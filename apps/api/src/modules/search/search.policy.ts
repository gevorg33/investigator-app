import { AppError } from '../../common/errors/app-error';
// One implementation, shared with idempotency keys: both answer "is this the same request as
// before", and two copies of that answer would drift. The canonical-JSON rules and the
// undefined/null collision they were written to avoid live in that file now.
import { stableFingerprint } from '../../common/hash/stable-fingerprint';

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
export const fingerprint = stableFingerprint;

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
