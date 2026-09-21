import { randomUUID } from 'node:crypto';
import { sql as dsql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coverageQuery } from './service-areas.service';
import { testPool } from '../../../test/db';

/**
 * The query plan, on a seeded dataset, for the query production actually runs.
 *
 * Seeded for real and left committed (T-042). It used to be rolled back, because every suite
 * shared one database and thousands of rows would have reached all of them; each worker now has
 * its own, emptied before the next spec file, so there is nothing to protect.
 *
 * That matters here more than anywhere: the seeding transaction ran ANALYZE on rows no other
 * transaction could see, so an autoanalyze firing in between — which the load of a full suite
 * makes likely and running this file alone does not — would overwrite the statistics with those
 * of an empty table and the planner would choose differently. The suite failed about one run in
 * three that way, and never in isolation.
 */
describe('coverage query plan', () => {
  let sql: postgres.Sql;
  let productionPlan = '';
  let distanceFilterPlan = '';
  let analysed: { relname: string; reltuples: number }[] = [];

  beforeAll(async () => {
    sql = testPool({ max: 1 });
    const run = randomUUID();
    await sql.begin(async (tx) => {
      // Seeding is a fixture, and fixtures are not a workspace's work: it runs with platform
      // access so each profile lands in its own owner's Personal workspace (T-077). The plans
      // below are then taken as a request takes them — in a workspace, with the policies on.
      await tx`SELECT set_config('app.platform_access', 'on', true)`;

      // Three statements, not one (T-076): a row's workspace is derived from rows inserted before
      // it — the user's Personal workspace, the profile's workspace — and a single statement
      // cannot see what it has itself inserted.
      await tx`
          INSERT INTO users (email)
            SELECT 'plan-' || g || '-' || ${run} || '@example.test' FROM generate_series(1, 1000) g`;
      await tx`
          INSERT INTO investigator_profiles (user_id, visibility, accepting_work)
          SELECT id, 'PUBLISHED', true FROM users WHERE email LIKE 'plan-%-' || ${run} || '@example.test'`;
      await tx`
          WITH seeded_profiles AS (
            SELECT p.id FROM investigator_profiles p JOIN users u ON u.id = p.user_id
             WHERE u.email LIKE 'plan-%-' || ${run} || '@example.test'
          )
          INSERT INTO service_areas (profile_id, kind, label, centre, radius_m, area)
          SELECT id, 'RADIUS', 'seed',
                 ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, 5000,
                 ST_Buffer(ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, 5000)
          FROM (
            -- Spread deterministically, not randomly (T-042). Random coordinates made the
            -- geographic predicate's selectivity differ from run to run, and with it the plan
            -- the planner chose: this suite failed roughly one run in three once each worker
            -- got a database of its own and stopped inheriting thousands of rows from earlier
            -- ones. Two coprime multipliers over the series give the same global spread with
            -- the same statistics every time.
            SELECT p.id,
                   round(-150 + ((n * 97 + s * 13) % 3000)::numeric / 10, 2)::float8 AS lon,
                   round(-60 + ((n * 31 + s * 7) % 1200)::numeric / 10, 2)::float8 AS lat
            FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM seeded_profiles) p,
                 generate_series(1, 5) s
          ) seeded`;
    });

    // As the OWNER, and this is the whole suite (T-042). ANALYZE run by a role that does not
    // own the table is skipped with a warning rather than refused, and `testPool` silences
    // notices — so these two statements had never once collected a statistic. The suite passed
    // anyway while every worker shared the development database, because autovacuum had long
    // since analysed it with thousands of rows in it. Given a database of its own, the planner
    // was left with `reltuples = -1` and chose a different plan whenever the guess went the
    // other way: one run in three, and never in isolation.
    //
    // The rows are committed by now, so an autovacuum worker reaching the table concurrently
    // arrives at the same statistics rather than an empty table's.
    const owner = testPool({ role: 'owner', max: 1 });
    await owner`ANALYZE service_areas`;
    await owner`ANALYZE investigator_profiles`;
    analysed = await owner<{ relname: string; reltuples: number }[]>`
      SELECT relname, reltuples FROM pg_class
       WHERE relname IN ('service_areas', 'investigator_profiles')`;
    await owner.end();

    await sql.begin(async (tx) => {
      // A searcher's workspace: every plan below carries the policy predicates production has.
      await tx`SELECT set_config('app.platform_access', '', true)`;
      const [searcher] = await tx`
          INSERT INTO users (email) VALUES (${`plan-searcher-${run}@example.test`}) RETURNING id`;
      await tx`SELECT set_config('app.user_id', ${searcher!['id'] as string}, true)`;
      const [workspace] = await tx`
          SELECT id FROM tenants WHERE personal_owner_id = ${searcher!['id'] as string}`;
      await tx`SELECT set_config('app.tenant_id', ${workspace!['id'] as string}, true)`;

      // A transaction handle is not a full drizzle client, so the query production builds is
      // compiled to text and parameters and explained directly. Same SQL, same parameters.
      const dialect = new PgDialect();
      const at = { lon: 44.52, lat: 40.19 };
      const explain = async (q: SQL) => {
        const { sql: text, params } = dialect.sqlToQuery(q);
        return JSON.stringify(await tx.unsafe(`EXPLAIN (FORMAT JSON) ${text}`, params as never[]));
      };

      productionPlan = await explain(coverageQuery(at, 10_000, 50));

      // The classic mistake, for contrast: distance in the WHERE clause. Sequential scans are
      // disabled so the planner would take the index if it could — it cannot.
      await tx`SET LOCAL enable_seqscan = off`;
      distanceFilterPlan = await explain(dsql`
          SELECT sa.profile_id FROM service_areas sa
          WHERE ST_Distance(sa.area, ST_SetSRID(ST_MakePoint(${at.lon}, ${at.lat}), 4326)::geography) <= 10000`);
    });
  }, 120_000);

  afterAll(async () => {
    await sql.end();
  });

  it('uses the GIST index for the coverage filter', () => {
    expect(productionPlan).toContain('service_areas_area_gist');
  });

  it('cannot use the index when distance is the filter — why ST_Distance only sorts', () => {
    expect(distanceFilterPlan).not.toContain('service_areas_area_gist');
  });

  it('was taken with statistics the planner could actually use', () => {
    // `reltuples = -1` means never analysed. It is what these tables looked like for the whole
    // of this suite's life, and a plan chosen without statistics says nothing about production.
    expect(analysed).toHaveLength(2);
    for (const t of analysed) expect(t.reltuples, t.relname).toBeGreaterThan(0);
  });

  it('was taken over a dataset large enough to mean something', async () => {
    // A plan over an empty table proves nothing: the planner would reach for a sequential scan
    // and be right to. This is what makes the two assertions above statements about the query.
    //
    // Counted with platform access, because the rows are spread across a thousand Personal
    // workspaces and this connection is in none of them (T-077) — the same reason the seeding
    // needed it.
    const [row] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.platform_access', 'on', true)`;
      return tx`SELECT count(*)::int AS n FROM service_areas`;
    });
    expect(row?.['n']).toBeGreaterThan(1000);
  });
});
