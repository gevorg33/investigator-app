import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test/db';
import { TABLE_CLASSES } from './table-classes';

/**
 * The registry against the applied schema (T-076). A table the registry does not know is a table
 * row-level security (T-077) would not protect — so it fails here, before it can ship.
 */
describe('the table classification registry', () => {
  let owner: postgres.Sql;

  beforeAll(() => {
    owner = testPool({ max: 1, role: 'owner' });
  });

  afterAll(async () => {
    await owner.end();
  });

  const tables = async () =>
    (
      await owner<{ name: string }[]>`
        SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`
    ).map((r) => r.name);

  it('classifies every table in the database', async () => {
    const unclassified = (await tables()).filter((t) => TABLE_CLASSES[t] === undefined);
    expect(unclassified).toEqual([]);
  });

  it('names no table that does not exist', async () => {
    const present = new Set(await tables());
    expect(Object.keys(TABLE_CLASSES).filter((t) => !present.has(t))).toEqual([]);
  });

  it('gives every workspace-scoped table the columns its class requires, NOT NULL but for declared exceptions', async () => {
    const problems: string[] = [];
    for (const [table, spec] of Object.entries(TABLE_CLASSES)) {
      if (spec.class !== 'tenant_owned' && spec.class !== 'two_party') continue;
      const required =
        spec.class === 'tenant_owned'
          ? ['tenant_id']
          : ['customer_tenant_id', ...(spec.columns ?? [])];
      for (const column of new Set([...required, ...(spec.columns ?? [])])) {
        const [col] = await owner<{ nullable: string; default: string | null }[]>`
          SELECT is_nullable AS nullable, column_default AS default FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`;
        if (col === undefined) {
          problems.push(`${table}.${column} missing`);
          continue;
        }
        const allowedNull = spec.nullable?.[column] !== undefined;
        if ((col.nullable === 'YES') !== allowedNull) {
          problems.push(
            `${table}.${column} nullable=${col.nullable}, expected ${allowedNull ? 'YES' : 'NO'}`,
          );
        }
        if (col.default !== 'app_current_tenant()')
          problems.push(`${table}.${column} default ${col.default}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('refuses to move any row of a workspace-scoped table to another workspace', async () => {
    const guarded = new Set(
      (
        await owner<{ name: string }[]>`
          SELECT c.relname AS name FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
           WHERE g.tgname LIKE '%\\_tenant\\_immutable'`
      ).map((r) => r.name),
    );
    const scoped = Object.entries(TABLE_CLASSES)
      .filter(([, s]) => s.class === 'tenant_owned' || s.class === 'two_party')
      .map(([t]) => t);
    expect(scoped.filter((t) => !guarded.has(t))).toEqual([]);
  });

  it('leads an index with the workspace column wherever policies will filter on it', async () => {
    // Every row-level policy adds a predicate on these columns; T-077 needs them indexed. The owner
    // tables and the two-party parents are checked; children are reached through their parent key.
    const needed = [
      ['customer_profiles', 'tenant_id'],
      ['investigator_profiles', 'tenant_id'],
      ['media_assets', 'tenant_id'],
      ['service_areas', 'tenant_id'],
      ['missions', 'customer_tenant_id'],
      ['quotes', 'customer_tenant_id'],
      ['quotes', 'supplier_tenant_id'],
      ['assignments', 'customer_tenant_id'],
      ['assignments', 'supplier_tenant_id'],
      ['idempotency_keys', 'tenant_id'],
    ];
    const missing: string[] = [];
    for (const [table, column] of needed) {
      const [row] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_index i
          JOIN pg_class c ON c.oid = i.indrelid
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
         WHERE c.relname = ${table!} AND a.attname = ${column!}`;
      if (row!.n === 0) missing.push(`${table}.${column}`);
    }
    expect(missing).toEqual([]);
  });
});
