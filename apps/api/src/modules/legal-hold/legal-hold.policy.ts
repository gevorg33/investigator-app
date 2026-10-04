import { AppError } from '../../common/errors/app-error';

/** docs/api/pagination.md: default 25, maximum 100, and a request above the maximum is clamped. */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/**
 * A reason must say which request, case or instruction the hold answers — long enough to be a
 * sentence about this one, as `PlatformContext` asks of an ad-hoc reason. The database holds the
 * upper bound (migration 0041).
 */
export const REASON_MIN = 12;
export const REASON_MAX = 2000;

export const LEGAL_HOLD_RESOURCES = [
  'USER',
  'TENANT',
  'MISSION',
  'ASSIGNMENT',
  'MEDIA_ASSET',
] as const;
export type LegalHoldResource = (typeof LEGAL_HOLD_RESOURCES)[number];

export const LEGAL_HOLD_STATUSES = ['ACTIVE', 'RELEASED', 'ALL'] as const;
export type LegalHoldStatus = (typeof LEGAL_HOLD_STATUSES)[number];

export const clampLimit = (requested: number | undefined): number =>
  requested === undefined ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);

/** Where the list left off: when the hold was placed, and the id that breaks ties. */
export interface HoldCursor {
  at: Date;
  id: string;
}

/**
 * Opaque to clients, and every malformed cursor is refused the same way — a cursor is never
 * mistaken for a capability.
 */
export function encodeHoldCursor(cursor: HoldCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.at.toISOString(), i: cursor.id }), 'utf8').toString(
    'base64url',
  );
}

export function decodeHoldCursor(cursor: string): HoldCursor {
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
