import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { investigatorSearchQuery, SearchService } from './search.service';

const actor = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const req = { correlationId: 'c' };
const compile = (q: ReturnType<typeof investigatorSearchQuery>) => new PgDialect().sqlToQuery(q);

/**
 * The shapes of the query that a database test cannot pin down, and the one path that needs two
 * queries to disagree with each other.
 */
describe('the query the builder produces', () => {
  it('defaults the radius to zero when a location is given without one', () => {
    // `near` with no `radiusKm` means "covers this point", and the distance still has to be a
    // real number — a missing radius must not reach PostGIS as null.
    const { sql, params } = compile(
      investigatorSearchQuery({ near: { lon: 44.52, lat: 40.19 } }, [], null, 25),
    );
    expect(sql).toContain('ST_DWithin');
    expect(params).toContain(0);
  });

  it('pages a search that has no distance to page by', () => {
    // A cursor from a search with no location carries a null distance. The keyset comparison
    // still needs a number on both sides, or the HAVING clause silently matches nothing.
    const { sql, params } = compile(
      investigatorSearchQuery({}, [], { distanceM: null, profileId: randomUUID() }, 25),
    );
    expect(sql).toContain('HAVING');
    expect(params).toContain(0);
  });

  it('joins service areas only when something asks about place', () => {
    expect(compile(investigatorSearchQuery({}, [], null, 25)).sql).not.toContain('service_areas');
    expect(compile(investigatorSearchQuery({ city: 'Yerevan' }, [], null, 25)).sql).toContain(
      'service_areas',
    );
  });

  it('always filters on every eligibility condition, whatever the filters are', () => {
    // The one property worth asserting about the SQL itself: these five cannot be filtered away.
    for (const dto of [{}, { city: 'Yerevan' }, { near: { lon: 0, lat: 0 }, radiusKm: 50 }]) {
      const { sql } = compile(investigatorSearchQuery(dto, [], null, 25));
      expect(sql).toContain("ip.visibility = 'PUBLISHED'");
      expect(sql).toContain("ip.verification_status = 'VERIFIED'");
      expect(sql).toContain('ip.accepting_work = true');
      expect(sql).toContain("u.status = 'ACTIVE'");
      expect(sql).toContain('u.deleted_at IS NULL');
    }
  });
});

describe('a row that disappears mid-request', () => {
  it('is dropped rather than half-rendered', async () => {
    // The search and the projection are two queries, not one transaction. A profile deleted
    // between them must not produce a result with no profile behind it.
    const db = {
      execute: async () => [{ profileId: randomUUID(), sortKey: 0, distanceM: null }],
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: async () => [] }),
          where: async () => [],
        }),
      }),
    };
    const authz = { requireActive: vi.fn().mockResolvedValue(undefined) };
    const service = new SearchService(db as never, authz as never);

    const page = await service.searchInvestigators(actor, {}, req);
    expect(page.items).toEqual([]);
    expect(page.pageInfo).toEqual({ nextCursor: null, hasNextPage: false });
  });
});
