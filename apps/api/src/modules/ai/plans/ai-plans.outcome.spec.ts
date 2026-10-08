import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { person, planJob, planStack, req, TallyTool } from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { agencyContext, asRequests } from '../../../../test/workspace-context';
import { agency } from '../../../../test/workspace-fixtures';
import { AuditService } from '../../../common/audit/audit.service';
import { runInContext } from '../../../common/context/execution-context';
import { AppError } from '../../../common/errors/app-error';
import { envelopeAs } from '../../../common/jobs/job';
import { eq } from 'drizzle-orm';
import { aiMessages } from '../../../database/schema';
import { EXECUTE_PLAN } from './execute-plan.handler';
import { PLAN_ENDED } from './ai-plans.service';

interface Outcome {
  planId: string;
  outcome: string;
  status: string;
  confirmation: string;
  reason: string | null;
  steps: Array<{ ordinal: number; tool: string; status: string; error: string | null }>;
}

/**
 * The person learns how their plan ended (T-226, P-15). Confirming returns at CONFIRMED and the worker
 * runs the plan later, so the conversation is told: one PLAN_OUTCOME message per ended plan, written
 * by the database from the step rows in the transaction that ends it (migration 0045) — never by a
 * model, and never "done" for a plan that stopped part-way.
 */
describe('the outcome reaches the person (T-226)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const tally = (amount: number) => ({ tool: 'addToTally', arguments: { name: 'rent', amount } });

  /** Every PLAN_OUTCOME message in the session, as stored. */
  const told = async (sessionId: string) =>
    owner<{ sequence: number; role: string; content: string | null; event: Outcome }[]>`
      SELECT sequence, role, content, event FROM ai_messages
       WHERE session_id = ${sessionId} AND kind = 'PLAN_OUTCOME' ORDER BY sequence`;

  const ended = async (planId: string) =>
    owner<{ payload: unknown; correlation: string | null }[]>`
      SELECT payload, correlation_id AS correlation FROM outbox_events
       WHERE aggregate_id = ${planId} AND event_type = ${PLAN_ENDED}`;

  /** A proposed plan in the person's Personal workspace, a message already in its conversation. */
  const proposed = async (amounts: number[]) => {
    const me = await person(owner);
    const tool = new TallyTool();
    const stack = planStack(sql, [tool]);
    const plans = asRequests(stack.plans, owner);
    const sessions = asRequests(stack.sessions, owner);
    const session = await sessions.create(me, {}, req());
    await sessions.append(me, session.id, { role: 'USER', content: 'Add to rent' }, req());
    const plan = await plans.propose(me, session.id, amounts.map(tally), req());
    return { me, tool, stack, plans, sessions, session, plan };
  };

  const confirmed = async (amounts: number[]) => {
    const p = await proposed(amounts);
    const confirming = req();
    await p.plans.confirm(p.me, p.session.id, p.plan.id, p.plan.planHash, confirming);
    // Carrying the confirming request's id, as PlanConfirmedTrigger queues it (T-212).
    const job = await planJob(owner, p.me.userId, p.plan.id);
    return {
      ...p,
      confirming,
      job: { ...job, payload: { planId: p.plan.id, correlationId: confirming.correlationId } },
    };
  };

  describe('from the worker', () => {
    it('tells a plan that did everything as completed, once, after what was already said', async () => {
      const c = await confirmed([1, 2]);
      await c.stack.jobs.run(c.job);

      expect(await told(c.session.id)).toEqual([
        {
          sequence: 2,
          role: 'SYSTEM',
          content: null,
          event: {
            planId: c.plan.id,
            outcome: 'completed',
            status: 'COMPLETED',
            confirmation: 'CONFIRMED',
            reason: null,
            steps: [
              { ordinal: 1, tool: 'addToTally', status: 'DONE', error: null },
              { ordinal: 2, tool: 'addToTally', status: 'DONE', error: null },
            ],
          },
        },
      ]);
      // What the person asked for happened: nobody is notified.
      expect(await ended(c.plan.id)).toEqual([]);

      // The person reads it through their own conversation, as any message.
      const page = await c.sessions.messages(c.me, c.session.id, { order: 'oldest' }, req());
      expect(page.items.map((m) => [m.sequence, m.kind])).toEqual([
        [1, 'TEXT'],
        [2, 'PLAN_OUTCOME'],
      ]);
      // The next message follows it: the sequence was taken, not borrowed.
      const next = await c.sessions.append(
        c.me,
        c.session.id,
        { role: 'USER', content: 'Thanks' },
        req(),
      );
      expect(next.sequence).toBe(3);
    });

    it('never tells a plan that stopped part-way as done: the failed step with its code, the rest skipped', async () => {
      const c = await confirmed([1, 2, 3]);
      c.tool.faults.set(`ai-plan:${c.plan.id}:2`, AppError.forbidden());
      await c.stack.jobs.run(c.job);

      const [message] = await told(c.session.id);
      expect(message!.event).toMatchObject({
        outcome: 'partial',
        status: 'FAILED',
        reason: 'step_failed',
        steps: [
          { ordinal: 1, status: 'DONE', error: null },
          { ordinal: 2, status: 'FAILED', error: 'forbidden' },
          { ordinal: 3, status: 'SKIPPED', error: null },
        ],
      });
      // Not what was asked: the person is notified, under the confirming request's id.
      expect(await ended(c.plan.id)).toEqual([
        { payload: { to: 'FAILED' }, correlation: c.confirming.correlationId },
      ]);
    });

    it('tells a plan whose first step was refused as failed, with nothing done', async () => {
      const c = await confirmed([1, 2]);
      c.tool.faults.set(`ai-plan:${c.plan.id}:1`, AppError.forbidden());
      await c.stack.jobs.run(c.job);
      expect((await told(c.session.id)).map((m) => m.event.outcome)).toEqual(['failed']);
      expect((await told(c.session.id))[0]!.event.steps.map((s) => s.status)).toEqual([
        'FAILED',
        'SKIPPED',
      ]);
    });

    it('tells a plan voided by the re-check as not run, with why', async () => {
      const c = await confirmed([1]);
      c.tool.touch('rent');
      await c.stack.jobs.run(c.job);
      expect((await told(c.session.id)).map((m) => m.event)).toEqual([
        expect.objectContaining({
          outcome: 'not_run',
          status: 'CANCELLED',
          confirmation: 'INVALIDATED',
          reason: 'state_changed',
          steps: [{ ordinal: 1, tool: 'addToTally', status: 'SKIPPED', error: null }],
        }),
      ]);
      expect(await ended(c.plan.id)).toEqual([
        { payload: { to: 'CANCELLED' }, correlation: c.confirming.correlationId },
      ]);
    });

    it('tells a step left running by a dead worker as running — it may have taken effect', async () => {
      const c = await confirmed([1, 2]);
      c.tool.faults.set(`ai-plan:${c.plan.id}:2`, 'crash_after');
      await expect(c.stack.jobs.run(c.job)).rejects.toThrow(/the worker died/);
      expect(await told(c.session.id)).toEqual([]);

      await c.stack.jobs.deadLettered(c.job);
      expect((await told(c.session.id)).map((m) => m.event)).toEqual([
        expect.objectContaining({
          outcome: 'partial',
          status: 'FAILED',
          reason: 'infrastructure_failed',
          steps: [
            expect.objectContaining({ status: 'DONE' }),
            expect.objectContaining({ status: 'RUNNING' }),
          ],
        }),
      ]);
    });
  });

  describe('a worker killed at the end', () => {
    it('after the last step took effect, before it was recorded: one message, when the retry ends it', async () => {
      const c = await confirmed([1, 2]);
      c.tool.faults.set(`ai-plan:${c.plan.id}:2`, 'crash_after');
      await expect(c.stack.jobs.run(c.job)).rejects.toThrow(/the worker died/);
      expect(await told(c.session.id)).toEqual([]);

      await c.stack.jobs.run(c.job);
      const messages = await told(c.session.id);
      expect(messages.map((m) => m.event.outcome)).toEqual(['completed']);
      // Step 2 took effect once, and the outcome says so once.
      expect(c.tool.totals.get('rent')).toBe(3);
    });

    it('after the status was written, before it committed: the message goes with the status', async () => {
      const c = await confirmed([1, 2]);
      const record = AuditService.prototype.record;
      let killed = false;
      vi.spyOn(AuditService.prototype, 'record').mockImplementation(async function (
        this: AuditService,
        event,
        tx,
      ) {
        // The status and its message are written; the worker dies before the transaction commits.
        if (event.action === 'ai_plan.completed' && !killed) {
          killed = true;
          throw new Error('the worker died before its commit');
        }
        return record.call(this, event, tx);
      });

      await expect(c.stack.jobs.run(c.job)).rejects.toThrow(/before its commit/);
      expect(await told(c.session.id)).toEqual([]);
      const [plan] = await owner<{ status: string }[]>`
        SELECT status FROM ai_plans WHERE id = ${c.plan.id}`;
      expect(plan!.status).toBe('CONFIRMED');

      await c.stack.jobs.run(c.job);
      expect((await told(c.session.id)).map((m) => m.event.outcome)).toEqual(['completed']);
      // Delivered again after it ended, it finds nothing to run and says nothing more.
      await c.stack.jobs.run({ ...c.job, jobId: 'again' });
      expect(await told(c.session.id)).toHaveLength(1);
    });
  });

  describe('from the person', () => {
    it('tells a declined plan as declined', async () => {
      const p = await proposed([1]);
      await p.plans.decline(p.me, p.session.id, p.plan.id, req());
      expect((await told(p.session.id)).map((m) => m.event)).toEqual([
        expect.objectContaining({
          outcome: 'declined',
          status: 'CANCELLED',
          confirmation: 'DECLINED',
          steps: [expect.objectContaining({ status: 'SKIPPED' })],
        }),
      ]);
      // Their own doing: nobody is notified.
      expect(await ended(p.plan.id)).toEqual([]);
    });

    it('tells a plan whose rows no longer match what was shown as not run', async () => {
      const p = await proposed([1]);
      // Rewritten under the plan, past the trigger that forbids it — what the hash re-check is for.
      await owner.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`UPDATE ai_plan_steps SET arguments = '{"name":"rent","amount":99}'
                  WHERE plan_id = ${p.plan.id}`;
      });
      await expect(
        p.plans.confirm(p.me, p.session.id, p.plan.id, p.plan.planHash, req()),
      ).rejects.toMatchObject({ details: [{ code: 'CHANGED' }] });
      expect((await told(p.session.id)).map((m) => m.event)).toEqual([
        expect.objectContaining({
          outcome: 'not_run',
          confirmation: 'INVALIDATED',
          reason: 'hash_mismatch',
        }),
      ]);
    });

    it('says nothing while a plan is only proposed, confirmed, or expired unanswered', async () => {
      const p = await proposed([1]);
      // Expiry is read, never written (`view`): an unanswered proposal past its time changes no row.
      await owner.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`UPDATE ai_plans SET created_at = now() - interval '2 days',
                                     expires_at = now() - interval '1 day'
                  WHERE id = ${p.plan.id}`;
      });
      expect((await p.plans.get(p.me, p.session.id, p.plan.id, req())).confirmation).toBe(
        'EXPIRED',
      );
      const c = await confirmed([1]);
      expect(await told(p.session.id)).toEqual([]);
      expect(await told(c.session.id)).toEqual([]);
    });
  });

  describe('a member who leaves', () => {
    const inAgency = async (amounts: number[]) => {
      const boss = await person(owner);
      const me = await person(owner);
      const firm = await agency(owner, [{ userId: boss.userId }, { userId: me.userId }]);
      const context = await agencyContext(owner, me.userId, firm.tenantId);
      const tool = new TallyTool();
      const stack = planStack(sql, [tool]);
      const { session, plan } = await runInContext(context, async () => {
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
      return { me, boss, firm, tool, stack, session, plan, job, remove };
    };

    it('keeps the outcome its person’s alone: a colleague in the same workspace reads none of it', async () => {
      const a = await inAgency([1]);
      await a.stack.jobs.run(a.job);
      const [row] = await owner<{ tenant: string; user: string }[]>`
        SELECT tenant_id AS tenant, user_id AS "user" FROM ai_messages
         WHERE session_id = ${a.session.id} AND kind = 'PLAN_OUTCOME'`;
      expect(row).toEqual({ tenant: a.firm.tenantId, user: a.me.userId });

      // Awaited inside: a query is lazy, and run outside the context it would see none.
      const outcomes = async () =>
        await a.stack.db
          .select({ id: aiMessages.id })
          .from(aiMessages)
          .where(eq(aiMessages.kind, 'PLAN_OUTCOME'));
      // The same read, as its person, finds it: the colleague's empty answer is the policy's.
      const mine = await agencyContext(owner, a.me.userId, a.firm.tenantId);
      expect(await runInContext(mine, outcomes)).toHaveLength(1);

      const colleague = await agencyContext(owner, a.boss.userId, a.firm.tenantId);
      await runInContext(colleague, async () => {
        await expect(
          a.stack.sessions.messages(a.boss, a.session.id, { order: 'oldest' }, req()),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(await outcomes()).toEqual([]);
      });
    });

    it('tells an unstarted plan as not run, its steps skipped, and leaves the conversation archived', async () => {
      const a = await inAgency([1, 2]);
      await a.remove();
      expect((await told(a.session.id)).map((m) => m.event)).toEqual([
        expect.objectContaining({
          outcome: 'not_run',
          confirmation: 'VOIDED',
          reason: 'member_left',
          // The rows stay PENDING (0043 leaves them); a plan that ended will never run them.
          steps: [
            expect.objectContaining({ status: 'SKIPPED' }),
            expect.objectContaining({ status: 'SKIPPED' }),
          ],
        }),
      ]);
      const [session] = await owner<{ archived: boolean; activity: Date }[]>`
        SELECT archived_at IS NOT NULL AS archived, last_activity_at AS activity
          FROM ai_sessions WHERE id = ${a.session.id}`;
      expect(session!.archived).toBe(true);
      expect(session!.activity.toISOString()).toBe(a.session.lastActivityAt);
    });

    it('tells a started plan as partial, though 0043 skips its steps only after ending it', async () => {
      const a = await inAgency([1, 2, 3]);
      a.tool.faults.set(`ai-plan:${a.plan.id}:2`, 'crash_before');
      await expect(a.stack.jobs.run(a.job)).rejects.toThrow(/the worker died/);
      await a.remove();
      expect((await told(a.session.id)).map((m) => m.event)).toEqual([
        expect.objectContaining({
          outcome: 'partial',
          status: 'FAILED',
          reason: 'member_left',
          steps: [
            expect.objectContaining({ status: 'DONE' }),
            expect.objectContaining({ status: 'RUNNING' }),
            expect.objectContaining({ status: 'SKIPPED' }),
          ],
        }),
      ]);
    });
  });

  describe('whoever the writer is', () => {
    /**
     * A plan ended by direct writes, as the owner — a script, a fixture, a bug — with its steps as
     * given. The outcome is read from the steps, so no mix of them makes a FAILED plan "completed".
     */
    const endDirectly = async (stepStatuses: string[], to: 'COMPLETED' | 'FAILED') => {
      const me = await person(owner);
      const [session] = await owner<{ id: string }[]>`
        INSERT INTO ai_sessions (tenant_id, user_id)
        SELECT tenant_id, user_id FROM tenant_memberships WHERE user_id = ${me.userId}
        RETURNING id`;
      const [plan] = await owner<{ id: string }[]>`
        INSERT INTO ai_plans (session_id, plan_hash, expires_at)
        VALUES (${session!.id}, repeat('a', 64), now() + interval '1 day') RETURNING id`;
      for (const [i, status] of stepStatuses.entries()) {
        await owner`
          INSERT INTO ai_plan_steps (plan_id, ordinal, tool, arguments, observed, status, started_at, finished_at, error)
          VALUES (${plan!.id}, ${i + 1}, 'addToTally', '{}'::jsonb, repeat('b', 64), ${status}::ai_plan_step_status,
                  CASE WHEN ${status} = 'PENDING' THEN NULL ELSE now() END,
                  CASE WHEN ${status} IN ('PENDING', 'RUNNING') THEN NULL ELSE now() END,
                  CASE WHEN ${status} = 'FAILED' THEN 'conflict' END)`;
      }
      await owner`UPDATE ai_plans SET status = 'CONFIRMED', confirmation_status = 'CONFIRMED', confirmed_at = now()
                   WHERE id = ${plan!.id}`;
      await owner`UPDATE ai_plans SET status = 'EXECUTING' WHERE id = ${plan!.id}`;
      await owner`UPDATE ai_plans SET status = ${to}, finished_at = now() WHERE id = ${plan!.id}`;
      const messages = await told(session!.id);
      expect(messages).toHaveLength(1);
      return messages[0]!.event.outcome;
    };

    it.each([
      [['DONE', 'FAILED'], 'partial'],
      [['DONE', 'SKIPPED'], 'partial'],
      [['DONE', 'RUNNING'], 'partial'],
      [['RUNNING'], 'partial'],
      [['DONE', 'DONE', 'PENDING'], 'partial'],
      [['FAILED', 'SKIPPED'], 'failed'],
      [['FAILED'], 'failed'],
    ])('a FAILED plan with steps %j is %s, never completed', async (steps, outcome) => {
      expect(await endDirectly(steps, 'FAILED')).toBe(outcome);
    });

    it('trusts COMPLETED only when every step says DONE', async () => {
      expect(await endDirectly(['DONE', 'DONE'], 'COMPLETED')).toBe('completed');
      // COMPLETED over a step that did not finish is not told as done.
      expect(await endDirectly(['DONE', 'RUNNING'], 'COMPLETED')).toBe('partial');
      expect(await endDirectly(['SKIPPED'], 'COMPLETED')).toBe('not_run');
    });

    it('refuses an outcome message in any other shape', async () => {
      const p = await proposed([1]);
      const insert = (role: string, content: string | null, event: unknown) =>
        owner`INSERT INTO ai_messages (session_id, sequence, role, kind, content, event)
              VALUES (${p.session.id}, 90, ${role}::ai_message_role, 'PLAN_OUTCOME', ${content},
                      ${owner.json(event as never)})`;
      const good = { planId: p.plan.id, outcome: 'completed', steps: [] };
      await expect(insert('ASSISTANT', null, good)).rejects.toThrow(/ai_messages_shape/);
      await expect(insert('SYSTEM', 'All done!', good)).rejects.toThrow(/ai_messages_shape/);
      await expect(insert('SYSTEM', null, { ...good, outcome: 'success' })).rejects.toThrow(
        /ai_messages_shape/,
      );
      await expect(insert('SYSTEM', null, { ...good, steps: 'all' })).rejects.toThrow(
        /ai_messages_shape/,
      );
      await expect(insert('SYSTEM', null, { outcome: 'failed', steps: [] })).rejects.toThrow(
        /ai_messages_shape/,
      );
    });
  });
});
