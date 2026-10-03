import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import { category, completeDraft, customer, type TestDb } from '../../../test/mission-fixtures';
import { asRequests, inWorkspaceOf, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import {
  auditLogs,
  missionModerationDecisions,
  missions,
  missionScreenings,
  missionStatusHistory,
  outboxEvents,
} from '../../database/schema';
import { MemoryRateLimitStore, RateLimitService } from '../auth/rate-limit.service';
import { MissionTransitionService } from '../missions/mission-transition.service';
import { OwnMissionRepository } from '../missions/missions.repository';
import { MissionsService } from '../missions/missions.service';
import type { DecideModerationDto } from './mission-moderation.dto';
import { MissionModerationService } from './mission-moderation.service';
import { MissionPolicyService } from './mission-policy.service';
import type { RiskBandValue } from './mission-screening';

const REASON = 'Say which company this is about, and what you need to know about it.';
const NOTE = 'The description reads like a check on a former partner; asked for the company first.';

describe('the moderation queue (T-051)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: TestDb;
  let missionsService: MissionsService;
  let service: MissionModerationService;
  let moderator: Actor;
  const req = (correlationId = randomUUID()) => ({
    ip: '198.51.100.80',
    userAgent: 'vitest',
    correlationId,
  });

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
    const transitions = new MissionTransitionService(authz, audit);
    missionsService = asRequests(
      new MissionsService(
        db,
        authz,
        audit,
        new OwnMissionRepository(db),
        transitions,
        new MissionPolicyService(),
        new RateLimitService(new MemoryRateLimitStore()),
      ),
      owner,
    );
    service = asRequests(
      new MissionModerationService(db, authz, transitions, new PlatformContext(audit)),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  /**
   * A mission the customer submitted, so screened and under review — through the real submission,
   * so its screening and its queue entry are the ones production would have written.
   */
  const underReview = async (
    opts: { band?: RiskBandValue | null; over?: Record<string, unknown>; customerId?: string } = {},
  ) => {
    const c =
      opts.customerId === undefined
        ? await customer(ownerDb)
        : { actor: { ...moderator, roles: ['CUSTOMER', 'STAFF'] as const } as Actor };
    const nodeId = await category(ownerDb, {
      riskBand: opts.band === undefined ? 'STANDARD' : opts.band,
    });
    const draft = await missionsService.createDraft(
      c.actor,
      { ...completeDraft(nodeId), ...opts.over },
      req(),
    );
    const sent = await missionsService.submit(
      c.actor,
      draft.id,
      { version: draft.version, lawfulPurposeConfirmed: true },
      req(),
    );
    return { customer: c.actor, id: sent.id, version: sent.version, nodeId };
  };

  const decide = (
    id: string,
    dto: Partial<DecideModerationDto> & Pick<DecideModerationDto, 'version'>,
    as: Actor = moderator,
    r = req(),
  ) =>
    service.decide(
      as,
      id,
      { outcome: 'PUBLISHED', reason: REASON, ...dto } as DecideModerationDto,
      r,
    );

  const missionOf = async (id: string) =>
    (await ownerDb.select().from(missions).where(eq(missions.id, id)))[0]!;
  const decisionsOf = (id: string) =>
    ownerDb
      .select()
      .from(missionModerationDecisions)
      .where(eq(missionModerationDecisions.missionId, id));
  const auditFor = (correlationId: string) =>
    ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, correlationId));

  /** Every id in the queue, in order, read a page of `limit` at a time. */
  const wholeQueue = async (limit: number) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 500; pages++) {
      const page = await service.queue(
        moderator,
        cursor === undefined ? { limit } : { limit, cursor },
        req(),
      );
      ids.push(...page.items.map((i) => i.id));
      if (page.pageInfo.nextCursor === null) return ids;
      cursor = page.pageInfo.nextCursor;
    }
    throw new Error('the queue never ended');
  };

  describe('the queue', () => {
    it('lists missions under review, the most sensitive band first, then the longest waiting', async () => {
      const standardOld = await underReview({ band: 'STANDARD' });
      const elevated = await underReview({ band: 'ELEVATED' });
      const standardNew = await underReview({ band: 'STANDARD' });
      const restricted = await underReview({ band: 'RESTRICTED' });
      const unbanded = await underReview({ band: null }); // screens as HIGH, never as low
      const ours = [standardOld, elevated, standardNew, restricted, unbanded].map((m) => m.id);

      const queue = await service.queue(moderator, { limit: 100 }, req());
      const listed = queue.items.filter((i) => ours.includes(i.id));
      expect(listed.map((i) => i.id)).toEqual([
        restricted.id,
        unbanded.id,
        elevated.id,
        standardOld.id,
        standardNew.id,
      ]);
      const [first] = listed;
      expect(first).toMatchObject({
        title: completeDraft('').title,
        taxonomyNodeId: restricted.nodeId,
        riskBand: 'RESTRICTED',
        screeningOutcome: 'PRIORITY_REVIEW',
        deadline: completeDraft('').deadline,
      });
      expect(listed.find((i) => i.id === unbanded.id)).toMatchObject({
        riskBand: 'HIGH',
        flagCount: 1,
      });
      // How long the customer has waited: when it entered review, as the history recorded it.
      const [entry] = await ownerDb
        .select()
        .from(missionStatusHistory)
        .where(
          and(
            eq(missionStatusHistory.missionId, standardOld.id),
            eq(missionStatusHistory.toStatus, 'UNDER_REVIEW'),
          ),
        );
      expect(listed.find((i) => i.id === standardOld.id)!.queuedAt.getTime()).toBe(
        Math.trunc(entry!.occurredAt.getTime()),
      );
    });

    it('pages through the same order without losing or repeating a mission', async () => {
      const made = [
        await underReview({ band: 'HIGH' }),
        await underReview({ band: 'STANDARD' }),
        await underReview({ band: 'HIGH' }),
      ].map((m) => m.id);
      const byOne = await wholeQueue(1);
      const atOnce = await wholeQueue(100);
      expect(byOne).toEqual(atOnce);
      expect(new Set(byOne).size).toBe(byOne.length);
      expect(byOne.filter((id) => made.includes(id))).toEqual([made[0], made[2], made[1]]);
    });

    it('lists nothing that is not under review: a draft, a published, a cancelled mission', async () => {
      const published = await underReview();
      await decide(published.id, { version: published.version });
      const cancelled = await underReview();
      await missionsService.cancel(
        cancelled.customer,
        cancelled.id,
        { version: cancelled.version },
        req(),
      );
      const { actor } = await customer(ownerDb);
      const draft = await missionsService.createDraft(actor, { title: 'Not sent' }, req());

      const ids = await wholeQueue(100);
      for (const id of [published.id, cancelled.id, draft.id]) expect(ids).not.toContain(id);
    });

    it('refuses a cursor it did not make', async () => {
      for (const cursor of [
        'not-base64-json',
        Buffer.from('{"r":9,"q":"2026-01-01T00:00:00Z","i":"x"}').toString('base64url'),
        Buffer.from('{"r":1,"q":"yesterday","i":"x"}').toString('base64url'),
        Buffer.from('{"r":1,"q":"2026-01-01T00:00:00Z","i":""}').toString('base64url'),
        Buffer.from('[]').toString('base64url'),
        Buffer.from('null').toString('base64url'),
      ]) {
        await expect(service.queue(moderator, { cursor }, req())).rejects.toMatchObject({
          status: 422,
        });
      }
    });

    it('crosses into the customers’ workspaces through PlatformContext, audited as the queue', async () => {
      await underReview();
      const correlationId = randomUUID();
      await service.queue(moderator, {}, req(correlationId));
      expect(await auditFor(correlationId)).toContainEqual(
        expect.objectContaining({
          action: 'platform.access',
          actorId: moderator.userId,
          staffScope: 'MODERATION',
          resourceId: 'mission_moderation.queue',
        }),
      );
    });
  });

  describe('who may moderate', () => {
    const refusals: Array<[string, () => Promise<Actor>]> = [
      ['someone who is not staff', () => person(ownerDb, { roles: ['CUSTOMER'] })],
      [
        'staff without the MODERATION scope — every other scope is not enough',
        () =>
          person(ownerDb, {
            roles: ['STAFF'],
            staffScopes: ['VERIFICATION', 'DISPUTES', 'PAYMENTS', 'TAXONOMY', 'ENFORCEMENT'],
          }),
      ],
      [
        'a moderator acting as a customer',
        () =>
          person(ownerDb, {
            roles: ['STAFF', 'CUSTOMER'],
            staffScopes: ['MODERATION'],
            activeRole: 'CUSTOMER',
          }),
      ],
      [
        'a suspended moderator',
        () =>
          person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION'], status: 'SUSPENDED' }),
      ],
    ];

    it.each(refusals)('refuses %s the queue, the mission and the decision', async (_who, who) => {
      const actor = await who();
      const m = await underReview();
      await expect(service.queue(actor, {}, req())).rejects.toMatchObject({ status: 403 });
      await expect(service.getForReview(actor, m.id, req())).rejects.toMatchObject({
        status: 403,
      });
      await expect(decide(m.id, { version: m.version }, actor)).rejects.toMatchObject({
        status: 403,
      });
      expect((await missionOf(m.id)).status).toBe('UNDER_REVIEW');
      expect(await decisionsOf(m.id)).toEqual([]);
    });
  });

  describe('one mission', () => {
    it('shows the brief, its screening and the AI classification as input, and nothing about the customer', async () => {
      const m = await underReview({
        band: 'ELEVATED',
        over: { subjectRelationship: 'FORMER_PARTNER', protectiveOrderDeclared: false },
      });
      // A model's opinion, when one exists, is stored beside the screening (missions.md).
      const classification = { label: 'relationship_investigation', confidence: 0.82 };
      await owner`UPDATE mission_screenings SET ai_classification = ${JSON.stringify(classification)}::jsonb
                   WHERE mission_id = ${m.id}`;

      const view = await service.getForReview(moderator, m.id, req());
      expect(view).toMatchObject({
        id: m.id,
        status: 'UNDER_REVIEW',
        version: m.version,
        title: completeDraft('').title,
        purpose: completeDraft('').purpose,
        subjectRelationship: 'FORMER_PARTNER',
        protectiveOrderDeclared: false,
        taxonomyNodeId: m.nodeId,
        languages: ['en', 'hy'],
        party: false,
        decisions: [],
        screening: {
          outcome: 'PRIORITY_REVIEW',
          // A partner investigation is the most sensitive band whatever the category says.
          riskBand: 'RESTRICTED',
          flags: ['partner_investigation'],
          aiClassification: classification,
        },
      });
      expect(view.queuedAt).toBeInstanceOf(Date);
      // Who the customer is is not what is being decided.
      const body = JSON.stringify(view);
      expect(body).not.toContain(m.customer.userId);
      expect(body).not.toMatch(/@example\.test/);
    });

    it('says so when the moderator is the mission’s own customer', async () => {
      const own = await underReview({ customerId: moderator.userId });
      expect((await service.getForReview(moderator, own.id, req())).party).toBe(true);
    });

    it('does not find a draft nobody submitted, or a mission that does not exist', async () => {
      const { actor } = await customer(ownerDb);
      const draft = await missionsService.createDraft(actor, { title: 'Private' }, req());
      for (const id of [draft.id, randomUUID()]) {
        await expect(service.getForReview(moderator, id, req())).rejects.toMatchObject({
          status: 404,
        });
        await expect(decide(id, { version: 1 })).rejects.toMatchObject({ status: 404 });
      }
    });

    it('audits the crossing as a review, on its own', async () => {
      const m = await underReview();
      const correlationId = randomUUID();
      await service.getForReview(moderator, m.id, req(correlationId));
      expect(await auditFor(correlationId)).toContainEqual(
        expect.objectContaining({
          action: 'platform.access',
          staffScope: 'MODERATION',
          resourceId: 'mission_moderation.review',
        }),
      );
    });
  });

  describe('deciding', () => {
    it('publishes: investigators can see it, and the decision is on record with its latency', async () => {
      const m = await underReview({ band: 'ELEVATED' });
      const correlationId = randomUUID();
      const decided = await decide(
        m.id,
        { version: m.version, reason: 'Ordinary company check.' },
        moderator,
        req(correlationId),
      );
      expect(decided).toMatchObject({
        outcome: 'PUBLISHED',
        reason: 'Ordinary company check.',
        internalNote: null,
        decidedBy: moderator.userId,
        missionVersion: m.version,
      });

      const after = await missionOf(m.id);
      expect(after.status).toBe('QUOTED');
      expect(after.publishedAt).not.toBeNull();
      expect(after.version).toBe(m.version + 1);

      const [row] = await decisionsOf(m.id);
      const [screening] = await ownerDb
        .select()
        .from(missionScreenings)
        .where(eq(missionScreenings.missionId, m.id));
      expect(row).toMatchObject({
        outcome: 'PUBLISHED',
        screeningId: screening!.id,
        taxonomyNodeId: m.nodeId,
        riskBand: 'ELEVATED',
        customerTenantId: after.customerTenantId,
      });
      // Review latency, from the first day: queued → decided, never negative.
      expect(row!.decidedAt.getTime()).toBeGreaterThanOrEqual(row!.queuedAt.getTime());

      // The move itself, through the one path: history, audit and outbox with it.
      const moves = await ownerDb
        .select()
        .from(missionStatusHistory)
        .where(eq(missionStatusHistory.missionId, m.id))
        .orderBy(missionStatusHistory.seq);
      expect(moves.at(-1)).toMatchObject({
        fromStatus: 'UNDER_REVIEW',
        toStatus: 'QUOTED',
        actorKind: 'STAFF',
        actorId: moderator.userId,
        staffScope: 'MODERATION',
        reason: 'Ordinary company check.',
      });
      const audited = await auditFor(correlationId);
      expect(audited).toContainEqual(
        expect.objectContaining({
          action: 'platform.access',
          resourceId: 'mission_moderation.decide',
        }),
      );
      expect(audited).toContainEqual(
        expect.objectContaining({
          action: 'mission.status_changed',
          actorRole: 'STAFF:MODERATION',
          reason: 'UNDER_REVIEW->QUOTED',
        }),
      );
      const [event] = await ownerDb
        .select()
        .from(outboxEvents)
        .where(
          and(eq(outboxEvents.aggregateId, m.id), eq(outboxEvents.correlationId, correlationId)),
        );
      expect(event?.payload).toMatchObject({
        from: 'UNDER_REVIEW',
        to: 'QUOTED',
        actorKind: 'STAFF',
      });
    });

    it('rejects, and the customer reads the reason as written — never the internal note', async () => {
      const m = await underReview();
      await decide(m.id, {
        version: m.version,
        outcome: 'REJECTED',
        reason: `  ${REASON}  `,
        internalNote: `  ${NOTE}  `,
      });
      expect((await missionOf(m.id)).status).toBe('REJECTED');
      expect((await decisionsOf(m.id))[0]).toMatchObject({ reason: REASON, internalNote: NOTE });

      const theirs = await missionsService.getMine(m.customer, m.id, req());
      expect(theirs.review).toMatchObject({ outcome: 'REJECTED', reason: REASON });
      expect(JSON.stringify(theirs)).not.toContain(NOTE);
      // Nor can their workspace read the decision record that holds the note.
      const seen = await inWorkspaceOf(owner, m.customer.userId, () =>
        scopedDb(sql).select().from(missionModerationDecisions),
      );
      expect(seen).toEqual([]);
    });

    it('returns for changes: a draft again, its confirmation cleared, and back in the queue once resubmitted', async () => {
      const m = await underReview();
      await decide(m.id, { version: m.version, outcome: 'CHANGES_REQUESTED', internalNote: NOTE });
      const returned = await missionOf(m.id);
      expect(returned.status).toBe('DRAFT');
      expect(returned.lawfulPurposeConfirmedAt).toBeNull();
      expect((await missionsService.getMine(m.customer, m.id, req())).review).toMatchObject({
        outcome: 'CHANGES_REQUESTED',
        reason: REASON,
      });

      const again = await missionsService.submit(
        m.customer,
        m.id,
        { version: returned.version, lawfulPurposeConfirmed: true },
        req(),
      );
      expect(await wholeQueue(100)).toContain(m.id);
      await decide(m.id, { version: again.version, reason: 'Now names the company.' });

      const view = await service.getForReview(moderator, m.id, req());
      expect(view.status).toBe('QUOTED');
      expect(view.decisions.map((d) => [d.outcome, d.missionVersion])).toEqual([
        ['CHANGES_REQUESTED', m.version],
        ['PUBLISHED', again.version],
      ]);
      expect(view.decisions[0]!.internalNote).toBe(NOTE);
      // Each submission was screened, and each decision names the screening its moderator saw.
      const rows = await decisionsOf(m.id);
      expect(new Set(rows.map((r) => r.screeningId)).size).toBe(2);
    });

    it('refuses the mission’s own customer, even holding the scope, and records the refusal', async () => {
      const own = await underReview({ customerId: moderator.userId });
      const correlationId = randomUUID();
      await expect(
        decide(own.id, { version: own.version }, moderator, req(correlationId)),
      ).rejects.toMatchObject({ status: 403 });
      expect((await missionOf(own.id)).status).toBe('UNDER_REVIEW');
      expect(await decisionsOf(own.id)).toEqual([]);
      expect(await auditFor(correlationId)).toContainEqual(
        expect.objectContaining({
          action: 'authz.denied.mission_moderation.decide',
          reason: 'state_forbids_action',
        }),
      );
    });

    it('refuses a decision on a mission that moved since it was read', async () => {
      const stale = await underReview();
      await expect(decide(stale.id, { version: stale.version - 1 })).rejects.toMatchObject({
        status: 409,
      });

      const cancelled = await underReview();
      await missionsService.cancel(
        cancelled.customer,
        cancelled.id,
        { version: cancelled.version },
        req(),
      );
      await expect(decide(cancelled.id, { version: cancelled.version })).rejects.toMatchObject({
        status: 409,
      });

      const decided = await underReview();
      await decide(decided.id, { version: decided.version, outcome: 'REJECTED' });
      await expect(decide(decided.id, { version: decided.version })).rejects.toMatchObject({
        status: 409,
      });
      expect((await missionOf(decided.id)).status).toBe('REJECTED');
      expect(await decisionsOf(decided.id)).toHaveLength(1);
    });

    it('lets one of two moderators deciding at once win, and records only that decision', async () => {
      const second = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION'] });
      const m = await underReview();
      const results = await Promise.allSettled([
        decide(m.id, { version: m.version, outcome: 'PUBLISHED' }),
        decide(m.id, { version: m.version, outcome: 'REJECTED' }, second),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: expect.objectContaining({ status: 409 }),
      });
      expect(await decisionsOf(m.id)).toHaveLength(1);
    });

    it('refuses to decide a mission that reached review without being screened, and records nothing', async () => {
      // Only possible by writing past the application, as the owner does here: submission screens
      // and queues in one transaction. Deciding it anyway would record a decision with no screening
      // behind it, so the broken invariant surfaces instead.
      const { userId } = await customer(ownerDb);
      const nodeId = await category(ownerDb);
      const [m] = await ownerDb
        .insert(missions)
        .values({
          customerId: userId,
          ...completeDraft(nodeId),
          status: 'UNDER_REVIEW',
          lawfulPurposeConfirmedAt: new Date(),
          submittedAt: new Date(),
        })
        .returning();
      // Opened, it says so: no screening and no queue entry, rather than a made-up one.
      expect(await service.getForReview(moderator, m!.id, req())).toMatchObject({
        screening: null,
        queuedAt: null,
      });
      await expect(decide(m!.id, { version: m!.version })).rejects.toThrow(
        /under review with no screening or queue entry/,
      );
      expect((await missionOf(m!.id)).status).toBe('UNDER_REVIEW');
      expect(await decisionsOf(m!.id)).toEqual([]);
    });

    it('keeps every decision as written: the application can neither change nor delete one', async () => {
      const m = await underReview();
      await decide(m.id, { version: m.version, outcome: 'REJECTED' });
      const [row] = await decisionsOf(m.id);
      const platform = new PlatformContext(new AuditService(scopedDb(sql)));
      for (const attempt of [
        (tx: postgres.TransactionSql) =>
          tx`UPDATE mission_moderation_decisions SET reason = 'rewritten' WHERE id = ${row!.id}`,
        (tx: postgres.TransactionSql) =>
          tx`DELETE FROM mission_moderation_decisions WHERE id = ${row!.id}`,
      ]) {
        await expect(
          inWorkspaceOf(owner, moderator.userId, () =>
            platform.asStaff(
              moderator,
              { scope: 'MODERATION', purpose: 'mission_moderation.decide' },
              req(),
              () => sql.begin(attempt),
            ),
          ),
        ).rejects.toThrow(/permission denied/);
      }
      expect((await decisionsOf(m.id))[0]).toEqual(row);
    });
  });
});
