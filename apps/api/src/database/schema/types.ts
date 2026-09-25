import { customType } from 'drizzle-orm/pg-core';

export interface LonLat {
  lon: number;
  lat: number;
}

/** A polygon as rings of `[lon, lat]` pairs. The first ring is the outer boundary; any others are holes. */
export interface PolygonCoordinates {
  rings: Array<Array<[number, number]>>;
}

const UNPARSEABLE = 'Unparseable geography value';
const EWKB_SRID_FLAG = 0x20000000;
const EWKB_POINT = 1;
const EWKB_POLYGON = 3;

/**
 * A minimal reader for the extended well-known binary PostgreSQL sends for geography.
 *
 * postgres.js returns a geography column as hex EWKB — `0101000020E6…` — not as `POINT(…)`
 * text. The first version of these types parsed only text, so reading any geography row back
 * through drizzle threw. This reads exactly what the column types here need, a 2D point or
 * polygon, and refuses anything else rather than guessing.
 */
class EwkbReader {
  private readonly view: DataView;
  private readonly littleEndian: boolean;
  private offset = 1;

  constructor(hex: string) {
    if (hex.length < 10 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
      throw new Error(UNPARSEABLE);
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    this.view = new DataView(bytes.buffer);
    const order = this.view.getUint8(0);
    if (order !== 0 && order !== 1) throw new Error(UNPARSEABLE);
    this.littleEndian = order === 1;
  }

  /**
   * The geometry type with the SRID flag removed. Z and M flags are deliberately left in, so
   * a 3D value fails the type comparison instead of being read with the wrong stride.
   */
  type(): number {
    const raw = this.uint32();
    if (raw & EWKB_SRID_FLAG) this.uint32();
    return (raw & ~EWKB_SRID_FLAG) >>> 0;
  }

  uint32(): number {
    const v = this.view.getUint32(this.offset, this.littleEndian);
    this.offset += 4;
    return v;
  }

  lonLat(): [number, number] {
    const lon = this.view.getFloat64(this.offset, this.littleEndian);
    const lat = this.view.getFloat64(this.offset + 8, this.littleEndian);
    this.offset += 16;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(UNPARSEABLE);
    return [lon, lat];
  }

  /** Trailing bytes mean the value is not what it claimed to be. */
  finish(): void {
    if (this.offset !== this.view.byteLength) throw new Error(UNPARSEABLE);
  }
}

/** Runs a parse, turning an out-of-range read on a truncated value into the same refusal. */
function parse<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new Error(UNPARSEABLE);
  }
}

function pointFromEwkb(hex: string): LonLat {
  return parse(() => {
    const r = new EwkbReader(hex);
    if (r.type() !== EWKB_POINT) throw new Error(UNPARSEABLE);
    const [lon, lat] = r.lonLat();
    r.finish();
    return { lon, lat };
  });
}

function pointFromText(value: string): LonLat {
  const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(value);
  const lon = Number(m?.[1]);
  const lat = Number(m?.[2]);
  // The pattern admits digits, dots and minus signs in any arrangement, so a match is not a
  // number: `1.2.3` matched and became NaN. Checking the parsed values also covers the
  // no-match case, since Number(undefined) is NaN.
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(UNPARSEABLE);
  return { lon, lat };
}

function polygonFromEwkb(hex: string): PolygonCoordinates {
  return parse(() => {
    const r = new EwkbReader(hex);
    if (r.type() !== EWKB_POLYGON) throw new Error(UNPARSEABLE);
    const rings: Array<Array<[number, number]>> = [];
    for (let ring = r.uint32(); ring > 0; ring--) {
      const points: Array<[number, number]> = [];
      for (let n = r.uint32(); n > 0; n--) points.push(r.lonLat());
      rings.push(points);
    }
    r.finish();
    return { rings };
  });
}

/**
 * PostGIS geography. Drizzle ships `point` and `line`, but those are native Postgres
 * geometric types, not PostGIS — no SRID, no spherical maths (ADR-0010).
 *
 * `geography` rather than `geometry` so ST_DWithin takes metres and distances are
 * correct without choosing a projection (postgis-search).
 */
export const geographyPoint = customType<{ data: LonLat; driverData: string }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
  toDriver(value) {
    // Longitude first. Reversing it puts Yerevan in the ocean.
    return `SRID=4326;POINT(${value.lon} ${value.lat})`;
  },
  fromDriver(value) {
    // The driver sends hex EWKB. Text is still accepted, for a value selected with ST_AsText.
    return value.startsWith('SRID=') || value.startsWith('POINT')
      ? pointFromText(value)
      : pointFromEwkb(value);
  },
});

/** A PostGIS geography polygon, for drawn service areas and buffered radius areas. */
export const geographyPolygon = customType<{ data: PolygonCoordinates; driverData: string }>({
  dataType() {
    return 'geography(Polygon, 4326)';
  },
  toDriver(value) {
    const rings = value.rings.map(
      (ring) => `(${ring.map(([lon, lat]) => `${lon} ${lat}`).join(',')})`,
    );
    return `SRID=4326;POLYGON(${rings.join(',')})`;
  },
  fromDriver(value) {
    return polygonFromEwkb(value);
  },
});

/** citext — case-insensitive text. Used for email so uniqueness is case-insensitive. */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
