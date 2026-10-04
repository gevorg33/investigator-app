import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignment } from '../../../test/assignment-fixtures';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import type { TestDb } from '../../../test/mission-fixtures';
import {
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
} from '../../../test/quote-fixtures';
import { document } from '../../../test/verification-fixtures';
import { asRequests, personalContext, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import { auditLogs, legalHolds } from '../../database/schema';
import type { PlaceLegalHoldDto } from './legal-hold.dto';
import type { LegalHoldResource } from './legal-hold.policy';
import { LegalHoldService } from './legal-hold.service';

const REASON = 'Preservation request PR-2026-114 from the investigating authority.';
const RELEASE = 'Counsel confirmed the preservation period has ended.';

describe('legal holds (T-035)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: TestDb;
  let service: LegalHoldService;
  let compliance: Actor;
  const req = (correlationId = randomUUID()) => ({
    ip: '198.51.100.35',
    userAgent: 'vitest',
    correlationId,
  });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    compliance = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['COMPLIANCE'] });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(
      new LegalHoldService(db, new AuthzService(audit), new PlatformContext(audit), audit),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const subject = async () => (await person(ownerDb, { roles: ['CUSTOMER'] })).userId;
  const place = (
    over: Partial<PlaceLegalHoldDto> & { resourceId: string },
    as = compliance,
    r = req(),
  ) => service.place(as, { resourceType: 'USER', reason: REASON, ...over } as PlaceLegalHoldDto, r);
  const holdRow = async (id: string) =>
    (await ownerDb.select().from(legalHolds).where(eq(legalHolds.id, id)))[0]!;
  const auditFor = (correlationId: string) =>
    ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, correlationId));

  describe('placing a hold', () => {
    it('places it in force, records who and why, and audits the crossing and the hold by reference', async () => {
      const userId = await subject();
      const r = req();
      const hold = await place({ resourceId: userId, reason: `  ${REASON}  ` }, compliance, r);

      expect(hold).toEqual({
        id: expect.any(String),
        resourceType: 'USER',
        resourceId: userId,
        reason: REASON,
        placedBy: compliance.userId,
        placedAt: expect.any(Date),
        release: null,
      });
      expect(await holdRow(hold.id)).toMatchObject({ releasedAt: null, reason: REASON });

      const trail = (await auditFor(r.correlationId)).map((a) => [
        a.action,
        a.staffScope,
        a.resourceType,
        a.resourceId,
        a.reason,
      ]);
      expect(trail).toEqual(
        expect.arrayContaining([
          ['platform.access', 'COMPLIANCE', 'workspace', 'legal_hold.place', null],
          // The reference, never the reason: a reason can name a case or a person.
          ['legal_hold.placed', 'COMPLIANCE', 'legal_hold', hold.id, `USER ${userId}`],
        ]),
      );
      expect(trail).toHaveLength(2);
    });

    it.each<[LegalHoldResource, () => Promise<string>]>([
      ['USER', () => subject()],
      ['TENANT', async () => (await personalContext(owner, await subject())).tenantId],
      ['MISSION', async () => (await quotableMission(ownerDb)).missionId],
      [
        'ASSIGNMENT',
        async () => {
          const mission = await quotableMission(ownerDb);
          const investigator = await eligibleInvestigator(ownerDb);
          const quote = await submittedQuote(ownerDb, {
            missionId: mission.missionId,
            investigatorProfileId: investigator.profileId,
          });
          return (await assignment(ownerDb, { quoteId: quote.id, customerId: mission.customerId }))
            .id;
        },
      ],
      ['MEDIA_ASSET', async () => document(ownerDb, await subject())],
    ])('finds a %s in any workspace, and refuses an id that names none', async (type, make) => {
      const id = await make();
      await expect(place({ resourceType: type, resourceId: id })).resolves.toMatchObject({
        resourceType: type,
        resourceId: id,
      });
      const missing = randomUUID();
      await expect(place({ resourceType: type, resourceId: missing })).rejects.toMatchObject({
        status: 404,
      });
      expect(
        await ownerDb.select().from(legalHolds).where(eq(legalHolds.resourceId, missing)),
      ).toEqual([]);
    });

    it('lets several holds stand on one resource, each on its own', async () => {
      const userId = await subject();
      const first = await place({ resourceId: userId });
      const second = await place({
        resourceId: userId,
        reason: 'Litigation hold, case 2026/4471.',
      });
      await service.release(compliance, first.id, { reason: RELEASE }, req());

      const page = await service.list(
        compliance,
        { resourceType: 'USER', resourceId: userId, status: 'ACTIVE' },
        req(),
      );
      expect(page.items.map((h) => h.id)).toEqual([second.id]);
    });
  });

  describe('releasing a hold', () => {
    it('releases it once, with its own reason, and audits it', async () => {
      const hold = await place({ resourceId: await subject() });
      const r = req();
      const released = await service.release(compliance, hold.id, { reason: ` ${RELEASE} ` }, r);

      expect(released.release).toEqual({
        at: expect.any(Date),
        by: compliance.userId,
        reason: RELEASE,
      });
      expect(released.release!.at.getTime()).toBeGreaterThanOrEqual(hold.placedAt.getTime());
      expect((await auditFor(r.correlationId)).map((a) => a.action).sort()).toEqual([
        'legal_hold.released',
        'platform.access',
      ]);
    });

    it('refuses to release a hold twice, and leaves the first release as it was', async () => {
      const hold = await place({ resourceId: await subject() });
      await service.release(compliance, hold.id, { reason: RELEASE }, req());
      const before = await holdRow(hold.id);

      await expect(
        service.release(compliance, hold.id, { reason: 'Released again by mistake.' }, req()),
      ).rejects.toMatchObject({ status: 409 });
      expect(await holdRow(hold.id)).toEqual(before);
    });

    it('does not find a hold that does not exist', async () => {
      await expect(
        service.release(compliance, randomUUID(), { reason: RELEASE }, req()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('listing holds', () => {
    it('lists in force by default, released or all when asked, newest first, a page at a time', async () => {
      const userId = await subject();
      const a = await place({ resourceId: userId });
      const b = await place({ resourceId: userId });
      const c = await place({ resourceId: userId });
      await service.release(compliance, b.id, { reason: RELEASE }, req());
      const on = { resourceType: 'USER' as const, resourceId: userId };

      const active = await service.list(compliance, on, req());
      expect(active.items.map((h) => h.id)).toEqual([c.id, a.id]);
      const released = await service.list(compliance, { ...on, status: 'RELEASED' }, req());
      expect(released.items.map((h) => h.id)).toEqual([b.id]);

      const first = await service.list(compliance, { ...on, status: 'ALL', limit: 2 }, req());
      expect(first.items.map((h) => h.id)).toEqual([c.id, b.id]);
      expect(first.pageInfo.hasNextPage).toBe(true);
      const rest = await service.list(
        compliance,
        { ...on, status: 'ALL', limit: 2, cursor: first.pageInfo.nextCursor! },
        req(),
      );
      expect(rest.items.map((h) => h.id)).toEqual([a.id]);
      expect(rest.pageInfo).toEqual({ nextCursor: null, hasNextPage: false });
    });

    it('lists across every resource when none is named', async () => {
      const hold = await place({ resourceId: await subject() });
      const page = await service.list(compliance, { limit: 100 }, req());
      expect(page.items.every((h) => h.release === null)).toBe(true);
      expect(page.items.map((h) => h.id)).toContain(hold.id);
    });

    it('refuses a resource type without its id, or an id without its type', async () => {
      await expect(service.list(compliance, { resourceType: 'USER' }, req())).rejects.toMatchObject(
        { code: 'VALIDATION_FAILED' },
      );
      await expect(
        service.list(compliance, { resourceId: randomUUID() }, req()),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses a cursor it did not make', async () => {
      await expect(
        service.list(compliance, { cursor: 'not-a-cursor' }, req()),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('who may', () => {
    const refused: Array<[string, () => Promise<Actor>]> = [
      ['a customer', () => person(ownerDb, { roles: ['CUSTOMER'] })],
      ['an investigator', () => person(ownerDb, { roles: ['INVESTIGATOR'] })],
      [
        'staff holding every other scope',
        () =>
          person(ownerDb, {
            roles: ['STAFF'],
            staffScopes: [
              'VERIFICATION',
              'MODERATION',
              'DISPUTES',
              'PAYMENTS',
              'TAXONOMY',
              'ENFORCEMENT',
            ],
          }),
      ],
      [
        'COMPLIANCE staff acting as a customer',
        () =>
          person(ownerDb, {
            roles: ['STAFF', 'CUSTOMER'],
            staffScopes: ['COMPLIANCE'],
            activeRole: 'CUSTOMER',
          }),
      ],
      [
        'suspended COMPLIANCE staff',
        () =>
          person(ownerDb, { roles: ['STAFF'], staffScopes: ['COMPLIANCE'], status: 'SUSPENDED' }),
      ],
    ];

    it.each(refused)('refuses %s everything, writing nothing', async (_, make) => {
      const actor = await make();
      const userId = await subject();
      const hold = await place({ resourceId: userId });

      await expect(place({ resourceId: userId }, actor)).rejects.toMatchObject({ status: 403 });
      await expect(
        service.release(actor, hold.id, { reason: RELEASE }, req()),
      ).rejects.toMatchObject({ status: 403 });
      await expect(service.list(actor, {}, req())).rejects.toMatchObject({ status: 403 });

      expect(
        await ownerDb.select().from(legalHolds).where(eq(legalHolds.resourceId, userId)),
      ).toHaveLength(1);
      expect((await holdRow(hold.id)).releasedAt).toBeNull();
    });

    it('audits a refusal', async () => {
      const r = req();
      await expect(
        place({ resourceId: await subject() }, await person(ownerDb, { roles: ['CUSTOMER'] }), r),
      ).rejects.toMatchObject({ status: 403 });
      expect((await auditFor(r.correlationId)).map((a) => a.action)).toEqual([
        'authz.denied.legal_hold.place',
      ]);
    });
  });

  describe('in the database, whoever the writer is', () => {
    const placeDirect = async (userId: string) =>
      (
        await owner<{ id: string }[]>`
          INSERT INTO legal_holds (resource_type, resource_id, reason, placed_by)
          VALUES ('USER', ${userId}, ${REASON}, ${randomUUID()}) RETURNING id`
      )[0]!.id;

    it('never deletes a hold, released or not', async () => {
      const id = await placeDirect(await subject());
      await expect(owner`DELETE FROM legal_holds WHERE id = ${id}`).rejects.toThrow(
        /legal_hold_never_deleted/,
      );
      await owner`
        UPDATE legal_holds SET released_at = now(), released_by = ${randomUUID()},
               release_reason = ${RELEASE} WHERE id = ${id}`;
      await expect(owner`DELETE FROM legal_holds WHERE id = ${id}`).rejects.toThrow(
        /legal_hold_never_deleted/,
      );
    });

    it('never rewrites what was held, why, by whom or since when', async () => {
      const id = await placeDirect(await subject());
      for (const change of [
        owner`UPDATE legal_holds SET reason = 'Something else entirely.' WHERE id = ${id}`,
        owner`UPDATE legal_holds SET resource_id = ${randomUUID()} WHERE id = ${id}`,
        owner`UPDATE legal_holds SET placed_at = now() - interval '1 year' WHERE id = ${id}`,
      ]) {
        await expect(change).rejects.toThrow(/legal_hold_released_once/);
      }
    });

    it('releases once, completely, and never un-releases', async () => {
      const id = await placeDirect(await subject());
      await expect(
        owner`UPDATE legal_holds SET released_at = now() WHERE id = ${id}`,
      ).rejects.toThrow(/legal_holds_release_complete/);
      await owner`
        UPDATE legal_holds SET released_at = now(), released_by = ${randomUUID()},
               release_reason = ${RELEASE} WHERE id = ${id}`;
      await expect(
        owner`UPDATE legal_holds SET release_reason = 'A better reason, later.' WHERE id = ${id}`,
      ).rejects.toThrow(/legal_hold_released_once/);
      await expect(
        owner`UPDATE legal_holds SET released_at = NULL, released_by = NULL, release_reason = NULL WHERE id = ${id}`,
      ).rejects.toThrow(/legal_hold_released_once/);
    });

    it('places a hold in force, never already released', async () => {
      await expect(owner`
        INSERT INTO legal_holds (resource_type, resource_id, reason, placed_by, released_at, released_by, release_reason)
        VALUES ('USER', ${randomUUID()}, ${REASON}, ${randomUUID()}, now(), ${randomUUID()}, ${RELEASE})`).rejects.toThrow(
        /legal_hold_placed_in_force/,
      );
    });

    it('outlives the account it holds and the account that placed it', async () => {
      const held = await subject();
      const placer = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['COMPLIANCE'] });
      const hold = await place({ resourceId: held }, placer);

      await owner`DELETE FROM users WHERE id = ANY(${[held, placer.userId]}::uuid[])`;
      expect(await holdRow(hold.id)).toMatchObject({
        resourceId: held,
        placedBy: placer.userId,
        releasedAt: null,
      });
    });

    it('shows no hold to the application outside platform access', async () => {
      await placeDirect(await subject());
      expect(await sql`SELECT id FROM legal_holds`).toHaveLength(0);
      await expect(sql`
        INSERT INTO legal_holds (resource_type, resource_id, reason, placed_by)
        VALUES ('USER', ${randomUUID()}, ${REASON}, ${randomUUID()})`).rejects.toThrow(
        /row-level security/,
      );
    });
  });
});
