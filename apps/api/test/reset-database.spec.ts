import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { testPool } from './db';
import { resetDatabase, timesReset } from './reset-database';

/**
 * What a spec file is entitled to assume when it starts (T-042).
 *
 * This is the guarantee the whole isolation story rests on, so it is asserted rather than
 * described: the database a spec file inherits holds no rows any other spec file wrote, and
 * still holds everything a migration seeded.
 */
describe('the database a spec file starts from', () => {
  const owner = testPool({ role: 'owner', max: 1 });
  const info = inject('testDatabase');

  afterAll(async () => {
    await owner.end();
  });

  it('was emptied before this file ran, not merely found empty', () => {
    // Separate from the assertion below because that one can be true by accident: if the file
    // that ran before this one happened to write nothing, a worker with the reset hook removed
    // would look identical. This says the hook ran.
    expect(timesReset()).toBeGreaterThan(0);
  });

  it('starts empty of anything a test could have written', async () => {
    const [row] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
    // Every other spec file in this worker ran before or after, and created users freely.
    expect(row?.n).toBe(0);
  });

  it('keeps what a migration seeded, which a test may not create', async () => {
    const [row] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM roles WHERE tenant_id IS NULL`;
    expect(row?.n).toBeGreaterThan(0);
  });

  it('removes rows written since, and puts the seeded ones back', async () => {
    const before = await owner<{ id: string; key: string }[]>`SELECT id, key FROM roles`;
    await owner`
      INSERT INTO users (email, status) VALUES (${`reset-${randomUUID()}@example.test`}, 'ACTIVE')`;

    await resetDatabase(owner, info);

    const [users] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
    expect(users?.n).toBe(0);
    // Identical rows, not merely the same number: `roles.tenant_id` references `tenants`, so
    // truncating tenants cascades into roles, and the restore has to be exact or every
    // membership in the next spec file would point at a role id that no longer exists.
    const after = await owner<{ id: string; key: string }[]>`SELECT id, key FROM roles`;
    expect([...after].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...before].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('empties every table in the database, not a list written down somewhere', async () => {
    const tables = await owner<{ name: string }[]>`
      SELECT c.relname AS name
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relkind = 'r'
         AND c.relname <> 'spatial_ref_sys'`;
    // A table added by a migration and forgotten here would carry rows between spec files.
    expect([...info.truncate].sort()).toEqual(tables.map((t) => t.name).sort());
  });

  it('restores a referenced table before the one that references it', async () => {
    const order = info.reference.map((r) => r.table);
    expect(order).toContain('roles');
    expect(order.indexOf('roles')).toBeLessThan(order.indexOf('role_permissions'));
  });
});

describe('what global setup found to restore', () => {
  let seeded: string[] = [];
  const owner = testPool({ role: 'owner', max: 1 });

  beforeAll(async () => {
    const rows = await owner<{ name: string }[]>`
      SELECT c.relname AS name FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`;
    const counted = await Promise.all(
      rows.map(async (r) => {
        const [n] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM ${owner(r.name)}`;
        return { name: r.name, n: n?.n ?? 0 };
      }),
    );
    seeded = counted.filter((c) => c.n > 0 && c.name !== 'spatial_ref_sys').map((c) => c.name);
  });

  afterAll(async () => {
    await owner.end();
  });

  it('is exactly the set of tables a migration left rows in', () => {
    // Found by looking, not by a list: a migration that seeds a taxonomy is picked up without
    // anyone remembering to add it here.
    expect(info().sort()).toEqual(seeded.sort());
  });

  const info = () => inject('testDatabase').reference.map((r) => r.table);
});
