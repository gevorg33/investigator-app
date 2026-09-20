import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expectAuthorized, testActor } from '../../../test/authz-cases';
import {
  category,
  completeDraft,
  customer,
  inDays,
  type TestDb,
} from '../../../test/mission-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import * as schema from '../../database/schema';
import {
  auditLogs,
  missions,
  missionScreenings,
  missionStatusHistory,
  outboxEvents,
} from '../../database/schema';
import { MemoryRateLimitStore, RateLimitService } from '../auth/rate-limit.service';
import { MissionPolicyService } from '../mission-policy/mission-policy.service';
import { MissionTransitionService } from './mission-transition.service';
import { OwnMissionRepository } from './missions.repository';
import { MissionsService } from './missions.service';
import { testPool } from '../../../test/db';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { agency } from '../../../test/workspace-fixtures';
import { runInContext } from '../../common/context/execution-context';


describe('missions', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  // Fixtures run as the owner: they write what the application may not (T-073).
  let ownerSql: postgres.Sql;
  let ownerDb: TestDb;
  let service: MissionsService;
  let raw: MissionsService;
  const req = () => ({ ip: '198.51.100.70', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    db = scopedDb(sql);
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
  });

  beforeEach(() => {
    const audit = new AuditService(db);
    // `raw` is the same service without the harness that enters the caller's Personal workspace:
    // the one test below is about which workspace a customer may act in at all.
    raw = new MissionsService(
      db,
      new AuthzService(audit),
      audit,
      new OwnMissionRepository(db),
      new MissionTransitionService(new AuthzService(audit), audit),
      new MissionPolicyService(),
      // A fresh limiter per test: the submission limit is not what these tests are about.
      new RateLimitService(new MemoryRateLimitStore()),
    );
    service = asRequests(raw, ownerSql);
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  /** A customer with a complete, submittable draft. */
  const withDraft = async (over: Record<string, unknown> = {}) => {
    const { actor } = await customer(ownerDb);
    const nodeId = await category(ownerDb);
    const draft = await service.createDraft(actor, { ...completeDraft(nodeId), ...over }, req());
    return { actor, draft, nodeId };
  };

  const historyOf = (missionId: string) =>
    ownerDb
      .select()
      .from(missionStatusHistory)
      .where(eq(missionStatusHistory.missionId, missionId))
      .orderBy(missionStatusHistory.occurredAt);

  describe('drafting', () => {
    it('saves an empty draft, so a customer can start without having decided everything', async () => {
      const { actor } = await customer(ownerDb);
      const draft = await service.createDraft(actor, {}, req());
      expect(draft).toMatchObject({ status: 'DRAFT', version: 1, title: null, languages: [] });
    });

    it('records creation in the history with no previous status', async () => {
      const { actor } = await customer(ownerDb);
      const draft = await service.createDraft(actor, { title: 'Something' }, req());
      expect(await historyOf(draft.id)).toMatchObject([
        { fromStatus: null, toStatus: 'DRAFT', actorKind: 'CUSTOMER', actorId: actor.userId },
      ]);
    });

    it('edits a draft and moves the version on', async () => {
      const { actor, draft } = await withDraft();
      const updated = await service.updateDraft(
        actor,
        draft.id,
        { version: draft.version, title: 'Renamed' },
        req(),
      );
      expect(updated).toMatchObject({ title: 'Renamed', version: draft.version + 1 });
    });

    it('clears a field when the client sends null, and leaves absent fields alone', async () => {
      const { actor, draft } = await withDraft();
      const updated = await service.updateDraft(
        actor,
        draft.id,
        { version: draft.version, locationLabel: null },
        req(),
      );
      expect(updated.locationLabel).toBeNull();
      expect(updated.title).toBe(draft.title);
    });

    it('coarsens a location before storing it', async () => {
      // A mission's location is often where its subject lives.
      const { actor, draft } = await withDraft();
      const updated = await service.updateDraft(
        actor,
        draft.id,
        { version: draft.version, location: { lon: 44.51523, lat: 40.18724 } },
        req(),
      );
      expect(updated.location).toEqual({ lon: 44.52, lat: 40.19 });
    });

    it('refuses a date that is not a real day', async () => {
      const { actor, draft } = await withDraft();
      await expect(
        service.updateDraft(
          actor,
          draft.id,
          { version: draft.version, deadline: '2026-02-31' },
          req(),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses a category that is not current', async () => {
      // Deprecated nodes keep old missions valid; they do not accept new ones.
      const { actor, draft } = await withDraft();
      const deprecated = await category(ownerDb, { status: 'DEPRECATED' });
      await expect(
        service.updateDraft(
          actor,
          draft.id,
          { version: draft.version, taxonomyNodeId: deprecated },
          req(),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses an edit that read an older version', async () => {
      const { actor, draft } = await withDraft();
      await service.updateDraft(actor, draft.id, { version: draft.version, title: 'First' }, req());
      await expect(
        service.updateDraft(actor, draft.id, { version: draft.version, title: 'Second' }, req()),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    });
  });

  describe('submitting', () => {
    it('confirms lawful purpose, screens, and holds the mission for a moderator', async () => {
      const { actor, draft } = await withDraft();
      const submitted = await service.submit(
        actor,
        draft.id,
        { version: draft.version, lawfulPurposeConfirmed: true },
        req(),
      );

      // Not QUOTED. No mission reaches investigators without a moderator publishing it.
      expect(submitted.status).toBe('UNDER_REVIEW');
      expect(submitted.lawfulPurposeConfirmedAt).toBeInstanceOf(Date);
      expect(submitted.submittedAt).toBeInstanceOf(Date);

      expect(
        (await historyOf(draft.id)).map((h) => [h.fromStatus, h.toStatus, h.actorKind]),
      ).toEqual([
        [null, 'DRAFT', 'CUSTOMER'],
        ['DRAFT', 'SUBMITTED', 'CUSTOMER'],
        ['SUBMITTED', 'UNDER_REVIEW', 'SYSTEM'],
      ]);
    });

    it('writes the status, history, audit and outbox in one transaction', async () => {
      const { actor, draft } = await withDraft();
      await service.submit(
        actor,
        draft.id,
        { version: draft.version, lawfulPurposeConfirmed: true },
        req(),
      );

      const events = await ownerDb
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.aggregateId, draft.id),
            eq(outboxEvents.eventType, 'mission.status_changed'),
          ),
        );
      expect(events.map((e) => (e.payload as { to: string }).to).sort()).toEqual([
        'SUBMITTED',
        'UNDER_REVIEW',
      ]);
      // Unpublished: the relay arrives with BullMQ (T-036).
      expect(events.every((e) => e.publishedAt === null)).toBe(true);

      const audits = await ownerDb.select().from(auditLogs).where(eq(auditLogs.resourceId, draft.id));
      expect(audits.map((a) => a.action)).toContain('mission.status_changed');
      expect(audits.map((a) => a.action)).toContain('mission.submitted');

      const [screening] = await ownerDb
        .select()
        .from(missionScreenings)
        .where(eq(missionScreenings.missionId, draft.id));
      expect(screening).toMatchObject({ outcome: 'ROUTINE_REVIEW', riskBand: 'STANDARD' });
    });

    it('lists every missing field rather than refusing one at a time', async () => {
      const { actor } = await customer(ownerDb);
      const draft = await service.createDraft(actor, { title: 'Only a title' }, req());
      await expect(
        service.submit(
          actor,
          draft.id,
          { version: draft.version, lawfulPurposeConfirmed: true },
          req(),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'taxonomyNodeId' }),
          expect.objectContaining({ field: 'description' }),
          expect.objectContaining({ field: 'purpose' }),
          expect.objectContaining({ field: 'subjectRelationship' }),
          expect.objectContaining({ field: 'languages' }),
        ]),
      });
    });

    it('asks for the protective-order answer where the relationship is personal', async () => {
      const { actor, draft } = await withDraft({ subjectRelationship: 'FORMER_PARTNER' });
      await expect(
        service.submit(
          actor,
          draft.id,
          { version: draft.version, lawfulPurposeConfirmed: true },
          req(),
        ),
      ).rejects.toMatchObject({
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'protectiveOrderDeclared' }),
        ]),
      });
    });

    it('refuses a deadline that has already passed', async () => {
      const { actor, draft } = await withDraft({ deadline: inDays(-1) });
      await expect(
        service.submit(
          actor,
          draft.id,
          { version: draft.version, lawfulPurposeConfirmed: true },
          req(),
        ),
      ).rejects.toMatchObject({
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'deadline', code: 'IN_THE_PAST' }),
        ]),
      });
    });

    it('leaves the draft untouched when submission fails', async () => {
      // Nothing half-applied: no confirmation recorded for a submission that did not happen.
      const { actor } = await customer(ownerDb);
      const draft = await service.createDraft(actor, { title: 'Incomplete' }, req());
      await expect(
        service.submit(
          actor,
          draft.id,
          { version: draft.version, lawfulPurposeConfirmed: true },
          req(),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      const [row] = await ownerDb.select().from(missions).where(eq(missions.id, draft.id));
      expect(row).toMatchObject({
        status: 'DRAFT',
        version: draft.version,
        lawfulPurposeConfirmedAt: null,
      });
      expect(
        await ownerDb.select().from(missionScreenings).where(eq(missionScreenings.missionId, draft.id)),
      ).toEqual([]);
    });

    it('refuses to submit the same mission twice', async () => {
      const { actor, draft } = await withDraft();
      const submitted = await service.submit(
        actor,
        draft.id,
        { version: draft.version, lawfulPurposeConfirmed: true },
        req(),
      );
      await expect(
        service.submit(
          actor,
          draft.id,
          { version: submitted.version, lawfulPurposeConfirmed: true },
          req(),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('refuses to edit a mission once it has been submitted', async () => {
      // Investigators may already be preparing quotes against it.
      const { actor, draft } = await withDraft();
      const submitted = await service.submit(
        actor,
        draft.id,
        { version: draft.version, lawfulPurposeConfirmed: true },
        req(),
      );
      await expect(
        service.updateDraft(
          actor,
          draft.id,
          { version: submitted.version, title: 'Changed' },
          req(),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('prioritises a mission whose text matches a policy rule, without deciding anything', async () => {
      const { actor, draft } = await withDraft({
        description: 'I need you to hack the account and read his messages.',
      });
      const submitted = await service.submit(
        actor,
        draft.id,
        { version: draft.version, lawfulPurposeConfirmed: true },
        req(),
      );

      // Flagged and prioritised — and in exactly the same place as a clean mission.
      expect(submitted.status).toBe('UNDER_REVIEW');
      const [screening] = await ownerDb
        .select()
        .from(missionScreenings)
        .where(eq(missionScreenings.missionId, draft.id));
      expect(screening).toMatchObject({ outcome: 'PRIORITY_REVIEW', riskBand: 'HIGH' });
      expect(screening?.flags).toContain('device_or_account_access');
    });

    it('tells the customer nothing about what screening found', async () => {
      // The customer is told the policy position by a moderator, never the detection.
      const { actor, draft } = await withDraft({ description: 'Put a GPS tracker on his car.' });
      const submitted = await service.submit(
        actor,
        draft.id,
        { version: draft.version, lawfulPurposeConfirmed: true },
        req(),
      );
      const serialised = JSON.stringify(submitted);
      expect(serialised).not.toContain('tracking_device');
      expect(serialised).not.toContain('PRIORITY_REVIEW');
      expect(Object.keys(submitted)).not.toContain('flags');
    });

    it('rate-limits submissions, because each one costs a moderator’s attention', async () => {
      const { actor } = await customer(ownerDb);
      const nodeId = await category(ownerDb);
      const submitOnce = async () => {
        const draft = await service.createDraft(actor, completeDraft(nodeId), req());
        return service.submit(
          actor,
          draft.id,
          { version: draft.version, lawfulPurposeConfirmed: true },
          req(),
        );
      };
      for (let i = 0; i < 10; i += 1) await submitOnce();
      await expect(submitOnce()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });
  });

  describe('the database as the last line', () => {
    it('refuses a submitted mission with no lawful-purpose confirmation, whatever wrote it', async () => {
      // The service is not the only thing that could ever write this table.
      const { userId } = await customer(ownerDb);
      const nodeId = await category(ownerDb);
      const [row] = await ownerDb
        .insert(missions)
        .values({ customerId: userId, ...completeDraft(nodeId) })
        .returning();
      await expect(
        ownerDb
          .update(missions)
          .set({ status: 'UNDER_REVIEW', submittedAt: new Date() })
          .where(eq(missions.id, row!.id)),
      ).rejects.toMatchObject({ cause: { constraint_name: 'missions_submission_complete' } });
    });

    it('refuses a submitted mission that is missing a required field', async () => {
      const { userId } = await customer(ownerDb);
      const [row] = await ownerDb
        .insert(missions)
        .values({ customerId: userId, title: 'Only a title' })
        .returning();
      await expect(
        ownerDb
          .update(missions)
          .set({
            status: 'UNDER_REVIEW',
            submittedAt: new Date(),
            lawfulPurposeConfirmedAt: new Date(),
          })
          .where(eq(missions.id, row!.id)),
      ).rejects.toMatchObject({ cause: { constraint_name: 'missions_submission_complete' } });
    });

    it('refuses a budget whose minimum exceeds its maximum', async () => {
      const { userId } = await customer(ownerDb);
      await expect(
        ownerDb
          .insert(missions)
          .values({ customerId: userId, budgetMinMinor: 900, budgetMaxMinor: 100 }),
      ).rejects.toMatchObject({ cause: { constraint_name: 'missions_budget_range' } });
    });

    it('refuses a location more precise than about a kilometre', async () => {
      const { userId } = await customer(ownerDb);
      await expect(
        ownerDb
          .insert(missions)
          .values({ customerId: userId, location: { lon: 44.51523, lat: 40.18724 } }),
      ).rejects.toMatchObject({ cause: { constraint_name: 'missions_location_coarsened' } });
    });

    it('refuses a language code that is not ISO 639-1', async () => {
      const { userId } = await customer(ownerDb);
      await expect(
        ownerDb.insert(missions).values({ customerId: userId, languages: ['en', 'English'] }),
      ).rejects.toMatchObject({ cause: { constraint_name: 'missions_languages_valid' } });
    });
  });

  describe('the personal-relationship path', () => {
    it('accepts the protective-order answer and screens the mission as restricted', async () => {
      // Partner investigation is in scope and moderated every time without exception
      // (ADR-0009). The answer is stored, and the mission is prioritised rather than refused.
      const { actor, draft } = await withDraft({
        subjectRelationship: 'PARTNER_OR_SPOUSE',
        protectiveOrderDeclared: false,
      });
      expect(draft.protectiveOrderDeclared).toBe(false);

      const submitted = await service.submit(
        actor,
        draft.id,
        { version: draft.version, lawfulPurposeConfirmed: true },
        req(),
      );
      expect(submitted.status).toBe('UNDER_REVIEW');

      const [screening] = await ownerDb
        .select()
        .from(missionScreenings)
        .where(eq(missionScreenings.missionId, draft.id));
      expect(screening).toMatchObject({ riskBand: 'RESTRICTED', outcome: 'PRIORITY_REVIEW' });
      expect(screening?.flags).toContain('partner_investigation');
    });

    it('flags a declared protective order', async () => {
      const { actor, draft } = await withDraft({ subjectRelationship: 'FAMILY_MEMBER' });
      const updated = await service.updateDraft(
        actor,
        draft.id,
        { version: draft.version, protectiveOrderDeclared: true },
        req(),
      );
      expect(updated.protectiveOrderDeclared).toBe(true);

      await service.submit(
        actor,
        draft.id,
        { version: updated.version, lawfulPurposeConfirmed: true },
        req(),
      );
      const [screening] = await ownerDb
        .select()
        .from(missionScreenings)
        .where(eq(missionScreenings.missionId, draft.id));
      expect(screening?.flags).toContain('protective_order_declared');
      expect(screening?.riskBand).toBe('RESTRICTED');
    });
  });

  describe('editing each field', () => {
    it('saves every field a draft can hold', async () => {
      const { actor } = await customer(ownerDb);
      const nodeId = await category(ownerDb);
      const draft = await service.createDraft(actor, {}, req());
      const updated = await service.updateDraft(
        actor,
        draft.id,
        {
          version: draft.version,
          ...completeDraft(nodeId),
          startBy: inDays(7),
          location: { lon: 44.52, lat: 40.19 },
          protectiveOrderDeclared: null,
        },
        req(),
      );
      expect(updated).toMatchObject({
        taxonomyNodeId: nodeId,
        countryCode: 'AM',
        currency: 'AMD',
        languages: ['en', 'hy'],
        startBy: inDays(7),
        location: { lon: 44.52, lat: 40.19 },
        subjectRelationship: 'BUSINESS_RELATIONSHIP',
        protectiveOrderDeclared: null,
      });
    });

    it('clears a location, a date and a language list when sent null', async () => {
      const { actor, draft } = await withDraft({
        startBy: inDays(3),
        location: { lon: 44.52, lat: 40.19 },
      });
      const cleared = await service.updateDraft(
        actor,
        draft.id,
        { version: draft.version, location: null, startBy: null, deadline: null, languages: null },
        req(),
      );
      expect(cleared).toMatchObject({
        location: null,
        startBy: null,
        deadline: null,
        languages: [],
      });
    });

    it('refuses an impossible start date as a field error, not a server error', async () => {
      const { actor, draft } = await withDraft();
      await expect(
        service.updateDraft(
          actor,
          draft.id,
          { version: draft.version, startBy: '2026-04-31' },
          req(),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ field: 'startBy' })],
      });
    });

    it('refuses a category that does not exist', async () => {
      const { actor, draft } = await withDraft();
      await expect(
        service.updateDraft(
          actor,
          draft.id,
          { version: draft.version, taxonomyNodeId: randomUUID() },
          req(),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses a draft created under a category that does not exist', async () => {
      const { actor } = await customer(ownerDb);
      await expect(
        service.createDraft(actor, { taxonomyNodeId: randomUUID() }, req()),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });
  });

  describe('cancelling', () => {
    it('cancels a draft', async () => {
      const { actor, draft } = await withDraft();
      const cancelled = await service.cancel(
        actor,
        draft.id,
        { version: draft.version, reason: 'Sorted it out' },
        req(),
      );
      expect(cancelled.status).toBe('CANCELLED');
    });

    it('cancels a mission that is waiting for review', async () => {
      const { actor, draft } = await withDraft();
      const submitted = await service.submit(
        actor,
        draft.id,
        { version: draft.version, lawfulPurposeConfirmed: true },
        req(),
      );
      const cancelled = await service.cancel(
        actor,
        draft.id,
        { version: submitted.version },
        req(),
      );
      expect(cancelled.status).toBe('CANCELLED');
      expect((await historyOf(draft.id)).at(-1)).toMatchObject({
        toStatus: 'CANCELLED',
        reason: null,
      });
    });

    it('refuses to cancel a mission that is already cancelled', async () => {
      const { actor, draft } = await withDraft();
      const cancelled = await service.cancel(actor, draft.id, { version: draft.version }, req());
      await expect(
        service.cancel(actor, draft.id, { version: cancelled.version }, req()),
      ).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('two people acting at once', () => {
    it('lets exactly one of two simultaneous submissions through', async () => {
      const { actor, draft } = await withDraft();
      const attempt = () =>
        service.submit(
          actor,
          draft.id,
          { version: draft.version, lawfulPurposeConfirmed: true },
          req(),
        );

      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      // And the losing one left nothing behind: one screening, one submission in the history.
      expect(
        await ownerDb.select().from(missionScreenings).where(eq(missionScreenings.missionId, draft.id)),
      ).toHaveLength(1);
      const history = await historyOf(draft.id);
      expect(history.filter((h) => h.toStatus === 'SUBMITTED')).toHaveLength(1);
    });

    it('lets exactly one of a simultaneous submit and cancel through', async () => {
      // A customer cancelling while their own submission is in flight is an ordinary event.
      const { actor, draft } = await withDraft();
      const results = await Promise.allSettled([
        service.submit(
          actor,
          draft.id,
          { version: draft.version, lawfulPurposeConfirmed: true },
          req(),
        ),
        service.cancel(actor, draft.id, { version: draft.version }, req()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const [row] = await ownerDb.select().from(missions).where(eq(missions.id, draft.id));
      expect(['UNDER_REVIEW', 'CANCELLED']).toContain(row?.status);
      // Whichever won, the row's version moved exactly as far as its transitions.
      expect(row?.version).toBe(
        row?.status === 'CANCELLED' ? draft.version + 1 : draft.version + 2,
      );
    });
  });

  describe('the workspace a customer may act in', () => {
    it('refuses a mission written while an agency workspace is active, and audits why', async () => {
      // Owner columns take the context's workspace (T-076), so this would file the customer's
      // mission into a company. Agencies are supplier-only in v1 (tenancy.md §3).
      const { actor } = await customer(ownerDb);
      const { tenantId, memberships } = await agency(ownerSql, [{ userId: actor.userId }]);
      const correlationId = randomUUID();
      const context = {
        tenantId,
        tenantKind: 'AGENCY' as const,
        userId: actor.userId,
        membershipId: memberships[0]!,
        permissions: [],
      };

      await expect(
        runInContext(context, () =>
          raw.createDraft(actor, { title: 'In the wrong place' }, { ...req(), correlationId }),
        ),
      ).rejects.toMatchObject({ status: 403 });

      const [denial] = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, correlationId));
      expect(denial).toMatchObject({ reason: 'workspace_kind_forbidden' });

      const [written] = await ownerDb
        .select()
        .from(missions)
        .where(eq(missions.customerTenantId, tenantId));
      expect(written).toBeUndefined();
    });

    it('allows the same mission in the caller’s Personal workspace', async () => {
      const { actor } = await customer(ownerDb);
      await expect(
        service.createDraft(actor, { title: 'In the right place' }, req()),
      ).resolves.toMatchObject({ status: 'DRAFT' });
    });
  });

  describe('authorization', () => {
    it('answers the seven cases for reading a mission', async () => {
      const { actor, draft } = await withDraft();
      const other = await customer(ownerDb);
      const investigator = testActor({ userId: randomUUID(), roles: ['INVESTIGATOR'] });
      const suspended = testActor({ ...actor, status: 'SUSPENDED' });

      await expectAuthorized((who) => service.getMine(who, draft.id, req()), {
        owner: actor,
        otherOfSameRole: other.actor,
        wrongRole: investigator,
        suspended,
      });
    });

    it('does not let another customer submit or cancel someone else’s mission', async () => {
      const { draft } = await withDraft();
      const intruder = await customer(ownerDb);
      // 404, not 403: a 403 confirms the id is real to somebody who should not know.
      await expect(
        service.submit(
          intruder.actor,
          draft.id,
          { version: draft.version, lawfulPurposeConfirmed: true },
          req(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.cancel(intruder.actor, draft.id, { version: draft.version }, req()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('lists only the caller’s own missions', async () => {
      const { actor, draft } = await withDraft();
      const other = await customer(ownerDb);
      await service.createDraft(other.actor, { title: 'Theirs' }, req());

      const mine = await service.listMine(actor, req());
      expect(mine.map((m) => m.id)).toEqual([draft.id]);
    });
  });
});
