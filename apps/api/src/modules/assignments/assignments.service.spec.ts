import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import {
  authorization,
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
  type TestDb,
} from '../../../test/quote-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import * as schema from '../../database/schema';
import { assignments, missions } from '../../database/schema';
import { MissionTransitionService } from '../missions/mission-transition.service';
import { AssignmentTransitionService } from './assignment-transition.service';
import { AssignmentsService } from './assignments.service';
import { testPool } from '../../../test/db';


describe('assignments', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  let service: AssignmentsService;
  const req = () => ({ ip: '198.51.100.30', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    db = drizzle(sql, { schema });
  });

  beforeEach(() => {
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    service = new AssignmentsService(
      db,
      authz,
      audit,
      new IdempotencyService(),
      new AssignmentTransitionService(authz, audit),
      new MissionTransitionService(authz, audit),
    );
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A mission whose customer has accepted a quote: the state a payment arrives into. */
  const awaitingPayment = async (over: { priceMinor?: number; currency?: string } = {}) => {
    const mission = await quotableMission(db, { status: 'CUSTOMER_CONFIRMED' });
    const inv = await eligibleInvestigator(db);
    const quote = await submittedQuote(db, {
      missionId: mission.missionId,
      investigatorProfileId: inv.profileId,
      status: 'ACCEPTED',
      priceMinor: over.priceMinor ?? 250_000,
      currency: over.currency ?? 'AMD',
    });
    return { mission, inv, quote };
  };

  describe('creating one, when a payment has been authorized', () => {
    it('creates the assignment and moves the mission through PAID to ASSIGNED', async () => {
      const { mission, inv, quote } = await awaitingPayment();
      const auth = authorization();

      const created = await service.createForAuthorizedPayment(
        { quoteId: quote.id, authorization: auth, idempotencyKey: randomUUID() },
        req(),
      );

      expect(created).toMatchObject({
        missionId: mission.missionId,
        quoteId: quote.id,
        investigatorProfileId: inv.profileId,
        status: 'PENDING_ACCEPTANCE',
        // Snapshotted from the quote: the agreement as it stood at acceptance.
        priceMinor: quote.priceMinor,
        currency: quote.currency,
        acceptedScope: quote.scope,
      });

      const [row] = await db.select().from(missions).where(eq(missions.id, mission.missionId));
      expect(row?.status).toBe('ASSIGNED');

      // Both moves recorded, not collapsed into one: a dispute needs to tell "paid" from
      // "assigned" apart.
      const history = await db
        .select()
        .from(schema.missionStatusHistory)
        .where(eq(schema.missionStatusHistory.missionId, mission.missionId));
      expect(history.map((h) => h.toStatus)).toEqual(expect.arrayContaining(['PAID', 'ASSIGNED']));
    });

    it('records the authorization it was created against', async () => {
      const { quote } = await awaitingPayment();
      const auth = authorization();
      const created = await service.createForAuthorizedPayment(
        { quoteId: quote.id, authorization: auth, idempotencyKey: randomUUID() },
        req(),
      );
      const [row] = await db.select().from(assignments).where(eq(assignments.id, created.id));
      expect(row?.paymentReference).toBe(auth.reference);
      expect(row?.paymentAuthorizedAt).toEqual(auth.authorizedAt);
    });

    it.each([
      ['the amount does not match the quote', { amountMinor: 100 }],
      ['the currency does not match the quote', { currency: 'USD' }],
    ])('refuses when %s', async (_label, over) => {
      // A mismatch means the two systems disagree about what was bought. That is never
      // resolved in favour of proceeding.
      const { quote } = await awaitingPayment();
      await expect(
        service.createForAuthorizedPayment(
          { quoteId: quote.id, authorization: authorization(over), idempotencyKey: randomUUID() },
          req(),
        ),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      expect(await db.select().from(assignments).where(eq(assignments.quoteId, quote.id))).toEqual(
        [],
      );
    });

    it('refuses a quote nobody accepted', async () => {
      const mission = await quotableMission(db, { status: 'CUSTOMER_CONFIRMED' });
      const inv = await eligibleInvestigator(db);
      const quote = await submittedQuote(db, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
      });
      await expect(
        service.createForAuthorizedPayment(
          { quoteId: quote.id, authorization: authorization(), idempotencyKey: randomUUID() },
          req(),
        ),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    });

    it('replays the first answer when the provider redelivers the same event', async () => {
      // Providers retry. A duplicate must not produce a second assignment.
      const { quote } = await awaitingPayment();
      const key = randomUUID();
      const auth = authorization();
      const first = await service.createForAuthorizedPayment(
        { quoteId: quote.id, authorization: auth, idempotencyKey: key },
        req(),
      );
      const replay = await service.createForAuthorizedPayment(
        { quoteId: quote.id, authorization: auth, idempotencyKey: key },
        req(),
      );
      expect(replay.id).toBe(first.id);
      expect(
        await db.select().from(assignments).where(eq(assignments.quoteId, quote.id)),
      ).toHaveLength(1);
    });

    it('creates exactly one assignment when two authorizations arrive at once', async () => {
      // The headline guarantee, and the database is what holds it: mission_id and quote_id are
      // both unique, so the loser violates a constraint rather than racing a check.
      const { quote } = await awaitingPayment();
      const attempt = () =>
        service.createForAuthorizedPayment(
          { quoteId: quote.id, authorization: authorization(), idempotencyKey: randomUUID() },
          req(),
        );

      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await db.select().from(assignments).where(eq(assignments.quoteId, quote.id)),
      ).toHaveLength(1);
    });
  });

  describe('the database as the last line', () => {
    it('refuses a second assignment for one mission, whatever writes it', async () => {
      // "One mission produces one assignment." The service would also have to lose a race to
      // get here; the constraint is what makes that impossible rather than unlikely.
      const { mission, inv, quote } = await awaitingPayment();
      const created = await service.createForAuthorizedPayment(
        { quoteId: quote.id, authorization: authorization(), idempotencyKey: randomUUID() },
        req(),
      );

      await expect(
        db.insert(assignments).values({
          missionId: mission.missionId,
          // A different quote, so only the mission uniqueness can refuse this.
          quoteId: (
            await submittedQuote(db, {
              missionId: mission.missionId,
              investigatorProfileId: inv.profileId,
              status: 'CLOSED',
            })
          ).id,
          customerId: mission.customerId,
          investigatorProfileId: inv.profileId,
          acceptedScope: 'a second agreement nobody made',
          deliverables: 'x',
          cancellationTerms: 'x',
          priceMinor: 1,
          currency: 'AMD',
          estimatedDurationDays: 1,
          paymentReference: 'pi_duplicate',
          paymentAuthorizedAt: new Date(),
          acceptanceDueAt: new Date(Date.now() + 86_400_000),
        }),
      ).rejects.toMatchObject({ cause: { constraint_name: 'assignments_mission_unique' } });

      expect(created.missionId).toBe(mission.missionId);
    });
  });

  describe('the investigator’s window', () => {
    const created = async () => {
      const { mission, inv, quote } = await awaitingPayment();
      const assignment = await service.createForAuthorizedPayment(
        { quoteId: quote.id, authorization: authorization(), idempotencyKey: randomUUID() },
        req(),
      );
      return { mission, inv, assignment };
    };

    it('accepts, which is what commits them to the work', async () => {
      const { inv, assignment } = await created();
      const accepted = await service.accept(inv.actor, assignment.id, req());
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.acceptedAt).toBeInstanceOf(Date);
    });

    it('refuses once the window has closed', async () => {
      // "Failing to accept it releases the customer." Enforced against the clock, not against
      // a status somebody has to remember to write.
      const { inv, assignment } = await created();
      await db
        .update(assignments)
        .set({ acceptanceDueAt: new Date(Date.now() - 1000) })
        .where(eq(assignments.id, assignment.id));
      await expect(service.accept(inv.actor, assignment.id, req())).rejects.toMatchObject({
        status: 403,
      });
    });

    it('declines, recording the ground it was declined on', async () => {
      const { inv, assignment } = await created();
      const declined = await service.decline(inv.actor, assignment.id, 'POLICY_CONCERN', req());
      expect(declined.status).toBe('CANCELLED');

      const history = await db
        .select()
        .from(schema.assignmentStatusHistory)
        .where(eq(schema.assignmentStatusHistory.assignmentId, assignment.id));
      expect(history.at(-1)).toMatchObject({ toStatus: 'CANCELLED', reason: 'POLICY_CONCERN' });
    });

    it('refuses an investigator who is not the one assigned', async () => {
      const { assignment } = await created();
      const other = await eligibleInvestigator(db);
      await expect(service.accept(other.actor, assignment.id, req())).rejects.toMatchObject({
        status: 404,
      });
    });

    it('refuses to accept twice', async () => {
      const { inv, assignment } = await created();
      await service.accept(inv.actor, assignment.id, req());
      await expect(service.accept(inv.actor, assignment.id, req())).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('reading', () => {
    it('is visible to both parties and to nobody else', async () => {
      const { mission, inv, quote } = await awaitingPayment();
      const assignment = await service.createForAuthorizedPayment(
        { quoteId: quote.id, authorization: authorization(), idempotencyKey: randomUUID() },
        req(),
      );

      expect((await service.getForParty(mission.actor, assignment.id, req())).id).toBe(
        assignment.id,
      );
      expect((await service.getForParty(inv.actor, assignment.id, req())).id).toBe(assignment.id);

      const stranger = testActor({ userId: randomUUID(), roles: ['CUSTOMER'] });
      await expect(service.getForParty(stranger, assignment.id, req())).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
