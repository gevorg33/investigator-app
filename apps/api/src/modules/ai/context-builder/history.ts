import { COMPACT_AT, estimateTokens } from './budget';

/** A message as it would enter a prompt: rendered, and what it costs. */
export interface MessagePiece {
  sequence: number;
  text: string;
  tokens: number;
}

/**
 * A summary, renderable three ways, each shorter than the last: in full; compact (goal, decisions,
 * constraints, pending, state); minimal (goal, pending, state).
 */
export interface SummaryPiece {
  start: number;
  end: number;
  full: { text: string; tokens: number };
  compact: { text: string; tokens: number };
  minimal: { text: string; tokens: number };
}

/**
 * How much of the conversation a call can carry, from the most to the least (ADR-0006):
 *
 * ```
 * recent → + summary → compress older → retrieve relevant history → structured state
 * ```
 *
 * Graceful, never sudden: each rung keeps less verbatim, and the last always fits. Nothing is
 * deleted on any rung — a message left out is still in the session, only not in this call.
 */
export type Rung = 'recent' | 'summary' | 'compressed' | 'retrieved' | 'state';

export interface HistoryChoice {
  rung: Rung;
  summaries: string[];
  /** Oldest first. */
  recent: MessagePiece[];
  /** Older messages relevant to the request, in conversation order. */
  retrieved: MessagePiece[];
  tokens: number;
  /** Summaries and unsummarized messages pass {@link COMPACT_AT} of the allowance: summarise now. */
  compactionDue: boolean;
}

/** At least this many of the newest messages before history is reduced to state and retrieval. */
export const MIN_RECENT = 2;

const sum = (xs: ReadonlyArray<{ tokens: number }>) => xs.reduce((n, x) => n + x.tokens, 0);

/** The newest messages that fit in `room`, oldest first. */
function newestWithin(messages: readonly MessagePiece[], room: number): MessagePiece[] {
  const kept: MessagePiece[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (used + m.tokens > room) break;
    kept.unshift(m);
    used += m.tokens;
  }
  return kept;
}

/** Relevant older messages that fit in `room` — best first in, conversation order out. */
function retrieveWithin(
  candidates: readonly MessagePiece[],
  before: number,
  room: number,
  max: number,
): MessagePiece[] {
  const kept: MessagePiece[] = [];
  let used = 0;
  for (const m of candidates) {
    if (kept.length === max) break;
    if (m.sequence >= before || used + m.tokens > room) continue;
    kept.push(m);
    used += m.tokens;
  }
  return kept.sort((a, b) => a.sequence - b.sequence);
}

/**
 * Chooses the highest rung whose history fits `allowance`.
 *
 * `messages` are those no summary covers yet, oldest first; `relevant` are older messages the
 * session's own search found for the request, best first — already the caller's own, by row-level
 * security and by session, before they get here.
 */
export function chooseHistory(
  input: {
    summaries: readonly SummaryPiece[];
    messages: readonly MessagePiece[];
    relevant: readonly MessagePiece[];
  },
  allowance: number,
): HistoryChoice {
  const { summaries, messages, relevant } = input;
  const all = sum(messages);
  const full = summaries.reduce((n, s) => n + s.full.tokens, 0);
  const compact = summaries.reduce((n, s) => n + s.compact.tokens, 0);
  const minimal = summaries.reduce((n, s) => n + s.minimal.tokens, 0);
  const compactionDue = full + all > COMPACT_AT * allowance;
  const choice = (
    rung: Rung,
    texts: string[],
    recent: MessagePiece[],
    retrieved: MessagePiece[] = [],
  ): HistoryChoice => ({
    rung,
    summaries: texts,
    recent,
    retrieved,
    tokens: texts.reduce((n, t) => n + estimateTokens(t), 0) + sum(recent) + sum(retrieved),
    compactionDue,
  });

  if (summaries.length === 0 && all <= allowance) return choice('recent', [], [...messages]);
  if (summaries.length > 0 && full + all <= allowance) {
    return choice(
      'summary',
      summaries.map((s) => s.full.text),
      [...messages],
    );
  }
  if (summaries.length > 0 && compact + all <= allowance) {
    return choice(
      'compressed',
      summaries.map((s) => s.compact.text),
      [...messages],
    );
  }

  // Not all of it verbatim: the newest that fit, and what is relevant from before them.
  const useCompact = compact <= allowance / 2;
  const kept = useCompact ? compact : minimal <= allowance / 2 ? minimal : 0;
  const texts =
    kept === 0 ? [] : summaries.map((s) => (useCompact ? s.compact.text : s.minimal.text));
  const room = allowance - kept;
  const recent = newestWithin(messages, Math.floor(room * 0.6));
  if (recent.length >= MIN_RECENT) {
    const first = recent[0]!.sequence;
    return choice(
      'retrieved',
      texts,
      recent,
      retrieveWithin(relevant, first, room - sum(recent), 8),
    );
  }

  // The floor: state (always in context, outside this choice), what little recent fits, and the
  // few most relevant earlier messages.
  const floorTexts = minimal <= allowance / 4 ? summaries.map((s) => s.minimal.text) : [];
  const floorRoom = allowance - (floorTexts.length > 0 ? minimal : 0);
  const last = newestWithin(messages, Math.floor(floorRoom / 2));
  const before = last[0]?.sequence ?? Number.MAX_SAFE_INTEGER;
  return choice(
    'state',
    floorTexts,
    last,
    retrieveWithin(relevant, before, floorRoom - sum(last), 3),
  );
}
