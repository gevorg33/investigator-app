import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverable,
  eastOf,
  isolate,
  node,
  searcher,
  somewhere,
  type DiscoverableOptions,
  type TestDb,
} from '../../../test/search-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { serviceAreas } from '../../database/schema';
import { SearchService } from './search.service';
import { testPool } from '../../../test/db';
import { asRequests, scopedDb } from '../../../test/workspace-context';

describe('investigator discovery', () => {
  let sqlClient: postgres.Sql;
  let db: TestDb;
  // Fixtures run as the owner: they write what the application may not (T-073).
  let ownerSql: postgres.Sql;
  let ownerDb: TestDb;
  let service: SearchService;
  let customer: Actor;
  /**
   * This test's own tag, carried as the city of every investigator it creates and filtered on by
   * every search it makes.
   *
   * Random geography alone was not enough. Discovery is global, every suite that creates an
   * investigator now creates a verified one, and the development database holds hundreds of them
   * at random points — so a 50 km search found somebody else's fixture and took the first result.
   * That failed once in a full run and passed three times alone, which is the signature of a
   * shared-state flake rather than a bug in the code under test.
   */
  let tag: string;
  const req = () => ({ ip: '198.51.100.90', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(async () => {
    sqlClient = testPool();
    db = scopedDb(sqlClient);
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    customer = await searcher(ownerDb);
  });

  beforeEach(() => {
    const audit = new AuditService(db);
    service = asRequests(new SearchService(db, new AuthzService(audit)), ownerSql);
    tag = isolate();
  });

  afterAll(async () => {
    await sqlClient.end();
    await ownerSql.end();
  });

  /** An investigator belonging to this test. */
  const mine = async (opts: DiscoverableOptions = {}) =>
    discoverable(ownerDb, { city: tag, ...opts });

  /** A search this test owns: at a point, tightly, and only over this test's investigators. */
  const near = async (centre: { lon: number; lat: number }, over: Record<string, unknown> = {}) =>
    service.searchInvestigators(customer, { near: centre, radiusKm: 0, city: tag, ...over }, req());

  /** A search with exactly the filters given — for the tests that are about the filters. */
  const search = async (dto: Record<string, unknown>) =>
    service.searchInvestigators(customer, dto, req());

  const ids = (page: { items: Array<{ id: string }> }) => page.items.map((i) => i.id);

  describe('eligibility', () => {
    it('finds an investigator who meets every condition', async () => {
      const found = await mine();
      expect(ids(await near(found.centre))).toEqual([found.profileId]);
    });

    it.each([
      ['not verified', { verificationStatus: 'UNVERIFIED' as const }],
      ['awaiting verification', { verificationStatus: 'PENDING' as const }],
      ['verification rejected', { verificationStatus: 'REJECTED' as const }],
      ['profile still a draft', { visibility: 'DRAFT' as const }],
      ['not accepting work', { acceptingWork: false }],
      ['account suspended', { accountStatus: 'SUSPENDED' as const }],
      ['account pending verification', { accountStatus: 'PENDING_VERIFICATION' as const }],
      ['account soft-deleted', { deleted: true }],
    ])('never returns an investigator who is %s', async (_label, opts) => {
      const hidden = await mine(opts);
      expect(ids(await near(hidden.centre))).toEqual([]);
    });

    it('cannot be brought back by matching every other filter perfectly', async () => {
      // The point of the pipeline: no stage adds. A profile that matches on language, category,
      // availability, price and distance is still ineligible if it is not verified.
      const category = await node(ownerDb);
      const hidden = await mine({
        verificationStatus: 'UNVERIFIED',
        languages: ['hy', 'en'],
        specialtyNodeIds: [category],
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
        pricingModel: 'HOURLY',
      });
      const page = await near(hidden.centre, {
        countryCode: 'AM',
        languages: ['hy', 'en'],
        taxonomyNodeIds: [category],
        availableDuring: { dayOfWeek: 1, startMinute: 600, endMinute: 660 },
        pricingModel: 'HOURLY',
      });
      expect(page.items).toEqual([]);
    });
  });

  describe('hard filters', () => {
    it('matches on country and excludes another one', async () => {
      const found = await mine({ countryCode: 'AM' });
      expect(ids(await near(found.centre, { countryCode: 'AM' }))).toEqual([found.profileId]);
      expect(ids(await near(found.centre, { countryCode: 'GE' }))).toEqual([]);
    });

    it('matches a city whatever the capitalisation', async () => {
      // The tag is this test's city, so the search is isolated and the case difference is real.
      const found = await mine();
      expect(ids(await near(found.centre, { city: tag.toUpperCase() }))).toEqual([found.profileId]);
    });

    it('does not match an area with no country against a country filter', async () => {
      // An unanswered question is not a match: the filter narrows.
      const found = await mine({ countryCode: null });
      expect(ids(await near(found.centre))).toEqual([found.profileId]);
      expect(ids(await near(found.centre, { countryCode: 'AM' }))).toEqual([]);
    });

    it('requires every language asked for, not merely one', async () => {
      const oneLanguage = await mine({ languages: ['hy'] });
      expect(ids(await near(oneLanguage.centre, { languages: ['hy'] }))).toEqual([
        oneLanguage.profileId,
      ]);
      expect(ids(await near(oneLanguage.centre, { languages: ['hy', 'en'] }))).toEqual([]);

      const both = await mine({ languages: ['hy', 'en'] });
      expect(ids(await near(both.centre, { languages: ['hy', 'en'] }))).toEqual([both.profileId]);
    });

    it('matches an availability window that overlaps, not only one that contains', async () => {
      const found = await mine({
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }],
      });
      expect(
        ids(
          await near(found.centre, {
            availableDuring: { dayOfWeek: 1, startMinute: 660, endMinute: 900 },
          }),
        ),
      ).toEqual([found.profileId]);
      // A different day, and a window that ends before theirs begins.
      expect(
        ids(
          await near(found.centre, {
            availableDuring: { dayOfWeek: 2, startMinute: 660, endMinute: 900 },
          }),
        ),
      ).toEqual([]);
      expect(
        ids(
          await near(found.centre, {
            availableDuring: { dayOfWeek: 1, startMinute: 0, endMinute: 540 },
          }),
        ),
      ).toEqual([]);
    });

    it('filters on pricing model', async () => {
      const found = await mine({ pricingModel: 'FIXED_FEE' });
      expect(ids(await near(found.centre, { pricingModel: 'FIXED_FEE' }))).toEqual([
        found.profileId,
      ]);
      expect(ids(await near(found.centre, { pricingModel: 'HOURLY' }))).toEqual([]);
    });
  });

  describe('the taxonomy walks the tree in both directions (ADR-0007)', () => {
    it('finds an investigator who declared a child when the customer asked for the parent', async () => {
      const parent = await node(ownerDb);
      const child = await node(ownerDb, { parentId: parent });
      const found = await mine({ specialtyNodeIds: [child] });
      expect(ids(await near(found.centre, { taxonomyNodeIds: [parent] }))).toEqual([
        found.profileId,
      ]);
    });

    it('finds an investigator who declared a parent when the customer asked for the child', async () => {
      const parent = await node(ownerDb);
      const child = await node(ownerDb, { parentId: parent });
      const found = await mine({ specialtyNodeIds: [parent] });
      expect(ids(await near(found.centre, { taxonomyNodeIds: [child] }))).toEqual([
        found.profileId,
      ]);
    });

    it('reaches a grandchild', async () => {
      const root = await node(ownerDb);
      const mid = await node(ownerDb, { parentId: root });
      const leaf = await node(ownerDb, { parentId: mid });
      const found = await mine({ specialtyNodeIds: [leaf] });
      expect(ids(await near(found.centre, { taxonomyNodeIds: [root] }))).toEqual([found.profileId]);
    });

    it('does not match an unrelated branch', async () => {
      const found = await mine({ specialtyNodeIds: [await node(ownerDb)] });
      expect(ids(await near(found.centre, { taxonomyNodeIds: [await node(ownerDb)] }))).toEqual([]);
    });

    it('returns nothing for a node that does not exist, rather than everything', async () => {
      const found = await mine({ specialtyNodeIds: [await node(ownerDb)] });
      expect(ids(await near(found.centre, { taxonomyNodeIds: [randomUUID()] }))).toEqual([]);
    });

    it('matches any of several requested nodes', async () => {
      const wanted = await node(ownerDb);
      const found = await mine({ specialtyNodeIds: [wanted] });
      expect(
        ids(await near(found.centre, { taxonomyNodeIds: [await node(ownerDb), wanted] })),
      ).toEqual([found.profileId]);
    });
  });

  describe('geography', () => {
    it('requires the point to fall inside a service area when no radius is given', async () => {
      const found = await mine({ radiusKm: 5 });
      // 40 km away: outside their 5 km area, and the search itself adds nothing.
      expect(ids(await near(eastOf(found.centre, 40)))).toEqual([]);
    });

    it('widens with the search radius', async () => {
      const centre = somewhere();
      const found = await mine({ centre, radiusKm: 5 });
      const from = eastOf(centre, 40);
      expect(ids(await near(from))).toEqual([]);
      expect(ids(await near(from, { radiusKm: 50 }))).toEqual([found.profileId]);
    });

    it('reports distance rounded up to whole kilometres, and no geometry', async () => {
      const centre = somewhere();
      const found = await mine({ centre, radiusKm: 5 });
      const page = await near(eastOf(centre, 30), { radiusKm: 50 });
      const [item] = page.items;
      expect(item?.id).toBe(found.profileId);
      expect(Number.isInteger(item?.distanceKm)).toBe(true);
      expect(item?.distanceKm).toBeGreaterThan(0);
    });

    it('lists an investigator once however many areas cover the point', async () => {
      const centre = somewhere();
      const found = await mine({ centre, radiusKm: 10 });
      // A second, overlapping area — the classic duplicate.
      await ownerDb.insert(serviceAreas).values({
        profileId: found.profileId,
        kind: 'RADIUS',
        label: 'Second area',
        countryCode: 'AM',
        city: tag,
        centre,
        radiusM: 20_000,
        area: sql`ST_Buffer(ST_SetSRID(ST_MakePoint(${centre.lon}, ${centre.lat}), 4326)::geography, 20000)`,
      });
      expect(ids(await near(centre))).toEqual([found.profileId]);
    });

    it('orders by distance, nearest first', async () => {
      const centre = somewhere();
      const close = await mine({ centre, radiusKm: 5 });
      const far = await mine({ centre: eastOf(centre, 30), radiusKm: 5 });
      expect(ids(await near(centre, { radiusKm: 60 }))).toEqual([close.profileId, far.profileId]);
    });

    it('finds an investigator with no service area only when no location is asked for', async () => {
      // Nowhere to work is not a reason to be invisible in a list that is not about location.
      // No area means no city either, so this one is isolated by a specialty of its own rather
      // than by the city tag — asking for a page of 100 and hoping it is on it depends on how
      // many profiles the shared database happens to hold.
      const specialty = await node(ownerDb);
      const found = await discoverable(ownerDb, {
        withoutArea: true,
        specialtyNodeIds: [specialty],
      });
      expect(ids(await near(somewhere()))).not.toContain(found.profileId);
      expect(ids(await search({ taxonomyNodeIds: [specialty] }))).toEqual([found.profileId]);
    });
  });

  describe('pagination', () => {
    it('pages without repeating or skipping, and stops', async () => {
      const centre = somewhere();
      const first = await mine({ centre, radiusKm: 5 });
      const second = await mine({ centre: eastOf(centre, 20), radiusKm: 5 });

      const page1 = await near(centre, { radiusKm: 60, limit: 1 });
      expect(ids(page1)).toEqual([first.profileId]);
      expect(page1.pageInfo.hasNextPage).toBe(true);

      const page2 = await search({
        near: centre,
        radiusKm: 60,
        city: tag,
        limit: 1,
        cursor: page1.pageInfo.nextCursor!,
      });
      expect(ids(page2)).toEqual([second.profileId]);
      expect(page2.pageInfo.hasNextPage).toBe(false);
      expect(page2.pageInfo.nextCursor).toBeNull();
    });

    it('refuses a cursor from a different search', async () => {
      const centre = somewhere();
      await mine({ centre, radiusKm: 5 });
      await mine({ centre: eastOf(centre, 20), radiusKm: 5 });
      const page1 = await near(centre, { radiusKm: 60, limit: 1 });

      await expect(
        search({
          near: centre,
          radiusKm: 60,
          city: tag,
          limit: 1,
          countryCode: 'AM',
          cursor: page1.pageInfo.nextCursor!,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('clamps an oversized limit instead of refusing it', async () => {
      const found = await mine();
      const page = await near(found.centre, { limit: 5000 });
      expect(ids(page)).toEqual([found.profileId]);
    });
  });

  describe('what a result contains', () => {
    it('carries the public projection and nothing private', async () => {
      const centre = somewhere();
      const found = await mine({ centre, displayName: 'Anahit', languages: ['hy'] });
      await ownerDb
        .update(schema.investigatorProfiles)
        .set({ contactPhone: '555-0104' })
        .where(sql`${schema.investigatorProfiles.id} = ${found.profileId}`);

      const page = await near(centre);
      const serialised = JSON.stringify(page);
      expect(page.items[0]).toMatchObject({
        id: found.profileId,
        displayName: 'Anahit',
        verificationStatus: 'VERIFIED',
      });
      // No contact details, no coordinates, no geometry, no account id.
      expect(serialised).not.toContain('555-0104');
      expect(serialised).not.toContain('contactPhone');
      expect(serialised).not.toContain('userId');
      expect(serialised).not.toContain(String(centre.lon));
      expect(serialised).not.toContain('POLYGON');
      expect(serialised).not.toContain('centre');
    });

    it('explains the match from the criteria that actually matched', async () => {
      const category = await node(ownerDb);
      const centre = somewhere();
      await mine({
        centre,
        languages: ['hy', 'en', 'ru'],
        specialtyNodeIds: [category],
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
      });

      const page = await near(centre, {
        countryCode: 'AM',
        languages: ['hy', 'en'],
        taxonomyNodeIds: [category],
        availableDuring: { dayOfWeek: 1, startMinute: 600, endMinute: 660 },
      });

      const matched = page.items[0]?.matchedOn;
      expect(matched?.taxonomyNodeIds).toEqual([category]);
      // The languages asked for, not every language they speak.
      expect(matched?.languages.sort()).toEqual(['en', 'hy']);
      expect(matched?.place).toEqual({ countryCode: 'AM', city: tag });
      expect(matched?.availability).toBe(true);
    });

    it('claims no match for a filter nobody applied', async () => {
      // No place filter at all here, so `place` can be null — which means the tag cannot isolate
      // this one. The result is found by id rather than by position instead.
      const centre = somewhere();
      const found = await mine({ centre });
      const page = await search({ near: centre, radiusKm: 0 });
      const item = page.items.find((i) => i.id === found.profileId);
      expect(item?.matchedOn).toEqual({
        taxonomyNodeIds: [],
        languages: [],
        place: null,
        availability: false,
      });
    });
  });

  describe('region', () => {
    it('filters on region, case-insensitively, and reports it as a match', async () => {
      // Region carries the tag here, so the search is isolated without a city filter muddying
      // what `matchedOn.place` should contain.
      const found = await mine({ region: tag });
      const page = await search({ near: found.centre, radiusKm: 0, region: tag.toUpperCase() });
      expect(ids(page)).toEqual([found.profileId]);
      expect(page.items[0]?.matchedOn.place).toEqual({ region: tag.toUpperCase() });
    });

    it('excludes another region', async () => {
      const found = await mine({ region: tag });
      expect(ids(await search({ near: found.centre, radiusKm: 0, region: 'Ararat' }))).toEqual([]);
    });
  });

  describe('a location with no radius', () => {
    it('requires the point to be inside the area, without the caller saying so', async () => {
      // The default is 0: "covers this spot", which is what the investigator article promises.
      const centre = somewhere();
      const found = await mine({ centre, radiusKm: 5 });
      expect(ids(await search({ near: centre, city: tag }))).toEqual([found.profileId]);
      expect(ids(await search({ near: eastOf(centre, 40), city: tag }))).toEqual([]);
    });
  });

  describe('authorization', () => {
    it('refuses a suspended account', async () => {
      const suspended = await searcher(ownerDb, { status: 'SUSPENDED' });
      await expect(service.searchInvestigators(suspended, {}, req())).rejects.toMatchObject({
        status: 403,
      });
    });
  });
});
