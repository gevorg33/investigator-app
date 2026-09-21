import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableConfig, integer, pgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { citext, geographyPoint, geographyPolygon } from './types';
import { testPool } from '../../../test/db';

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
    expect(() => place.mapFromDriverValue('not a point')).toThrow(/Unparseable geography value/);
  });

  it.each(['POINT(1.2.3 40)', 'POINT(44 1.2.3)', 'POINT(- 40)', 'POINT(44 .)'])(
    'refuses %s instead of returning NaN as a coordinate',
    (value) => {
      // The pattern admits digits, dots and minus signs in any arrangement. Without a
      // finiteness check these became NaN — a location that silently matches nothing.
      expect(() => place.mapFromDriverValue(value)).toThrow(/Unparseable geography value/);
    },
  );

  it('is accepted by PostGIS, and puts Yerevan where Yerevan is', async () => {
    sql = testPool({ max: 1, role: 'owner' });
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

/**
 * Regression: the column types must survive a real round trip through the driver.
 *
 * postgres.js returns a geography value as hex EWKB (`0101000020E6…`), not as `POINT(…)`
 * text. The parser originally understood only text, so reading any geography row back
 * through drizzle threw — unnoticed because the earlier test cast to text inside SQL and
 * never read a column the way application code does.
 */
describe('reading geography back through drizzle', () => {
  let sql: postgres.Sql;
  const pointProbe = pgTable('geo_point_roundtrip_probe', {
    id: integer('id').primaryKey(),
    place: geographyPoint('place'),
  });

  beforeAll(async () => {
    // One connection, so the temporary table is visible to every query below.
    sql = testPool({ max: 1, role: 'owner' });
    await sql`CREATE TEMP TABLE geo_point_roundtrip_probe (id integer primary key, place geography(Point, 4326))`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('returns the point that was written', async () => {
    const db = drizzle(sql);
    await db.insert(pointProbe).values({ id: 1, place: YEREVAN });
    const [row] = await db.select().from(pointProbe);
    expect(row?.place.lon).toBeCloseTo(YEREVAN.lon, 6);
    expect(row?.place.lat).toBeCloseTo(YEREVAN.lat, 6);
  });
});

/** Builds EWKB hex exactly as PostGIS lays it out, so the reader is tested against the format itself. */
const ewkb = (o: {
  littleEndian?: boolean;
  srid?: boolean;
  type: number;
  counts?: number[];
  doubles: number[];
  trailing?: string;
}): string => {
  const le = o.littleEndian ?? true;
  const parts: Buffer[] = [Buffer.from([le ? 1 : 0])];
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    if (le) b.writeUInt32LE(n >>> 0);
    else b.writeUInt32BE(n >>> 0);
    return b;
  };
  parts.push(u32(o.type | (o.srid === false ? 0 : 0x20000000)));
  if (o.srid !== false) parts.push(u32(4326));
  for (const c of o.counts ?? []) parts.push(u32(c));
  for (const d of o.doubles) {
    const b = Buffer.alloc(8);
    if (le) b.writeDoubleLE(d);
    else b.writeDoubleBE(d);
    parts.push(b);
  }
  return Buffer.concat(parts).toString('hex') + (o.trailing ?? '');
};

describe('geography point, from the binary the driver actually sends', () => {
  const place = column('place');

  it('reads the exact value PostGIS returned for Yerevan', () => {
    expect(place.mapFromDriverValue('0101000020E61000001973D712F2414640D5E76A2BF6174440')).toEqual(
      YEREVAN,
    );
  });

  it('reads big-endian as well as little-endian', () => {
    expect(
      place.mapFromDriverValue(ewkb({ littleEndian: false, type: 1, doubles: [44.5, 40.1] })),
    ).toEqual({
      lon: 44.5,
      lat: 40.1,
    });
  });

  it('reads a value that carries no SRID', () => {
    expect(place.mapFromDriverValue(ewkb({ srid: false, type: 1, doubles: [-74, 40.7] }))).toEqual({
      lon: -74,
      lat: 40.7,
    });
  });

  it('still accepts text beginning with POINT', () => {
    expect(place.mapFromDriverValue('POINT(1 2)')).toEqual({ lon: 1, lat: 2 });
  });

  it.each([
    ['non-hex characters', 'zz01000020E610000000'],
    ['an odd number of hex digits', '0101000020E6100000A'],
    ['too short to hold a header', '0101'],
    ['an invalid byte-order marker', ewkb({ type: 1, doubles: [1, 2] }).replace(/^01/, '02')],
    ['a polygon offered as a point', ewkb({ type: 3, counts: [0], doubles: [] })],
    ['a 3D point', ewkb({ type: 1 | 0x80000000, doubles: [1, 2, 3] })],
    ['a truncated value', ewkb({ type: 1, doubles: [1, 2] }).slice(0, -4)],
    ['trailing bytes', ewkb({ type: 1, doubles: [1, 2], trailing: '00' })],
    ['a non-finite coordinate', ewkb({ type: 1, doubles: [Number.NaN, 2] })],
  ])('refuses %s', (_label, value) => {
    expect(() => place.mapFromDriverValue(value)).toThrow(/Unparseable geography value/);
  });
});

describe('geography polygon', () => {
  const polyTable = pgTable('poly_type_probe', { area: geographyPolygon('area') });
  const area = getTableConfig(polyTable).columns[0] as unknown as {
    getSQLType(): string;
    mapToDriverValue(v: unknown): unknown;
    mapFromDriverValue(v: unknown): unknown;
  };
  const square: Array<[number, number]> = [
    [44, 40],
    [45, 40],
    [45, 41],
    [44, 41],
    [44, 40],
  ];

  it('declares a PostGIS geography polygon', () => {
    expect(area.getSQLType()).toBe('geography(Polygon, 4326)');
  });

  it('writes longitude first, ring by ring', () => {
    expect(area.mapToDriverValue({ rings: [square] })).toBe(
      'SRID=4326;POLYGON((44 40,45 40,45 41,44 41,44 40))',
    );
  });

  it.each([
    ['a point offered as a polygon', ewkb({ type: 1, doubles: [1, 2] })],
    ['a truncated ring', ewkb({ type: 3, counts: [1, 5], doubles: [44, 40, 45, 40] })],
    ['trailing bytes', ewkb({ type: 3, counts: [0], doubles: [], trailing: 'ff' })],
    ['a non-hex value', 'POLYGON((44 40,45 40,45 41,44 40))'],
  ])('refuses %s', (_label, value) => {
    expect(() => area.mapFromDriverValue(value)).toThrow(/Unparseable geography value/);
  });

  describe('through PostGIS and back', () => {
    let sql: postgres.Sql;
    const probe = pgTable('geo_polygon_roundtrip_probe', {
      id: integer('id').primaryKey(),
      area: geographyPolygon('area'),
    });

    beforeAll(async () => {
      sql = testPool({ max: 1, role: 'owner' });
      await sql`CREATE TEMP TABLE geo_polygon_roundtrip_probe (id integer primary key, area geography(Polygon, 4326))`;
    });

    afterAll(async () => {
      await sql.end();
    });

    it('returns the polygon that was written', async () => {
      const db = drizzle(sql);
      await db.insert(probe).values({ id: 1, area: { rings: [square] } });
      // By id, not the first row: the next test writes a second polygon into the same probe
      // table, and without this the assertion passes or fails on which test ran first.
      const [row] = await db.select().from(probe).where(eq(probe.id, 1));
      expect(row?.area).toEqual({ rings: [square] });
    });

    it('keeps holes as further rings', async () => {
      const db = drizzle(sql);
      const hole: Array<[number, number]> = [
        [44.4, 40.4],
        [44.6, 40.4],
        [44.6, 40.6],
        [44.4, 40.6],
        [44.4, 40.4],
      ];
      await db.insert(probe).values({ id: 2, area: { rings: [square, hole] } });
      const [row] = await db.select().from(probe).where(eq(probe.id, 2));
      expect(row?.area.rings).toHaveLength(2);
      expect(row?.area.rings[1]).toEqual(hole);
    });
  });
});
