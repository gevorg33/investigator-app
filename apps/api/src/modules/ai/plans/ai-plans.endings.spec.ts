import type { Job } from 'bullmq';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { person, planJob, planStack, req, TallyTool } from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { agencyContext, asRequests } from '../../../../test/workspace-context';
import { agency } from '../../../../test/workspace-fixtures';
import { AuditService } from '../../../common/audit/audit.service';
import { runInContext } from '../../../common/context/execution-context';
import { PlatformContext } from '../../../common/context/platform-context';
import { DeadLetters } from '../../../common/jobs/dead-letters';
import { envelopeAs } from '../../../common/jobs/job';
import { processorFor } from '../../../common/jobs/job-queue';
import { EXECUTION_DEADLINE_MS, type PlanView } from './ai-plans.service';
import { EXECUTE_PLAN } from './execute-plan.handler';

/**
 * Every plan ends, and says what happened (T-224). Found by the review of T-048: a plan whose worker
 * died stayed CONFIRMED for ever; a member who left had a half-run plan reported as never run; and a
 * conversation deleted mid-run could hang on locks and erase the only record of what ran.
 */
describe('every plan ends, honestly (T-224)', () => {
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

  const tally = (amount: number) => ({ tool: 'addToTally', arguments: { name: 'rent', amount } });
  const stepsOf = (p: PlanView) => p.steps.map((s) => s.status);

  /** A confirmed plan in the person's Personal workspace, and the job that runs it. */
  const confirmed = async (amounts: number[]) => {
    const me = await person(owner);
    const tool = new TallyTool();
    const stack = planStack(sql, [tool]);
    const plans = asRequests(stack.plans, owner);
    const sessions = asRequests(stack.sessions, owner);
    const session = await sessions.create(me, {}, req());
    const plan = await plans.propose(me, session.id, amounts.map(tally), req());
    await plans.confirm(me, session.id, plan.id, plan.planHash, req());
    return {
      me,
      tool,
      stack,
      plans,
      sessions,
      plan,
      job: await planJob(owner, me.userId, plan.id),
      read: () => plans.get(me, session.id, plan.id, req()),
    };
  };

  /** The same, in an agency workspace, so the person can be removed from it. */
  const inAgency = async (amounts: number[]) => {
    const boss = await person(owner);
    const me = await person(owner);
    const firm = await agency(owner, [{ userId: boss.userId }, { userId: me.userId }]);
    const context = await agencyContext(owner, me.userId, firm.tenantId);
    const tool = new TallyTool();
    const stack = planStack(sql, [tool]);
    const inFirm = <T>(fn: () => Promise<T>) => runInContext(context, fn);
    const { session, plan } = await inFirm(async () => {
      const s = await stack.sessions.create(me, {}, req());
      const p = await stack.plans.propose(me, s.id, amounts.map(tally), req());
      await stack.plans.confirm(me, s.id, p.id, p.planHash, req());
      return { session: s, plan: p };
    });
    const job = envelopeAs(
      { tenantId: firm.tenantId, userId: me.userId, membershipId: context.membershipId },
      EXECUTE_PLAN,
      `ai-plan-${plan.id}`,
      { planId: plan.id },
    );
    const remove = () =>
      owner`UPDATE tenant_memberships SET status = 'REMOVED'
             WHERE tenant_id = ${firm.tenantId} AND user_id = ${me.userId}`;
    const state = async () => {
      const [row] = await owner<{ status: string; confirmation: string; reason: string | null }[]>`
        SELECT status, confirmation_status AS confirmation, reason FROM ai_plans WHERE id = ${plan.id}`;
      const steps = await owner<{ status: string }[]>`
        SELECT status FROM ai_plan_steps WHERE plan_id = ${plan.id} ORDER BY ordinal`;
      return { ...row, steps: steps.map((s) => s.status) };
    };
    return { me, tool, stack, session, plan, job, remove, state };
  };

  describe('a member who leaves', () => {
    it('fails a plan that had already started, rather than calling it never run', async () => {
      const a = await inAgency([1, 2, 3]);
      a.tool.faults.set(`ai-plan:${a.plan.id}:2`, 'crash_before');
      await expect(a.stack.jobs.run(a.job)).rejects.toThrow(/the worker died/);

      await a.remove();

      // Step 1 took effect. The plan failed; it was not "cancelled before anything ran".
      expect(await a.state()).toEqual({
        status: 'FAILED',
        confirmation: 'CONFIRMED',
        reason: 'member_left',
        steps: ['DONE', 'RUNNING', 'SKIPPED'],
      });
    });

    it('still voids a plan that had not started', async () => {
      const a = await inAgency([1]);
      await a.remove();
      expect(await a.state()).toEqual({
        status: 'CANCELLED',
        confirmation: 'VOIDED',
        reason: 'member_left',
        steps: ['PENDING'],
      });
      expect(a.tool.calls).toEqual([]);
    });
  });

  describe('a plan whose job is dead-lettered', () => {
    const lastAttempt = (data: unknown) =>
      ({ data, attemptsMade: 4, opts: { attempts: 5 }, id: 'j1' }) as unknown as Job<unknown>;
    const deadLetters = (c: Awaited<ReturnType<typeof confirmed>>) =>
      new DeadLetters(c.stack.db, new PlatformContext(new AuditService(c.stack.db)));

    it('ends FAILED infrastructure_failed once a step ran, and a replay finds nothing to run', async () => {
      const c = await confirmed([1, 2, 3]);
      c.tool.faults.set(`ai-plan:${c.plan.id}:2`, 'crash_before');
      const process = processorFor(c.stack.jobs, deadLetters(c), 'events');

      await expect(process(lastAttempt(c.job))).rejects.toThrow(/the worker died/);

      const after = await c.read();
      expect(after).toMatchObject({ status: 'FAILED', reason: 'infrastructure_failed' });
      expect(after.finishedAt).not.toBeNull();
      // Step 2 may have taken effect, so it is not called skipped; step 3 never ran.
      expect(stepsOf(after)).toEqual(['DONE', 'RUNNING', 'SKIPPED']);
      const [audited] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_logs
         WHERE resource_id = ${c.plan.id} AND action = 'ai_plan.failed' AND reason = 'infrastructure_failed'`;
      expect(audited!.n).toBe(1);

      // T-168's replay re-enqueues the job as it was: it runs nothing.
      const calls = c.tool.calls.length;
      await expect(c.stack.jobs.run(c.job)).resolves.toBe('done');
      expect(c.tool.calls.length).toBe(calls);
    });

    it('leaves a plan that already ended, or went with its session, as it is', async () => {
      const done = await confirmed([1]);
      await done.stack.jobs.run(done.job);
      await done.stack.jobs.deadLettered(done.job);
      expect((await done.read()).status).toBe('COMPLETED');

      const gone = await confirmed([1]);
      await gone.sessions.delete(gone.me, gone.plan.sessionId, req());
      await expect(gone.stack.jobs.deadLettered(gone.job)).resolves.toBeUndefined();
    });

    it('ends CANCELLED/INVALIDATED when nothing ran', async () => {
      const c = await confirmed([1]);
      // The account goes: the runner refuses the job's context, which is permanent.
      await owner`UPDATE users SET status = 'SUSPENDED' WHERE id = ${c.me.userId}`;
      const process = processorFor(c.stack.jobs, deadLetters(c), 'events');
      await expect(
        process({
          data: c.job,
          attemptsMade: 0,
          opts: { attempts: 5 },
          id: 'j2',
        } as unknown as Job<unknown>),
      ).rejects.toThrow(/context_refused/);
      await owner`UPDATE users SET status = 'ACTIVE' WHERE id = ${c.me.userId}`;
      expect(await c.read()).toMatchObject({
        status: 'CANCELLED',
        confirmation: 'INVALIDATED',
        reason: 'infrastructure_failed',
      });
      expect(c.tool.calls).toEqual([]);
    });
  });

  it('lists a confirmed plan as open until it ends', async () => {
    const c = await confirmed([1, 2]);
    c.tool.faults.set(`ai-plan:${c.plan.id}:2`, 'crash_before');
    const open = () => c.plans.list(c.me, c.plan.sessionId, { open: true }, req());
    expect((await open()).map((p) => p.id)).toEqual([c.plan.id]);

    await expect(c.stack.jobs.run(c.job)).rejects.toThrow(/the worker died/);
    // Started and stuck between retries: still listed, so the person can see it.
    expect((await open()).map((p) => [p.id, p.status])).toEqual([[c.plan.id, 'CONFIRMED']]);

    await c.stack.jobs.run(c.job);
    expect(await open()).toEqual([]);
  });

  it('never starts a confirmed plan the worker reaches after the execution deadline', async () => {
    const c = await confirmed([1]);
    const confirmedAt = new Date((await c.read()).confirmedAt!).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(confirmedAt + EXECUTION_DEADLINE_MS + 1));

    await c.stack.jobs.run(c.job);

    expect(await c.read()).toMatchObject({
      status: 'CANCELLED',
      confirmation: 'INVALIDATED',
      reason: 'confirmation_stale',
    });
    expect(c.tool.calls).toEqual([]);
  });

  it('lets a started plan finish after the deadline: the deadline is for starting, not resuming', async () => {
    const c = await confirmed([1, 2]);
    c.tool.faults.set(`ai-plan:${c.plan.id}:2`, 'crash_before');
    await expect(c.stack.jobs.run(c.job)).rejects.toThrow(/the worker died/);
    const confirmedAt = new Date((await c.read()).confirmedAt!).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(confirmedAt + EXECUTION_DEADLINE_MS + 1));

    await c.stack.jobs.run(c.job);
    expect((await c.read()).status).toBe('COMPLETED');
  });

  describe('deleting the conversation', () => {
    it('refuses at once, without hanging, while the plan is running', async () => {
      const c = await confirmed([1]);
      // A worker in the middle of the run holds the plan row, as PlanExecutor does.
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockTaken = new Promise<void>((r) => (locked = r));
      const worker = owner.begin(async (tx) => {
        await tx`SELECT id FROM ai_plans WHERE id = ${c.plan.id} FOR UPDATE`;
        locked();
        await held;
      });
      await lockTaken;

      const started = Date.now();
      await expect(c.sessions.delete(c.me, c.plan.sessionId, req())).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
        details: [
          { code: 'PLAN_IN_FLIGHT', messageKey: 'error.validation.ai_session.plan_in_flight' },
        ],
      });
      expect(Date.now() - started).toBeLessThan(3_000);
      release();
      await worker;
      expect((await c.read()).status).toBe('CONFIRMED');
    });

    it('refuses while a started plan waits for its retry', async () => {
      const c = await confirmed([1, 2]);
      c.tool.faults.set(`ai-plan:${c.plan.id}:2`, 'crash_before');
      await expect(c.stack.jobs.run(c.job)).rejects.toThrow(/the worker died/);
      await expect(c.sessions.delete(c.me, c.plan.sessionId, req())).rejects.toMatchObject({
        details: [{ code: 'PLAN_IN_FLIGHT' }],
      });
    });

    it('voids a confirmed plan that had not started, and its job then finds nothing', async () => {
      const c = await confirmed([1]);
      await c.sessions.delete(c.me, c.plan.sessionId, req());
      const [voided] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_logs
         WHERE resource_id = ${c.plan.id} AND action = 'ai_plan.voided' AND reason = 'session_deleted'`;
      expect(voided!.n).toBe(1);
      await expect(c.stack.jobs.run(c.job)).resolves.toBe('done');
      expect(c.tool.calls).toEqual([]);
    });

    it('keeps the outcome of a plan that ran in audit — commands and step results, never arguments', async () => {
      const c = await confirmed([1, 2]);
      await c.stack.jobs.run(c.job);
      await c.sessions.delete(c.me, c.plan.sessionId, req());
      const rows = await owner<{ reason: string }[]>`
        SELECT reason FROM audit_logs WHERE resource_id = ${c.plan.id} AND action = 'ai_plan.erased'`;
      expect(rows).toEqual([{ reason: 'COMPLETED: done=addToTally,addToTally' }]);
      expect(JSON.stringify(rows)).not.toContain('rent');
    });

    it('erases a plan nobody confirmed without a trace beyond its proposal', async () => {
      const me = await person(owner);
      const stack = planStack(sql, [new TallyTool()]);
      const sessions = asRequests(stack.sessions, owner);
      const session = await sessions.create(me, {}, req());
      const plan = await asRequests(stack.plans, owner).propose(me, session.id, [tally(1)], req());
      await sessions.delete(me, session.id, req());
      const actions = await owner<{ action: string }[]>`
        SELECT action FROM audit_logs WHERE resource_id = ${plan.id} ORDER BY occurred_at`;
      expect(actions.map((a) => a.action)).toEqual(['ai_plan.proposed']);
    });
  });

  it('gives up on a plan row another transaction holds, instead of waiting for ever', async () => {
    const c = await confirmed([1]);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    const other = owner.begin(async (tx) => {
      await tx`SELECT id FROM ai_plans WHERE id = ${c.plan.id} FOR UPDATE`;
      locked();
      await held;
    });
    await lockTaken;
    const started = Date.now();
    await expect(c.stack.jobs.run(c.job)).rejects.toMatchObject({ cause: { code: '55P03' } });
    expect(Date.now() - started).toBeLessThan(15_000);
    release();
    await other;
    // The job is retried later and runs.
    await expect(c.stack.jobs.run(c.job)).resolves.toBe('done');
    expect((await c.read()).status).toBe('COMPLETED');
  }, 30_000);
});
