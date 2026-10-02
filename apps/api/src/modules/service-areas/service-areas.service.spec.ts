import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import * as schema from '../../database/schema';
import { auditLogs, serviceAreas } from '../../database/schema';
import { testActor } from '../../../test/actor';
import { investigator, somewhere, square, type TestDb } from '../../../test/service-area-fixtures';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { MAX_AREAS_PER_PROFILE } from './service-areas.policy';
import { ServiceAreasService } from './service-areas.service';
import { testPool } from '../../../test/db';
import { agency, member } from '../../../test/workspace-fixtures';
import {
  agencyContext,
  asRequests,
  inWorkspaceOf,
  scopedDb,
} from '../../../test/workspace-context';
import { runInContext } from '../../common/context/execution-context';

describe('service areas', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  // Fixtures run as the owner: they write what the application may not (T-073).
  let ownerSql: postgres.Sql;
  let ownerDb: TestDb;
  let areas: ServiceAreasService;
  /** The same service without the harness that enters the caller's Personal workspace. */
  let raw: ServiceAreasService;
  /** Someone in another workspace, doing the searching. */
  let searcher: { userId: string };
  const req = () => ({ ip: '198.51.100.50', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(async () => {
    sql = testPool();
    db = scopedDb(sql);
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    searcher = (await member(ownerSql)).actor;
  });

  beforeEach(() => {
    raw = new ServiceAreasService(
      db,
      new AuthzService(new AuditService(db)),
      new AuditService(db),
      new OwnInvestigatorProfileRepository(db),
    );
    areas = asRequests(raw, ownerSql);
  });

  /**
   * An agency with an owner, a viewer and an agent, and a published, verified profile it holds for
   * the agent (T-087). `in(who)` runs a call in that person's context in the agency.
   */
  const agencyWithProfile = async () => {
    const owner = await member(ownerSql);
    const viewer = await member(ownerSql);
    const agent = await member(ownerSql, { roles: ['INVESTIGATOR'] });
    const { tenantId } = await agency(ownerSql, [
      { userId: owner.actor.userId },
      { userId: viewer.actor.userId, role: 'VIEWER' },
      { userId: agent.actor.userId, role: 'INVESTIGATOR' },
    ]);
    const [profile] = await ownerDb
      .insert(schema.investigatorProfiles)
      .values({
        userId: agent.actor.userId,
        tenantId,
        visibility: 'PUBLISHED',
        acceptingWork: true,
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
      })
      .returning();
    const inAgency = async <T>(who: { actor: { userId: string } }, fn: () => Promise<T>) =>
      runInContext(await agencyContext(ownerSql, who.actor.userId, tenantId), fn);
    return { tenantId, owner, viewer, agent, profileId: profile!.id, in: inAgency };
  };

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  const radius = (at: { lon: number; lat: number }, radiusKm = 10, label = 'work') => ({
    kind: 'RADIUS' as const,
    label,
    centre: at,
    radiusKm,
  });

  // Coverage is read by whoever is searching: another workspace entirely, seeing published
  // profiles and their areas through the public projection (T-077).
  const coverage = async (...args: Parameters<ServiceAreasService['findCoverage']>) =>
    inWorkspaceOf(ownerSql, searcher.userId, () => areas.findCoverage(...args));

  describe('managing your own areas', () => {
    it('coarsens a radius centre to about a kilometre before storing it', async () => {
      const { actor } = await investigator(ownerDb);
      const created = await areas.createMine(
        actor,
        radius({ lon: 44.51523, lat: 40.18724 }),
        req(),
      );
      expect(created).toMatchObject({
        kind: 'RADIUS',
        centre: { lon: 44.52, lat: 40.19 },
        radiusKm: 10,
        boundary: null,
      });
      const [row] = await ownerDb
        .select()
        .from(serviceAreas)
        .where(eq(serviceAreas.id, created.id));
      expect(row?.radiusM).toBe(10_000);
      // Only the coarsened point exists anywhere.
      expect(row?.centre).toEqual({ lon: 44.52, lat: 40.19 });
    });

    it.each([
      ['at (0.5, 0)', { lon: 0.5, lat: 0 }],
      ['at (90.5, 0)', { lon: 90.5, lat: 0 }],
      ['at (-179.5, -5)', { lon: -179.5, lat: -5 }],
    ])('accepts a minimum 5 km radius %s', async (_label, at) => {
      // Regression, at measured coordinates rather than random ones. PostGIS buffers geography
      // through a local projection chosen by longitude band, so a 5 km buffer's area varies by
      // place: on four of every sixteen grid longitudes between 35°S and 35°N it comes out as
      // small as 77,948,988 m². The constraint was first 78,000,000 and refused these genuine
      // minimum areas. A random longitude usually missed the affected bands, which is why an
      // earlier version of this test passed against the broken constraint.
      const { actor } = await investigator(ownerDb);
      await expect(areas.createMine(actor, radius(at, 5), req())).resolves.toMatchObject({
        radiusKm: 5,
      });
    });

    it('closes a drawn boundary and returns it as drawn', async () => {
      const { actor } = await investigator(ownerDb);
      const boundary = square(somewhere(), 0.5);
      const created = await areas.createMine(
        actor,
        { kind: 'POLYGON', label: 'district', boundary },
        req(),
      );
      expect(created).toMatchObject({ kind: 'POLYGON', centre: null, radiusKm: null, boundary });
    });

    it('does not close a boundary twice when the client already closed it', async () => {
      const { actor } = await investigator(ownerDb);
      const open = square(somewhere(), 0.5);
      const closed = [...open, open[0]!];
      const created = await areas.createMine(
        actor,
        { kind: 'POLYGON', label: 'closed', boundary: closed },
        req(),
      );
      expect(created.boundary).toEqual(open);
    });

    it('audits the change', async () => {
      const { actor } = await investigator(ownerDb);
      const r = req();
      const created = await areas.createMine(actor, radius(somewhere()), r);
      const rows = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, r.correlationId));
      expect(rows).toContainEqual(
        expect.objectContaining({
          action: 'service_area.created',
          resourceId: created.id,
          reason: 'RADIUS',
        }),
      );
    });

    it.each([
      [
        'a drawn area too small to be anywhere but one building',
        () => square(somewhere(), 0.01),
        'TOO_SMALL',
      ],
      [
        'a self-intersecting boundary',
        () => {
          const a = somewhere();
          return [
            { lon: a.lon, lat: a.lat },
            { lon: a.lon + 1, lat: a.lat + 1 },
            { lon: a.lon + 1, lat: a.lat },
            { lon: a.lon, lat: a.lat + 1 },
          ];
        },
        'INVALID_SHAPE',
      ],
      [
        'more points than the limit',
        () => {
          const a = somewhere();
          return Array.from({ length: 201 }, (_, i) => ({
            lon: a.lon + Math.cos((2 * Math.PI * i) / 201),
            lat: a.lat + Math.sin((2 * Math.PI * i) / 201),
          }));
        },
        'TOO_COMPLEX',
      ],
    ] as const)('refuses %s, with the reason', async (_label, makeBoundary, code) => {
      const { actor } = await investigator(ownerDb);
      await expect(
        areas.createMine(actor, { kind: 'POLYGON', label: 'bad', boundary: makeBoundary() }, req()),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ code })],
      });
    });

    it('surfaces a database refusal it does not have a reason for, rather than mislabelling it', async () => {
      const { actor } = await investigator(ownerDb);
      await expect(
        areas.createMine(actor, radius(somewhere(), 10, 'x'.repeat(81)), req()),
      ).rejects.not.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it(`allows at most ${MAX_AREAS_PER_PROFILE} areas`, async () => {
      const { actor } = await investigator(ownerDb);
      for (let i = 0; i < MAX_AREAS_PER_PROFILE; i++)
        await areas.createMine(actor, radius(somewhere()), req());
      await expect(areas.createMine(actor, radius(somewhere()), req())).rejects.toMatchObject({
        details: [expect.objectContaining({ code: 'LIMIT_REACHED' })],
      });
    });

    it('lists only your own areas, oldest first', async () => {
      const { actor } = await investigator(ownerDb);
      const other = await investigator(ownerDb);
      const first = await areas.createMine(actor, radius(somewhere(), 10, 'first'), req());
      const second = await areas.createMine(actor, radius(somewhere(), 10, 'second'), req());
      await areas.createMine(other.actor, radius(somewhere(), 10, 'theirs'), req());
      expect((await areas.listMine(actor, req())).map((a) => a.id)).toEqual([first.id, second.id]);
    });

    it('removes your own area', async () => {
      const { actor } = await investigator(ownerDb);
      const created = await areas.createMine(actor, radius(somewhere()), req());
      await areas.deleteMine(actor, created.id, req());
      expect(await areas.listMine(actor, req())).toEqual([]);
    });

    it('will not remove another investigator’s area, and answers as if it did not exist', async () => {
      const owner = await investigator(ownerDb);
      const created = await areas.createMine(owner.actor, radius(somewhere()), req());
      const stranger = await investigator(ownerDb);
      await expect(areas.deleteMine(stranger.actor, created.id, req())).rejects.toMatchObject({
        status: 404,
      });
      await expect(areas.deleteMine(stranger.actor, randomUUID(), req())).rejects.toMatchObject({
        status: 404,
      });
      expect(await areas.listMine(owner.actor, req())).toHaveLength(1);
    });

    it('refuses a customer, a suspended investigator, and one with no profile', async () => {
      const { actor } = await investigator(ownerDb);
      await expect(areas.listMine({ ...actor, roles: ['CUSTOMER'] }, req())).rejects.toMatchObject({
        status: 403,
      });
      await expect(areas.listMine({ ...actor, status: 'SUSPENDED' }, req())).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        areas.listMine(testActor({ userId: randomUUID(), roles: ['INVESTIGATOR'] }), req()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('an agency’s areas for a profile it holds (T-087)', () => {
    it('are managed by whoever holds investigators.update there, and audited as the agency’s', async () => {
      const a = await agencyWithProfile();
      const at = somewhere();
      const created = await a.in(a.owner, () =>
        raw.createForAgency(a.owner.actor as never, a.profileId, radius(at, 10), req()),
      );
      expect(created).toMatchObject({ kind: 'RADIUS', radiusKm: 10, centre: at });
      // The same areas the holder sees as their own, in the agency.
      expect(await a.in(a.agent, () => raw.listMine(a.agent.actor as never, req()))).toEqual([
        created,
      ]);
      // And what discovery reads.
      expect(await coverage(at)).toContainEqual({ profileId: a.profileId, distanceKm: 0 });

      await a.in(a.owner, () =>
        raw.deleteForAgency(a.owner.actor as never, a.profileId, created.id, req()),
      );
      expect(
        await a.in(a.owner, () => raw.listForAgency(a.owner.actor as never, a.profileId, req())),
      ).toEqual([]);
      const reasons = await ownerDb
        .select({ action: auditLogs.action, reason: auditLogs.reason })
        .from(auditLogs)
        .where(eq(auditLogs.resourceId, created.id));
      expect(reasons).toEqual(
        expect.arrayContaining([
          { action: 'service_area.created', reason: 'RADIUS' },
          { action: 'service_area.deleted', reason: 'agency' },
        ]),
      );
    });

    it('are read, not changed, by a member holding only investigators.read', async () => {
      const a = await agencyWithProfile();
      expect(
        await a.in(a.viewer, () => raw.listForAgency(a.viewer.actor as never, a.profileId, req())),
      ).toEqual([]);
      await expect(
        a.in(a.viewer, () =>
          raw.createForAgency(a.viewer.actor as never, a.profileId, radius(somewhere()), req()),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('reach no profile outside the agency, nor anything outside an agency', async () => {
      const a = await agencyWithProfile();
      const other = await agencyWithProfile();
      const independent = await investigator(ownerDb);
      for (const profileId of [other.profileId, independent.profileId]) {
        await expect(
          a.in(a.owner, () => raw.listForAgency(a.owner.actor as never, profileId, req())),
        ).rejects.toMatchObject({ status: 404 });
      }
      // Another profile's area id is the same 404 as one that never existed.
      const theirs = await other.in(other.owner, () =>
        raw.createForAgency(
          other.owner.actor as never,
          other.profileId,
          radius(somewhere()),
          req(),
        ),
      );
      await expect(
        a.in(a.owner, () =>
          raw.deleteForAgency(a.owner.actor as never, a.profileId, theirs.id, req()),
        ),
      ).rejects.toMatchObject({ status: 404 });
      // In a Personal workspace there is no agency to hold anything.
      await expect(
        areas.listForAgency(a.owner.actor as never, a.profileId, req()),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('coverage', () => {
    it('finds an investigator whose area contains the point, at distance 0', async () => {
      const at = somewhere();
      const { actor, profileId } = await investigator(ownerDb);
      await areas.createMine(actor, radius(at, 10), req());
      expect(await coverage(at)).toContainEqual({ profileId, distanceKm: 0 });
    });

    it('excludes an area the point falls outside, unless the search reaches it', async () => {
      const at = somewhere();
      const { actor, profileId } = await investigator(ownerDb);
      await areas.createMine(actor, radius(at, 5), req());
      // About 20 km north of the centre: outside a 5 km area by roughly 15 km.
      const away = { lon: at.lon, lat: at.lat + 0.18 };
      expect((await coverage(away)).map((c) => c.profileId)).not.toContain(profileId);
      const reached = (await coverage(away, { searchRadiusM: 30_000 })).find(
        (c) => c.profileId === profileId,
      );
      expect(reached?.distanceKm).toBeGreaterThanOrEqual(15);
      expect(reached?.distanceKm).toBeLessThanOrEqual(16);
    });

    it('lists an investigator once, however many of their areas match, at the nearest', async () => {
      const at = somewhere();
      const { actor, profileId } = await investigator(ownerDb);
      await areas.createMine(actor, radius(at, 10, 'a'), req());
      await areas.createMine(actor, radius(at, 20, 'b'), req());
      await areas.createMine(
        actor,
        {
          kind: 'POLYGON',
          label: 'c',
          boundary: square({ lon: at.lon - 0.3, lat: at.lat - 0.3 }, 0.6),
        },
        req(),
      );
      const mine = (await coverage(at)).filter((c) => c.profileId === profileId);
      expect(mine).toEqual([{ profileId, distanceKm: 0 }]);
    });

    it('orders nearest first', async () => {
      const at = somewhere();
      const inside = await investigator(ownerDb);
      const nearby = await investigator(ownerDb);
      await areas.createMine(inside.actor, radius(at, 10), req());
      await areas.createMine(nearby.actor, radius({ lon: at.lon, lat: at.lat + 0.18 }, 5), req());
      const ids = (await coverage(at, { searchRadiusM: 30_000 }))
        .map((c) => c.profileId)
        .filter((id) => id === inside.profileId || id === nearby.profileId);
      expect(ids).toEqual([inside.profileId, nearby.profileId]);
    });

    it('never includes a draft profile or one not accepting work', async () => {
      const at = somewhere();
      const draft = await investigator(ownerDb, { visibility: 'DRAFT' });
      const busy = await investigator(ownerDb, { acceptingWork: false });
      await areas.createMine(draft.actor, radius(at, 10), req());
      await areas.createMine(busy.actor, radius(at, 10), req());
      const ids = (await coverage(at)).map((c) => c.profileId);
      expect(ids).not.toContain(draft.profileId);
      expect(ids).not.toContain(busy.profileId);
    });

    it('leaves out a profile whose agency is not ACTIVE (T-087)', async () => {
      const a = await agencyWithProfile();
      const at = somewhere();
      await a.in(a.owner, () =>
        raw.createForAgency(a.owner.actor as never, a.profileId, radius(at, 10), req()),
      );
      expect((await coverage(at)).map((c) => c.profileId)).toContain(a.profileId);
      await ownerSql`UPDATE tenants SET status = 'SUSPENDED' WHERE id = ${a.tenantId}`;
      expect((await coverage(at)).map((c) => c.profileId)).not.toContain(a.profileId);
    });

    it('returns an id and a whole-kilometre distance, and nothing that locates an area', async () => {
      const at = somewhere();
      const { actor } = await investigator(ownerDb);
      await areas.createMine(actor, radius(at, 10), req());
      for (const result of await coverage(at, { searchRadiusM: 50_000 })) {
        expect(Object.keys(result).sort()).toEqual(['distanceKm', 'profileId']);
        expect(Number.isInteger(result.distanceKm)).toBe(true);
      }
    });

    it('honours the result limit', async () => {
      const at = somewhere();
      for (let i = 0; i < 3; i++) {
        const { actor } = await investigator(ownerDb);
        await areas.createMine(actor, radius(at, 10), req());
      }
      expect(await coverage(at, { limit: 2 })).toHaveLength(2);
    });

    it.each([
      ['a longitude out of range', { lon: 181, lat: 0 }, {}, 'point'],
      ['a latitude out of range', { lon: 0, lat: -91 }, {}, 'point'],
      ['a non-numeric coordinate', { lon: Number.NaN, lat: 0 }, {}, 'point'],
      ['a negative search radius', { lon: 0, lat: 0 }, { searchRadiusM: -1 }, 'searchRadiusM'],
      [
        'a search radius over the limit',
        { lon: 0, lat: 0 },
        { searchRadiusM: 100_001 },
        'searchRadiusM',
      ],
      ['a zero limit', { lon: 0, lat: 0 }, { limit: 0 }, 'limit'],
      ['a fractional limit', { lon: 0, lat: 0 }, { limit: 1.5 }, 'limit'],
      ['a limit over the maximum', { lon: 0, lat: 0 }, { limit: 201 }, 'limit'],
    ] as const)('refuses %s', async (_label, point, options, field) => {
      await expect(coverage(point, options)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ field })],
      });
    });
  });
});
