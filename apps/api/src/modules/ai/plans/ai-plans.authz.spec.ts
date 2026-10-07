import { eq } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { person, planStack, req, TallyTool } from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { agencyContext, asRequests, scopedDb } from '../../../../test/workspace-context';
import { agency } from '../../../../test/workspace-fixtures';
import type { Actor } from '../../../common/authz/contract';
import { runInContext } from '../../../common/context/execution-context';
import { aiPlans, aiPlanSteps } from '../../../database/schema';
import type { AiPlansService } from './ai-plans.service';

/**
 * Nobody but its person reaches a plan, by any path (T-048) — not to read it, and above all not to
 * confirm it. A stranger gets the 404 an unknown id gets; so does a colleague in the same agency,
 * its owner included, because a plan is as private as the conversation it was proposed in.
 */
describe('nobody else reaches a plan, or confirms it', () => {
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

  const tally = { tool: 'addToTally', arguments: { name: 'a', amount: 1 } };

  /** Every way there is to touch one plan, as `actor`. */
  const everyPath = (
    plans: AiPlansService,
    actor: Actor,
    sessionId: string,
    plan: { id: string; planHash: string },
  ): Array<() => Promise<unknown>> => [
    () => plans.get(actor, sessionId, plan.id, req()),
    () => plans.timeline(actor, sessionId, plan.id, req()),
    () => plans.list(actor, sessionId, {}, req()),
    () => plans.confirm(actor, sessionId, plan.id, plan.planHash, req()),
    () => plans.decline(actor, sessionId, plan.id, req()),
    () => plans.propose(actor, sessionId, [tally], req()),
  ];

  const untouched = async (planId: string) => {
    const [row] = await owner<{ status: string; n: number }[]>`
      SELECT status, (SELECT count(*)::int FROM outbox_events WHERE aggregate_id = ${planId}) AS n
        FROM ai_plans WHERE id = ${planId}`;
    expect(row).toEqual({ status: 'PROPOSED', n: 0 });
  };

  it('gives another user 404 on every path — the session id and the plan id are both theirs to know', async () => {
    const me = await person(owner);
    const stranger = await person(owner);
    const stack = planStack(sql, [new TallyTool()]);
    const plans = asRequests(stack.plans, owner);
    const session = await asRequests(stack.sessions, owner).create(me, {}, req());
    const plan = await plans.propose(me, session.id, [tally], req());

    for (const attempt of everyPath(plans, stranger, session.id, plan)) {
      await expect(attempt()).rejects.toMatchObject({ status: 404 });
    }
    // Their own session, naming my plan, is no way in either — and lists only their own.
    const theirs = await asRequests(stack.sessions, owner).create(stranger, {}, req());
    await expect(plans.get(stranger, theirs.id, plan.id, req())).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      plans.confirm(stranger, theirs.id, plan.id, plan.planHash, req()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(plans.decline(stranger, theirs.id, plan.id, req())).rejects.toMatchObject({
      status: 404,
    });
    expect(await plans.list(stranger, theirs.id, {}, req())).toEqual([]);
    await untouched(plan.id);
  });

  it('keeps a colleague out — even the agency’s owner — and the policy shows them nothing underneath', async () => {
    const boss = await person(owner);
    const colleague = await person(owner);
    const firm = await agency(owner, [{ userId: boss.userId }, { userId: colleague.userId }]);
    const stack = planStack(sql, [new TallyTool()]);
    const inFirm = (actor: Actor) => agencyContext(owner, actor.userId, firm.tenantId);

    const { session, plan } = await runInContext(await inFirm(colleague), async () => {
      const s = await stack.sessions.create(colleague, {}, req());
      return { session: s, plan: await stack.plans.propose(colleague, s.id, [tally], req()) };
    });
    const asBoss = await inFirm(boss);
    for (const attempt of everyPath(stack.plans, boss, session.id, plan)) {
      await expect(runInContext(asBoss, attempt)).rejects.toMatchObject({ status: 404 });
    }
    const seen = await runInContext(asBoss, async () => ({
      plans: await scopedDb(sql).select().from(aiPlans).where(eq(aiPlans.id, plan.id)),
      steps: await scopedDb(sql).select().from(aiPlanSteps).where(eq(aiPlanSteps.planId, plan.id)),
    }));
    expect(seen).toEqual({ plans: [], steps: [] });
    await untouched(plan.id);
  });

  it('is not the person’s own in another of their workspaces: a confirmation does not cross', async () => {
    const me = await person(owner);
    const firm = await agency(owner, [{ userId: me.userId }]);
    const stack = planStack(sql, [new TallyTool()]);
    const plans = asRequests(stack.plans, owner);
    const session = await asRequests(stack.sessions, owner).create(me, {}, req());
    const plan = await plans.propose(me, session.id, [tally], req());

    const inFirm = await agencyContext(owner, me.userId, firm.tenantId);
    await expect(
      runInContext(inFirm, () =>
        stack.plans.confirm(me, session.id, plan.id, plan.planHash, req()),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await untouched(plan.id);
  });

  it('refuses a suspended account, or a call made outside any workspace, before reading anything', async () => {
    const me = await person(owner);
    const stack = planStack(sql, [new TallyTool()]);
    const plans = asRequests(stack.plans, owner);
    const session = await asRequests(stack.sessions, owner).create(me, {}, req());
    const plan = await plans.propose(me, session.id, [tally], req());

    const suspended = { ...me, status: 'SUSPENDED' as const };
    for (const attempt of everyPath(plans, suspended, session.id, plan)) {
      await expect(attempt()).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      stack.plans.confirm(me, session.id, plan.id, plan.planHash, req()),
    ).rejects.toMatchObject({ status: 403 });
    await untouched(plan.id);
  });
});
