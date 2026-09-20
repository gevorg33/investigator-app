import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { TENANT_PERMISSIONS } from './permissions';

/**
 * The names code may ask for against the catalog the database actually holds (T-078).
 *
 * The catalog is data, seeded from `docs/architecture/tenancy.md` §3 and checked against that
 * document by `tenants.spec.ts`. This closes the last gap: a permission renamed in the seed but
 * not here would leave a service asking for something no role can hold — a check that always
 * refuses, which is the hardest kind of bug to see, because refusing looks like working.
 */
describe('the permission names code can ask for', () => {
  let owner: postgres.Sql;

  beforeAll(() => {
    owner = testPool({ max: 1, role: 'owner' });
  });

  afterAll(async () => {
    await owner.end();
  });

  it('is exactly the seeded catalog', async () => {
    const seeded = await owner<{ key: string }[]>`SELECT key FROM permissions ORDER BY 1`;
    expect([...TENANT_PERMISSIONS]).toEqual(seeded.map((r) => r.key));
  });

  it('names every permission once', () => {
    expect(new Set(TENANT_PERMISSIONS).size).toBe(TENANT_PERMISSIONS.length);
  });
});
