import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ActorService } from '../../../common/authz/actor.service';
import { AuditService } from '../../../common/audit/audit.service';
import type { Actor } from '../../../common/authz/contract';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { DB, type Db, type Tx } from '../../../database/database.module';
import { aiPlanSteps, aiPlans } from '../../../database/schema';
import { ToolRunner } from '../tools/tool-runner';
import { digestObservation, planHash } from './plan-hash';

type PlanRow = typeof aiPlans.$inferSelect;
type StepRow = typeof aiPlanSteps.$inferSelect;

export type PlanOutcome = 'completed' | 'failed' | 'invalidated' | 'gone' | 'not_runnable';

/** An error's code as a plan or a step records it: lower-case, never the message. */
const codeOf = (e: AppError) => e.code.toLowerCase();

/**
 * Runs a plan its person confirmed (T-048, ADR-0006, ADR-0012) — in the worker, as that person, in
 * the workspace they confirmed it in, re-read by the job runner when the job starts.
 *
 * ```
 * plan locked (the job's tx) → still CONFIRMED or EXECUTING → steps still hash to the plan
 *   → the person as they are now, in the role they confirmed as
 *   → before the first step: every step observed again — the same state, or the confirmation is void
 *   → each step in order: re-authorized and run with its own idempotency key, progress persisted
 *   → COMPLETED, or FAILED at the first refused step (the rest SKIPPED)
 * ```
 *
 * **Resumes, never repeats.** The plan row is locked in the job's transaction for the whole run, so
 * two deliveries never run one plan at once, and the plan's own status commits with the job's claim.
 * Each step's progress is written outside that transaction, as it happens. A worker that dies loses
 * the transaction — the plan reads CONFIRMED again, the claim is gone, and the job is delivered again
 * — but not the steps: one finished stays finished, and is not run twice. A step left RUNNING is run
 * again with the same idempotency key, which every write tool honours (ADR-0012). So whether a plan
 * has started is read from its steps, which survive, and never from its status, which may not.
 *
 * **Re-checked once, before anything runs.** Every step is observed again while no step has started.
 * A resumed plan was checked when it started, and is not checked again: a step left RUNNING may
 * already have taken effect, and its own effect is not a change the person did not see. Every step is
 * still re-authorized as it runs. Steps run in order and do not depend on each other (T-096 adds
 * dependencies).
 *
 * **Ends honestly.** Refused before any step ran, the plan is CANCELLED and its confirmation
 * INVALIDATED — nothing happened, and a fresh confirmation is needed. Refused after, it is FAILED:
 * some of it happened, and its steps say which.
 */
@Injectable()
export class PlanExecutor {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly runner: ToolRunner,
    private readonly actors: ActorService,
    private readonly audit: AuditService,
  ) {}

  async run(planId: string, tx: Tx, req: RequestContext): Promise<PlanOutcome> {
    const [plan] = await tx.select().from(aiPlans).where(eq(aiPlans.id, planId)).for('update');
    // Deleted with its session, or voided since: there is nothing to run, and nothing to retry.
    if (plan === undefined) return 'gone';
    if (plan.status !== 'CONFIRMED' && plan.status !== 'EXECUTING') return 'not_runnable';
    const steps = await tx
      .select()
      .from(aiPlanSteps)
      .where(eq(aiPlanSteps.planId, planId))
      .orderBy(asc(aiPlanSteps.ordinal));

    // What survives a dead worker is the steps' progress, so that is what says the plan has started.
    const started = steps.some((s) => s.status !== 'PENDING');
    const refuse = (reason: string) =>
      started
        ? this.fail(tx, plan, steps, reason, req)
        : this.invalidate(tx, plan, steps, reason, req);

    if (planHash({ id: plan.id, sessionId: plan.sessionId, steps }) !== plan.planHash) {
      return refuse('hash_mismatch');
    }

    let actor: Actor;
    try {
      actor = await this.actors.forJob(plan.userId, plan.confirmedRole);
    } catch (e) {
      if (e instanceof AppError) return refuse('account_refused');
      throw e;
    }
    // Confirmed as one role: run as it, or not at all. A narrowing that no longer holds would widen.
    if (plan.confirmedRole !== null && actor.activeRole !== plan.confirmedRole) {
      return refuse('role_revoked');
    }

    const remaining = steps.filter((s) => s.status === 'PENDING' || s.status === 'RUNNING');
    for (const step of remaining) {
      const tool = this.runner.find(step.tool);
      if (tool === undefined) return refuse('tool_unavailable');
      if (started) continue;
      try {
        const now = digestObservation(await this.runner.observe(actor, tool, step.arguments, req));
        if (now !== step.observed) return refuse('state_changed');
      } catch (e) {
        if (e instanceof AppError) return refuse(`recheck_${codeOf(e)}`);
        throw e;
      }
    }

    await this.executing(tx, plan);
    for (const step of remaining) {
      const tool = this.runner.find(step.tool)!;
      if (step.status === 'PENDING') await this.progress(step, { status: 'RUNNING' });
      let result: unknown;
      try {
        result = await this.runner.runConfirmed(actor, tool, step.arguments, req, {
          idempotencyKey: `ai-plan:${plan.id}:${step.ordinal}`,
        });
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        await this.progress(step, { status: 'FAILED', error: codeOf(e) });
        return this.fail(tx, plan, steps.slice(step.ordinal), 'step_failed', req);
      }
      await this.progress(step, { status: 'DONE', result: result as Record<string, unknown> });
    }

    const now = new Date();
    await tx
      .update(aiPlans)
      .set({ status: 'COMPLETED', finishedAt: now, updatedAt: now })
      .where(eq(aiPlans.id, planId));
    await this.record(plan, 'ai_plan.completed', undefined, req, tx);
    return 'completed';
  }

  /**
   * A step's progress, committed now — outside the job's transaction, so a worker that dies after
   * this keeps it. Runs in the job's restored context: row-level security applies as it does to the
   * person.
   */
  private async progress(
    step: StepRow,
    to:
      | { status: 'RUNNING' }
      | { status: 'DONE'; result: Record<string, unknown> }
      | { status: 'FAILED'; error: string },
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(aiPlanSteps)
      .set(
        to.status === 'RUNNING'
          ? { status: 'RUNNING', startedAt: now }
          : to.status === 'DONE'
            ? { status: 'DONE', result: to.result, finishedAt: now }
            : { status: 'FAILED', error: to.error, finishedAt: now },
      )
      .where(eq(aiPlanSteps.id, step.id));
  }

  /** Something the confirmation was given against changed: it no longer covers the plan. */
  private async invalidate(
    tx: Tx,
    plan: PlanRow,
    steps: readonly StepRow[],
    reason: string,
    req: RequestContext,
  ): Promise<PlanOutcome> {
    await this.stop(
      tx,
      plan,
      steps,
      { status: 'CANCELLED', confirmationStatus: 'INVALIDATED' },
      reason,
    );
    await this.record(plan, 'ai_plan.invalidated', reason, req, tx);
    return 'invalidated';
  }

  /** Part of the plan ran and the rest will not: FAILED, by way of EXECUTING as the trigger requires. */
  private async fail(
    tx: Tx,
    plan: PlanRow,
    steps: readonly StepRow[],
    reason: string,
    req: RequestContext,
  ): Promise<PlanOutcome> {
    await this.executing(tx, plan);
    await this.stop(tx, plan, steps, { status: 'FAILED' }, reason);
    await this.record(plan, 'ai_plan.failed', reason, req, tx);
    return 'failed';
  }

  /** EXECUTING, in the job's transaction — from CONFIRMED, which is what it reads after a dead worker. */
  private async executing(tx: Tx, plan: PlanRow): Promise<void> {
    await tx
      .update(aiPlans)
      .set({ status: 'EXECUTING', updatedAt: new Date() })
      .where(and(eq(aiPlans.id, plan.id), eq(aiPlans.status, 'CONFIRMED')));
  }

  /** The plan ends here; every step that had not run is SKIPPED with it. */
  private async stop(
    tx: Tx,
    plan: PlanRow,
    steps: readonly StepRow[],
    to: Partial<Pick<PlanRow, 'status' | 'confirmationStatus'>>,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const waiting = steps.filter((s) => s.status === 'PENDING').map((s) => s.id);
    if (waiting.length > 0) {
      await tx
        .update(aiPlanSteps)
        .set({ status: 'SKIPPED', finishedAt: now })
        .where(and(inArray(aiPlanSteps.id, waiting), eq(aiPlanSteps.status, 'PENDING')));
    }
    await tx
      .update(aiPlans)
      .set({ ...to, reason, finishedAt: now, updatedAt: now })
      .where(eq(aiPlans.id, plan.id));
  }

  private async record(
    plan: PlanRow,
    action: string,
    reason: string | undefined,
    req: RequestContext,
    tx: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: req.correlationId,
        actorId: plan.userId,
        action,
        resourceType: 'ai_plan',
        resourceId: plan.id,
        reason,
      },
      tx,
    );
  }
}
