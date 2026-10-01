import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/actor';
import {
  eligibleInvestigator,
  inDays,
  quotableMission,
  submittedQuote,
  type TestDb,
} from '../../../test/quote-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import * as schema from '../../database/schema';
import { auditLogs, missions, quotes } from '../../database/schema';
import { MissionTransitionService } from '../missions/mission-transition.service';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { QuotesService } from './quotes.service';
import { testPool } from '../../../test/db';
import { blockBetween } from '../../../test/block-fixtures';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import { runInContext, type ExecutionContext } from '../../common/context/execution-context';

describe('quotes', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  // Fixtures run as the owner: they write what the application may not (T-073).
  let ownerSql: postgres.Sql;
  let ownerDb: TestDb;
  let service: QuotesService;
  let raw: QuotesService;
  const req = () => ({ ip: '198.51.100.20', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    db = scopedDb(sql);
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
  });

  beforeEach(() => {
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    // `raw` is the same service without the harness that enters the caller's Personal
    // workspace: the agency cases below are about which workspace the call is made in.
    raw = new QuotesService(
      db,
      authz,
      audit,
      new IdempotencyService(),
      new MissionTransitionService(authz, audit),
      new OwnInvestigatorProfileRepository(db),
    );
    service = asRequests(raw, ownerSql);
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  const offer = (over: Record<string, unknown> = {}) => ({
    priceMinor: 250_000,
    currency: 'AMD',
    estimatedDurationDays: 14,
    scope: 'Records research at the declared business address.',
    deliverables: 'A written report with sources listed.',
    cancellationTerms: 'Full refund before work starts.',
    expiresAt: inDays(7).toISOString(),
    ...over,
  });

  describe('submitting', () => {
    it('accepts an offer from an eligible investigator', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const quote = await service.submit(inv.actor, mission.missionId, offer() as never, req());
      expect(quote).toMatchObject({
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
        status: 'SUBMITTED',
        priceMinor: 250_000,
        currency: 'AMD',
      });
    });

    it.each([
      ['not verified', { verificationStatus: 'UNVERIFIED' as const }],
      ['still a draft profile', { visibility: 'DRAFT' as const }],
      ['not accepting work', { acceptingWork: false }],
    ])('refuses an investigator who is %s', async (_label, opts) => {
      // The same conditions discovery applies. Someone who cannot be found should not arrive
      // through the back door of a quote.
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb, opts);
      await expect(
        service.submit(inv.actor, mission.missionId, offer() as never, req()),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('refuses a mission no moderator has published', async () => {
      // A draft mission is not visible to investigators at all, so absence and "not yet
      // published" are answered the same way.
      const mission = await quotableMission(ownerDb, { status: 'DRAFT' });
      const inv = await eligibleInvestigator(ownerDb);
      await expect(
        service.submit(inv.actor, mission.missionId, offer() as never, req()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('refuses the investigator’s own mission, as a 404 like any mission they may not quote on (T-142)', async () => {
      // One account holds both roles: posting as a customer, then quoting, accepting and reviewing
      // as the investigator would be self-dealing. Browse already leaves the mission out.
      const inv = await eligibleInvestigator(ownerDb);
      const own = await quotableMission(ownerDb, { customerId: inv.actor.userId });
      await expect(
        service.submit(inv.actor, own.missionId, offer() as never, req()),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect(
        await ownerDb.select().from(quotes).where(eq(quotes.missionId, own.missionId)),
      ).toEqual([]);
    });

    it('allows one live offer per investigator per mission', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      await service.submit(inv.actor, mission.missionId, offer() as never, req());
      await expect(
        service.submit(inv.actor, mission.missionId, offer() as never, req()),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('allows a replacement once the first is withdrawn', async () => {
      // "Before acceptance, withdraw it and submit a replacement."
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const first = await service.submit(inv.actor, mission.missionId, offer() as never, req());
      await service.withdraw(inv.actor, first.id, req());
      const second = await service.submit(
        inv.actor,
        mission.missionId,
        offer({ priceMinor: 300_000 }) as never,
        req(),
      );
      expect(second.priceMinor).toBe(300_000);
    });

    it.each([
      ['already past', new Date(Date.now() - 60_000).toISOString()],
      ['minutes away', new Date(Date.now() + 60_000).toISOString()],
      ['a year out', inDays(365).toISOString()],
    ])('refuses an expiry that is %s', async (_label, expiresAt) => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      await expect(
        service.submit(inv.actor, mission.missionId, offer({ expiresAt }) as never, req()),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('lets two investigators quote the same mission', async () => {
      // "You can receive several quotes for one mission and compare them."
      const mission = await quotableMission(ownerDb);
      const a = await eligibleInvestigator(ownerDb);
      const b = await eligibleInvestigator(ownerDb);
      await service.submit(a.actor, mission.missionId, offer() as never, req());
      await service.submit(b.actor, mission.missionId, offer() as never, req());
      expect(await service.listForMission(mission.actor, mission.missionId, req())).toHaveLength(2);
    });
  });

  describe('withdrawing', () => {
    it('withdraws a live offer', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const quote = await service.submit(inv.actor, mission.missionId, offer() as never, req());
      expect((await service.withdraw(inv.actor, quote.id, req())).status).toBe('WITHDRAWN');
    });

    it('refuses to withdraw somebody else’s offer', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const other = await eligibleInvestigator(ownerDb);
      const quote = await service.submit(inv.actor, mission.missionId, offer() as never, req());
      // 404, not 403: a 403 confirms the id is real to somebody who should not know.
      await expect(service.withdraw(other.actor, quote.id, req())).rejects.toMatchObject({
        status: 404,
      });
    });

    it('refuses to withdraw once accepted — that is the agreement', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
        status: 'ACCEPTED',
      });
      await expect(service.withdraw(inv.actor, quote.id, req())).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('accepting', () => {
    const accept = async (
      mission: { actor: { userId: string } },
      quoteId: string,
      key = randomUUID(),
    ) => service.accept(mission.actor as never, quoteId, key, req());

    it('confirms the scope and price, and closes the other offers', async () => {
      const mission = await quotableMission(ownerDb);
      const a = await eligibleInvestigator(ownerDb);
      const b = await eligibleInvestigator(ownerDb);
      const chosen = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: a.profileId,
      });
      const other = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: b.profileId,
      });

      const accepted = await accept(mission, chosen.id);
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.acceptedAt).toBeInstanceOf(Date);

      // "Once an assignment exists, the other quotes for that mission are closed."
      const [sibling] = await ownerDb.select().from(quotes).where(eq(quotes.id, other.id));
      expect(sibling?.status).toBe('CLOSED');

      // The mission moves, and no assignment exists yet — payment has not been authorized.
      const [row] = await ownerDb.select().from(missions).where(eq(missions.id, mission.missionId));
      expect(row?.status).toBe('CUSTOMER_CONFIRMED');
      expect(await ownerDb.select().from(schema.assignments)).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ missionId: mission.missionId })]),
      );
    });

    it('refuses an offer from someone the customer blocked, and says so, until they unblock', async () => {
      // T-052: the customer's own block, so theirs to be told about.
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
      });
      const block = await blockBetween(ownerSql, mission.customerId, inv.actor.userId);

      const refused = await accept(mission, quote.id).catch((e: unknown) => e);
      expect(refused).toMatchObject({
        code: 'STATE_CONFLICT',
        details: [
          { field: 'quote', code: 'BLOCKED', messageKey: 'error.validation.quote.blocked' },
        ],
      });
      expect((await ownerDb.select().from(quotes).where(eq(quotes.id, quote.id)))[0]?.status).toBe(
        'SUBMITTED',
      );

      await ownerSql`DELETE FROM user_blocks WHERE id = ${block}`;
      expect((await accept(mission, quote.id)).status).toBe('ACCEPTED');
    });

    it('refuses an expired offer', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      // Aged after insertion, because the database refuses a quote born already expired —
      // which is how a real one lapses anyway.
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
        expiredFor: 1000,
      });
      await expect(accept(mission, quote.id)).rejects.toMatchObject({ status: 403 });
    });

    it('refuses a withdrawn offer', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
        status: 'WITHDRAWN',
      });
      await expect(accept(mission, quote.id)).rejects.toMatchObject({ status: 403 });
    });

    it('refuses another customer, and the investigator', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
      });
      const stranger = testActor({ userId: randomUUID(), roles: ['CUSTOMER'] });
      await expect(service.accept(stranger, quote.id, randomUUID(), req())).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.accept(inv.actor, quote.id, randomUUID(), req())).rejects.toMatchObject({
        status: 403,
      });
    });

    it('replays the first answer when the same key arrives twice', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
      });
      const key = randomUUID();

      const first = await accept(mission, quote.id, key);
      const replay = await accept(mission, quote.id, key);
      expect(replay.id).toBe(first.id);

      // One acceptance, not two: the mission moved once.
      const history = await ownerDb
        .select()
        .from(schema.missionStatusHistory)
        .where(eq(schema.missionStatusHistory.missionId, mission.missionId));
      expect(history.filter((h) => h.toStatus === 'CUSTOMER_CONFIRMED')).toHaveLength(1);
    });

    it('refuses a second acceptance under a different key', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
      });
      await accept(mission, quote.id);
      await expect(accept(mission, quote.id)).rejects.toMatchObject({ status: 403 });
    });

    it('lets exactly one of two simultaneous acceptances through', async () => {
      // Two quotes on one mission, accepted at the same instant. "Accepting a quote creates a
      // single assignment for that mission" — so one wins and the other finds the mission
      // already confirmed.
      const mission = await quotableMission(ownerDb);
      const a = await eligibleInvestigator(ownerDb);
      const b = await eligibleInvestigator(ownerDb);
      const first = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: a.profileId,
      });
      const second = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: b.profileId,
      });

      const results = await Promise.allSettled([
        accept(mission, first.id),
        accept(mission, second.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const rows = await ownerDb
        .select()
        .from(quotes)
        .where(eq(quotes.missionId, mission.missionId));
      expect(rows.filter((q) => q.status === 'ACCEPTED')).toHaveLength(1);
    });
  });

  describe('the database as the last line', () => {
    it('refuses a second accepted quote on one mission, whatever writes it', async () => {
      // The service locks the mission, so its own concurrency test passes even with this index
      // dropped — a negative control proved exactly that. The constraint is what holds the rule
      // against every other writer: a job, a migration, a console, a future endpoint that
      // forgets to lock.
      const mission = await quotableMission(ownerDb);
      const a = await eligibleInvestigator(ownerDb);
      const b = await eligibleInvestigator(ownerDb);
      const first = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: a.profileId,
      });
      const second = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: b.profileId,
      });

      await ownerDb
        .update(quotes)
        .set({ status: 'ACCEPTED', acceptedAt: new Date() })
        .where(eq(quotes.id, first.id));

      await expect(
        ownerDb
          .update(quotes)
          .set({ status: 'ACCEPTED', acceptedAt: new Date() })
          .where(eq(quotes.id, second.id)),
      ).rejects.toMatchObject({ cause: { constraint_name: 'quotes_one_accepted_per_mission' } });
    });

    it('refuses a second live quote from one investigator on one mission', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
      });
      await expect(
        submittedQuote(ownerDb, {
          missionId: mission.missionId,
          investigatorProfileId: inv.profileId,
        }),
      ).rejects.toMatchObject({ cause: { constraint_name: 'quotes_one_live_per_investigator' } });
    });
  });

  describe('reading', () => {
    it('shows the customer every offer on their own mission', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
      });
      expect(await service.listForMission(mission.actor, mission.missionId, req())).toHaveLength(1);
    });

    it('refuses another customer’s mission', async () => {
      const mission = await quotableMission(ownerDb);
      const stranger = testActor({ userId: randomUUID(), roles: ['CUSTOMER'] });
      await expect(
        service.listForMission(stranger, mission.missionId, req()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('shows an investigator their own offers', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      await service.submit(inv.actor, mission.missionId, offer() as never, req());
      const mine = await service.listMine(inv.actor, req());
      expect(mine.map((q) => q.missionId)).toContain(mission.missionId);
    });
  });

  describe('quoting from an agency workspace', () => {
    /** The context a request in `tenantId` would get, with the roles that membership holds. */
    const contextIn = async (userId: string, tenantId: string) => {
      const [row] = await ownerSql<{ membership: string; permissions: string[] }[]>`
        SELECT m.id AS membership,
               coalesce(array_agg(DISTINCT rp.permission_key)
                          FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
          FROM tenant_memberships m
          LEFT JOIN membership_roles mr ON mr.membership_id = m.id
          LEFT JOIN role_permissions rp ON rp.role_id = mr.role_id
         WHERE m.tenant_id = ${tenantId} AND m.user_id = ${userId}
         GROUP BY m.id`;
      return {
        tenantId,
        tenantKind: 'AGENCY' as const,
        userId,
        membershipId: row!.membership,
        sessionId: randomUUID(),
        permissions: row!.permissions as ExecutionContext['permissions'],
      };
    };

    it('refuses a member whose role does not grant investigations.create', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const boss = await member(ownerSql);
      const { tenantId } = await agency(ownerSql, [
        { userId: boss.actor.userId },
        { userId: inv.actor.userId, role: 'VIEWER' },
      ]);
      const correlationId = randomUUID();

      await expect(
        runInContext(await contextIn(inv.actor.userId, tenantId), () =>
          raw.submit(inv.actor, mission.missionId, offer() as never, { ...req(), correlationId }),
        ),
      ).rejects.toMatchObject({ status: 403 });

      const [denial] = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, correlationId));
      expect(denial).toMatchObject({ reason: 'permission_not_held' });
    });

    it('does not let a member quote for the agency with their Personal profile', async () => {
      // Their profile in their Personal workspace is theirs, not the agency's: a request in the
      // agency finds no profile of theirs there (T-087). Before T-087 it found the Personal one,
      // got past authorization, and only the database refused the write (T-078).
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const boss = await member(ownerSql);
      const { tenantId } = await agency(ownerSql, [
        { userId: boss.actor.userId },
        { userId: inv.actor.userId, role: 'INVESTIGATOR' },
      ]);
      const correlationId = randomUUID();

      await expect(
        runInContext(await contextIn(inv.actor.userId, tenantId), () =>
          raw.submit(inv.actor, mission.missionId, offer() as never, { ...req(), correlationId }),
        ),
      ).rejects.toMatchObject({ status: 404 });

      const [denial] = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, correlationId));
      expect(denial).toMatchObject({ reason: 'resource_not_visible' });
      expect(
        await ownerDb.select().from(quotes).where(eq(quotes.missionId, mission.missionId)),
      ).toEqual([]);
    });

    it('quotes as the agency with the profile the agency holds for them (T-087)', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const boss = await member(ownerSql);
      const { tenantId } = await agency(ownerSql, [
        { userId: boss.actor.userId },
        { userId: inv.actor.userId, role: 'INVESTIGATOR' },
      ]);
      const held = await eligibleInvestigator(ownerDb, {
        heldIn: { tenantId, userId: inv.actor.userId },
      });

      const quote = await runInContext(await contextIn(inv.actor.userId, tenantId), () =>
        raw.submit(inv.actor, mission.missionId, offer() as never, req()),
      );

      // The agency's profile, and the agency as the supplier party — not the person's Personal one.
      expect(quote.investigatorProfileId).toBe(held.profileId);
      const [row] = await ownerDb.select().from(quotes).where(eq(quotes.id, quote.id));
      expect(row).toMatchObject({
        supplierTenantId: tenantId,
        investigatorProfileId: held.profileId,
      });
      expect(await service.listForMission(mission.actor, mission.missionId, req())).toHaveLength(1);
    });
  });
});
