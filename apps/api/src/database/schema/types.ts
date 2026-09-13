import { customType } from 'drizzle-orm/pg-core';

/**
 * PostGIS geography. Drizzle ships `point` and `line`, but those are native Postgres
 * geometric types, not PostGIS — no SRID, no spherical maths (ADR-0010).
 *
 * `geography` rather than `geometry` so ST_DWithin takes metres and distances are
 * correct without choosing a projection (postgis-search).
 */
export const geographyPoint = customType<{
  data: { lon: number; lat: number };
  driverData: string;
}>({
  dataType() {
    return 'geography(Point, 4326)';
  },
  toDriver(value) {
    // Longitude first. Reversing it puts Yerevan in the ocean.
    return `SRID=4326;POINT(${value.lon} ${value.lat})`;
  },
  fromDriver(value) {
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(value);
    if (!m?.[1] || !m[2]) throw new Error('Unparseable geography point');
    return { lon: Number(m[1]), lat: Number(m[2]) };
  },
});

/** citext — case-insensitive text. Used for email so uniqueness is case-insensitive. */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
