import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/actor';
import { assignment, investigationSource } from '../../../test/assignment-fixtures';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import {
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
} from '../../../test/quote-fixtures';
import { asRequests, inWorkspaceOf, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import {
  assignments,
  assignmentStatusHistory,
  auditLogs,
  investigationSources,
  moneyDecisions,
  outboxEvents,
  policyReviews,
} from '../../database/schema';
import { AssignmentTransitionService } from './assignment-transition.service';
import type { ResolvePolicyReviewDto } from './assignments.dto';
import { PolicyRefusalService } from './policy-refusal.service';

type Status = (typeof schema.assignmentStatus.enumValues)[number];

const GROUND = 'The attachment appears to be a private message obtained without consent';
const REASONING = 'The material was obtained unlawfully; the investigator was right to stop';

describe('policy refusal and halt (T-050)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: PolicyRefusalService;
  let moderator: Actor;
  const req = () => ({ ip: '198.51.100.50', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    moderator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION'] });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    service = asRequests(
      new PolicyRefusalService(
        db,
        authz,
        audit,
        new AssignmentTransitionService(authz, audit),
        new PlatformContext(audit),
      ),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  /** An assignment in `status`, its two parties, and an investigator who can be told apart. */
  const work = async (
    status: Status = 'PENDING_ACCEPTANCE',
    investigator?: Awaited<ReturnType<typeof eligibleInvestigator>>,
  ) => {
    const mission = await quotableMission(ownerDb);
    const inv = investigator ?? (await eligibleInvestigator(ownerDb));
    const quote = await submittedQuote(ownerDb, {
      missionId: mission.missionId,
      investigatorProfileId: inv.profileId,
    });
    const row = await assignment(ownerDb, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status,
    });
    return {
      customer: mission.actor,
      inv,
      investigator: inv.actor,
      id: row.id,
      missionId: mission.missionId,
      price: row.priceMinor,
    };
  };

  const reviewOf = async (assignmentId: string) =>
    (
      await ownerDb.select().from(policyReviews).where(eq(policyReviews.assignmentId, assignmentId))
    )[0];
  const moneyOf = (assignmentId: string) =>
    ownerDb
      .select()
      .from(moneyDecisions)
      .where(eq(moneyDecisions.assignmentId, assignmentId))
      .orderBy(moneyDecisions.decidedAt);
  const statusOf = async (id: string) =>
    (await ownerDb.select().from(assignments).where(eq(assignments.id, id)))[0]!.status;
  const resolve = (reviewId: string, dto: Partial<ResolvePolicyReviewDto>, as: Actor = moderator) =>
    service.resolve(
      as,
      reviewId,
      { finding: 'SUBSTANTIATED', reasoning: REASONING, ...dto } as ResolvePolicyReviewDto,
      req(),
    );

  describe('window 1 — declining before accepting', () => {
    it('cancels, refunds in full, and opens a review of the mission on a policy concern', async () => {
      const { investigator, id, missionId } = await work();
      const declined = await service.decline(
        investigator,
        id,
        { reasonCode: 'POLICY_CONCERN', reason: GROUND },
        req(),
      );
      expect(declined.status).toBe('CANCELLED');

      const review = await reviewOf(id);
      expect([review?.kind, review?.missionId, review?.ground, review?.decidedAt]).toEqual([
        'DECLINE',
        missionId,
        GROUND,
        null,
      ]);
      const [money] = await moneyOf(id);
      expect([money?.decision, money?.executedAt, money?.policyReviewId]).toEqual([
        'FULL_REFUND',
        null,
        review!.id,
      ]);
      expect(money?.currency).toBe('AMD');
    });

    it('refunds in full on any decline, and opens no review without a policy concern', async () => {
      const { investigator, id } = await work();
      await service.decline(
        investigator,
        id,
        { reasonCode: 'UNAVAILABLE', reason: 'Travelling that week' },
        req(),
      );
      expect(await reviewOf(id)).toBeUndefined();
      expect((await moneyOf(id)).map((m) => m.decision)).toEqual(['FULL_REFUND']);
      const [last] = await ownerDb
        .select()
        .from(assignmentStatusHistory)
        .where(eq(assignmentStatusHistory.assignmentId, id))
        .orderBy(assignmentStatusHistory.occurredAt);
      expect(last).toBeDefined();
    });

    it('wants a ground a moderator can review, and changes nothing without one', async () => {
      const { investigator, id } = await work();
      for (const reason of [undefined, 'Feels wrong']) {
        await expect(
          service.decline(investigator, id, { reasonCode: 'POLICY_CONCERN', reason }, req()),
        ).rejects.toMatchObject({ status: 422 });
      }
      expect(await statusOf(id)).toBe('PENDING_ACCEPTANCE');
      expect(await moneyOf(id)).toEqual([]);
    });

    it('never shows the customer the ground: not in the history, not the review', async () => {
      const { customer, investigator, id } = await work();
      await service.decline(
        investigator,
        id,
        { reasonCode: 'POLICY_CONCERN', reason: GROUND },
        req(),
      );

      const history = await ownerDb
        .select()
        .from(assignmentStatusHistory)
        .where(eq(assignmentStatusHistory.assignmentId, id));
      expect(JSON.stringify(history)).not.toContain('private message');
      expect(history.at(-1)?.reason).toBe('POLICY_CONCERN');

      const [seen, money] = await inWorkspaceOf(owner, customer.userId, async () => [
        await scopedDb(sql).select().from(policyReviews).where(eq(policyReviews.assignmentId, id)),
        await scopedDb(sql)
          .select()
          .from(moneyDecisions)
          .where(eq(moneyDecisions.assignmentId, id)),
      ]);
      expect(seen).toEqual([]);
      // What happens to their money is theirs to see.
      expect(money.map((m) => m.decision)).toEqual(['FULL_REFUND']);
    });

    it('passes an ordinary reason on to the customer, as a message', async () => {
      const { investigator, id } = await work();
      await service.decline(
        investigator,
        id,
        { reasonCode: 'OUTSIDE_EXPERTISE', reason: 'Not my jurisdiction' },
        req(),
      );
      const history = await ownerDb
        .select()
        .from(assignmentStatusHistory)
        .where(eq(assignmentStatusHistory.assignmentId, id));
      expect(history.map((h) => h.reason)).toContain('OUTSIDE_EXPERTISE: Not my jurisdiction');
    });
  });

  describe('window 2 — halting accepted work', () => {
    it.each(['ACCEPTED', 'IN_PROGRESS'] as const)(
      'suspends from %s, holds the money, and opens a review',
      async (status) => {
        const { investigator, id } = await work(status);
        const halted = await service.halt(investigator, id, GROUND, req());
        expect(halted.status).toBe('SUSPENDED');
        expect((await reviewOf(id))?.kind).toBe('HALT');
        expect((await moneyOf(id)).map((m) => m.decision)).toEqual(['HOLD']);
      },
    );

    it('is available after material exists, and erases none of it', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      const source = await investigationSource(ownerDb, {
        assignmentId: id,
        addedBy: investigator.userId,
      });
      await service.halt(investigator, id, GROUND, req());
      const [kept] = await ownerDb
        .select()
        .from(investigationSources)
        .where(eq(investigationSources.id, source.id));
      expect(kept?.withdrawnAt).toBeNull();
    });

    it.each([
      'PENDING_ACCEPTANCE',
      'REPORT_SUBMITTED',
      'COMPLETED',
      'CANCELLED',
      'SUSPENDED',
    ] as const)('is refused while %s, leaving nothing behind', async (status) => {
      const { investigator, id } = await work(status);
      await expect(service.halt(investigator, id, GROUND, req())).rejects.toMatchObject({
        status: 403,
      });
      expect(await reviewOf(id)).toBeUndefined();
      expect(await moneyOf(id)).toEqual([]);
    });

    it('goes through the transition service: status, history, audit and outbox together', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      await service.halt(investigator, id, GROUND, req());
      const history = await ownerDb
        .select()
        .from(assignmentStatusHistory)
        .where(eq(assignmentStatusHistory.assignmentId, id));
      expect(history.at(-1)).toMatchObject({
        fromStatus: 'IN_PROGRESS',
        toStatus: 'SUSPENDED',
        reason: 'POLICY_HALT',
      });
      const events = await ownerDb
        .select({ type: outboxEvents.eventType })
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, id));
      expect(events.map((e) => e.type).sort()).toEqual([
        'assignment.status_changed',
        'money_decision.recorded',
      ]);
      const review = await reviewOf(id);
      const opened = await ownerDb
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, review!.id));
      expect(opened.map((e) => e.eventType)).toEqual(['policy_review.opened']);
    });
  });

  it('records events with no correlation when the request carried none', async () => {
    const { investigator, id } = await work('IN_PROGRESS');
    await service.halt(investigator, id, GROUND, { ip: '198.51.100.51' });
    const events = await ownerDb
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, id));
    expect(events.every((e) => e.correlationId === null)).toBe(true);
  });

  describe('staff decide, once', () => {
    it('resumes a halted assignment and releases the hold', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      await service.halt(investigator, id, GROUND, req());
      const review = await reviewOf(id);
      const decided = await resolve(review!.id, {
        finding: 'SUBSTANTIATED',
        disposition: 'RESUME',
      });
      expect([decided.finding, decided.disposition]).toEqual(['SUBSTANTIATED', 'RESUME']);
      expect(await statusOf(id)).toBe('IN_PROGRESS');
      expect((await moneyOf(id)).map((m) => m.decision)).toEqual(['HOLD', 'RESUME']);
    });

    it('cancels a halted assignment with the money decided separately', async () => {
      const { investigator, id, price } = await work('IN_PROGRESS');
      await service.halt(investigator, id, GROUND, req());
      const review = await reviewOf(id);
      await resolve(review!.id, {
        disposition: 'CANCEL',
        money: {
          decision: 'SPLIT',
          investigatorAmountMinor: Math.floor(price / 2),
          reason: 'Half the work was done lawfully',
        },
      });
      expect(await statusOf(id)).toBe('CANCELLED');
      const money = await moneyOf(id);
      expect(money.map((m) => [m.decision, m.investigatorAmountMinor])).toEqual([
        ['HOLD', null],
        ['SPLIT', Math.floor(price / 2)],
      ]);
      // Two decisions, two audit entries: the review and the money are recorded apart.
      const resolved = await ownerDb
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.resourceId, review!.id), eq(auditLogs.action, 'policy_review.resolved')),
        );
      expect(resolved[0]?.reason).toBe('HALT SUBSTANTIATED -> CANCEL');
    });

    it('never splits more than the customer paid', async () => {
      const { investigator, id, price } = await work('IN_PROGRESS');
      await service.halt(investigator, id, GROUND, req());
      const review = await reviewOf(id);
      await expect(
        resolve(review!.id, {
          disposition: 'CANCEL',
          money: { decision: 'SPLIT', investigatorAmountMinor: price + 1, reason: 'Too much' },
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(await statusOf(id)).toBe('SUSPENDED');
    });

    it('records a decline’s finding, and nothing about the assignment or money', async () => {
      const { investigator, id } = await work();
      await service.decline(
        investigator,
        id,
        { reasonCode: 'POLICY_CONCERN', reason: GROUND },
        req(),
      );
      const review = await reviewOf(id);
      await resolve(review!.id, { finding: 'UNSUBSTANTIATED' });
      expect((await moneyOf(id)).map((m) => m.decision)).toEqual(['FULL_REFUND']);
    });

    it.each([
      ['a disposition on a decline', 'DECLINE', { disposition: 'RESUME' as const }],
      ['a halt without a disposition', 'HALT', {}],
      ['a cancellation without a money decision', 'HALT', { disposition: 'CANCEL' as const }],
      [
        'a money decision on a resumption',
        'HALT',
        {
          disposition: 'RESUME' as const,
          money: { decision: 'FULL_REFUND' as const, reason: 'Refund it' },
        },
      ],
      [
        'bad faith on a substantiated finding',
        'HALT',
        { disposition: 'RESUME' as const, badFaith: true },
      ],
      [
        'a split with no amount',
        'HALT',
        { disposition: 'CANCEL' as const, money: { decision: 'SPLIT' as const, reason: 'Half' } },
      ],
    ])('refuses %s', async (_what, kind, dto) => {
      const { investigator, id } = await work(
        kind === 'HALT' ? 'IN_PROGRESS' : 'PENDING_ACCEPTANCE',
      );
      if (kind === 'HALT') await service.halt(investigator, id, GROUND, req());
      else
        await service.decline(
          investigator,
          id,
          { reasonCode: 'POLICY_CONCERN', reason: GROUND },
          req(),
        );
      const review = await reviewOf(id);
      await expect(resolve(review!.id, dto)).rejects.toMatchObject({ status: 422 });
      expect((await reviewOf(id))?.decidedAt).toBeNull();
    });

    it('decides once', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      await service.halt(investigator, id, GROUND, req());
      const review = await reviewOf(id);
      await resolve(review!.id, { disposition: 'RESUME' });
      await expect(resolve(review!.id, { disposition: 'RESUME' })).rejects.toMatchObject({
        status: 403,
      });
      await expect(resolve(randomUUID(), { disposition: 'RESUME' })).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('the response record — the asymmetry is the whole design', () => {
    const record = (inv: Actor) => service.myResponseRecord(inv, req());

    it('excuses a substantiated refusal and counts an unsubstantiated one, in both windows', async () => {
      const inv = await eligibleInvestigator(ownerDb);

      const a = await work('PENDING_ACCEPTANCE', inv);
      await service.decline(
        inv.actor,
        a.id,
        { reasonCode: 'POLICY_CONCERN', reason: GROUND },
        req(),
      );
      expect(await record(inv.actor)).toEqual({ counted: 0, excused: 0, pending: 1, badFaith: 0 });
      await resolve((await reviewOf(a.id))!.id, { finding: 'SUBSTANTIATED' });
      expect(await record(inv.actor)).toEqual({ counted: 0, excused: 1, pending: 0, badFaith: 0 });

      const b = await work('PENDING_ACCEPTANCE', inv);
      await service.decline(
        inv.actor,
        b.id,
        { reasonCode: 'POLICY_CONCERN', reason: GROUND },
        req(),
      );
      await resolve((await reviewOf(b.id))!.id, { finding: 'UNSUBSTANTIATED' });
      expect(await record(inv.actor)).toEqual({ counted: 1, excused: 1, pending: 0, badFaith: 0 });

      const c = await work('IN_PROGRESS', inv);
      await service.halt(inv.actor, c.id, GROUND, req());
      await resolve((await reviewOf(c.id))!.id, {
        finding: 'UNSUBSTANTIATED',
        badFaith: true,
        disposition: 'RESUME',
      });
      expect(await record(inv.actor)).toEqual({ counted: 2, excused: 1, pending: 0, badFaith: 1 });

      const d = await work('IN_PROGRESS', inv);
      await service.halt(inv.actor, d.id, GROUND, req());
      await resolve((await reviewOf(d.id))!.id, {
        finding: 'SUBSTANTIATED',
        disposition: 'RESUME',
      });
      expect(await record(inv.actor)).toEqual({ counted: 2, excused: 2, pending: 0, badFaith: 1 });
    });

    it('counts an ordinary decline like any other', async () => {
      const inv = await eligibleInvestigator(ownerDb);
      const a = await work('PENDING_ACCEPTANCE', inv);
      await service.decline(inv.actor, a.id, { reasonCode: 'UNAVAILABLE' }, req());
      expect(await record(inv.actor)).toEqual({ counted: 1, excused: 0, pending: 0, badFaith: 0 });
    });

    it('shows a moderator the raiser’s record in the queue, oldest first, paged', async () => {
      const inv = await eligibleInvestigator(ownerDb);
      const first = await work('IN_PROGRESS', inv);
      await service.halt(inv.actor, first.id, GROUND, req());
      const second = await work('IN_PROGRESS', inv);
      await service.halt(inv.actor, second.id, GROUND, req());

      // The whole queue: other tests in this file leave reviews open too.
      const all = await service.queue(moderator, { limit: 100 }, req());
      const mine = all.items.filter((i) => [first.id, second.id].includes(i.assignmentId));
      expect(mine.map((i) => i.assignmentId)).toEqual([first.id, second.id]);
      expect(mine.every((i) => i.raisedByRecord?.pending === 2)).toBe(true);

      // And paged: the second page begins exactly where the first ended.
      const one = await service.queue(moderator, { limit: 1 }, req());
      const two = await service.queue(
        moderator,
        { limit: 1, cursor: one.pageInfo.nextCursor! },
        req(),
      );
      expect([one.items[0]?.id, two.items[0]?.id]).toEqual([all.items[0]?.id, all.items[1]?.id]);
      const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
      for (const bad of [
        b64(null),
        b64({ t: 'yesterday', i: randomUUID() }),
        b64({ t: new Date().toISOString() }),
      ]) {
        await expect(service.queue(moderator, { cursor: bad }, req())).rejects.toMatchObject({
          status: 422,
        });
      }
      await expect(service.queue(moderator, { cursor: 'garbage' }, req())).rejects.toMatchObject({
        status: 422,
      });
    });
  });

  describe('who may', () => {
    it('lets only the assignment’s investigator refuse or halt it', async () => {
      const { customer, id } = await work('IN_PROGRESS');
      const stranger = (await eligibleInvestigator(ownerDb)).actor;
      await expect(service.halt(stranger, id, GROUND, req())).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.halt(customer, id, GROUND, req())).rejects.toMatchObject({
        status: 403,
      });
      const both = testActor({ ...customer, roles: ['CUSTOMER', 'INVESTIGATOR'] });
      await expect(service.halt(both, id, GROUND, req())).rejects.toMatchObject({ status: 404 });
    });

    it('lets only moderation staff decide, and records who was refused', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      await service.halt(investigator, id, GROUND, req());
      const review = await reviewOf(id);
      const disputes = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['DISPUTES'] });
      for (const who of [investigator, disputes]) {
        await expect(resolve(review!.id, { disposition: 'RESUME' }, who)).rejects.toMatchObject({
          status: 403,
        });
        await expect(service.queue(who, {}, req())).rejects.toMatchObject({ status: 403 });
      }
      const refused = await ownerDb
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.actorId, disputes.userId),
            eq(auditLogs.action, 'authz.denied.policy_review.resolve'),
          ),
        );
      expect(refused.map((r) => r.reason)).toEqual(['staff_scope_not_held']);
      expect((await reviewOf(id))?.decidedAt).toBeNull();
    });

    it('refuses a suspended investigator', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      await expect(
        service.halt(testActor({ ...investigator, status: 'SUSPENDED' }), id, GROUND, req()),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.myResponseRecord(testActor({ ...investigator, status: 'SUSPENDED' }), req()),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('the database holds it without the service', () => {
    const asWorkspaceOf = <T>(
      userId: string,
      fn: (db: ReturnType<typeof scopedDb>) => Promise<T>,
    ) => inWorkspaceOf(owner, userId, async () => await fn(scopedDb(sql)));

    it('lets no investigator decide their own review', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      await service.halt(investigator, id, GROUND, req());
      const changed = await asWorkspaceOf(investigator.userId, (db) =>
        db
          .update(policyReviews)
          .set({
            finding: 'SUBSTANTIATED',
            reasoning: REASONING,
            decidedBy: investigator.userId,
            decidedAt: new Date(),
          })
          .where(eq(policyReviews.assignmentId, id))
          .returning(),
      );
      expect(changed).toEqual([]);
    });

    it('lets the investigator’s workspace record only a refund or a hold', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      await expect(
        asWorkspaceOf(investigator.userId, (db) =>
          db.insert(moneyDecisions).values({
            assignmentId: id,
            decision: 'SPLIT',
            investigatorAmountMinor: 1,
            currency: 'AMD',
            reason: 'Pay me',
          }),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
      });
    });

    it('never changes a money decision, and marks it executed only once', async () => {
      const { investigator, id } = await work();
      await service.decline(investigator, id, {}, req());
      const [money] = await moneyOf(id);
      await expect(
        owner`UPDATE money_decisions SET decision = 'HOLD' WHERE id = ${money!.id}`,
      ).rejects.toThrow(/never changed/);
      await owner`UPDATE money_decisions SET executed_at = now() WHERE id = ${money!.id}`;
      await expect(
        owner`UPDATE money_decisions SET executed_at = now() WHERE id = ${money!.id}`,
      ).rejects.toThrow(/never changed/);
    });

    it('refuses a split above the price, whoever writes it', async () => {
      const { id, price } = await work('IN_PROGRESS');
      await expect(
        owner`INSERT INTO money_decisions (assignment_id, decision, investigator_amount_minor, currency, reason)
              VALUES (${id}, 'SPLIT', ${price + 1}, 'AMD', 'Too much')`,
      ).rejects.toThrow(/more than the customer paid/);
    });

    it('never rewrites what was raised, and decides once', async () => {
      const { investigator, id } = await work('IN_PROGRESS');
      await service.halt(investigator, id, GROUND, req());
      const review = await reviewOf(id);
      await expect(
        owner`UPDATE policy_reviews SET ground = 'Something else entirely, rewritten' WHERE id = ${review!.id}`,
      ).rejects.toThrow(/never rewritten/);
      await resolve(review!.id, { disposition: 'RESUME' });
      await expect(
        owner`UPDATE policy_reviews SET bad_faith = false WHERE id = ${review!.id}`,
      ).rejects.toThrow(/decided once/);
    });
  });
});
