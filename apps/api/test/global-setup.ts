import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { MAX_WORKERS } from './db-budget';
import {
  DEFAULT_OWNER_URL,
  HARNESS_DATABASE,
  maintenanceUrl,
  templateDatabase,
  withDatabase,
  workerDatabase,
} from './worker-database';

/** A table's rows as `to_jsonb` renders them — no Date objects to survive serialization. */
export interface ReferenceTable {
  table: string;
  rows: Record<string, unknown>[];
}

/** What global setup hands every worker, so no worker has to query the catalog itself. */
export interface TestDatabaseInfo {
  /** Every base table in `public`, to be emptied between spec files. */
  truncate: string[];
  /** What a migration seeded, in an order that satisfies the foreign keys between them. */
  reference: ReferenceTable[];
}

declare module 'vitest' {
  interface ProvidedContext {
    testDatabase: TestDatabaseInfo;
  }
}

const EXTENSIONS_SQL = join(
  __dirname,
  '../../../infrastructure/docker/postgres/init/01-extensions.sql',
);
const MIGRATIONS = join(__dirname, '../src/database/migrations');

/**
 * Provisions one database per worker, before any worker starts (T-042).
 *
 * A template is migrated once and cloned; each worker's copy is then migrated again, which
 * is a single catalogue read when it is already current and applies the difference when it
 * is not. The databases are kept between runs — building them is the slow part, and emptying
 * them is the fast part, which is what happens between spec files.
 *
 * Nothing here drops anything. A run that wanted a database rebuilt from nothing can delete
 * it by hand; the harness treats every database it did not name itself as someone's.
 */
export default async function setup(project: {
  provide: <K extends 'testDatabase'>(key: K, value: TestDatabaseInfo) => void;
}): Promise<void> {
  const base = process.env['MIGRATION_DATABASE_URL'] ?? DEFAULT_OWNER_URL;
  const admin = postgres(maintenanceUrl(base), { max: 1, onnotice: () => {} });

  try {
    const template = templateDatabase(base);
    await ensureDatabase(admin, template);
    const info = await prepare(withDatabase(base, template), { capture: true });

    for (let slot = 1; slot <= MAX_WORKERS; slot++) {
      const name = workerDatabase(base, slot);
      // Cloning needs no session on the template, which is why `prepare` closed its pool.
      await ensureDatabase(admin, name, template);
      await prepare(withDatabase(base, name), { capture: false });
    }
    project.provide('testDatabase', info!);
  } finally {
    await admin.end();
  }
}

/** Creates `name` if it is absent, optionally as a copy of `template`. */
async function ensureDatabase(admin: postgres.Sql, name: string, template?: string): Promise<void> {
  for (const n of template === undefined ? [name] : [name, template]) {
    // The names come from `worker-database.ts`, but this is the statement that cannot be
    // parameterised, so it checks rather than trusts.
    if (!HARNESS_DATABASE.test(n)) throw new Error(`refusing to create ${n}: not a harness name`);
  }
  const [existing] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (existing !== undefined) return;

  const from = template === undefined ? '' : ` TEMPLATE "${template}"`;
  await admin.unsafe(`CREATE DATABASE "${name}"${from}`);
}

/**
 * Brings one database up to date: extensions, then migrations. Extensions are created here
 * rather than by a migration for the reason `01-extensions.sql` gives — they need a
 * superuser, and the runtime role must not be one — and the file itself is read rather than
 * copied, so a new extension is added in one place.
 */
async function prepare(
  url: string,
  opts: { capture: boolean },
): Promise<TestDatabaseInfo | undefined> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync(EXTENSIONS_SQL, 'utf8'));
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
    return opts.capture ? await capture(sql) : undefined;
  } finally {
    await sql.end();
  }
}

/**
 * Reads, from the pristine template, what a reset has to restore.
 *
 * "Reference data" is not a list held here: it is whatever a migration put in a table, found
 * by looking. Migration 0011 seeds roles, permissions and role_permissions today; when a
 * later migration seeds a taxonomy, this picks it up without being told.
 */
async function capture(sql: postgres.Sql): Promise<TestDatabaseInfo> {
  const tables = await sql<{ name: string }[]>`
    SELECT c.relname AS name
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind = 'r'
       AND c.relname <> 'spatial_ref_sys'`;
  const truncate = tables.map((t) => t.name).sort();

  const seeded: string[] = [];
  for (const name of truncate) {
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(name)}`;
    if ((row?.n ?? 0) > 0) seeded.push(name);
  }

  const reference: ReferenceTable[] = [];
  for (const table of await inInsertionOrder(sql, seeded)) {
    // to_jsonb, not the row: the value crosses into worker processes, and JSON has no Date.
    const rows = await sql<{ row: Record<string, unknown> }[]>`
      SELECT to_jsonb(t) AS row FROM ${sql(table)} t`;
    reference.push({ table, rows: rows.map((r) => r.row) });
  }
  return { truncate, reference };
}

/** Sorts seeded tables so that a row is inserted after anything it references. */
async function inInsertionOrder(sql: postgres.Sql, tables: string[]): Promise<string[]> {
  if (tables.length === 0) return [];
  const edges = await sql<{ child: string; parent: string }[]>`
    SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.conrelid::regclass::text = ANY(${tables})
       AND c.confrelid::regclass::text = ANY(${tables})
       AND c.conrelid <> c.confrelid`;

  const ordered: string[] = [];
  const placed = new Set<string>();
  // Kahn's algorithm, minus the cycle case: a cycle here would mean seed rows that cannot be
  // inserted in any order, which the migration that wrote them could not have done either.
  while (ordered.length < tables.length) {
    const next = tables.filter(
      (t) => !placed.has(t) && edges.every((e) => e.child !== t || placed.has(e.parent)),
    );
    if (next.length === 0) throw new Error('seeded tables reference each other in a cycle');
    for (const t of next) {
      ordered.push(t);
      placed.add(t);
    }
  }
  return ordered;
}
