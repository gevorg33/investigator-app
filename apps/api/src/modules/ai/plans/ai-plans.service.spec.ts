import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { person, planStack, req, TallyTool } from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { agencyContext, asRequests, personalContext } from '../../../../test/workspace-context';
import { agency } from '../../../../test/workspace-fixtures';
import type { Actor } from '../../../common/authz/contract';
import { runInContext } from '../../../common/context/execution-context';
import type { JobEnvelope } from '../../../common/jobs/job';
import type { JobQueue } from '../../../common/jobs/job-queue';
import type { OutboxEvent } from '../../../common/jobs/outbox-delivery.handler';
import { MAX_STEPS, PLAN_CONFIRMED, PLAN_TTL_MS, view } from './ai-plans.service';
import { EXECUTE_PLAN, ExecutePlanHandler, PlanConfirmedTrigger } from './execute-plan.handler';
import type { PlanExecutor } from './plan-executor';
import { digestObservation, planHash } from './plan-hash';

/**
 * Plans and their confirmation (T-048): what the assistant proposes is fixed and hashed before
 * anyone sees it; the person confirms exactly that, once; and the confirmation lives in PostgreSQL,
 * so nothing about it depends on the browser, the API process or the worker that was running.
 */
describe('assistant plans and confirmation (T-048)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  /** A stack as one API process builds it, entered as requests are. */
  const api = (tool = new TallyTool()) => {
    const stack = planStack(sql, [tool]);
    return {
      tool,
      plans: asRequests(stack.plans, owner),
      sessions: asRequests(stack.sessions, owner),
    };
  };
  const tally = (name: string, amount: number) => ({
    tool: 'addToTally',
    arguments: { name, amount },
  });
  const auditOf = (planId: string) =>
    owner<{ action: string; reason: string | null }[]>`
      SELECT action, reason FROM audit_logs WHERE resource_id = ${planId} ORDER BY occurred_at`;

  describe('proposing', () => {
    it('fixes and hashes the steps as parsed, observes them, and runs nothing', async () => {
      const me = await person(owner);
      const { tool, plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      tool.touch('rent');

      const plan = await plans.propose(me, session.id, [tally('rent', 3), tally('food', 1)], req());

      expect(plan).toMatchObject({
        sessionId: session.id,
        status: 'PROPOSED',
        confirmation: 'PENDING',
        reason: null,
        confirmedAt: null,
        finishedAt: null,
      });
      expect(plan.steps).toEqual([
        {
          ordinal: 1,
          tool: 'addToTally',
          arguments: { name: 'rent', amount: 3 },
          status: 'PENDING',
          result: null,
          error: null,
        },
        {
          ordinal: 2,
          tool: 'addToTally',
          arguments: { name: 'food', amount: 1 },
          status: 'PENDING',
          result: null,
          error: null,
        },
      ]);
      expect(tool.calls).toEqual([]);

      const [stored] = await owner<{ observed: string }[]>`
        SELECT observed FROM ai_plan_steps WHERE plan_id = ${plan.id} AND ordinal = 1`;
      expect(stored!.observed).toBe(digestObservation({ name: 'rent', version: 1 }));
      expect(plan.planHash).toBe(
        planHash({
          id: plan.id,
          sessionId: session.id,
          steps: [
            {
              ordinal: 1,
              tool: 'addToTally',
              arguments: { name: 'rent', amount: 3 },
              observed: stored!.observed,
            },
            {
              ordinal: 2,
              tool: 'addToTally',
              arguments: { name: 'food', amount: 1 },
              observed: digestObservation({ name: 'food', version: 0 }),
            },
          ],
        }),
      );
      expect(new Date(plan.expiresAt).getTime() - new Date(plan.createdAt).getTime()).toBeCloseTo(
        PLAN_TTL_MS,
        -4,
      );
      // Which tools — never their arguments, which can be the person's own words.
      expect(await auditOf(plan.id)).toEqual([
        { action: 'ai_plan.proposed', reason: 'addToTally,addToTally' },
      ]);
    });

    it('refuses an empty plan, one too long, an unknown tool, or arguments the tool does not take — and stores none', async () => {
      const me = await person(owner);
      const { plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      const refusals: unknown[][] = [
        [],
        Array.from({ length: MAX_STEPS + 1 }, () => tally('x', 1)),
        [{ tool: 'dropTables', arguments: {} }],
        [{ tool: 'addToTally', arguments: { name: 'x', amount: 1, userId: me.userId } }],
      ];
      for (const steps of refusals) {
        await expect(plans.propose(me, session.id, steps as never, req())).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
        });
      }
      const [n] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ai_plans WHERE session_id = ${session.id}`;
      expect(n!.n).toBe(0);
    });

    it('takes the full ten steps a person can read', async () => {
      const me = await person(owner);
      const { plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      const steps = Array.from({ length: MAX_STEPS }, (_, i) => tally(`t${i}`, 1));
      expect((await plans.propose(me, session.id, steps, req())).steps).toHaveLength(MAX_STEPS);
    });

    it('lists a session’s plans newest first, and the open ones alone on request', async () => {
      const me = await person(owner);
      const { plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      expect(await plans.list(me, session.id, {}, req())).toEqual([]);
      const first = await plans.propose(me, session.id, [tally('a', 1)], req());
      const second = await plans.propose(me, session.id, [tally('b', 1)], req());
      await plans.decline(me, session.id, first.id, req());

      expect((await plans.list(me, session.id, {}, req())).map((p) => p.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect((await plans.list(me, session.id, { open: true }, req())).map((p) => p.id)).toEqual([
        second.id,
      ]);
      expect(await plans.get(me, session.id, second.id, req())).toEqual(second);
    });
  });

  describe('confirming', () => {
    it('confirms once, for the hash shown, and writes the event the worker runs it from in the same transaction', async () => {
      const me = await person(owner, ['CUSTOMER', 'INVESTIGATOR']);
      const { plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      const plan = await plans.propose(me, session.id, [tally('a', 1)], req());
      const asCustomer = { ...me, activeRole: 'CUSTOMER' as const };

      const confirming = req();
      const confirmed = await plans.confirm(
        asCustomer,
        session.id,
        plan.id,
        plan.planHash,
        confirming,
      );
      expect(confirmed).toMatchObject({ status: 'CONFIRMED', confirmation: 'CONFIRMED' });
      expect(confirmed.confirmedAt).not.toBeNull();

      const [row] = await owner<{ role: string | null }[]>`
        SELECT confirmed_role AS role FROM ai_plans WHERE id = ${plan.id}`;
      expect(row!.role).toBe('CUSTOMER');
      const events = await owner<{ type: string; payload: unknown; user: string }[]>`
        SELECT event_type AS type, payload, user_id AS user FROM outbox_events
         WHERE aggregate_id = ${plan.id}`;
      expect(events).toEqual([
        {
          type: PLAN_CONFIRMED,
          payload: { planId: plan.id, correlationId: confirming.correlationId },
          user: me.userId,
        },
      ]);

      // Once. A second yes, or a no after a yes, is refused and changes nothing.
      for (const again of [
        () => plans.confirm(me, session.id, plan.id, plan.planHash, req()),
        () => plans.decline(me, session.id, plan.id, req()),
      ]) {
        await expect(again()).rejects.toMatchObject({
          code: 'STATE_CONFLICT',
          details: [
            {
              field: 'plan',
              code: 'NOT_PENDING',
              messageKey: 'error.validation.ai_plan.not_pending',
            },
          ],
        });
      }
      expect((await plans.get(me, session.id, plan.id, req())).status).toBe('CONFIRMED');
      expect((await auditOf(plan.id)).map((a) => a.action)).toEqual([
        'ai_plan.proposed',
        'ai_plan.confirmed',
      ]);
    });

    it('refuses a hash that is not the plan’s, and leaves the plan to be confirmed as shown', async () => {
      const me = await person(owner);
      const { plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      const plan = await plans.propose(me, session.id, [tally('a', 1)], req());
      const other = await plans.propose(me, session.id, [tally('a', 2)], req());

      await expect(
        plans.confirm(me, session.id, plan.id, other.planHash, req()),
      ).rejects.toMatchObject({
        details: [{ code: 'CHANGED', messageKey: 'error.validation.ai_plan.changed' }],
      });
      expect((await plans.get(me, session.id, plan.id, req())).status).toBe('PROPOSED');
      await expect(
        plans.confirm(me, session.id, plan.id, plan.planHash, req()),
      ).resolves.toMatchObject({ status: 'CONFIRMED' });
    });

    it('refuses a plan past its time, which reads EXPIRED and is no longer open', async () => {
      const me = await person(owner);
      const { plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      const plan = await plans.propose(me, session.id, [tally('a', 1)], req());

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(new Date(plan.expiresAt).getTime() + 1));
      await expect(
        plans.confirm(me, session.id, plan.id, plan.planHash, req()),
      ).rejects.toMatchObject({
        details: [{ code: 'EXPIRED', messageKey: 'error.validation.ai_plan.expired' }],
      });
      expect((await plans.get(me, session.id, plan.id, req())).confirmation).toBe('EXPIRED');
      expect(await plans.list(me, session.id, { open: true }, req())).toEqual([]);
    });

    it('voids, rather than confirms, a plan whose stored steps no longer hash to it', async () => {
      const me = await person(owner);
      const { plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      const plan = await plans.propose(me, session.id, [tally('a', 1)], req());

      // The trigger refuses a rewritten step from any writer…
      await expect(
        owner`UPDATE ai_plan_steps SET arguments = '{"name":"a","amount":99}' WHERE plan_id = ${plan.id}`,
      ).rejects.toThrow(/ai_plan_step_fixed/);
      // …so this is a writer that went around the triggers, which confirmation must still catch.
      await owner.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`UPDATE ai_plan_steps SET arguments = '{"name":"a","amount":99}' WHERE plan_id = ${plan.id}`;
      });

      await expect(
        plans.confirm(me, session.id, plan.id, plan.planHash, req()),
      ).rejects.toMatchObject({ details: [{ code: 'CHANGED' }] });
      expect(await plans.get(me, session.id, plan.id, req())).toMatchObject({
        status: 'CANCELLED',
        confirmation: 'INVALIDATED',
        reason: 'hash_mismatch',
      });
      expect((await auditOf(plan.id)).at(-1)).toEqual({
        action: 'ai_plan.invalidated',
        reason: 'hash_mismatch',
      });
    });

    it('declines a plan still waiting, and nothing of it can be confirmed after', async () => {
      const me = await person(owner);
      const { plans, sessions } = api();
      const session = await sessions.create(me, {}, req());
      const plan = await plans.propose(me, session.id, [tally('a', 1)], req());

      expect(await plans.decline(me, session.id, plan.id, req())).toMatchObject({
        status: 'CANCELLED',
        confirmation: 'DECLINED',
        reason: 'declined',
      });
      await expect(
        plans.confirm(me, session.id, plan.id, plan.planHash, req()),
      ).rejects.toMatchObject({ details: [{ code: 'NOT_PENDING' }] });
      const [events] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ${plan.id}`;
      expect(events!.n).toBe(0);
    });
  });

  describe('a pending confirmation survives', () => {
    it('a closed browser, a restarted API and a restarted worker: a new process finds it and confirms it', async () => {
      const me = await person(owner);
      // The process that proposed it, gone afterwards with everything it held.
      const before = planStack(testPool(), [new TallyTool()]);
      const session = await asRequests(before.sessions, owner).create(me, {}, req());
      const plan = await asRequests(before.plans, owner).propose(
        me,
        session.id,
        [tally('a', 2)],
        req(),
      );

      // A fresh process — new pool, new services — and a client that only knows the session.
      const afterPool = testPool();
      const after = planStack(afterPool, [new TallyTool()]);
      const plans = asRequests(after.plans, owner);
      const open = await plans.list(me, session.id, { open: true }, req());
      expect(open).toEqual([plan]);
      await expect(
        plans.confirm(me, session.id, open[0]!.id, open[0]!.planHash, req()),
      ).resolves.toMatchObject({ status: 'CONFIRMED' });
      await afterPool.end();
    });
  });

  describe('a member who leaves the workspace', () => {
    it('has their open plans there voided — proposed or confirmed — and nobody else’s', async () => {
      const boss = await person(owner);
      const leaver = await person(owner);
      const firm = await agency(owner, [{ userId: boss.userId }, { userId: leaver.userId }]);
      const stack = planStack(sql, [new TallyTool()]);
      const inFirm = (actor: Actor) => agencyContext(owner, actor.userId, firm.tenantId);

      const open = async (actor: Actor) =>
        runInContext(await inFirm(actor), async () => {
          const s = await stack.sessions.create(actor, {}, req());
          return {
            session: s,
            plan: await stack.plans.propose(actor, s.id, [tally('a', 1)], req()),
          };
        });
      const waiting = await open(leaver);
      const confirmed = await open(leaver);
      await runInContext(await inFirm(leaver), () =>
        stack.plans.confirm(
          leaver,
          confirmed.session.id,
          confirmed.plan.id,
          confirmed.plan.planHash,
          req(),
        ),
      );
      const theirs = await open(boss);
      // Their plan in their own Personal workspace is not this workspace's to void.
      const personal = await runInContext(await personalContext(owner, leaver.userId), async () => {
        const s = await stack.sessions.create(leaver, {}, req());
        return stack.plans.propose(leaver, s.id, [tally('a', 1)], req());
      });

      await owner`UPDATE tenant_memberships SET status = 'REMOVED'
                   WHERE tenant_id = ${firm.tenantId} AND user_id = ${leaver.userId}`;

      const states = await owner<
        { id: string; status: string; confirmation: string; reason: string | null }[]
      >`
        SELECT id, status, confirmation_status AS confirmation, reason FROM ai_plans
         WHERE id IN (${waiting.plan.id}, ${confirmed.plan.id}, ${theirs.plan.id}, ${personal.id})`;
      const byId = Object.fromEntries(states.map(({ id, ...rest }) => [id, rest]));
      const voided = { status: 'CANCELLED', confirmation: 'VOIDED', reason: 'member_left' };
      expect(byId[waiting.plan.id]).toEqual(voided);
      expect(byId[confirmed.plan.id]).toEqual(voided);
      expect(byId[theirs.plan.id]).toMatchObject({ status: 'PROPOSED' });
      expect(byId[personal.id]).toMatchObject({ status: 'PROPOSED' });
    });
  });

  it('is erased with its session — plan, steps and all', async () => {
    const me = await person(owner);
    const { plans, sessions } = api();
    const session = await sessions.create(me, {}, req());
    const plan = await plans.propose(me, session.id, [tally('a', 1), tally('b', 1)], req());
    await sessions.delete(me, session.id, req());
    const [left] = await owner<{ plans: number; steps: number }[]>`
      SELECT (SELECT count(*)::int FROM ai_plans WHERE id = ${plan.id}) AS plans,
             (SELECT count(*)::int FROM ai_plan_steps WHERE plan_id = ${plan.id}) AS steps`;
    expect(left).toEqual({ plans: 0, steps: 0 });
    // And a deleted session takes no new plan.
    await expect(plans.propose(me, session.id, [tally('a', 1)], req())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('records a confirmation that arrived without a correlation id as having none', async () => {
    const me = await person(owner);
    const { plans, sessions } = api();
    const session = await sessions.create(me, {}, req());
    const plan = await plans.propose(me, session.id, [tally('a', 1)], req());
    await plans.confirm(me, session.id, plan.id, plan.planHash, {});
    const [event] = await owner<{ correlation: string | null }[]>`
      SELECT correlation_id AS correlation FROM outbox_events WHERE aggregate_id = ${plan.id}`;
    expect(event).toEqual({ correlation: null });
  });

  it('takes only a plan id as the job’s payload; anything else is not a job it runs', () => {
    const handler = new ExecutePlanHandler({} as PlanExecutor);
    const planId = randomUUID();
    expect(handler.parse({ planId })).toEqual({ planId });
    for (const payload of [null, {}, { planId: 42 }, { planId: 'latest' }]) {
      expect(() => handler.parse(payload)).toThrow('not a plan');
    }
    expect([handler.command, handler.queue]).toEqual([EXECUTE_PLAN, 'events']);
  });

  it('hands a confirmed plan to the worker as its person, keyed so it is queued once', async () => {
    const me = await person(owner);
    const queued: Array<[string, JobEnvelope]> = [];
    const trigger = new PlanConfirmedTrigger({
      enqueue: async (q: string, e: JobEnvelope) => void queued.push([q, e]),
    } as unknown as JobQueue);
    const context = await personalContext(owner, me.userId);
    const planId = randomUUID();
    const event: OutboxEvent = {
      eventId: randomUUID(),
      eventType: PLAN_CONFIRMED,
      aggregateType: 'ai_plan',
      aggregateId: planId,
      data: { planId },
    };
    await runInContext(context, () => trigger.handle(event));
    expect(trigger.eventType).toBe(PLAN_CONFIRMED);
    expect(queued).toEqual([
      [
        'events',
        {
          jobId: `${EXECUTE_PLAN}-ai-plan-${planId}`,
          key: `ai-plan-${planId}`,
          command: EXECUTE_PLAN,
          tenantId: context.tenantId,
          userId: me.userId,
          membershipId: context.membershipId,
          payload: { planId },
        },
      ],
    ]);
  });

  it('reads a proposal past its time as EXPIRED, and any other as its stored confirmation', () => {
    const at = new Date('2026-10-05T12:00:00Z');
    const row = {
      id: randomUUID(),
      sessionId: randomUUID(),
      planHash: 'a'.repeat(64),
      status: 'PROPOSED' as const,
      confirmationStatus: 'PENDING' as const,
      expiresAt: at,
      confirmedAt: null,
      confirmedRole: null,
      reason: null,
      finishedAt: null,
      createdAt: new Date(at.getTime() - 1000),
      updatedAt: at,
      tenantId: randomUUID(),
      userId: randomUUID(),
    };
    expect(view(row, [], at).confirmation).toBe('EXPIRED');
    expect(view(row, [], new Date(at.getTime() - 1)).confirmation).toBe('PENDING');
    expect(
      view({ ...row, status: 'CANCELLED', confirmationStatus: 'DECLINED' }, [], at).confirmation,
    ).toBe('DECLINED');
  });
});
