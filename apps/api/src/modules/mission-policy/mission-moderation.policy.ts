import { AppError } from '../../common/errors/app-error';
import { RISK_BANDS, type RiskBandValue } from './mission-screening';

/** docs/api/pagination.md: default 25, maximum 100, and a request above the maximum is clamped. */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/**
 * The longest reason a moderator may write. For a rejection or a request for changes the customer
 * reads it as written, so it is long enough to say what to change and no longer.
 */
export const REASON_MAX = 2000;

/** The longest internal note: staff only, so room for the detail the reason must not carry. */
export const NOTE_MAX = 4000;

export const clampLimit = (requested: number | undefined): number =>
  requested === undefined ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);

/**
 * How sensitive a band is, highest first in the queue: RESTRICTED is 3, STANDARD 0. The enum's own
 * order, so the queue and screening cannot disagree about which band is higher.
 */
export const bandRank = (band: RiskBandValue): number => RISK_BANDS.indexOf(band);

/** Where the queue left off: the band's rank, when the mission was queued, and the id for ties. */
export interface ModerationCursor {
  rank: number;
  queuedAt: Date;
  id: string;
}

/**
 * Opaque to clients, and every malformed cursor is refused the same way — a cursor is never
 * mistaken for a capability. The queue has no filters, so there is no filter set to bind it to.
 */
export function encodeModerationCursor(cursor: ModerationCursor): string {
  return Buffer.from(
    JSON.stringify({ r: cursor.rank, q: cursor.queuedAt.toISOString(), i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeModerationCursor(cursor: string): ModerationCursor {
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

  const { r, q, i } = parsed as { r?: unknown; q?: unknown; i?: unknown };
  if (
    typeof r !== 'number' ||
    !Number.isInteger(r) ||
    r < 0 ||
    r >= RISK_BANDS.length ||
    typeof q !== 'string' ||
    typeof i !== 'string' ||
    i.length === 0
  ) {
    return reject();
  }
  const queuedAt = new Date(q as string);
  if (Number.isNaN(queuedAt.getTime())) return reject();

  return { rank: r as number, queuedAt, id: i as string };
}
