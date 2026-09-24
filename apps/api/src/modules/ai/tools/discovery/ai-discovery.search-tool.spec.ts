import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testPool } from '../../../../../test/db';
import {
  discoverable,
  eastOf,
  isolate,
  node,
  searcher,
  somewhere,
  type DiscoverableOptions,
  type TestDb,
} from '../../../../../test/search-fixtures';
import { asRequests, scopedDb } from '../../../../../test/workspace-context';
import { agency } from '../../../../../test/workspace-fixtures';
import { AuditService } from '../../../../common/audit/audit.service';
import { AuthzService } from '../../../../common/authz/authz.service';
import type { Actor } from '../../../../common/authz/contract';
import { runInContext } from '../../../../common/context/execution-context';
import { PlatformContext } from '../../../../common/context/platform-context';
import * as schema from '../../../../database/schema';
import { auditLogs, investigatorProfiles, taxonomyNodeLabels } from '../../../../database/schema';
import { MemoryRateLimitStore, RateLimitService } from '../../../auth/rate-limit.service';
import type { SearchInvestigatorsDto } from '../../../search/search.dto';
import { investigatorSearchQuery, SearchService } from '../../../search/search.service';
import { TaxonomyService } from '../../../taxonomy/taxonomy.service';
import { ToolRunner } from '../tool-runner';
import type { SearchInvestigatorsInput } from './discovery.schemas';
import { ListTaxonomyTool } from './list-taxonomy.tool';
import { CANDIDATE_POOL, SearchInvestigatorsTool } from './search-investigators.tool';

describe('assistant discovery tools (T-018)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: TestDb;
  let customer: Actor;
  let search: SearchService;
  let searchTool: SearchInvestigatorsTool;
  let listTool: ListTaxonomyTool;
  let runner: ToolRunner;
  /** This test's city: every investigator it makes works there, and every search filters on it. */
  let tag: string;

  const req = () => ({ correlationId: randomUUID(), ip: '198.51.100.7', userAgent: 'spec' });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    customer = await searcher(ownerDb);
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    search = new SearchService(db, authz);
    const taxonomy = new TaxonomyService(db, authz, new PlatformContext(audit), audit);
    searchTool = new SearchInvestigatorsTool(search, taxonomy);
    listTool = new ListTaxonomyTool(taxonomy);
    runner = new ToolRunner(authz, audit, new RateLimitService(new MemoryRateLimitStore()), [
      searchTool,
      listTool,
    ]);
    tag = isolate();
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const mine = async (
    opts: DiscoverableOptions & {
      headline?: string;
      bio?: string;
      contactPhone?: string;
      rate?: number;
    } = {},
  ) => {
    const { headline, bio, contactPhone, rate, ...rest } = opts;
    const found = await discoverable(ownerDb, { city: tag, ...rest });
    await ownerDb
      .update(investigatorProfiles)
      .set({
        headline: headline ?? null,
        bio: bio ?? null,
        contactPhone: contactPhone ?? null,
        ...(rate !== undefined ? { hourlyRateMinor: rate, currency: 'AMD' } : {}),
      })
      .where(eq(investigatorProfiles.id, found.profileId));
    return found;
  };

  const find = (args: Partial<SearchInvestigatorsInput>, r = req()) =>
    asRequests(runner, owner).invoke(
      customer,
      searchTool,
      { ...args, place: { city: tag, ...args.place } },
      r,
    );

  const ids = (out: { results: Array<{ investigatorId: string }> }) =>
    out.results.map((r) => r.investigatorId);

  const labelled = async (labels: Partial<Record<'en' | 'ru', string>>, parentId?: string) => {
    const id = await node(ownerDb, parentId === undefined ? {} : { parentId });
    for (const [locale, label] of Object.entries(labels)) {
      await ownerDb
        .insert(taxonomyNodeLabels)
        .values({ nodeId: id, locale: locale as 'en', label });
    }
    return id;
  };

  describe('eligibility: no path surfaces an investigator discovery would not list', () => {
    it.each([
      ['not verified', { verificationStatus: 'UNVERIFIED' as const }],
      ['awaiting verification', { verificationStatus: 'PENDING' as const }],
      ['verification rejected', { verificationStatus: 'REJECTED' as const }],
      ['a draft profile', { visibility: 'DRAFT' as const }],
      ['not accepting work', { acceptingWork: false }],
      ['a suspended account', { accountStatus: 'SUSPENDED' as const }],
      ['a soft-deleted account', { deleted: true }],
    ])('%s — however well the description fits the request', async (_label, excluded) => {
      const fits = 'Corporate fraud and due diligence investigations';
      await mine({ ...excluded, headline: fits, bio: fits, yearsExperience: 30 });
      const listed = await mine({ bio: 'Process serving', yearsExperience: 1 });

      for (const args of [{}, { relevanceHint: 'corporate fraud due diligence' }]) {
        expect(ids(await find(args))).toEqual([listed.profileId]);
      }
    });
  });

  describe('geography', () => {
    it('keeps who works within the distance, nearest first, and a hint does not overrule distance', async () => {
      const centre = somewhere();
      const near = await mine({ centre, radiusKm: 5 });
      const far = await mine({ centre: eastOf(centre, 30), radiusKm: 5, bio: 'fraud fraud fraud' });

      const wide = await find({
        near: { ...centre, radiusKm: 40 },
        relevanceHint: 'fraud',
      });
      expect(ids(wide)).toEqual([near.profileId, far.profileId]);
      expect(wide.orderedBy).toBe('distance');
      expect(wide.results.map((r) => r.distanceKm)).toEqual([0, expect.any(Number)]);
      expect(wide.results[1]!.distanceKm).toBeGreaterThanOrEqual(24);

      const tight = await find({ near: { ...centre, radiusKm: 10 } });
      expect(ids(tight)).toEqual([near.profileId]);
    });

    it('filters with ST_DWithin and sorts with ST_Distance — the statement the index serves', async () => {
      const spy = vi.spyOn(search, 'searchInvestigators');
      await find({ near: { lon: 44.5, lat: 40.2, radiusKm: 25 } });
      const dto = spy.mock.calls[0]![1] as SearchInvestigatorsDto;
      expect(dto).toMatchObject({
        near: { lon: 44.5, lat: 40.2 },
        radiusKm: 25,
        limit: CANDIDATE_POOL,
      });

      const text = new PgDialect().sqlToQuery(investigatorSearchQuery(dto, [], null, 5)).sql;
      const [, where, order] = text.split(/\bWHERE\b|\bORDER BY\b/);
      expect(where).toContain('ST_DWithin(sa.area');
      expect(where).not.toContain('ST_Distance');
      expect(text).toMatch(/min\(ST_Distance\(sa\.area, .*\)\) AS "sortKey"/);
      expect(order).toContain('"sortKey" ASC');
    });
  });

  describe('why each one matched — and what they do not offer', () => {
    it('reports only what was asked for and met, and names the requested specialty they lack', async () => {
      const dueDiligence = await labelled({ en: 'Due diligence', ru: 'Проверка контрагентов' });
      const surveillance = await labelled({ en: 'Surveillance' });
      const window = { dayOfWeek: 1, startMinute: 600, endMinute: 660 };
      const hours = [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }];
      const one = await mine({
        languages: ['hy', 'en'],
        specialtyNodeIds: [dueDiligence],
        availability: hours,
        yearsExperience: 10,
      });
      const both = await mine({
        languages: ['hy'],
        specialtyNodeIds: [dueDiligence, surveillance],
        availability: hours,
        yearsExperience: 5,
      });

      const out = await find({
        place: { countryCode: 'AM' },
        taxonomyNodeIds: [dueDiligence, surveillance],
        languages: ['hy'],
        availableDuring: window,
        locale: 'ru',
      });

      expect(ids(out)).toEqual([one.profileId, both.profileId]);
      expect(out.results[0]).toMatchObject({
        matchedOn: {
          taxonomy: [{ id: dueDiligence, label: 'Проверка контрагентов' }],
          // Only the language asked for, though they also work in English.
          languages: ['hy'],
          place: { countryCode: 'AM', city: tag },
          availability: window,
        },
        // In Russian where it has a Russian label, in English where it does not.
        notMatched: { taxonomy: [{ id: surveillance, label: 'Surveillance' }] },
      });
      expect(out.results[1]!.notMatched).toEqual({ taxonomy: [] });
      expect(out.results[1]!.matchedOn.taxonomy.map((t) => t.id).sort()).toEqual(
        [dueDiligence, surveillance].sort(),
      );
    });

    it('matches a parent asked for through a child declared, and says nothing it was not asked', async () => {
      const parent = await labelled({ en: 'Corporate' });
      const child = await node(ownerDb, { parentId: parent });
      await mine({ specialtyNodeIds: [child] });

      const out = await find({ taxonomyNodeIds: [parent] });
      expect(out.results[0]!.matchedOn).toEqual({
        // A node nobody has labelled yet has no name to give, and does not borrow one.
        taxonomy: [{ id: child, label: null }],
        languages: [],
        place: { city: tag },
        availability: null,
      });
      expect(out.results[0]!.specialties).toEqual([{ id: child, label: null }]);
    });
  });

  it('gives a public projection only: no price, no bio, no contact, no account, no coordinates', async () => {
    const centre = somewhere();
    await mine({
      centre,
      headline: 'Records research',
      bio: 'I also do phone hacking, ask me',
      contactPhone: '555-0142',
      rate: 150_000,
    });
    const out = await find({ near: { ...centre, radiusKm: 0 } });
    const [result] = out.results;
    expect(Object.keys(result!).sort()).toEqual(
      [
        'availability',
        'displayName',
        'distanceKm',
        'headline',
        'investigatorId',
        'languages',
        'matchedOn',
        'notMatched',
        'specialties',
        'verificationStatus',
        'yearsExperience',
      ].sort(),
    );
    const json = JSON.stringify(out);
    for (const leak of ['hacking', '555-0142', '150000', 'AMD', String(centre.lon), 'userId']) {
      expect(json).not.toContain(leak);
    }
    expect(result).toMatchObject({ headline: 'Records research', verificationStatus: 'VERIFIED' });
  });

  describe('relevance', () => {
    it('reorders the eligible set by fit — the same people, never more', async () => {
      const senior = await mine({ yearsExperience: 20, bio: 'Process serving' });
      const junior = await mine({ yearsExperience: 2, headline: 'Insurance fraud specialist' });

      const plain = await find({});
      expect([ids(plain), plain.orderedBy]).toEqual([
        [senior.profileId, junior.profileId],
        'experience',
      ]);

      const hinted = await find({ relevanceHint: 'insurance fraud' });
      expect([ids(hinted), hinted.orderedBy]).toEqual([
        [junior.profileId, senior.profileId],
        'relevance',
      ]);

      // A hint that fits nobody better changes nothing, and says so.
      const idle = await find({ relevanceHint: 'maritime' });
      expect([ids(idle), idle.orderedBy]).toEqual([ids(plain), 'experience']);
    });
  });

  it('shows a bounded number and says when there are more', async () => {
    for (const years of [3, 2, 1]) await mine({ yearsExperience: years });
    const two = await find({ limit: 2 });
    expect([two.results.length, two.hasMore]).toEqual([2, true]);
    const all = await find({});
    expect([all.results.length, all.hasMore]).toEqual([3, false]);
  });

  it('audits which filters were used, never their values', async () => {
    const r = req();
    await find({ near: { lon: 44.51, lat: 40.18, radiusKm: 5 }, relevanceHint: 'zebrafish' }, r);
    const rows = await ownerDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.correlationId, r.correlationId));
    expect(rows.map((row) => [row.action, row.reason])).toEqual([
      ['ai.tool.search_investigators', 'ok: filters=city,near,relevanceHint'],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`${tag}|44\\.51|zebrafish`));
    expect(searchTool.auditArguments({})).toBe('filters=none');
    expect(
      searchTool.auditArguments({
        place: { countryCode: 'AM', region: 'Shirak' },
        taxonomyNodeIds: ['a', 'b'],
        languages: ['hy'],
        availableDuring: { dayOfWeek: 0, startMinute: 0, endMinute: 60 },
      }),
    ).toBe('filters=countryCode,region,taxonomy(2),languages(1),availability');
  });

  it('answers the same from an agency workspace: the workspace is the caller’s, and public profiles are public', async () => {
    const listed = await mine();
    const { tenantId, memberships } = await agency(owner, [{ userId: customer.userId }]);
    const out = await runInContext(
      {
        tenantId,
        tenantKind: 'AGENCY',
        userId: customer.userId,
        membershipId: memberships[0]!,
        sessionId: randomUUID(),
        permissions: [],
      },
      () => runner.invoke(customer, searchTool, { place: { city: tag } }, req()),
    );
    expect(ids(out)).toEqual([listed.profileId]);
  });

  it('lists the taxonomy flat, with parents, labelled in the language asked for', async () => {
    const parent = await labelled({ en: 'Family', ru: 'Семья' });
    const child = await labelled({ en: 'Missing persons' }, parent);
    const out = await asRequests(runner, owner).invoke(customer, listTool, { locale: 'ru' }, req());
    expect(out.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parent, parentId: null, label: 'Семья' }),
        expect.objectContaining({ id: child, parentId: parent, label: 'Missing persons' }),
      ]),
    );
    expect(listTool.auditArguments({})).toBe('locale=en');
  });
});
