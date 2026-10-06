import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { person, planJob, planStack, req, TallyTool } from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { asRequests, personalContext } from '../../../../test/workspace-context';
import { runInContext } from '../../../common/context/execution-context';
import type { JobEnvelope } from '../../../common/jobs/job';
import type { JobQueue } from '../../../common/jobs/job-queue';
import type { OutboxEvent } from '../../../common/jobs/outbox-delivery.handler';
import type { PlanExecutor } from './plan-executor';
import { PLAN_CONFIRMED } from './ai-plans.service';
import { ExecutePlanHandler, PlanConfirmedTrigger } from './execute-plan.handler';

/**
 * One correlation id from the person's confirmation to the last step (T-212). The plan runs in the
 * worker, later, under a job; without this, its audit rows carried the job's id and could not be
 * joined to the request that confirmed it.
 */
describe('a confirmed plan carries its request’s correlation id (T-212)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const correlationsOf = (planId: string, userId: string) =>
    owner<{ action: string; correlation: string | null }[]>`
      SELECT action, correlation_id AS correlation FROM audit_logs
       WHERE (resource_id = ${planId} AND action LIKE 'ai_plan.%' AND action <> 'ai_plan.proposed')
          OR (action = 'ai.tool.add_to_tally' AND actor_id = ${userId} AND reason LIKE 'ok: confirmed%')
       ORDER BY occurred_at, action`;

  it('joins confirm → outbox → job → every step’s audit row on one id', async () => {
    const me = await person(owner);
    const stack = planStack(sql, [new TallyTool()]);
    const plans = asRequests(stack.plans, owner);
    const session = await asRequests(stack.sessions, owner).create(me, {}, req());
    const plan = await plans.propose(
      me,
      session.id,
      [1, 2].map((amount) => ({ tool: 'addToTally', arguments: { name: 'rent', amount } })),
      req(),
    );
    const confirming = { ...req(), correlationId: `confirm-${randomUUID()}` };
    await plans.confirm(me, session.id, plan.id, plan.planHash, confirming);

    // The event as the outbox holds it, delivered to the trigger in the person's context.
    const [row] = await owner<{ id: string; payload: unknown; correlation: string }[]>`
      SELECT id, payload, correlation_id AS correlation FROM outbox_events WHERE aggregate_id = ${plan.id}`;
    expect(row!.correlation).toBe(confirming.correlationId);
    const queued: JobEnvelope[] = [];
    const trigger = new PlanConfirmedTrigger({
      enqueue: async (_q: string, e: JobEnvelope) => void queued.push(e),
    } as unknown as JobQueue);
    const event: OutboxEvent = {
      eventId: row!.id,
      eventType: PLAN_CONFIRMED,
      aggregateType: 'ai_plan',
      aggregateId: plan.id,
      data: row!.payload,
    };
    await runInContext(await personalContext(owner, me.userId), () => trigger.handle(event));

    await expect(stack.jobs.run(queued[0]!)).resolves.toBe('done');

    const rows = await correlationsOf(plan.id, me.userId);
    expect(rows.map((r) => r.action).sort()).toEqual([
      'ai.tool.add_to_tally',
      'ai.tool.add_to_tally',
      'ai_plan.completed',
      'ai_plan.confirmed',
    ]);
    expect(new Set(rows.map((r) => r.correlation))).toEqual(new Set([confirming.correlationId]));
  });

  it('runs a job queued before this change, under the job’s own id', async () => {
    const me = await person(owner);
    const stack = planStack(sql, [new TallyTool()]);
    const plans = asRequests(stack.plans, owner);
    const session = await asRequests(stack.sessions, owner).create(me, {}, req());
    const plan = await plans.propose(
      me,
      session.id,
      [{ tool: 'addToTally', arguments: { name: 'rent', amount: 1 } }],
      req(),
    );
    await plans.confirm(me, session.id, plan.id, plan.planHash, req());
    const job = await planJob(owner, me.userId, plan.id); // payload { planId } only
    await stack.jobs.run(job);
    const rows = (await correlationsOf(plan.id, me.userId)).filter(
      (r) => r.action !== 'ai_plan.confirmed',
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.correlation))).toEqual(new Set([job.jobId]));
  });

  it('takes a correlation id only as a short string', () => {
    const handler = new ExecutePlanHandler({} as PlanExecutor);
    const planId = randomUUID();
    expect(handler.parse({ planId, correlationId: 'c-1' })).toEqual({
      planId,
      correlationId: 'c-1',
    });
    expect(handler.parse({ planId })).toEqual({ planId });
    for (const correlationId of [42, '', 'x'.repeat(201)]) {
      expect(() => handler.parse({ planId, correlationId })).toThrow('not a plan');
    }
  });
});
