import { AppError } from '../../common/errors/app-error';

/** docs/api/pagination.md: default 25, maximum 100, and a request above the maximum is clamped. */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Enough for identity plus licences in several jurisdictions; not a way to fill storage. */
export const MAX_DOCUMENTS = 10;

/** Enough to be specific. The reason is written for the applicant, who is shown it. */
export const REASON_MAX = 2000;

export const clampLimit = (requested: number | undefined): number =>
  requested === undefined ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);

/** Where the queue left off: the submission instant and the id that breaks its ties. */
export interface QueueCursor {
  submittedAt: Date;
  id: string;
}

/**
 * The queue has no filters, so unlike a discovery cursor there is no filter set to bind this
 * one to. It is still opaque — clients must not parse or construct it — and every malformed
 * cursor is refused the same way, so a cursor is never mistaken for a capability.
 */
export function encodeQueueCursor(cursor: QueueCursor): string {
  return Buffer.from(
    JSON.stringify({ s: cursor.submittedAt.toISOString(), i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeQueueCursor(cursor: string): QueueCursor {
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

  const { s, i } = parsed as { s?: unknown; i?: unknown };
  if (typeof s !== 'string' || typeof i !== 'string' || i.length === 0) return reject();
  const submittedAt = new Date(s as string);
  if (Number.isNaN(submittedAt.getTime())) return reject();

  return { submittedAt, id: i as string };
}
