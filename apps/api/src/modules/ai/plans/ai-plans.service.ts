import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { currentContext } from '../../../common/context/execution-context';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { DB, type Db, type Tx } from '../../../database/database.module';
import {
  aiMessages,
  aiPlanSteps,
  aiPlans,
  aiSessions,
  auditLogs,
  outboxEvents,
} from '../../../database/schema';
import { ToolRunner } from '../tools/tool-runner';
import { digestObservation, planHash, type HashedStep } from './plan-hash';
import { buildTimeline, PLAN_ACTIONS, type Outcome, type PlanTimeline } from './plan-timeline';

type PlanRow = typeof aiPlans.$inferSelect;
type StepRow = typeof aiPlanSteps.$inferSelect;

/** How long a proposal waits for its person. Past it, what it was about may have moved on. */
export const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * How long a confirmed plan may wait for the worker to start it (T-224). Past it, the plan is invalid
 * (`confirmation_stale`) and the person confirms again: what they confirmed may have moved on. A plan
 * that has started finishes whenever its worker returns.
 */
export const EXECUTION_DEADLINE_MS = 15 * 60 * 1000;
/** A plan is something a person reads before confirming; bulk is a command of its own (T-095). */
export const MAX_STEPS = 10;
/** The event a confirmation writes, in its transaction; the worker runs the plan from it. */
export const PLAN_CONFIRMED = 'ai.plan.confirmed';
/**
 * The event a plan the worker was running writes when it ends without doing what was asked — FAILED,
 * or voided before it ran — in the transaction that ends it. Its person is notified from it (T-226).
 */
export const PLAN_ENDED = 'ai.plan.ended';

export type ConfirmationView = PlanRow['confirmationStatus'] | 'EXPIRED';

export interface PlanStepView {
  ordinal: number;
  tool: string;
  arguments: Record<string, unknown>;
  status: StepRow['status'];
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface PlanView {
  id: string;
  sessionId: string;
  /** What the client sends back to confirm: the plan as it was shown, and no other. */
  planHash: string;
  status: PlanRow['status'];
  confirmation: ConfirmationView;
  reason: string | null;
  expiresAt: string;
  confirmedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  steps: PlanStepView[];
}

/** A write the assistant wants to do: which tool, with what. Checked by the tool's own schema. */
export interface ProposedStep {
  tool: string;
  arguments: unknown;
}

/**
 * Plans and their confirmation (ADR-0006, ADR-0012, T-048).
 *
 * ```
 * propose (the assistant)   tools prepared as the caller → steps fixed → hash → PROPOSED, audited
 * confirm (the person)      own plan → still PROPOSED → not expired → the hash they saw → steps
 *                           still hash to it → CONFIRMED once + ai.plan.confirmed event, one tx
 * decline (the person)      own PROPOSED plan → CANCELLED / DECLINED
 * ```
 *
 * The model proposes and never confirms: confirming is a person's authenticated request, and no
 * tool reaches it. Everything here is the caller's own — row-level security admits a plan to its
 * session's user in its session's workspace — so another person's plan, or the caller's own from
 * another workspace, is the same 404 as one that does not exist. Running a confirmed plan is the
 * worker's (`PlanExecutor`), which checks everything again first.
 */
@Injectable()
export class AiPlansService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly runner: ToolRunner,
  ) {}

  /**
   * For the assistant, not a route. Each step is prepared through the tool registry as the caller —
   * account, workspace, role, rate limit, strict arguments — and observed, never run. The plan and
   * its steps are written in one transaction, already hashed.
   */
  async propose(
    actor: Actor,
    sessionId: string,
    steps: readonly ProposedStep[],
    req: RequestContext,
  ): Promise<PlanView> {
    const c = ctx('ai_plan.propose', req, sessionId);
    await this.enter(actor, c);
    await this.session(actor, sessionId, c);
    if (steps.length === 0 || steps.length > MAX_STEPS) {
      throw AppError.validation([
        { field: 'steps', code: 'RANGE', messageKey: 'error.validation.assistant_tool.invalid' },
      ]);
    }

    const prepared: HashedStep[] = [];
    for (const [i, step] of steps.entries()) {
      const tool = this.runner.find(step.tool);
      if (tool === undefined) {
        throw AppError.validation([
          {
            field: `steps.${i}.tool`,
            code: 'UNKNOWN',
            messageKey: 'error.validation.assistant_tool.invalid',
          },
        ]);
      }
      const { arguments: args, observed } = await this.runner.prepare(
        actor,
        tool,
        step.arguments,
        req,
      );
      prepared.push({
        ordinal: i + 1,
        tool: tool.name,
        // As parsed: what runs is what the schema produced, and that is what the person confirms.
        arguments: args as Record<string, unknown>,
        observed: digestObservation(observed),
      });
    }

    const id = randomUUID();
    const hash = planHash({ id, sessionId, steps: prepared });
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [plan] = await tx
        .insert(aiPlans)
        .values({ id, sessionId, planHash: hash, expiresAt: new Date(now.getTime() + PLAN_TTL_MS) })
        .returning();
      const rows = await tx
        .insert(aiPlanSteps)
        .values(prepared.map((s) => ({ planId: id, sessionId, ...s })))
        .returning();
      // Which tools, and how many — never their arguments, which can be the person's own words.
      await this.record(
        actor,
        c,
        'ai_plan.proposed',
        id,
        prepared.map((s) => s.tool).join(','),
        tx,
      );
      return view(plan!, rows, now);
    });
  }

  /**
   * A session's plans, newest first. `open` keeps those not yet ended: proposals still waiting for an
   * answer, and confirmed plans until they finish — a stuck one stays in view (T-224).
   */
  async list(
    actor: Actor,
    sessionId: string,
    query: { open?: boolean | undefined },
    req: RequestContext,
  ): Promise<PlanView[]> {
    const c = ctx('ai_plan.list', req, sessionId);
    await this.enter(actor, c);
    await this.session(actor, sessionId, c);
    const now = new Date();
    const plans = await this.db
      .select()
      .from(aiPlans)
      .where(
        and(
          eq(aiPlans.sessionId, sessionId),
          query.open === true
            ? inArray(aiPlans.status, ['PROPOSED', 'CONFIRMED', 'EXECUTING'])
            : undefined,
        ),
      )
      .orderBy(desc(aiPlans.createdAt), desc(aiPlans.id))
      .limit(20);
    const open =
      query.open === true
        ? plans.filter((p) => p.status !== 'PROPOSED' || p.expiresAt > now)
        : plans;
    if (open.length === 0) return [];
    const steps = await this.db
      .select()
      .from(aiPlanSteps)
      .where(
        inArray(
          aiPlanSteps.planId,
          open.map((p) => p.id),
        ),
      )
      .orderBy(asc(aiPlanSteps.ordinal));
    return open.map((p) =>
      view(
        p,
        steps.filter((s) => s.planId === p.id),
        now,
      ),
    );
  }

  async get(
    actor: Actor,
    sessionId: string,
    planId: string,
    req: RequestContext,
  ): Promise<PlanView> {
    const c = ctx('ai_plan.get', req, planId);
    await this.enter(actor, c);
    await this.session(actor, sessionId, c);
    const plan = await this.plan(actor, sessionId, planId, c, this.db);
    return view(plan, await this.steps(planId, this.db));
  }

  /**
   * One plan from proposal to its last step (T-214): the caller's own, as `get` admits it. Its audit
   * rows are the plan's own lifecycle, and the tool calls made under its confirmation's correlation id
   * as its person — never a refusal of someone else's look at it, never an address, a device or an
   * argument. A row written in the system context (a dead-lettered run's end) belongs to no workspace
   * and is not among them; the plan's own row still says how it ended.
   */
  async timeline(
    actor: Actor,
    sessionId: string,
    planId: string,
    req: RequestContext,
  ): Promise<PlanTimeline> {
    const c = ctx('ai_plan.timeline', req, planId);
    await this.enter(actor, c);
    await this.session(actor, sessionId, c);
    const plan = await this.plan(actor, sessionId, planId, c, this.db);
    const steps = await this.steps(planId, this.db);

    const own = await this.db
      .select({
        occurredAt: auditLogs.occurredAt,
        action: auditLogs.action,
        reason: auditLogs.reason,
        correlationId: auditLogs.correlationId,
        resourceType: auditLogs.resourceType,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, 'ai_plan'),
          eq(auditLogs.resourceId, planId),
          inArray(auditLogs.action, [...PLAN_ACTIONS]),
          eq(auditLogs.actorId, plan.userId),
        ),
      );
    const correlationId = own.find((a) => a.action === 'ai_plan.confirmed')?.correlationId ?? null;
    const calls =
      correlationId === null
        ? []
        : await this.db
            .select({
              occurredAt: auditLogs.occurredAt,
              action: auditLogs.action,
              reason: auditLogs.reason,
              correlationId: auditLogs.correlationId,
              resourceType: auditLogs.resourceType,
            })
            .from(auditLogs)
            .where(
              and(
                eq(auditLogs.resourceType, 'assistant_tool'),
                eq(auditLogs.correlationId, correlationId),
                eq(auditLogs.actorId, plan.userId),
                or(
                  sql`${auditLogs.reason} LIKE 'ok: confirmed:%'`,
                  eq(auditLogs.reason, 'rejected: invalid arguments'),
                ),
              ),
            );

    // How it ended is what the database wrote from the steps when it ended (migration 0045).
    const [told] = await this.db
      .select({ event: aiMessages.event })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.sessionId, sessionId),
          eq(aiMessages.kind, 'PLAN_OUTCOME'),
          sql`${aiMessages.event} ->> 'planId' = ${planId}`,
        ),
      );
    const outcome = (told?.event?.['outcome'] as Outcome | undefined) ?? null;
    return buildTimeline(plan, steps, [...own, ...calls], outcome, correlationId);
  }

  /**
   * The person's yes, to exactly the plan they were shown. Once: the plan must still be PROPOSED,
   * unexpired, carry the hash the client sends, and its stored steps must still hash to it — a step
   * rewritten under the plan is caught here as well as by the trigger that forbids it. The plan
   * becomes CONFIRMED and the event the worker runs it from is written in the same transaction.
   */
  async confirm(
    actor: Actor,
    sessionId: string,
    planId: string,
    shownHash: string,
    req: RequestContext,
  ): Promise<PlanView> {
    const c = ctx('ai_plan.confirm', req, planId);
    await this.enter(actor, c);
    await this.session(actor, sessionId, c);

    const outcome = await this.db.transaction(async (tx) => {
      const plan = await this.plan(actor, sessionId, planId, c, tx, true);
      const steps = await this.steps(planId, tx);
      const now = new Date();
      if (plan.status !== 'PROPOSED') return { refused: 'not_pending' as const };
      if (plan.expiresAt <= now) return { refused: 'expired' as const };
      if (shownHash !== plan.planHash) return { refused: 'changed' as const };
      if (planHash({ id: plan.id, sessionId, steps }) !== plan.planHash) {
        // The rows no longer say what was hashed. Nothing confirms this plan, ever.
        await tx
          .update(aiPlans)
          .set({
            status: 'CANCELLED',
            confirmationStatus: 'INVALIDATED',
            reason: 'hash_mismatch',
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(aiPlans.id, planId));
        await this.record(actor, c, 'ai_plan.invalidated', planId, 'hash_mismatch', tx);
        return { refused: 'changed' as const };
      }

      const [confirmed] = await tx
        .update(aiPlans)
        .set({
          status: 'CONFIRMED',
          confirmationStatus: 'CONFIRMED',
          confirmedAt: now,
          confirmedRole: actor.activeRole ?? null,
          updatedAt: now,
        })
        .where(and(eq(aiPlans.id, planId), eq(aiPlans.status, 'PROPOSED')))
        .returning();
      await tx.insert(outboxEvents).values({
        aggregateType: 'ai_plan',
        aggregateId: planId,
        eventType: PLAN_CONFIRMED,
        // The request's id travels with the event into the job, so every step joins to it (T-212).
        payload: {
          planId,
          ...(req.correlationId !== undefined && { correlationId: req.correlationId }),
        },
        correlationId: req.correlationId ?? null,
      });
      await this.record(actor, c, 'ai_plan.confirmed', planId, undefined, tx);
      return { view: view(confirmed!, steps, now) };
    });

    if ('refused' in outcome) {
      throw AppError.conflictOn('plan', outcome.refused.toUpperCase(), REFUSAL[outcome.refused]);
    }
    return outcome.view;
  }

  /** The person's no. Only a plan still waiting for them; nothing of it runs. */
  async decline(
    actor: Actor,
    sessionId: string,
    planId: string,
    req: RequestContext,
  ): Promise<PlanView> {
    const c = ctx('ai_plan.decline', req, planId);
    await this.enter(actor, c);
    await this.session(actor, sessionId, c);
    const outcome = await this.db.transaction(async (tx) => {
      const plan = await this.plan(actor, sessionId, planId, c, tx, true);
      if (plan.status !== 'PROPOSED') return undefined;
      const now = new Date();
      const [declined] = await tx
        .update(aiPlans)
        .set({
          status: 'CANCELLED',
          confirmationStatus: 'DECLINED',
          reason: 'declined',
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(aiPlans.id, planId))
        .returning();
      await this.record(actor, c, 'ai_plan.declined', planId, undefined, tx);
      return view(declined!, await this.steps(planId, tx), now);
    });
    if (outcome === undefined) {
      throw AppError.conflictOn('plan', 'NOT_PENDING', REFUSAL.not_pending);
    }
    return outcome;
  }

  /** A live account, in a workspace: a plan belongs to exactly one, through its session. */
  private async enter(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireWorkspace(actor, currentContext() !== undefined, c);
  }

  /** The caller's own live session, or the 404 an unknown one gets. */
  private async session(actor: Actor, sessionId: string, c: AuthzContext): Promise<void> {
    const [row] = await this.db
      .select({ id: aiSessions.id })
      .from(aiSessions)
      .where(and(eq(aiSessions.id, sessionId), isNull(aiSessions.deletedAt)));
    await this.authz.visible(actor, row, c);
  }

  /** The caller's plan in that session — row-level security has already narrowed to their own. */
  private async plan(
    actor: Actor,
    sessionId: string,
    planId: string,
    c: AuthzContext,
    db: Db | Tx,
    lock = false,
  ): Promise<PlanRow> {
    const query = db
      .select()
      .from(aiPlans)
      .where(and(eq(aiPlans.id, planId), eq(aiPlans.sessionId, sessionId)));
    const [row] = await (lock ? query.for('update') : query);
    return this.authz.visible(actor, row, c);
  }

  private steps(planId: string, db: Db | Tx): Promise<StepRow[]> {
    return db
      .select()
      .from(aiPlanSteps)
      .where(eq(aiPlanSteps.planId, planId))
      .orderBy(asc(aiPlanSteps.ordinal));
  }

  private async record(
    actor: Actor,
    c: AuthzContext,
    action: string,
    planId: string,
    reason?: string,
    tx?: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        action,
        resourceType: 'ai_plan',
        resourceId: planId,
        reason,
      },
      tx,
    );
  }
}

const REFUSAL = {
  not_pending: 'error.validation.ai_plan.not_pending',
  expired: 'error.validation.ai_plan.expired',
  changed: 'error.validation.ai_plan.changed',
} as const;

const ctx = (action: string, req: RequestContext, resourceId?: string): AuthzContext => ({
  action,
  resourceType: 'ai_plan',
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});

/** Expiry is read, never stored: a proposal past its time is EXPIRED to anyone who looks. */
export function view(plan: PlanRow, steps: readonly StepRow[], now = new Date()): PlanView {
  return {
    id: plan.id,
    sessionId: plan.sessionId,
    planHash: plan.planHash,
    status: plan.status,
    confirmation:
      plan.status === 'PROPOSED' && plan.expiresAt <= now ? 'EXPIRED' : plan.confirmationStatus,
    reason: plan.reason,
    expiresAt: plan.expiresAt.toISOString(),
    confirmedAt: plan.confirmedAt?.toISOString() ?? null,
    finishedAt: plan.finishedAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    steps: steps.map((s) => ({
      ordinal: s.ordinal,
      tool: s.tool,
      arguments: s.arguments,
      status: s.status,
      result: s.result ?? null,
      error: s.error,
    })),
  };
}
