import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test/db';
import { TABLE_CLASSES, type TableClass } from './table-classes';

/**
 * What row-level security is turned on for, and what it is deliberately not (T-077).
 *
 * The registry decides: a class that must be protected is protected on every table in it, and a
 * class that is not yet protected says why and names the task that will. A table cannot slip
 * between the two — `table-classes.spec.ts` already fails on a table missing from the registry,
 * and this fails on a table whose database state does not match its class.
 */
const PROTECTED: readonly TableClass[] = ['tenancy', 'tenant_owned', 'two_party'];

/** Not protected by policies, and why. Each entry is a decision with an owner, not an oversight. */
const UNPROTECTED: Readonly<Record<TableClass, string>> = {
  identity: 'read before any workspace exists; whether they get user-keyed policies is T-098',
  platform: 'the same rows for every workspace; the app holds SELECT and nothing else',
  system: 'outbox_events has no workspace column until T-082',
  platform_record: 'audit_logs has no workspace column until T-080',
  postgis: 'owned by PostGIS, never written by the application',
  tenancy: '',
  tenant_owned: '',
  two_party: '',
};

describe('row-level security', () => {
  let owner: postgres.Sql;

  beforeAll(() => {
    owner = testPool({ max: 1, role: 'owner' });
  });

  afterAll(async () => {
    await owner.end();
  });

  const state = async () =>
    new Map(
      (
        await owner<{ name: string; enabled: boolean; forced: boolean; policies: number }[]>`
          SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
                 (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'`
      ).map((r) => [r.name, r]),
    );

  it('is enabled and FORCEd on every table whose class must be protected', async () => {
    const applied = await state();
    const problems: string[] = [];
    for (const [table, spec] of Object.entries(TABLE_CLASSES)) {
      const row = applied.get(table);
      if (row === undefined) continue;
      const mustBe = PROTECTED.includes(spec.class);
      if (row.enabled !== mustBe || row.forced !== mustBe) {
        problems.push(`${table}: enabled=${row.enabled} forced=${row.forced}, expected ${mustBe}`);
      }
      if (mustBe && row.policies === 0) problems.push(`${table}: no policy`);
      if (!mustBe && row.policies > 0)
        problems.push(`${table}: ${row.policies} unexpected policies`);
    }
    expect(problems).toEqual([]);
  });

  it('leaves a class unprotected only where the registry says why', () => {
    // Reading it the other way round: every class is either protected or has a reason recorded.
    const classes = new Set(Object.values(TABLE_CLASSES).map((s) => s.class));
    const unexplained = [...classes].filter(
      (c) => !PROTECTED.includes(c) && UNPROTECTED[c].length === 0,
    );
    expect(unexplained).toEqual([]);
  });

  it('gives the application no way to write the tables every workspace reads', async () => {
    const writable = await owner<{ table: string; privilege: string }[]>`
      SELECT table_name AS table, privilege_type AS privilege
        FROM information_schema.role_table_grants
       WHERE grantee = 'investigator_app' AND table_schema = 'public'
         AND table_name IN ('taxonomy_nodes', 'permissions', 'roles', 'role_permissions')
         AND privilege_type <> 'SELECT'`;
    expect(writable).toEqual([]);
  });

  it('reads the context through NULLIF, so no context matches nothing', async () => {
    const [row] = await owner<{ tenant: string | null; user: string | null; platform: boolean }[]>`
      SELECT app_current_tenant() AS tenant, app_current_user() AS user,
             app_platform_access() AS platform`;
    expect(row).toEqual({ tenant: null, user: null, platform: false });
  });

  it('treats a setting left behind on a pooled connection as no context', async () => {
    // After a transaction ends, a transaction-local setting reads back as '' rather than being
    // unset. That is why the functions use NULLIF: '' must mean "no workspace", not an error.
    await owner.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', '', true), set_config('app.user_id', '', true)`;
      const [row] = await tx<{ tenant: string | null; user: string | null }[]>`
        SELECT app_current_tenant() AS tenant, app_current_user() AS user`;
      expect(row).toEqual({ tenant: null, user: null });
    });
  });

  it('keeps discovery’s GIST index usable by marking the PostGIS predicates leakproof', async () => {
    // Without this the security quals must be evaluated first and ST_DWithin can no longer be an
    // index condition: measured at 392 ms instead of 3 ms on 10,000 published profiles (T-077).
    // A database where the migration could not do it — not superuser — fails here rather than
    // serving discovery 80× slower in silence.
    const marked = await owner<{ name: string }[]>`
      SELECT oid::regprocedure::text AS name FROM pg_proc
       WHERE proname IN ('st_dwithin', '_st_dwithin', 'geography_overlaps', 'overlaps_geog')
         AND proleakproof`;
    // Sorted here rather than in SQL: the database's collation orders the leading underscore
    // differently from one server to the next, and the set is what matters.
    expect(marked.map((r) => r.name).sort()).toEqual([
      '_st_dwithin(geography,geography,double precision,boolean)',
      'geography_overlaps(geography,geography)',
      'overlaps_geog(geography,gidx)',
      'st_dwithin(geography,geography,double precision,boolean)',
    ]);
  });

  it('raises platform access in exactly two database functions, both integrity checks', async () => {
    // A tenancy invariant must hold whoever is writing, so the two constraint triggers read with
    // platform access — a SET clause on the function, restored when it returns. Nothing else in
    // the database may do that; in the application, only PlatformContext can (tenant-plumbing).
    const elevated = await owner<{ name: string }[]>`
      SELECT proname AS name FROM pg_proc
       WHERE proconfig::text LIKE '%app.platform_access%'`;
    expect(elevated.map((r) => r.name).sort()).toEqual([
      'assert_personal_member_is_owner',
      'assert_tenant_has_owner',
    ]);
  });

  it('holds the tenancy invariant even for a writer who cannot see the workspace', async () => {
    // The check returns early when it cannot see the tenant row. Under the writer's own
    // visibility that would be a check that skips itself — the one failure mode that matters.
    const [row] = await owner<{ src: string }[]>`
      SELECT prosrc AS src FROM pg_proc WHERE proname = 'assert_tenant_has_owner'`;
    expect(row!.src).toContain('FOR UPDATE');
  });

  it('has no role that bypasses policies without being a superuser', async () => {
    // A BYPASSRLS role is the one thing that would undo every policy at once, quietly, for
    // whoever holds it. A superuser bypasses inherently — that is what a superuser is, and the
    // runtime role refuses to be one (T-073). Anything else with the flag is a bypass built on
    // purpose, and there is no such role.
    const bypassers = await owner<{ name: string }[]>`
      SELECT rolname AS name FROM pg_roles WHERE rolbypassrls AND NOT rolsuper ORDER BY 1`;
    expect(bypassers).toEqual([]);
  });

  it('runs the application as a role that is neither a superuser nor a bypasser', async () => {
    const [row] = await owner<{ superuser: boolean; bypass: boolean }[]>`
      SELECT rolsuper AS superuser, rolbypassrls AS bypass
        FROM pg_roles WHERE rolname = 'investigator_app'`;
    expect(row).toEqual({ superuser: false, bypass: false });
  });
});
