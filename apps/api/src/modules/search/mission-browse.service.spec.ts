import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  areaAt,
  backdate,
  missionOwner,
  posted,
  publishedAt,
  type TestDb,
} from '../../../test/browse-fixtures';
import { testPool } from '../../../test/db';
import { category, inDays } from '../../../test/mission-fixtures';
import {
  discoverable,
  eastOf,
  node,
  somewhere,
  type Discoverable,
} from '../../../test/search-fixtures';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import * as schema from '../../database/schema';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import type { BrowseMissionsDto } from './mission-browse.dto';
import {
  MAX_SAVED_SEARCHES,
  MissionBrowseService,
  missionBrowseQuery,
  type MissionBrowsePage,
} from './mission-browse.service';

const req = () => ({ ip: '198.51.100.54', userAgent: 'vitest', correlationId: randomUUID() });

describe('mission browse', () => {
  let appSql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: TestDb;
  let service: MissionBrowseService;
  let investigator: Discoverable;
  /** This test's own category: every browse filters on it, so other suites' missions stay out. */
  let mine: string;

  beforeAll(async () => {
    appSql = testPool();
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
  });

  afterAll(async () => {
    await appSql.end();
    await ownerSql.end();
  });

  beforeEach(async () => {
    const db = scopedDb(appSql);
    service = asRequests(
      new MissionBrowseService(
        db,
        new AuthzService(new AuditService(db)),
        new OwnInvestigatorProfileRepository(db),
      ),
      ownerSql,
    );
    investigator = await discoverable(ownerDb, { centre: somewhere(), radiusKm: 10 });
    mine = await category(ownerDb);
  });

  const browse = (dto: BrowseMissionsDto = {}, as: Actor = investigator.actor) =>
    service.browse(as, { taxonomyNodeIds: [mine], ...dto }, req());
  const ids = (page: MissionBrowsePage) => page.items.map((i) => i.id);

  /** Every page of a browse, one mission at a time — the cursor path, end to end. */
  const everyPage = async (dto: BrowseMissionsDto): Promise<string[]> => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await browse({ ...dto, limit: 1, ...(cursor !== undefined ? { cursor } : {}) });
      seen.push(...ids(page));
      if (page.pageInfo.nextCursor === null) return seen;
      cursor = page.pageInfo.nextCursor;
    }
    throw new Error('did not reach the last page');
  };

  const refusal = async (p: Promise<unknown>) => {
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  };
  const fields = async (p: Promise<unknown>) =>
    ((await refusal(p)).details ?? []).map((d) => [d.field, d.messageKey]);

  describe('who may browse', () => {
    it('is an investigator who could quote: published, verified, accepting work', async () => {
      const m = await posted(ownerDb, mine);
      expect(ids(await browse())).toEqual([m]);
    });

    it.each([
      ['not verified', { verificationStatus: 'PENDING' as const }],
      ['a draft profile', { visibility: 'DRAFT' as const }],
      ['not accepting work', { acceptingWork: false }],
    ])('is refused with %s, exactly as a quote would be', async (_, opts) => {
      const other = await discoverable(ownerDb, opts);
      await posted(ownerDb, mine);
      expect((await refusal(browse({}, other.actor))).code).toBe('FORBIDDEN');
    });

    it('is refused to a customer, and to a suspended account', async () => {
      const owner = await missionOwner(ownerDb);
      const customer: Actor = { ...investigator.actor, userId: owner, roles: ['CUSTOMER'] };
      expect((await refusal(browse({}, customer))).code).toBe('FORBIDDEN');
      const suspended = { ...investigator.actor, status: 'SUSPENDED' as const };
      expect((await refusal(browse({}, suspended))).code).toBe('FORBIDDEN');
    });
  });

  describe('eligibility comes first, and no filter loosens it', () => {
    it('shows published missions only, and never the investigator’s own', async () => {
      const eligible = [
        await posted(ownerDb, mine, {
          languages: ['en'],
          location: eastOf(investigator.centre, 5),
        }),
        await posted(ownerDb, mine, {
          languages: ['hy'],
          currency: 'USD',
          budgetMaxMinor: 900_000,
        }),
        await posted(ownerDb, mine, { deadline: inDays(3), title: 'Asset search in Gyumri' }),
      ];
      const ineligible = [
        ...(await Promise.all(
          (
            [
              'DRAFT',
              'SUBMITTED',
              'UNDER_REVIEW',
              'REJECTED',
              'CANCELLED',
              'CUSTOMER_CONFIRMED',
            ] as const
          ).map((status) =>
            posted(ownerDb, mine, { status, location: eastOf(investigator.centre, 5) }),
          ),
        )),
        // One account holds both roles: their own published mission is not work for them.
        await posted(ownerDb, mine, { customerId: investigator.userId, languages: ['en'] }),
      ];

      // Nothing but the category: exactly the eligible set.
      expect((await everyPage({})).sort()).toEqual([...eligible].sort());

      // Every filter, every sort, free text and the cursor path: never anything else.
      const combinations: BrowseMissionsDto[] = [
        { sort: 'newest' },
        { sort: 'closest' },
        { sort: 'deadline' },
        { sort: 'budget', currency: 'AMD' },
        { sort: 'budget', currency: 'USD' },
        { q: 'Asset search' },
        { q: 'due diligence Counterparty' },
        { languages: ['en', 'hy', 'ru'] },
        { languages: ['en'] },
        { currency: 'AMD', budgetMinMinor: 0, budgetMaxMinor: 2_000_000_000 },
        { deadlineFrom: inDays(-3650), deadlineTo: inDays(3650) },
        { withinKm: 200 },
        { withinKm: 0, sort: 'closest' },
        { serviceAreaId: await areaAt(ownerDb, investigator.profileId, investigator.centre, 50) },
        { postedWithinDays: 365 },
      ];
      for (const dto of combinations) {
        const seen = await everyPage(dto);
        for (const id of seen) {
          expect(ineligible, JSON.stringify(dto)).not.toContain(id);
          expect(eligible, JSON.stringify(dto)).toContain(id);
        }
        // And each mission appears at most once across the pages.
        expect(new Set(seen).size, JSON.stringify(dto)).toBe(seen.length);
      }
    });

    it('needs no category: the whole published set, newest first', async () => {
      const m = await posted(ownerDb, mine);
      const page = await service.browse(investigator.actor, { limit: 100 }, req());
      expect(ids(page)).toContain(m);
    });

    it('drops a mission hired between the two reads rather than showing it', async () => {
      const m = await posted(ownerDb, mine);
      const page = await browse();
      expect(ids(page)).toEqual([m]);
      await ownerDb
        .update(schema.missions)
        .set({ status: 'CUSTOMER_CONFIRMED' })
        .where(eq(schema.missions.id, m));
      expect(ids(await browse())).toEqual([]);
    });
  });

  describe('filters', () => {
    it('walks the taxonomy both ways, as discovery does', async () => {
      const parent = await node(ownerDb);
      const child = await node(ownerDb, { parentId: parent });
      const atParent = await posted(ownerDb, parent);
      const atChild = await posted(ownerDb, child);
      const byParent = await service.browse(
        investigator.actor,
        { taxonomyNodeIds: [parent] },
        req(),
      );
      expect(ids(byParent).sort()).toEqual([atParent, atChild].sort());
      const byChild = await service.browse(investigator.actor, { taxonomyNodeIds: [child] }, req());
      expect(ids(byChild).sort()).toEqual([atParent, atChild].sort());
    });

    it('finds nothing under a category that does not exist', async () => {
      await posted(ownerDb, mine);
      const page = await service.browse(
        investigator.actor,
        { taxonomyNodeIds: [randomUUID()] },
        req(),
      );
      expect(page).toEqual({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } });
    });

    it('matches a budget range that overlaps, in the currency asked for', async () => {
      const low = await posted(ownerDb, mine, { budgetMinMinor: 10_000, budgetMaxMinor: 40_000 });
      const high = await posted(ownerDb, mine, {
        budgetMinMinor: 200_000,
        budgetMaxMinor: 500_000,
      });
      const straddles = await posted(ownerDb, mine, {
        budgetMinMinor: 50_000,
        budgetMaxMinor: 250_000,
      });
      await posted(ownerDb, mine, {
        currency: 'USD',
        budgetMinMinor: 10_000,
        budgetMaxMinor: 40_000,
      });

      const inRange = await browse({
        currency: 'AMD',
        budgetMinMinor: 30_000,
        budgetMaxMinor: 100_000,
      });
      expect(ids(inRange).sort()).toEqual([low, straddles].sort());
      expect(ids(await browse({ currency: 'AMD', budgetMinMinor: 300_000 }))).toEqual([high]);
      expect(ids(await browse({ currency: 'USD' })).length).toBe(1);
    });

    it('refuses a budget without a currency, and a range that ends before it starts', async () => {
      expect(await fields(browse({ budgetMinMinor: 1 }))).toEqual([
        ['currency', 'error.validation.currency.required'],
      ]);
      expect(
        await fields(browse({ currency: 'AMD', budgetMinMinor: 5, budgetMaxMinor: 4 })),
      ).toEqual([['budgetMaxMinor', 'error.validation.budget.range']]);
    });

    it('matches deadlines inside the window, both ends inclusive', async () => {
      const soon = await posted(ownerDb, mine, { deadline: inDays(5) });
      const later = await posted(ownerDb, mine, { deadline: inDays(60) });
      expect(ids(await browse({ deadlineFrom: inDays(5), deadlineTo: inDays(5) }))).toEqual([soon]);
      expect(ids(await browse({ deadlineTo: inDays(10) }))).toEqual([soon]);
      expect(ids(await browse({ deadlineFrom: inDays(10) }))).toEqual([later]);
      expect(await fields(browse({ deadlineFrom: inDays(10), deadlineTo: inDays(1) }))).toEqual([
        ['deadlineTo', 'error.validation.deadline.range'],
      ]);
    });

    it('keeps the missions whose every required language the investigator works in', async () => {
      const english = await posted(ownerDb, mine, { languages: ['en'] });
      const both = await posted(ownerDb, mine, { languages: ['en', 'hy'] });
      const russian = await posted(ownerDb, mine, { languages: ['ru'] });
      expect(ids(await browse({ languages: ['en'] }))).toEqual([english]);
      expect(ids(await browse({ languages: ['hy', 'en'] })).sort()).toEqual([english, both].sort());
      expect(ids(await browse({ languages: ['ru', 'en', 'hy'] })).sort()).toEqual(
        [english, both, russian].sort(),
      );
    });

    it('keeps what was posted recently, relative to now', async () => {
      const fresh = await posted(ownerDb, mine);
      const old = await posted(ownerDb, mine);
      await backdate(ownerSql, old, 10);
      expect(ids(await browse({ postedWithinDays: 7 }))).toEqual([fresh]);
      expect(ids(await browse({ postedWithinDays: 30 })).sort()).toEqual([fresh, old].sort());
    });

    describe('distance from a service area', () => {
      let inside: string;
      let twenty: string;
      let seventy: string;
      let nowhere: string;

      beforeEach(async () => {
        const c = investigator.centre;
        inside = await posted(ownerDb, mine, { location: eastOf(c, 5) });
        twenty = await posted(ownerDb, mine, { location: eastOf(c, 30) });
        seventy = await posted(ownerDb, mine, { location: eastOf(c, 80) });
        nowhere = await posted(ownerDb, mine, { location: null });
      });

      it('filters with ST_DWithin from the area’s edge; 0 means inside it', async () => {
        expect(ids(await browse({ withinKm: 0 }))).toEqual([inside]);
        expect(ids(await browse({ withinKm: 30 })).sort()).toEqual([inside, twenty].sort());
      });

      it('sorts nearest first, with rounded distances and the unlocated last', async () => {
        const page = await browse({ sort: 'closest' });
        expect(ids(page)).toEqual([inside, twenty, seventy, nowhere]);
        const km = page.items.map((i) => i.distanceKm);
        expect(km[0]).toBe(0);
        expect(km[1]).toBeGreaterThanOrEqual(19);
        expect(km[1]).toBeLessThanOrEqual(22);
        expect(km[2]).toBeGreaterThanOrEqual(69);
        expect(km[3]).toBeNull();
      });

      it('measures from the area named, and only the investigator’s own', async () => {
        const far = await areaAt(
          ownerDb,
          investigator.profileId,
          eastOf(investigator.centre, 80),
          5,
        );
        const page = await browse({ serviceAreaId: far, sort: 'closest' });
        expect(ids(page)[0]).toBe(seventy);

        const stranger = await discoverable(ownerDb);
        const theirs = await areaAt(ownerDb, stranger.profileId, investigator.centre, 5);
        expect(await fields(browse({ serviceAreaId: theirs }))).toEqual([
          ['serviceAreaId', 'error.validation.service_area.unknown'],
        ]);
      });

      it('carries no distance when none was asked for', async () => {
        expect((await browse()).items.every((i) => i.distanceKm === null)).toBe(true);
      });
    });
  });

  describe('orders', () => {
    it('is newest first by default', async () => {
      const a = await posted(ownerDb, mine);
      const b = await posted(ownerDb, mine);
      const c = await posted(ownerDb, mine);
      await publishedAt(ownerSql, a, new Date('2026-09-20T10:00:00Z'));
      await publishedAt(ownerSql, b, new Date('2026-09-22T10:00:00Z'));
      await publishedAt(ownerSql, c, new Date('2026-09-21T10:00:00Z'));
      expect(ids(await browse())).toEqual([b, c, a]);
      expect(await everyPage({ sort: 'newest' })).toEqual([b, c, a]);
    });

    it('puts the highest budget first, by its upper end, in one currency', async () => {
      const small = await posted(ownerDb, mine, { budgetMinMinor: 1_000, budgetMaxMinor: 5_000 });
      const big = await posted(ownerDb, mine, { budgetMinMinor: 1_000, budgetMaxMinor: 900_000 });
      const middle = await posted(ownerDb, mine, {
        budgetMinMinor: 50_000,
        budgetMaxMinor: 60_000,
      });
      await posted(ownerDb, mine, { currency: 'USD', budgetMaxMinor: 9_000_000 });
      expect(await everyPage({ sort: 'budget', currency: 'AMD' })).toEqual([big, middle, small]);
      expect(await fields(browse({ sort: 'budget' }))).toEqual([
        ['currency', 'error.validation.currency.required'],
      ]);
    });

    it('puts the soonest deadline first, then the newest', async () => {
      const later = await posted(ownerDb, mine, { deadline: inDays(40) });
      const sameOlder = await posted(ownerDb, mine, { deadline: inDays(2) });
      const sameNewer = await posted(ownerDb, mine, { deadline: inDays(2) });
      await publishedAt(ownerSql, sameOlder, new Date('2026-09-01T00:00:00Z'));
      expect(await everyPage({ sort: 'deadline' })).toEqual([sameNewer, sameOlder, later]);
    });

    it('ranks by free text without removing anything', async () => {
      const other = await posted(ownerDb, mine, {
        title: 'Background check',
        description: 'Employment history.',
      });
      const match = await posted(ownerDb, mine, {
        title: 'Vehicle asset search',
        description: 'Find vehicles registered to the company.',
      });
      const page = await browse({ q: 'vehicle asset' });
      expect(ids(page)).toEqual([match, other]);
      // Nothing matches at all: still every eligible mission, newest first.
      expect(ids(await browse({ q: 'zzzqqq' })).sort()).toEqual([other, match].sort());
    });

    it('refuses free text under any other order, and relevance without text', async () => {
      expect(await fields(browse({ q: 'asset', sort: 'newest' }))).toEqual([
        ['sort', 'error.validation.browse.text_orders_only'],
      ]);
      expect(await fields(browse({ sort: 'relevance' }))).toEqual([
        ['q', 'error.validation.browse.relevance_needs_text'],
      ]);
    });
  });

  describe('pages', () => {
    it('walks every page once, in order, and binds the cursor to its filters', async () => {
      const made = [];
      for (let i = 0; i < 5; i++)
        made.push(await posted(ownerDb, mine, { deadline: inDays(10 + i) }));
      const first = await browse({ sort: 'deadline', limit: 2 });
      expect(ids(first)).toEqual(made.slice(0, 2));
      expect(first.pageInfo.hasNextPage).toBe(true);
      expect(await everyPage({ sort: 'deadline' })).toEqual(made);

      // Page two of one browse is never page two of another.
      const cursor = first.pageInfo.nextCursor!;
      expect(await fields(browse({ sort: 'newest', limit: 2, cursor }))).toEqual([
        ['cursor', 'error.validation.cursor.invalid'],
      ]);
      expect(await fields(browse({ cursor: 'not-a-cursor' }))).toEqual([
        ['cursor', 'error.validation.cursor.invalid'],
      ]);
    });
  });

  describe('what a listing shows', () => {
    it('is what a quote needs, and nothing about the customer', async () => {
      await posted(ownerDb, mine, { location: eastOf(investigator.centre, 5) });
      const [item] = (await browse({ sort: 'closest' })).items;
      expect(Object.keys(item!).sort()).toEqual(
        [
          'budgetMaxMinor',
          'budgetMinMinor',
          'countryCode',
          'currency',
          'deadline',
          'description',
          'distanceKm',
          'id',
          'languages',
          'locationLabel',
          'publishedAt',
          'startBy',
          'taxonomyNodeId',
          'title',
        ].sort(),
      );
      const text = JSON.stringify(item);
      // The fixture's purpose and relationship are in the row; none of it is in the listing.
      expect(text).not.toMatch(/Deciding whether to sign|BUSINESS_RELATIONSHIP|customer|@example/);
      expect(item!.publishedAt).toBeInstanceOf(Date);
    });
  });

  describe('saved searches', () => {
    const save = (name: string, filters: object = { languages: ['en'] }, as = investigator.actor) =>
      service.save(as, { name, filters }, req());

    it('saves a browse under a name, lists it newest first, and deletes it', async () => {
      const a = await save('English work');
      const b = await save('  Budget, AMD  ', { sort: 'budget', currency: 'AMD' });
      expect(b.name).toBe('Budget, AMD');
      expect(b.filters).toEqual({ sort: 'budget', currency: 'AMD' });
      const listed = await service.listSaved(investigator.actor, req());
      expect(listed.map((s) => s.id)).toEqual([b.id, a.id]);
      await service.removeSaved(investigator.actor, a.id, req());
      expect((await service.listSaved(investigator.actor, req())).map((s) => s.id)).toEqual([b.id]);
    });

    it('checks a search as a browse would, so every saved one runs', async () => {
      expect(await fields(save('Broken', { sort: 'budget' }))).toEqual([
        ['currency', 'error.validation.currency.required'],
      ]);
    });

    it('keeps names unique, and the number bounded', async () => {
      await save('Same');
      expect(await fields(save('Same'))).toEqual([
        ['name', 'error.validation.saved_search.name_taken'],
      ]);
      for (let i = 1; i < MAX_SAVED_SEARCHES; i++) await save(`Search ${i}`);
      expect(await fields(save('One too many'))).toEqual([
        ['name', 'error.validation.saved_search.limit'],
      ]);
    });

    it('belongs to its investigator alone', async () => {
      const mineSaved = await save('Private');
      const colleague = await discoverable(ownerDb);
      expect(await service.listSaved(colleague.actor, req())).toEqual([]);
      expect((await refusal(service.removeSaved(colleague.actor, mineSaved.id, req()))).code).toBe(
        'NOT_FOUND',
      );
      expect((await service.listSaved(investigator.actor, req())).map((s) => s.id)).toEqual([
        mineSaved.id,
      ]);
    });

    it('stays listable when eligibility lapses, but is kept from customers', async () => {
      const lapsed = await discoverable(ownerDb, { acceptingWork: false });
      expect(await service.listSaved(lapsed.actor, req())).toEqual([]);
      const owner = await missionOwner(ownerDb);
      const customer: Actor = { ...investigator.actor, userId: owner, roles: ['CUSTOMER'] };
      expect((await refusal(service.listSaved(customer, req()))).code).toBe('FORBIDDEN');
    });
  });

  describe('when a mission was published', () => {
    const row = async (id: string) =>
      (await ownerDb.select().from(schema.missions).where(eq(schema.missions.id, id)))[0]!;

    it('is set by the database on entry into QUOTED, whatever a writer supplies', async () => {
      const id = await posted(ownerDb, mine, { status: 'UNDER_REVIEW' });
      expect((await row(id)).publishedAt).toBeNull();
      await ownerDb
        .update(schema.missions)
        .set({ status: 'QUOTED' })
        .where(eq(schema.missions.id, id));
      const published = (await row(id)).publishedAt;
      expect(published).toBeInstanceOf(Date);
      // Kept once the mission moves on, so a hired mission still says when it was posted.
      await ownerDb
        .update(schema.missions)
        .set({ status: 'CUSTOMER_CONFIRMED' })
        .where(eq(schema.missions.id, id));
      expect((await row(id)).publishedAt).toEqual(published);
    });

    it('cannot be written by anyone else', async () => {
      const id = await posted(ownerDb, mine);
      const e = await ownerDb
        .update(schema.missions)
        .set({ publishedAt: new Date('2020-01-01T00:00:00Z') })
        .where(eq(schema.missions.id, id))
        .catch((x: unknown) => x);
      expect(String((e as { cause?: unknown }).cause ?? e)).toMatch(
        /mission_published_at_is_derived/,
      );

      const [draft] = await ownerDb
        .insert(schema.missions)
        .values({ customerId: await missionOwner(ownerDb), publishedAt: new Date() })
        .returning();
      expect(draft!.publishedAt).toBeNull();
    });
  });

  it('filters by distance with ST_DWithin, and uses ST_Distance only to sort', () => {
    const query = missionBrowseQuery({
      filters: { withinKm: 10 },
      sort: 'closest',
      closure: [],
      actorUserId: randomUUID(),
      profileId: randomUUID(),
      cursor: null,
      limit: 25,
    });
    const text = JSON.stringify(query);
    expect(text).toMatch(/ST_DWithin\(m\.location, sa\.area/);
    expect(text).not.toMatch(/ST_Distance\([^)]*\)\s*[<>]/);
  });
});
