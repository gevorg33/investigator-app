import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import { ActorService } from '../src/common/authz/actor.service';
import { AuditService } from '../src/common/audit/audit.service';
import { AuthzService } from '../src/common/authz/authz.service';
import type { Actor, Role } from '../src/common/authz/contract';
import { PlatformContext } from '../src/common/context/platform-context';
import { WorkspaceResolver } from '../src/common/context/workspace.resolver';
import { AppError } from '../src/common/errors/app-error';
import { envelopeAs } from '../src/common/jobs/job';
import { JobRunner } from '../src/common/jobs/job-runner';
import { AiSessionsService } from '../src/modules/ai-sessions/ai-sessions.service';
import { AiPlansService } from '../src/modules/ai/plans/ai-plans.service';
import { EXECUTE_PLAN, ExecutePlanHandler } from '../src/modules/ai/plans/execute-plan.handler';
import { PlanExecutor } from '../src/modules/ai/plans/plan-executor';
import type { AssistantTool, ToolEffect } from '../src/modules/ai/tools/assistant-tool';
import { ToolRunner } from '../src/modules/ai/tools/tool-runner';
import { MemoryRateLimitStore, RateLimitService } from '../src/modules/auth/rate-limit.service';
import { SessionService } from '../src/modules/auth/session.service';
import { TokenService } from '../src/modules/auth/token.service';
import { personalContext, scopedDb } from './workspace-context';
import { member } from './workspace-fixtures';

export interface Tally {
  name: string;
  amount: number;
}

/** What to do the next time a step with this key runs — a way to kill a worker at a chosen moment. */
export type Fault = 'crash_before' | 'crash_after' | AppError;

/**
 * A write tool over a resource that lives here rather than in a table: tallies, each with a version.
 * It keeps the write-tool contract the way a real one must — `observe` reads what it would act on,
 * and `execute` is idempotent on the step's key — so a spec can kill a worker before or after the
 * effect and see the plan resume without doing anything twice.
 */
export class TallyTool implements AssistantTool<Tally, { name: string; total: number }> {
  readonly name = 'addToTally';
  readonly description = 'Adds to a named tally.';
  // Two roles, so a spec can show a plan confirmed as one does not run as the other.
  readonly requiredRoles: readonly Role[] = ['CUSTOMER', 'INVESTIGATOR'];
  readonly resourceScope = 'own' as const;
  readonly operation = 'write' as const;
  readonly confirmation = 'required' as const;
  readonly input = z.strictObject({
    name: z.string().min(1).max(20),
    amount: z.number().int().min(1).max(100),
  });
  readonly output = z.object({ name: z.string(), total: z.number() });
  readonly auditEvent = 'ai.tool.add_to_tally';
  readonly rateLimit = { perMinute: 100 };

  readonly totals = new Map<string, number>();
  /** Each tally's version: what `observe` reports, and what a change elsewhere moves. */
  readonly versions = new Map<string, number>();
  /** Every key `execute` was called with, repeats included. */
  readonly calls: string[] = [];
  /** Every key that took effect — once each, however often it was called. */
  readonly applied = new Map<string, { name: string; total: number }>();
  readonly faults = new Map<string, Fault>();

  auditArguments(input: Tally): string {
    return `amount=${input.amount}`;
  }

  async observe(_actor: Actor, input: Tally): Promise<unknown> {
    return { name: input.name, version: this.versions.get(input.name) ?? 0 };
  }

  /** Something other than the plan changes the tally — what a confirmation must not survive. */
  touch(name: string): void {
    this.versions.set(name, (this.versions.get(name) ?? 0) + 1);
  }

  async execute(
    _actor: Actor,
    input: Tally,
    _req: unknown,
    effect?: ToolEffect,
  ): Promise<{ name: string; total: number }> {
    if (effect === undefined) throw new Error('a write runs only as a confirmed step');
    const key = effect.idempotencyKey;
    this.calls.push(key);
    const fault = this.faults.get(key);
    this.faults.delete(key);
    if (fault instanceof AppError) throw fault;
    if (fault === 'crash_before') throw new Error('the worker died before the effect');
    const done = this.applied.get(key);
    if (done !== undefined) return done;
    const total = (this.totals.get(input.name) ?? 0) + input.amount;
    this.totals.set(input.name, total);
    this.applied.set(key, { name: input.name, total });
    if (fault === 'crash_after') throw new Error('the worker died after the effect');
    return { name: input.name, total };
  }
}

/**
 * The plans stack as the API and the worker build it, over `sql` — once per "process": building it
 * twice is an API or a worker restarted, with nothing carried over but the database.
 */
export function planStack(sql: postgres.Sql, tools: AssistantTool[]) {
  const db = scopedDb(sql);
  const audit = new AuditService(db);
  const authz = new AuthzService(audit);
  const runner = new ToolRunner(
    authz,
    audit,
    new RateLimitService(new MemoryRateLimitStore()),
    tools as never,
  );
  const tokens = new TokenService();
  const executor = new PlanExecutor(
    db,
    runner,
    new ActorService(db, tokens, new SessionService(tokens)),
    audit,
  );
  return {
    db,
    runner,
    plans: new AiPlansService(db, authz, audit, runner),
    sessions: new AiSessionsService(db, authz, audit),
    executor,
    jobs: new JobRunner(db, new WorkspaceResolver(db, authz), new PlatformContext(audit), [
      new ExecutePlanHandler(executor),
    ]),
  };
}

/** A signed-in person with real role rows — what the worker reads them from when the plan runs. */
export async function person(owner: postgres.Sql, roles: Role[] = ['CUSTOMER']): Promise<Actor> {
  const { actor } = await member(owner, { roles });
  for (const role of roles) {
    await owner`INSERT INTO user_roles (user_id, role) VALUES (${actor.userId}, ${role})`;
  }
  return actor;
}

/** The job a confirmed plan becomes, in its person's Personal workspace — as the trigger queues it. */
export async function planJob(owner: postgres.Sql, userId: string, planId: string) {
  const c = await personalContext(owner, userId);
  return envelopeAs(
    { tenantId: c.tenantId, userId, membershipId: c.membershipId },
    EXECUTE_PLAN,
    `ai-plan-${planId}`,
    { planId },
  );
}

export const req = () => ({
  ip: '198.51.100.48',
  userAgent: 'vitest',
  correlationId: randomUUID(),
});
