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
 * Seeded inside a transaction that is always rolled back, so thousands of rows never reach
 * other suites or the development database.
 */
describe('coverage query plan', () => {
  let sql: postgres.Sql;
  let productionPlan = '';
  let distanceFilterPlan = '';

  beforeAll(async () => {
    sql = testPool({ max: 1 });
    const run = randomUUID();
    const rollback = new Error('rollback');
    await sql
      .begin(async (tx) => {
        await tx`
          WITH u AS (
            INSERT INTO users (email)
            SELECT 'plan-' || g || '-' || ${run} || '@example.test' FROM generate_series(1, 1000) g
            RETURNING id
          ), p AS (
            INSERT INTO investigator_profiles (user_id, visibility, accepting_work)
            SELECT id, 'PUBLISHED', true FROM u RETURNING id
          )
          INSERT INTO service_areas (profile_id, kind, label, centre, radius_m, area)
          SELECT id, 'RADIUS', 'seed',
                 ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, 5000,
                 ST_Buffer(ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, 5000)
          FROM (
            SELECT p.id,
                   round((random() * 300 - 150)::numeric, 2)::float8 AS lon,
                   round((random() * 120 - 60)::numeric, 2)::float8 AS lat
            FROM p, generate_series(1, 5)
          ) seeded`;
        await tx`ANALYZE service_areas`;
        await tx`ANALYZE investigator_profiles`;

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
        throw rollback;
      })
      .catch((e: unknown) => {
        if (e !== rollback) throw e;
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

  it('left none of the seeded rows behind', async () => {
    const [row] = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE 'plan-%'`;
    expect(row?.['n']).toBe(0);
  });
});
