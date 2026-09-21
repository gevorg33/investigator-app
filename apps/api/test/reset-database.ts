import type postgres from 'postgres';
import type { TestDatabaseInfo } from './global-setup';

/**
 * Empties a worker's database and puts back what a migration seeded (T-042).
 *
 * Every table goes, including the seeded ones, and they are then restored — because
 * `roles.tenant_id` references `tenants`, so truncating tenants cascades into roles whether
 * or not any role points at a tenant. Restoring is three small inserts; excluding roles from
 * the truncation would silently leave a test's tenant-scoped roles behind.
 *
 * Runs as the owner. The runtime role cannot truncate, and should not be able to.
 */
let resets = 0;

/**
 * How many times this worker has emptied the database since the file was loaded.
 *
 * Asserted by `reset-database.spec.ts`, because "the database starts empty" can be true by
 * luck — if whatever ran before happened to write nothing, a suite with the reset hook removed
 * would still pass. This cannot be true by luck (T-042).
 */
export const timesReset = (): number => resets;

export async function resetDatabase(owner: postgres.Sql, info: TestDatabaseInfo): Promise<void> {
  resets++;
  // One statement: TRUNCATE takes an ACCESS EXCLUSIVE lock on each table, and taking them
  // all at once in a fixed order is what stops two of these deadlocking against each other.
  const list = info.truncate.map((t) => `"${t}"`).join(', ');
  await owner.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  for (const { table, rows } of info.reference) {
    if (rows.length === 0) continue;
    await owner`INSERT INTO ${owner(table)} ${owner(rows as never[])}`;
  }
}
