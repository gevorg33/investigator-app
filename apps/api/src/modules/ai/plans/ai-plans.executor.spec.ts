import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  person,
  planJob,
  planStack,
  req,
  TallyTool,
  type Fault,
} from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { asRequests } from '../../../../test/workspace-context';
import type { Actor } from '../../../common/authz/contract';
import { AppError } from '../../../common/errors/app-error';
import { personalContext, scopedDb } from '../../../../test/workspace-context';
import { AuditService } from '../../../common/audit/audit.service';
import type { ActorService } from '../../../common/authz/actor.service';
import { runInContext } from '../../../common/context/execution-context';
import type { PlanView } from './ai-plans.service';
import { PlanExecutor } from './plan-executor';

/**
 * Running a confirmed plan (T-048) — in the worker, through the real job runner, as the person who
 * confirmed it. Everything is checked again before anything runs, every step is re-authorized as it
 * runs, and a worker that dies is replaced by one that resumes from what PostgreSQL holds.
 */
describe('running a confirmed plan (T-048)', () => {
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

  const tally = (name: string, amount: number) => ({
    tool: 'addToTally',
    arguments: { name, amount },
  });

  /** A person, a confirmed plan of `amounts` on one tally, and the stack that proposed it. */
  const confirmed = async (
    amounts: number[],
    opts: { roles?: Array<'CUSTOMER' | 'INVESTIGATOR'>; as?: 'CUSTOMER' } = {},
  ) => {
    const me = await person(owner, opts.roles);
    const tool = new TallyTool();
    const stack = planStack(sql, [tool]);
    const plans = asRequests(stack.plans, owner);
    const session = await asRequests(stack.sessions, owner).create(me, {}, req());
    const plan = await plans.propose(
      me,
      session.id,
      amounts.map((a) => tally('rent', a)),
      req(),
    );
    const actor: Actor = opts.as === undefined ? me : { ...me, activeRole: opts.as };
    await plans.confirm(actor, session.id, plan.id, plan.planHash, req());
    const job = await planJob(owner, me.userId, plan.id);
    const read = () => plans.get(me, session.id, plan.id, req());
    return { me, tool, stack, plan, job, read };
  };

  const auditOf = (planId: string) =>
    owner<{ action: string; reason: string | null }[]>`
      SELECT action, reason FROM audit_logs WHERE resource_id = ${planId} ORDER BY occurred_at`;
  const stepsOf = (p: PlanView) => p.steps.map((s) => [s.status, s.error]);

  it('runs every step as its person, each once with its own key, and completes', async () => {
    const { tool, stack, plan, job, read, me } = await confirmed([2, 3]);

    await expect(stack.jobs.run(job)).resolves.toBe('done');

    const done = await read();
    expect(done).toMatchObject({ status: 'COMPLETED', confirmation: 'CONFIRMED', reason: null });
    expect(done.finishedAt).not.toBeNull();
    expect(done.steps.map((s) => [s.status, s.result])).toEqual([
      ['DONE', { name: 'rent', total: 2 }],
      ['DONE', { name: 'rent', total: 5 }],
    ]);
    expect(tool.calls).toEqual([`ai-plan:${plan.id}:1`, `ai-plan:${plan.id}:2`]);
    expect((await auditOf(plan.id)).map((a) => a.action)).toEqual([
      'ai_plan.proposed',
      'ai_plan.confirmed',
      'ai_plan.completed',
    ]);
    const steps = await owner<{ reason: string; actor: string }[]>`
      SELECT reason, actor_id AS actor FROM audit_logs
       WHERE action = 'ai.tool.add_to_tally' AND actor_id = ${me.userId} ORDER BY occurred_at`;
    expect(steps.map((s) => s.reason)).toEqual([
      'proposed: amount=2',
      'proposed: amount=3',
      'ok: confirmed: amount=2',
      'ok: confirmed: amount=3',
    ]);
    // Delivered again, it is a duplicate, and runs nothing.
    await expect(stack.jobs.run(job)).resolves.toBe('duplicate');
    expect(tool.calls).toHaveLength(2);
  });

  it('runs a plan once when two deliveries arrive together', async () => {
    const { tool, stack, job, read } = await confirmed([1, 1]);
    const outcomes = await Promise.all([stack.jobs.run(job), stack.jobs.run(job)]);
    expect(outcomes.sort()).toEqual(['done', 'duplicate']);
    expect(tool.calls).toHaveLength(2);
    expect((await read()).status).toBe('COMPLETED');
  });

  describe('checks everything again before anything runs', () => {
    it('voids the confirmation when what a step acts on changed since it was shown', async () => {
      const { tool, stack, plan, job, read, me } = await confirmed([2, 3]);
      tool.touch('rent');

      await stack.jobs.run(job);

      const after = await read();
      expect(after).toMatchObject({
        status: 'CANCELLED',
        confirmation: 'INVALIDATED',
        reason: 'state_changed',
      });
      expect(stepsOf(after)).toEqual([
        ['SKIPPED', null],
        ['SKIPPED', null],
      ]);
      expect(tool.calls).toEqual([]);
      expect((await auditOf(plan.id)).at(-1)).toEqual({
        action: 'ai_plan.invalidated',
        reason: 'state_changed',
      });

      // A fresh one is needed: the old plan cannot be confirmed again; a new proposal is its own.
      const plans = asRequests(stack.plans, owner);
      await expect(
        plans.confirm(me, plan.sessionId, plan.id, plan.planHash, req()),
      ).rejects.toMatchObject({
        details: [{ code: 'NOT_PENDING' }],
      });
      const fresh = await plans.propose(
        me,
        plan.sessionId,
        [tally('rent', 2), tally('rent', 3)],
        req(),
      );
      expect(fresh.id).not.toBe(plan.id);
      expect(fresh.planHash).not.toBe(plan.planHash);
      expect(fresh.confirmation).toBe('PENDING');
    });

    it('voids the confirmation when the stored steps no longer hash to what was confirmed', async () => {
      const { tool, stack, job, read, plan } = await confirmed([2]);
      await owner.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`UPDATE ai_plan_steps SET arguments = '{"name":"rent","amount":99}' WHERE plan_id = ${plan.id}`;
      });
      await stack.jobs.run(job);
      expect(await read()).toMatchObject({
        status: 'CANCELLED',
        confirmation: 'INVALIDATED',
        reason: 'hash_mismatch',
      });
      expect(tool.calls).toEqual([]);
    });

    it('re-authorizes as the person holds roles now: a revoked role runs nothing', async () => {
      const { tool, stack, job, read, me } = await confirmed([2]);
      await owner`DELETE FROM user_roles WHERE user_id = ${me.userId}`;
      await stack.jobs.run(job);
      expect(await read()).toMatchObject({
        status: 'CANCELLED',
        confirmation: 'INVALIDATED',
        reason: 'recheck_forbidden',
      });
      expect(tool.calls).toEqual([]);
    });

    it('runs as the role it was confirmed in, or not at all — never wider', async () => {
      // Confirmed as a customer. With that role gone the tool would still admit an investigator;
      // running as one would be acting with authority the person did not use to confirm.
      const { tool, stack, job, read, me } = await confirmed([2], {
        roles: ['CUSTOMER', 'INVESTIGATOR'],
        as: 'CUSTOMER',
      });
      await owner`DELETE FROM user_roles WHERE user_id = ${me.userId} AND role = 'CUSTOMER'`;
      await stack.jobs.run(job);
      expect(await read()).toMatchObject({ status: 'CANCELLED', reason: 'role_revoked' });
      expect(tool.calls).toEqual([]);
    });

    it('runs nothing for a person whose workspace membership has gone: the runner refuses the job', async () => {
      const { tool, stack, job, me } = await confirmed([2]);
      await owner`UPDATE users SET status = 'SUSPENDED' WHERE id = ${me.userId}`;
      await expect(stack.jobs.run(job)).rejects.toMatchObject({ reason: 'context_refused' });
      expect(tool.calls).toEqual([]);
    });

    it('does nothing for a plan already finished, or erased with its session', async () => {
      const { stack, job, read, me, plan, tool } = await confirmed([1]);
      await stack.jobs.run(job);
      await owner`DELETE FROM job_runs WHERE job_key = ${job.key}`;
      await stack.jobs.run(job);
      expect((await read()).status).toBe('COMPLETED');
      expect(tool.calls).toHaveLength(1);

      await asRequests(stack.sessions, owner).delete(me, plan.sessionId, req());
      await owner`DELETE FROM job_runs WHERE job_key = ${job.key}`;
      await expect(stack.jobs.run(job)).resolves.toBe('done');
      expect(tool.calls).toHaveLength(1);
    });
  });

  it('stops at a refused step: it FAILED with its code, the rest SKIPPED, the plan FAILED', async () => {
    const { tool, stack, plan, job, read } = await confirmed([1, 2, 3]);
    tool.faults.set(`ai-plan:${plan.id}:2`, AppError.stateConflict());

    await stack.jobs.run(job);

    const after = await read();
    expect(after).toMatchObject({
      status: 'FAILED',
      confirmation: 'CONFIRMED',
      reason: 'step_failed',
    });
    expect(stepsOf(after)).toEqual([
      ['DONE', null],
      ['FAILED', 'state_conflict'],
      ['SKIPPED', null],
    ]);
    expect(tool.totals.get('rent')).toBe(1);
    expect((await auditOf(plan.id)).at(-1)).toEqual({
      action: 'ai_plan.failed',
      reason: 'step_failed',
    });
  });

  it('fails at its last step with nothing left to skip', async () => {
    const { tool, stack, plan, job, read } = await confirmed([1, 2]);
    tool.faults.set(`ai-plan:${plan.id}:2`, AppError.forbidden());
    await stack.jobs.run(job);
    const after = await read();
    expect(after).toMatchObject({ status: 'FAILED', reason: 'step_failed' });
    expect(stepsOf(after)).toEqual([
      ['DONE', null],
      ['FAILED', 'forbidden'],
    ]);
  });

  describe('a killed worker is replaced by one that resumes, never repeats', () => {
    it.each<[string, Fault, number]>([
      ['before the step took effect', 'crash_before', 1 + 2 + 3],
      ['after the step took effect', 'crash_after', 1 + 2 + 3],
    ])(
      'dies %s; another worker finishes the plan, each amount counted once',
      async (_when, fault, total) => {
        const { tool, stack, plan, job, read } = await confirmed([1, 2, 3]);
        tool.faults.set(`ai-plan:${plan.id}:2`, fault);

        // The first worker dies mid-plan: its transaction — the claim and the plan's status — is lost.
        await expect(stack.jobs.run(job)).rejects.toThrow(/the worker died/);
        const halfway = await read();
        expect(halfway.status).toBe('CONFIRMED');
        expect(stepsOf(halfway)).toEqual([
          ['DONE', null],
          ['RUNNING', null],
          ['PENDING', null],
        ]);
        const [claims] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM job_runs WHERE job_key = ${job.key}`;
        expect(claims!.n).toBe(0);

        // A new worker: a new pool, new services, the same tool's world — and only the database.
        const pool = testPool();
        const replacement = planStack(pool, [tool]);
        await expect(replacement.jobs.run(job)).resolves.toBe('done');
        await pool.end();

        const done = await read();
        expect(done.status).toBe('COMPLETED');
        expect(stepsOf(done)).toEqual([
          ['DONE', null],
          ['DONE', null],
          ['DONE', null],
        ]);
        // Step 1 was not run again; step 2 ran again with its own key, and took effect once.
        expect(tool.calls).toEqual([
          `ai-plan:${plan.id}:1`,
          `ai-plan:${plan.id}:2`,
          `ai-plan:${plan.id}:2`,
          `ai-plan:${plan.id}:3`,
        ]);
        expect(tool.totals.get('rent')).toBe(total);
      },
    );

    it('does not take a resumed step’s own effect for a change it was not confirmed against', async () => {
      // Step 1 took effect and moved the tally's version; a resumed plan is not re-checked, so
      // that is not read as something the person did not see.
      const { tool, stack, plan, job, read } = await confirmed([1, 2]);
      tool.faults.set(`ai-plan:${plan.id}:2`, 'crash_before');
      await expect(stack.jobs.run(job)).rejects.toThrow(/the worker died/);
      tool.touch('rent');
      await stack.jobs.run(job);
      expect((await read()).status).toBe('COMPLETED');
    });
  });

  describe('what the job runner does not already catch', () => {
    /** The executor alone, in its person's workspace, with the actor service replaced. */
    const runWith = async (
      c: Awaited<ReturnType<typeof confirmed>>,
      actors: Partial<ActorService>,
    ) => {
      const db = scopedDb(sql);
      const executor = new PlanExecutor(
        db,
        c.stack.runner,
        actors as ActorService,
        new AuditService(db),
      );
      return runInContext(await personalContext(owner, c.me.userId), () =>
        db.transaction((tx) => executor.run(c.plan.id, tx, req())),
      );
    };

    it('voids the confirmation of a person whose account went between the runner’s check and the run', async () => {
      const c = await confirmed([1]);
      const gone = { forJob: async () => Promise.reject(new AppError('UNAUTHENTICATED')) };
      await expect(runWith(c, gone)).resolves.toBe('invalidated');
      expect(await c.read()).toMatchObject({ status: 'CANCELLED', reason: 'account_refused' });
      expect(c.tool.calls).toEqual([]);
    });

    it('lets an unexpected failure reading the person, or re-reading a step, through — to be retried', async () => {
      const c = await confirmed([1]);
      const broken = { forJob: async () => Promise.reject(new Error('connection reset')) };
      await expect(runWith(c, broken)).rejects.toThrow('connection reset');
      c.tool.observe = async () => Promise.reject(new Error('connection reset'));
      await expect(c.stack.jobs.run(c.job)).rejects.toThrow('connection reset');
      expect(await c.read()).toMatchObject({ status: 'CONFIRMED' });
      expect(c.tool.calls).toEqual([]);
    });

    it('fails a started plan whose tool the worker no longer has, leaving the step it was on as it was', async () => {
      const c = await confirmed([1, 2, 3]);
      c.tool.faults.set(`ai-plan:${c.plan.id}:2`, 'crash_before');
      await expect(c.stack.jobs.run(c.job)).rejects.toThrow(/the worker died/);

      const pool = testPool();
      await expect(planStack(pool, []).jobs.run(c.job)).resolves.toBe('done');
      await pool.end();

      const after = await c.read();
      expect(after).toMatchObject({ status: 'FAILED', reason: 'tool_unavailable' });
      // Step 2 may or may not have taken effect, so it is not called SKIPPED; step 3 never ran.
      expect(stepsOf(after)).toEqual([
        ['DONE', null],
        ['RUNNING', null],
        ['SKIPPED', null],
      ]);
    });
  });
});
