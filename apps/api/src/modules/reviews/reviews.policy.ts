import { AppError } from '../../common/errors/app-error';

/** docs/api/pagination.md: default 25, maximum 100, and a request above the maximum is clamped. */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** The database holds the same bounds (migration 0022); these fail a request before it gets there. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const TEXT_MAX = 2000;
export const REPORT_REASON_MIN = 10;
export const REPORT_REASON_MAX = 1000;
export const REMOVAL_REASON_MIN = 20;
export const REMOVAL_REASON_MAX = 2000;

export const clampLimit = (requested: number | undefined): number =>
  requested === undefined ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);

/** Where a list left off: the instant and the id that breaks its ties. */
export interface ListCursor {
  at: Date;
  id: string;
}

/**
 * Opaque to clients — they must not parse or construct one — and every malformed cursor is
 * refused the same way, so a cursor is never mistaken for a capability.
 */
export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.at.toISOString(), i: cursor.id }), 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string): ListCursor {
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

  const { t, i } = parsed as { t?: unknown; i?: unknown };
  if (typeof t !== 'string' || typeof i !== 'string' || i.length === 0) return reject();
  const at = new Date(t as string);
  if (Number.isNaN(at.getTime())) return reject();

  return { at, id: i as string };
}
