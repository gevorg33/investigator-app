import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';

/** docs/api/pagination.md: default 25, maximum 100, and a request above the maximum is clamped. */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Bounded so one request cannot ask for an arbitrary number of OR branches. */
export const MAX_FILTER_VALUES = 20;

/** The widest a customer may push a location search, in kilometres. Matches service areas. */
export const MAX_SEARCH_RADIUS_KM = 100;

export const clampLimit = (requested: number | undefined): number =>
  requested === undefined ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);

/**
 * The sort key of the last row on a page.
 *
 * `distanceM` is null when the search had no location, because then results are not ordered by
 * distance and a cursor carrying one would be meaningless.
 */
export interface Cursor {
  distanceM: number | null;
  profileId: string;
}

/**
 * Identifies the query a cursor came from.
 *
 * docs/api/pagination.md requires that a cursor from one filter set applied to another is
 * rejected rather than silently reinterpreted — otherwise page two of one search quietly
 * becomes page two of a different one, skipping rows nobody can account for.
 *
 * A hash, not the filters themselves: a cursor is opaque, and echoing the filter set back to
 * the client inside it would make it readable and forgeable.
 */
export function fingerprint(filters: unknown): string {
  return createHash('sha256').update(canonical(filters)).digest('hex').slice(0, 16);
}

/** Stable JSON: key order must not change the fingerprint, or paging breaks at random. */
function canonical(value: unknown): string {
  // `JSON.stringify` returns undefined for undefined, functions and symbols. The fallback must
  // not be 'null', which is what null itself produces: a test caught the two hashing
  // identically, and two different filter sets sharing a fingerprint is the one thing this
  // function exists to prevent.
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    // `a < b ? -1 : 1` rather than a three-way compare: `Object.entries` cannot yield the same
    // key twice, so an "equal" arm would be a branch no input can reach.
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function encodeCursor(filters: unknown, last: Cursor): string {
  const payload = { f: fingerprint(filters), d: last.distanceM, i: last.profileId };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor, or refuses it.
 *
 * Every failure is the same `VALIDATION_FAILED`: malformed, truncated, from another query, or
 * simply invented. A cursor is not a capability — it addresses a position in a result set the
 * caller could reach anyway, and refusing them all identically keeps it that way.
 */
export function decodeCursor(filters: unknown, cursor: string): Cursor {
  const reject = (): never => {
    throw AppError.validation([
      { field: 'cursor', code: 'INVALID', messageKey: 'error.validation.cursor.invalid' },
    ]);
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return reject();
  }
  if (parsed === null || typeof parsed !== 'object') return reject();

  const { f, d, i } = parsed as { f?: unknown; d?: unknown; i?: unknown };
  if (typeof f !== 'string' || f !== fingerprint(filters)) return reject();
  if (typeof i !== 'string' || i.length === 0) return reject();
  if (d !== null && (typeof d !== 'number' || !Number.isFinite(d))) return reject();

  return { distanceM: d as number | null, profileId: i };
}
