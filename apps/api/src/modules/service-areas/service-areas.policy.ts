/**
 * Limits on service areas. The privacy ones are also CHECK constraints in migration 0006, so
 * they hold for every writer; they are repeated here so a request can be refused with a
 * readable reason before it reaches the database.
 */

/** A 5 km minimum radius: no area small enough to pinpoint where someone lives. */
export const MIN_RADIUS_KM = 5;
export const MAX_RADIUS_KM = 300;

/**
 * Centres are stored to two decimal places — about 1.1 km of latitude. Coarse enough that a
 * radius area cannot be centred on a front door, fine enough for "where I work".
 */
export const CENTRE_DECIMALS = 2;

/** Vertices in a drawn boundary, before PostGIS closes the ring. */
export const MAX_BOUNDARY_VERTICES = 200;

export const MAX_AREAS_PER_PROFILE = 10;

/** How far outside an area a search may reach. Zero means the point must fall inside it. */
export const MAX_SEARCH_RADIUS_M = 100_000;
export const DEFAULT_RESULT_LIMIT = 50;
export const MAX_RESULT_LIMIT = 200;

export const coarsen = (degrees: number): number =>
  Math.round(degrees * 10 ** CENTRE_DECIMALS) / 10 ** CENTRE_DECIMALS;

/**
 * Distances leave the service rounded UP to whole kilometres. Exact metres, returned for
 * repeated searches from different points, would let anyone triangulate an area's centre.
 */
export const toReportedKm = (metres: number): number => Math.ceil(metres / 1000);
