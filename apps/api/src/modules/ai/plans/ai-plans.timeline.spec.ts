import type { Job } from 'bullmq';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { person, planJob, planStack, req, TallyTool } from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { agencyContext, asRequests } from '../../../../test/workspace-context';
import { agency } from '../../../../test/workspace-fixtures';
import { AuditService } from '../../../common/audit/audit.service';
import { runInContext } from '../../../common/context/execution-context';
import { PlatformContext } from '../../../common/context/platform-context';
import { AppError } from '../../../common/errors/app-error';
import { DeadLetters } from '../../../common/jobs/dead-letters';
import { processorFor } from '../../../common/jobs/job-queue';
import type { PlanTimeline } from './plan-timeline';

/**
 * A plan from proposal to its last step (T-214, P-3b): its rows and its audit under one correlation
 * id, for its own person. Partial reads as partial, a FAILED step never as done, and nobody else
 * reads it — nor finds themselves in it.
 */
describe('a plan’s timeline (T-214)', () => {
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

  const tally = (amount: number) => ({ tool: 'addToTally', arguments: { name: 'rent', amount } });

  const proposed = async (amounts: number[]) => {
    const me = await person(owner);
    const tool = new TallyTool();
    const stack = planStack(sql, [tool]);
    const plans = asRequests(stack.plans, owner);
    const sessions = asRequests(stack.sessions, owner);
    const session = await sessions.create(me, {}, req());
    const plan = await plans.propose(me, session.id, amounts.map(tally), req());
    const read = () => plans.timeline(me, session.id, plan.id, req());
    return { me, tool, stack, plans, session, plan, read };
  };

  const confirmed = async (amounts: number[]) => {
    const p = await proposed(amounts);
    const confirming = req();
    await p.plans.confirm(p.me, p.session.id, p.plan.id, p.plan.planHash, confirming);
    const job = await planJob(owner, p.me.userId, p.plan.id);
    return {
      ...p,
      confirming,
      job: { ...job, payload: { planId: p.plan.id, correlationId: confirming.correlationId } },
    };
  };

  /** The events the plan's own rows give, in order, without their times. */
  const rows = (t: PlanTimeline) =>
    t.events.map((e) => {
      const { at: _at, ...rest } = e;
      return rest;
    });
  const audited = (t: PlanTimeline) => t.audit;

  it('reads a completed plan in order, under the confirming request’s id', async () => {
    const c = await confirmed([1, 2]);
    await c.stack.jobs.run(c.job);
    const t = await c.read();

    expect(t).toMatchObject({
      planId: c.plan.id,
      sessionId: c.session.id,
      status: 'COMPLETED',
      outcome: 'completed',
      correlationId: c.confirming.correlationId,
      unknown: [],
    });
    expect(rows(t)).toEqual([
      { type: 'proposed', steps: 2 },
      { type: 'confirmed', role: null },
      { type: 'step_started', ordinal: 1, tool: 'addToTally' },
      { type: 'step_finished', ordinal: 1, tool: 'addToTally', status: 'DONE', error: null },
      { type: 'step_started', ordinal: 2, tool: 'addToTally' },
      { type: 'step_finished', ordinal: 2, tool: 'addToTally', status: 'DONE', error: null },
      { type: 'ended', status: 'COMPLETED', confirmation: 'CONFIRMED', reason: null },
    ]);
    // The audit is in the database's own time order.
    const times = t.audit.map((a) => a.at);
    expect(times).toEqual([...times].sort());

    // Its audit: the plan's own lifecycle and each step's call, joined by the confirmation's id.
    expect(audited(t).map((a) => [a.action, a.outcome])).toEqual(
      expect.arrayContaining([
        ['ai_plan.proposed', 'addToTally,addToTally'],
        ['ai_plan.confirmed', null],
        ['ai.tool.add_to_tally', 'ok'],
        ['ai_plan.completed', null],
      ]),
    );
    expect(audited(t).filter((a) => a.action === 'ai.tool.add_to_tally')).toHaveLength(2);
    expect(
      audited(t)
        .filter((a) => a.action !== 'ai_plan.proposed')
        .every((a) => a.correlationId === c.confirming.correlationId),
    ).toBe(true);
    // Codes only: no argument, no address, no device.
    const json = JSON.stringify(t);
    expect(json).not.toContain('amount');
    expect(json).not.toContain('rent');
    expect(json).not.toContain('198.51.100.48');
    expect(json).not.toContain('vitest');
  });

  it('reads a plan that stopped part-way as partial, and its FAILED step never as done', async () => {
    const c = await confirmed([1, 2, 3]);
    c.tool.faults.set(`ai-plan:${c.plan.id}:2`, AppError.forbidden());
    await c.stack.jobs.run(c.job);
    const t = await c.read();

    expect(t.outcome).toBe('partial');
    const finished = rows(t).filter((e) => e.type === 'step_finished');
    expect(finished).toEqual([
      { type: 'step_finished', ordinal: 1, tool: 'addToTally', status: 'DONE', error: null },
      {
        type: 'step_finished',
        ordinal: 2,
        tool: 'addToTally',
        status: 'FAILED',
        error: 'forbidden',
      },
      { type: 'step_finished', ordinal: 3, tool: 'addToTally', status: 'SKIPPED', error: null },
    ]);
    // Step 3 never started.
    expect(
      rows(t)
        .filter((e) => e.type === 'step_started')
        .map((e) => e.ordinal),
    ).toEqual([1, 2]);
    expect(rows(t).at(-1)).toEqual({
      type: 'ended',
      status: 'FAILED',
      confirmation: 'CONFIRMED',
      reason: 'step_failed',
    });
    // Only the step that took effect has an "ok" call.
    expect(audited(t).filter((a) => a.action === 'ai.tool.add_to_tally')).toHaveLength(1);
  });

  it('marks a step left running as unknown, with no finish it never had', async () => {
    const c = await confirmed([1, 2]);
    c.tool.faults.set(`ai-plan:${c.plan.id}:2`, 'crash_before');
    const process = processorFor(
      c.stack.jobs,
      new DeadLetters(c.stack.db, new PlatformContext(new AuditService(c.stack.db))),
      'events',
    );
    await expect(
      process({
        data: c.job,
        attemptsMade: 4,
        opts: { attempts: 5 },
        id: 'j1',
      } as unknown as Job<unknown>),
    ).rejects.toThrow(/the worker died/);
    const t = await c.read();

    expect(t).toMatchObject({ status: 'FAILED', outcome: 'partial', unknown: [2] });
    expect(rows(t).filter((e) => 'ordinal' in e && e.ordinal === 2)).toEqual([
      { type: 'step_started', ordinal: 2, tool: 'addToTally' },
    ]);
    // Ended in the system context, whose audit row is in no workspace: the plan's own row says it.
    expect(rows(t).at(-1)).toMatchObject({ type: 'ended', reason: 'infrastructure_failed' });
    expect(audited(t).map((a) => a.action)).not.toContain('ai_plan.failed');
  });

  it('reads a plan still waiting as only proposed, with no outcome and no correlation yet', async () => {
    const p = await proposed([1]);
    const t = await p.read();
    expect(t).toMatchObject({
      status: 'PROPOSED',
      outcome: null,
      correlationId: null,
      unknown: [],
    });
    expect(rows(t)).toEqual([{ type: 'proposed', steps: 1 }]);
  });

  it('reads a declined plan as declined, with nothing started', async () => {
    const p = await proposed([1]);
    await p.plans.decline(p.me, p.session.id, p.plan.id, req());
    const t = await p.read();
    expect(t.outcome).toBe('declined');
    expect(rows(t).map((e) => e.type)).toEqual(['proposed', 'ended']);
    expect(audited(t).map((a) => a.action)).toEqual(
      expect.arrayContaining(['ai_plan.proposed', 'ai_plan.declined']),
    );
  });

  describe('whose it is', () => {
    it('is a 404 to another person, and to the plan’s own person in another conversation', async () => {
      const c = await confirmed([1]);
      const stranger = await person(owner);
      await expect(
        c.plans.timeline(stranger, c.session.id, c.plan.id, req()),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const elsewhere = await asRequests(c.stack.sessions, owner).create(c.me, {}, req());
      await expect(c.plans.timeline(c.me, elsewhere.id, c.plan.id, req())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('is a 404 to a colleague in the same workspace, whose look never appears in it', async () => {
      const boss = await person(owner);
      const me = await person(owner);
      const firm = await agency(owner, [{ userId: boss.userId }, { userId: me.userId }]);
      const stack = planStack(sql, [new TallyTool()]);
      const mine = await agencyContext(owner, me.userId, firm.tenantId);
      const theirs = await agencyContext(owner, boss.userId, firm.tenantId);
      const { session, plan } = await runInContext(mine, async () => {
        const s = await stack.sessions.create(me, {}, req());
        return { session: s, plan: await stack.plans.propose(me, s.id, [tally(1)], req()) };
      });

      await runInContext(theirs, async () => {
        await expect(stack.plans.timeline(boss, session.id, plan.id, req())).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
        await expect(stack.plans.get(boss, session.id, plan.id, req())).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      });
      // The refusals are audited in the same workspace, about this plan — and are not the person's to read.
      const [denied] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_logs
         WHERE tenant_id = ${firm.tenantId} AND actor_id = ${boss.userId} AND action LIKE 'authz.denied%'`;
      expect(denied!.n).toBeGreaterThan(0);

      const t = await runInContext(mine, async () =>
        stack.plans.timeline(me, session.id, plan.id, req()),
      );
      expect(audited(t).map((a) => a.action)).toEqual(['ai_plan.proposed']);
      expect(JSON.stringify(t)).not.toContain(boss.userId);
    });
  });
});
