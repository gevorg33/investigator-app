import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { citext, geographyPoint } from './types';

const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

const probe = pgTable('type_probe', { place: geographyPoint('place'), email: citext('email') });
const column = (name: string) => {
  const c = getTableConfig(probe).columns.find((col) => col.name === name);
  if (!c) throw new Error(`no column ${name}`);
  return c as unknown as {
    getSQLType(): string;
    mapToDriverValue(v: unknown): unknown;
    mapFromDriverValue(v: unknown): unknown;
  };
};
const YEREVAN = { lon: 44.5152, lat: 40.1872 };

describe('geography point', () => {
  const place = column('place');
  let sql: postgres.Sql | undefined;

  afterAll(async () => {
    await sql?.end();
  });

  it('declares a PostGIS geography, not a native geometric point', () => {
    expect(place.getSQLType()).toBe('geography(Point, 4326)');
  });

  it('writes longitude first', () => {
    expect(place.mapToDriverValue(YEREVAN)).toBe('SRID=4326;POINT(44.5152 40.1872)');
  });

  it('reads a point back', () => {
    expect(place.mapFromDriverValue('POINT(44.5152 40.1872)')).toEqual(YEREVAN);
  });

  it('reads negative coordinates', () => {
    expect(place.mapFromDriverValue('SRID=4326;POINT(-74.006 -40.7128)')).toEqual({
      lon: -74.006,
      lat: -40.7128,
    });
  });

  it('refuses an unparseable value rather than inventing a location', () => {
    expect(() => place.mapFromDriverValue('not a point')).toThrow(/Unparseable/);
  });

  it.each(['POINT(1.2.3 40)', 'POINT(44 1.2.3)', 'POINT(- 40)', 'POINT(44 .)'])(
    'refuses %s instead of returning NaN as a coordinate',
    (value) => {
      // The pattern admits digits, dots and minus signs in any arrangement. Without a
      // finiteness check these became NaN — a location that silently matches nothing.
      expect(() => place.mapFromDriverValue(value)).toThrow(/Unparseable/);
    },
  );

  it('is accepted by PostGIS, and puts Yerevan where Yerevan is', async () => {
    sql = postgres(URL, { max: 1, onnotice: () => {} });
    const text = place.mapToDriverValue(YEREVAN) as string;
    const [row] = await sql`
      select ST_X(${text}::geography::geometry) as lon, ST_Y(${text}::geography::geometry) as lat`;
    expect(Number(row?.['lon'])).toBeCloseTo(YEREVAN.lon, 4);
    expect(Number(row?.['lat'])).toBeCloseTo(YEREVAN.lat, 4);
  });
});

describe('citext', () => {
  it('declares a case-insensitive text column', () => {
    expect(column('email').getSQLType()).toBe('citext');
  });
});
