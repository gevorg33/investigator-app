import { randomUUID } from 'node:crypto';
import { getTableConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerProfiles, investigatorProfiles } from './profiles';
import { serviceAreas } from './service-areas';
import { users } from './users';
import { testPool } from '../../../test/db';


describe('service_areas', () => {
  let sql: postgres.Sql;
  let profileId: string;

  beforeAll(async () => {
    sql = testPool({ max: 2 });
    const [u] = await sql`insert into users (email) values (${`sa-schema-${randomUUID()}@example.test`}) returning id`;
    const [p] = await sql`insert into investigator_profiles (user_id) values (${u?.['id']}) returning id`;
    profileId = String(p?.['id']);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('goes with the profile it belongs to', () => {
    const [fk] = getTableConfig(serviceAreas).foreignKeys;
    expect(fk?.reference().foreignTable).toBe(investigatorProfiles);
    expect(fk?.onDelete).toBe('cascade');
  });

  it('indexes the searched area with GIST', () => {
    const idx = getTableConfig(serviceAreas).indexes.find((i) => i.config.name === 'service_areas_area_gist');
    expect(idx?.config.method).toBe('gist');
  });

  it('has no column that could hold where someone lives', () => {
    // The criterion that home location is not discoverable starts with not storing one.
    for (const table of [users, investigatorProfiles, customerProfiles, serviceAreas]) {
      for (const col of getTableConfig(table).columns) {
        expect(col.name, `${getTableConfig(table).name}.${col.name}`).not.toMatch(/home|address|residen|street|postcode|zip/i);
      }
    }
  });

  const point = (lon: number, lat: number) => `SRID=4326;POINT(${lon} ${lat})`;
  const buffer = (lon: number, lat: number, m: number) =>
    sql`ST_Buffer(ST_GeogFromText(${point(lon, lat)}), ${m})`;

  /** 23514 is Postgres's check_violation; the constraint name says which rule refused. */
  const refused = async (run: Promise<unknown>, constraint: string) => {
    const err = await run.then(() => null).catch((e: { code?: string; constraint_name?: string }) => e);
    expect(err, 'expected the database to refuse').not.toBeNull();
    expect((err as { code?: string }).code).toBe('23514');
    expect((err as { constraint_name?: string }).constraint_name).toBe(constraint);
  };

  it('accepts a well-formed radius area', async () => {
    await expect(
      sql`insert into service_areas (profile_id, kind, label, centre, radius_m, area)
          values (${profileId}, 'RADIUS', 'ok', ST_GeogFromText(${point(44.52, 40.19)}), 5000, ${buffer(44.52, 40.19, 5000)})`,
    ).resolves.toBeDefined();
  });

  it('refuses a centre more precise than about a kilometre, whoever writes it', async () => {
    await refused(
      sql`insert into service_areas (profile_id, kind, label, centre, radius_m, area)
          values (${profileId}, 'RADIUS', 'precise', ST_GeogFromText(${point(44.5152, 40.1872)}), 5000, ${buffer(44.52, 40.19, 5000)})`,
      'service_areas_centre_coarsened',
    );
  });

  it('refuses a radius below 5 km', async () => {
    await refused(
      sql`insert into service_areas (profile_id, kind, label, centre, radius_m, area)
          values (${profileId}, 'RADIUS', 'small', ST_GeogFromText(${point(44.52, 40.19)}), 4999, ${buffer(44.52, 40.19, 5000)})`,
      'service_areas_radius_range',
    );
  });

  it('refuses a drawn area small enough to pinpoint a building', async () => {
    const tiny = 'SRID=4326;POLYGON((44.51 40.18,44.52 40.18,44.52 40.19,44.51 40.19,44.51 40.18))';
    await refused(
      sql`insert into service_areas (profile_id, kind, label, area) values (${profileId}, 'POLYGON', 'tiny', ST_GeogFromText(${tiny}))`,
      'service_areas_min_area',
    );
  });

  it('refuses a boundary with a hole', async () => {
    const holed =
      'SRID=4326;POLYGON((44 40,46 40,46 42,44 42,44 40),(44.5 40.5,45.5 40.5,45.5 41.5,44.5 41.5,44.5 40.5))';
    await refused(
      sql`insert into service_areas (profile_id, kind, label, area) values (${profileId}, 'POLYGON', 'holed', ST_GeogFromText(${holed}))`,
      'service_areas_area_simple',
    );
  });

  it('refuses a self-intersecting boundary', async () => {
    const bowtie = 'SRID=4326;POLYGON((44 40,46 42,46 40,44 42,44 40))';
    await refused(
      sql`insert into service_areas (profile_id, kind, label, area) values (${profileId}, 'POLYGON', 'bowtie', ST_GeogFromText(${bowtie}))`,
      'service_areas_area_valid',
    );
  });

  it('refuses a radius area with no radius, and a drawn area with a centre', async () => {
    await refused(
      sql`insert into service_areas (profile_id, kind, label, centre, area)
          values (${profileId}, 'RADIUS', 'x', ST_GeogFromText(${point(44.52, 40.19)}), ${buffer(44.52, 40.19, 5000)})`,
      'service_areas_kind_fields',
    );
    await refused(
      sql`insert into service_areas (profile_id, kind, label, centre, area)
          values (${profileId}, 'POLYGON', 'x', ST_GeogFromText(${point(44.52, 40.19)}), ${buffer(44.52, 40.19, 5000)})`,
      'service_areas_kind_fields',
    );
  });

  it('refuses an empty label', async () => {
    await refused(
      sql`insert into service_areas (profile_id, kind, label, centre, radius_m, area)
          values (${profileId}, 'RADIUS', '', ST_GeogFromText(${point(44.52, 40.19)}), 5000, ${buffer(44.52, 40.19, 5000)})`,
      'service_areas_label_length',
    );
  });
});
