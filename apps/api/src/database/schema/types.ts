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
    const lon = Number(m?.[1]);
    const lat = Number(m?.[2]);
    // The pattern admits digits, dots and minus signs in any arrangement, so a match is not
    // a number: `1.2.3` matched and became NaN, a location that silently matches nothing.
    // Checking the parsed values also covers the no-match case, since Number(undefined) is
    // NaN — which is why there is no separate branch for it.
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('Unparseable geography point');
    }
    return { lon, lat };
  },
});

/** citext — case-insensitive text. Used for email so uniqueness is case-insensitive. */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
