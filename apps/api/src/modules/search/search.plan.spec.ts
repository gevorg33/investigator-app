import { randomUUID } from 'node:crypto';
import { sql as dsql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { investigatorSearchQuery } from './search.service';

const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

/**
 * The plan for the query discovery actually runs, on a seeded dataset.
 *
 * Seeded inside a transaction that is always rolled back, so thousands of rows never reach
 * another suite or the development database. The query is the exported one — a lookalike
 * rewritten for the test would prove the test's SQL is fast, which is not the question.
 */
describe('discovery query plan', () => {
  let sql: postgres.Sql;
  let productionPlan = '';
  let distanceFilterPlan = '';
  const at = { lon: 44.52, lat: 40.19 };

  beforeAll(async () => {
    sql = postgres(URL, { max: 1, onnotice: () => {} });
    const run = randomUUID();
    const rollback = new Error('rollback');
    await sql
      .begin(async (tx) => {
        await tx`
          WITH u AS (
            INSERT INTO users (email, status)
            SELECT 'dplan-' || g || '-' || ${run} || '@example.test', 'ACTIVE' FROM generate_series(1, 1000) g
            RETURNING id
          ), p AS (
            INSERT INTO investigator_profiles (user_id, visibility, accepting_work, verification_status, verified_at)
            SELECT id, 'PUBLISHED', true, 'VERIFIED', now() FROM u RETURNING id
          )
          INSERT INTO service_areas (profile_id, kind, label, country_code, city, centre, radius_m, area)
          SELECT id, 'RADIUS', 'seed', 'AM', 'Yerevan',
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

        // A transaction handle is not a full drizzle client, so the query is compiled to text
        // and parameters and explained directly. Same SQL, same parameters.
        const dialect = new PgDialect();
        const explain = async (q: SQL) => {
          const { sql: text, params } = dialect.sqlToQuery(q);
          return JSON.stringify(
            await tx.unsafe(`EXPLAIN (FORMAT JSON) ${text}`, params as never[]),
          );
        };

        productionPlan = await explain(
          investigatorSearchQuery({ near: at, radiusKm: 10 }, [], null, 25),
        );

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

  it('uses the GIST index for the geographic filter', () => {
    // ST_DWithin with a constant distance is what makes the index usable. This is the whole
    // reason a radius is stored as a buffered polygon rather than tested row by row.
    expect(productionPlan).toContain('service_areas_area_gist');
  });

  it('cannot use the index when distance is the filter — why ST_Distance only sorts', () => {
    expect(distanceFilterPlan).not.toContain('service_areas_area_gist');
  });

  it('left none of the seeded rows behind', async () => {
    const [row] = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE 'dplan-%'`;
    expect(row?.['n']).toBe(0);
  });
});
