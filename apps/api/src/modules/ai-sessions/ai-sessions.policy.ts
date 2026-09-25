import { AppError } from '../../common/errors/app-error';

/** docs/api/pagination.md: default 25, maximum 100, and a request above the maximum is clamped. */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const clampLimit = (requested: number | undefined): number =>
  requested === undefined ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);

/**
 * How long a session can sit without a message before it counts as idle (ADR-0006). A
 * product setting rather than a rule of the domain; it only changes how a session is described.
 */
export const IDLE_AFTER_MS = 30 * 60 * 1000;

export type SessionStatus = 'ACTIVE' | 'IDLE' | 'ARCHIVED' | 'DELETED';

/**
 * A session's lifecycle, read from the facts it rests on (T-045).
 *
 * Nothing stores it: a stored IDLE would be wrong the moment a user walked away, and nothing
 * runs to correct it. DELETED outranks ARCHIVED, which outranks the question of activity.
 */
export function statusOf(
  session: { deletedAt: Date | null; archivedAt: Date | null; lastActivityAt: Date },
  now: Date = new Date(),
): SessionStatus {
  if (session.deletedAt !== null) return 'DELETED';
  if (session.archivedAt !== null) return 'ARCHIVED';
  return now.getTime() - session.lastActivityAt.getTime() >= IDLE_AFTER_MS ? 'IDLE' : 'ACTIVE';
}

/** The longest title taken from a message; a person's own titles may run to 120 (the DTO). */
export const TITLE_FROM_MESSAGE_MAX = 60;

/**
 * A title for an untitled session, from the first thing its user wrote (owner decision,
 * 2026-09-25): whitespace collapsed, and cut at a word boundary with an ellipsis when long.
 *
 * Only ever the user's own words. Nothing the assistant wrote, and nothing a tool returned, can
 * reach a title — so no evidence content can either (T-056). No model is asked.
 */
export function titleFrom(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return null;
  const chars = [...flat];
  if (chars.length <= TITLE_FROM_MESSAGE_MAX) return flat;
  const cut = chars.slice(0, TITLE_FROM_MESSAGE_MAX - 1).join('');
  const space = cut.lastIndexOf(' ');
  // A first word longer than half the limit is cut where it stands, not dropped.
  return `${(space >= TITLE_FROM_MESSAGE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Where a list of sessions left off, bound to whether it was the archived list. */
interface SessionCursor {
  archived: boolean;
  lastActivityAt: Date;
  id: string;
}

const invalidCursor = (): never => {
  throw AppError.validation([
    { field: 'cursor', code: 'INVALID', messageKey: 'error.validation.cursor.invalid' },
  ]);
};

export function encodeSessionCursor(cursor: SessionCursor): string {
  return Buffer.from(
    JSON.stringify({ a: cursor.archived, t: cursor.lastActivityAt.toISOString(), i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * A cursor from the other list is refused, not reinterpreted (docs/api/pagination.md). It is not a
 * capability either: the query it resumes is still the caller's own, under row-level security.
 */
export function decodeSessionCursor(cursor: string, archived: boolean): SessionCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return invalidCursor();
  }
  const p = parsed as { a?: unknown; t?: unknown; i?: unknown } | null;
  const at = typeof p?.t === 'string' ? new Date(p.t) : new Date(Number.NaN);
  if (
    p?.a !== archived ||
    Number.isNaN(at.getTime()) ||
    typeof p.i !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(p.i)
  ) {
    return invalidCursor();
  }
  return { archived, lastActivityAt: at, id: p.i };
}

/**
 * Which end of a conversation a page of messages starts from: the beginning, for reading it in
 * order; or the end, newest first, for opening it where it stands and reaching back (T-057).
 */
export type MessageOrder = 'oldest' | 'newest';

/** Where a page of messages left off: the last sequence it returned, and in which direction. */
export function encodeMessageCursor(sequence: number, order: MessageOrder = 'oldest'): string {
  return Buffer.from(
    JSON.stringify(order === 'oldest' ? { s: sequence } : { s: sequence, o: 'n' }),
    'utf8',
  ).toString('base64url');
}

/**
 * A cursor from the other direction is refused, not reinterpreted (docs/api/pagination.md): "after
 * 40" read backwards would silently skip everything since. Cursors from before T-057 carry no
 * direction and are oldest-first, as they always were.
 */
export function decodeMessageCursor(cursor: string, order: MessageOrder = 'oldest'): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return invalidCursor();
  }
  const p = parsed as { s?: unknown; o?: unknown } | null;
  const s = p?.s;
  const direction = p?.o === 'n' ? 'newest' : p?.o === undefined ? 'oldest' : null;
  return typeof s === 'number' && Number.isInteger(s) && s >= 0 && direction === order
    ? s
    : invalidCursor();
}
