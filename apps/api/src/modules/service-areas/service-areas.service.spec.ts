import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import * as schema from '../../database/schema';
import { auditLogs, serviceAreas } from '../../database/schema';
import { testActor } from '../../../test/authz-cases';
import { investigator, somewhere, square, type TestDb } from '../../../test/service-area-fixtures';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { MAX_AREAS_PER_PROFILE } from './service-areas.policy';
import { ServiceAreasService } from './service-areas.service';

const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

describe('service areas', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  let areas: ServiceAreasService;
  const req = () => ({ ip: '198.51.100.50', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = postgres(URL, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
  });

  beforeEach(() => {
    areas = new ServiceAreasService(
      db,
      new AuthzService(new AuditService(db)),
      new AuditService(db),
      new OwnInvestigatorProfileRepository(db),
    );
  });

  afterAll(async () => {
    await sql.end();
  });

  const radius = (at: { lon: number; lat: number }, radiusKm = 10, label = 'work') => ({
    kind: 'RADIUS' as const,
    label,
    centre: at,
    radiusKm,
  });

  describe('managing your own areas', () => {
    it('coarsens a radius centre to about a kilometre before storing it', async () => {
      const { actor } = await investigator(db);
      const created = await areas.createMine(actor, radius({ lon: 44.51523, lat: 40.18724 }), req());
      expect(created).toMatchObject({
        kind: 'RADIUS',
        centre: { lon: 44.52, lat: 40.19 },
        radiusKm: 10,
        boundary: null,
      });
      const [row] = await db.select().from(serviceAreas).where(eq(serviceAreas.id, created.id));
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
      const { actor } = await investigator(db);
      await expect(areas.createMine(actor, radius(at, 5), req())).resolves.toMatchObject({ radiusKm: 5 });
    });

    it('closes a drawn boundary and returns it as drawn', async () => {
      const { actor } = await investigator(db);
      const boundary = square(somewhere(), 0.5);
      const created = await areas.createMine(actor, { kind: 'POLYGON', label: 'district', boundary }, req());
      expect(created).toMatchObject({ kind: 'POLYGON', centre: null, radiusKm: null, boundary });
    });

    it('does not close a boundary twice when the client already closed it', async () => {
      const { actor } = await investigator(db);
      const open = square(somewhere(), 0.5);
      const closed = [...open, open[0]!];
      const created = await areas.createMine(actor, { kind: 'POLYGON', label: 'closed', boundary: closed }, req());
      expect(created.boundary).toEqual(open);
    });

    it('audits the change', async () => {
      const { actor } = await investigator(db);
      const r = req();
      const created = await areas.createMine(actor, radius(somewhere()), r);
      const rows = await db.select().from(auditLogs).where(eq(auditLogs.correlationId, r.correlationId));
      expect(rows).toContainEqual(expect.objectContaining({ action: 'service_area.created', resourceId: created.id, reason: 'RADIUS' }));
    });

    it.each([
      ['a drawn area too small to be anywhere but one building', () => square(somewhere(), 0.01), 'TOO_SMALL'],
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
      const { actor } = await investigator(db);
      await expect(
        areas.createMine(actor, { kind: 'POLYGON', label: 'bad', boundary: makeBoundary() }, req()),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [expect.objectContaining({ code })] });
    });

    it('surfaces a database refusal it does not have a reason for, rather than mislabelling it', async () => {
      const { actor } = await investigator(db);
      await expect(
        areas.createMine(actor, radius(somewhere(), 10, 'x'.repeat(81)), req()),
      ).rejects.not.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it(`allows at most ${MAX_AREAS_PER_PROFILE} areas`, async () => {
      const { actor } = await investigator(db);
      for (let i = 0; i < MAX_AREAS_PER_PROFILE; i++) await areas.createMine(actor, radius(somewhere()), req());
      await expect(areas.createMine(actor, radius(somewhere()), req())).rejects.toMatchObject({
        details: [expect.objectContaining({ code: 'LIMIT_REACHED' })],
      });
    });

    it('lists only your own areas, oldest first', async () => {
      const { actor } = await investigator(db);
      const other = await investigator(db);
      const first = await areas.createMine(actor, radius(somewhere(), 10, 'first'), req());
      const second = await areas.createMine(actor, radius(somewhere(), 10, 'second'), req());
      await areas.createMine(other.actor, radius(somewhere(), 10, 'theirs'), req());
      expect((await areas.listMine(actor, req())).map((a) => a.id)).toEqual([first.id, second.id]);
    });

    it('removes your own area', async () => {
      const { actor } = await investigator(db);
      const created = await areas.createMine(actor, radius(somewhere()), req());
      await areas.deleteMine(actor, created.id, req());
      expect(await areas.listMine(actor, req())).toEqual([]);
    });

    it('will not remove another investigator’s area, and answers as if it did not exist', async () => {
      const owner = await investigator(db);
      const created = await areas.createMine(owner.actor, radius(somewhere()), req());
      const stranger = await investigator(db);
      await expect(areas.deleteMine(stranger.actor, created.id, req())).rejects.toMatchObject({ status: 404 });
      await expect(areas.deleteMine(stranger.actor, randomUUID(), req())).rejects.toMatchObject({ status: 404 });
      expect(await areas.listMine(owner.actor, req())).toHaveLength(1);
    });

    it('refuses a customer, a suspended investigator, and one with no profile', async () => {
      const { actor } = await investigator(db);
      await expect(areas.listMine({ ...actor, roles: ['CUSTOMER'] }, req())).rejects.toMatchObject({ status: 403 });
      await expect(areas.listMine({ ...actor, status: 'SUSPENDED' }, req())).rejects.toMatchObject({ status: 403 });
      await expect(
        areas.listMine(testActor({ userId: randomUUID(), roles: ['INVESTIGATOR'] }), req()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('coverage', () => {
    it('finds an investigator whose area contains the point, at distance 0', async () => {
      const at = somewhere();
      const { actor, profileId } = await investigator(db);
      await areas.createMine(actor, radius(at, 10), req());
      expect(await areas.findCoverage(at)).toContainEqual({ profileId, distanceKm: 0 });
    });

    it('excludes an area the point falls outside, unless the search reaches it', async () => {
      const at = somewhere();
      const { actor, profileId } = await investigator(db);
      await areas.createMine(actor, radius(at, 5), req());
      // About 20 km north of the centre: outside a 5 km area by roughly 15 km.
      const away = { lon: at.lon, lat: at.lat + 0.18 };
      expect((await areas.findCoverage(away)).map((c) => c.profileId)).not.toContain(profileId);
      const reached = (await areas.findCoverage(away, { searchRadiusM: 30_000 })).find((c) => c.profileId === profileId);
      expect(reached?.distanceKm).toBeGreaterThanOrEqual(15);
      expect(reached?.distanceKm).toBeLessThanOrEqual(16);
    });

    it('lists an investigator once, however many of their areas match, at the nearest', async () => {
      const at = somewhere();
      const { actor, profileId } = await investigator(db);
      await areas.createMine(actor, radius(at, 10, 'a'), req());
      await areas.createMine(actor, radius(at, 20, 'b'), req());
      await areas.createMine(actor, { kind: 'POLYGON', label: 'c', boundary: square({ lon: at.lon - 0.3, lat: at.lat - 0.3 }, 0.6) }, req());
      const mine = (await areas.findCoverage(at)).filter((c) => c.profileId === profileId);
      expect(mine).toEqual([{ profileId, distanceKm: 0 }]);
    });

    it('orders nearest first', async () => {
      const at = somewhere();
      const inside = await investigator(db);
      const nearby = await investigator(db);
      await areas.createMine(inside.actor, radius(at, 10), req());
      await areas.createMine(nearby.actor, radius({ lon: at.lon, lat: at.lat + 0.18 }, 5), req());
      const ids = (await areas.findCoverage(at, { searchRadiusM: 30_000 }))
        .map((c) => c.profileId)
        .filter((id) => id === inside.profileId || id === nearby.profileId);
      expect(ids).toEqual([inside.profileId, nearby.profileId]);
    });

    it('never includes a draft profile or one not accepting work', async () => {
      const at = somewhere();
      const draft = await investigator(db, { visibility: 'DRAFT' });
      const busy = await investigator(db, { acceptingWork: false });
      await areas.createMine(draft.actor, radius(at, 10), req());
      await areas.createMine(busy.actor, radius(at, 10), req());
      const ids = (await areas.findCoverage(at)).map((c) => c.profileId);
      expect(ids).not.toContain(draft.profileId);
      expect(ids).not.toContain(busy.profileId);
    });

    it('returns an id and a whole-kilometre distance, and nothing that locates an area', async () => {
      const at = somewhere();
      const { actor } = await investigator(db);
      await areas.createMine(actor, radius(at, 10), req());
      for (const result of await areas.findCoverage(at, { searchRadiusM: 50_000 })) {
        expect(Object.keys(result).sort()).toEqual(['distanceKm', 'profileId']);
        expect(Number.isInteger(result.distanceKm)).toBe(true);
      }
    });

    it('honours the result limit', async () => {
      const at = somewhere();
      for (let i = 0; i < 3; i++) {
        const { actor } = await investigator(db);
        await areas.createMine(actor, radius(at, 10), req());
      }
      expect(await areas.findCoverage(at, { limit: 2 })).toHaveLength(2);
    });

    it.each([
      ['a longitude out of range', { lon: 181, lat: 0 }, {}, 'point'],
      ['a latitude out of range', { lon: 0, lat: -91 }, {}, 'point'],
      ['a non-numeric coordinate', { lon: Number.NaN, lat: 0 }, {}, 'point'],
      ['a negative search radius', { lon: 0, lat: 0 }, { searchRadiusM: -1 }, 'searchRadiusM'],
      ['a search radius over the limit', { lon: 0, lat: 0 }, { searchRadiusM: 100_001 }, 'searchRadiusM'],
      ['a zero limit', { lon: 0, lat: 0 }, { limit: 0 }, 'limit'],
      ['a fractional limit', { lon: 0, lat: 0 }, { limit: 1.5 }, 'limit'],
      ['a limit over the maximum', { lon: 0, lat: 0 }, { limit: 201 }, 'limit'],
    ] as const)('refuses %s', async (_label, point, options, field) => {
      await expect(areas.findCoverage(point, options)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ field })],
      });
    });
  });
});
