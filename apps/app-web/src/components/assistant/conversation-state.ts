import type { AiMessage, AiSession, TurnEvent, TurnStep } from '@/lib/api/assistant';
import { ApiError } from '@/lib/api/errors';

/**
 * Where the current turn is: `running` until its stream ends, then gone (answered), `stopped` or
 * `failed`. A turn that ended before its question was stored keeps the question as `unsent`, so
 * trying again sends it; once stored, trying again answers the stored one.
 */
export type Turn =
  | { phase: 'running'; question: string; stored: boolean; step: TurnStep | null }
  | { phase: 'stopped'; unsent: string | null }
  | { phase: 'failed'; error: ApiError; unsent: string | null };

/** Why the conversation on screen was replaced by a fresh one, said once (T-057). */
export type Notice = 'archived' | 'deleted' | 'gone';

export interface ConversationState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  loadError: ApiError | null;
  session: AiSession | null;
  /**
   * The part of the conversation loaded: from the oldest page read to the newest message — never
   * the whole history at once (T-057). `earlier` is where the next older page starts, or null when
   * the beginning is here.
   */
  messages: AiMessage[];
  earlier: string | null;
  /** Reading back an earlier page failed; the button says so and tries again. */
  earlierFailed: boolean;
  /** A message to bring into view — the one a search found. */
  focus: number | null;
  turn: Turn | null;
  notice: Notice | null;
}

export const initialState: ConversationState = {
  status: 'idle',
  loadError: null,
  session: null,
  messages: [],
  earlier: null,
  earlierFailed: false,
  focus: null,
  turn: null,
  notice: null,
};

export type Action =
  /** Reading begins: of whatever is latest, or of `session` — which is the one open from now. */
  | { type: 'load'; session?: AiSession }
  | {
      type: 'loaded';
      session: AiSession | null;
      messages: AiMessage[];
      earlier: string | null;
      focus?: number | null;
    }
  | { type: 'load_failed'; error: ApiError }
  /** An older page, put before what is loaded. */
  | { type: 'prepended'; messages: AiMessage[]; earlier: string | null }
  | { type: 'earlier_failed' }
  /** The newest messages read back from the server, when what it holds was uncertain. */
  | { type: 'synced'; messages: AiMessage[] }
  | { type: 'reset'; notice?: Notice }
  | { type: 'session'; session: AiSession }
  | { type: 'start'; question: string; stored: boolean }
  | { type: 'event'; event: TurnEvent }
  | { type: 'stopped' }
  | { type: 'failed'; error: ApiError };

/** Every message once, in its place — a message two reads both bring is one. */
const merged = (messages: AiMessage[], more: AiMessage[]): AiMessage[] => {
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const m of more) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
};

/** The running turn's question, if the server has not confirmed storing it. */
const unsentOf = (t: Turn | null): string | null =>
  t?.phase === 'running' && !t.stored ? t.question : null;

export function reduce(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'load':
      return {
        ...state,
        status: 'loading',
        loadError: null,
        notice: null,
        ...(action.session === undefined ? {} : { session: action.session }),
      };
    case 'loaded':
      return {
        ...initialState,
        status: 'ready',
        session: action.session,
        messages: action.messages,
        earlier: action.earlier,
        focus: action.focus ?? null,
      };
    case 'load_failed':
      return { ...state, status: 'failed', loadError: action.error };
    case 'prepended':
      return {
        ...state,
        messages: merged(state.messages, action.messages),
        earlier: action.earlier,
        earlierFailed: false,
      };
    case 'earlier_failed':
      return { ...state, earlierFailed: true };
    case 'synced': {
      const messages = merged(state.messages, action.messages);
      const t = state.turn;
      const last = messages.at(-1);
      // A question that turns out to have been stored is no longer unsent: retry answers it.
      const kept =
        t !== null && t.phase !== 'running' && t.unsent !== null && last?.role === 'USER'
          ? { ...t, unsent: last.content === t.unsent ? null : t.unsent }
          : t;
      return { ...state, messages, turn: kept?.phase === 'running' ? null : kept };
    }
    case 'reset':
      return { ...initialState, status: 'ready', notice: action.notice ?? null };
    case 'session':
      return { ...state, session: action.session };
    case 'start':
      return {
        ...state,
        notice: null,
        turn: { phase: 'running', question: action.question, stored: action.stored, step: null },
      };
    case 'stopped':
      return { ...state, turn: { phase: 'stopped', unsent: unsentOf(state.turn) } };
    case 'failed':
      return {
        ...state,
        turn: { phase: 'failed', error: action.error, unsent: unsentOf(state.turn) },
      };
    case 'event':
      return onEvent(state, action.event);
  }
}

function onEvent(state: ConversationState, event: TurnEvent): ConversationState {
  const t = state.turn;
  switch (event.type) {
    case 'message': {
      const messages = merged(state.messages, [event.message]);
      // The question as stored: from here, trying again answers it rather than sending it again.
      const turn =
        t?.phase === 'running' && event.message.role === 'USER' ? { ...t, stored: true } : t;
      return { ...state, messages, turn };
    }
    case 'session':
      return { ...state, session: event.session };
    case 'step':
      return t?.phase === 'running' ? { ...state, turn: { ...t, step: event.step } } : state;
    case 'error':
      return {
        ...state,
        turn: {
          phase: 'failed',
          unsent: unsentOf(t),
          // A failure on the server's side of a turn under way: a 500 in all but name, so the
          // reference a person can quote to support is shown.
          error: new ApiError(
            500,
            event.error.code,
            event.error.messageKey,
            [],
            event.error.correlationId,
          ),
        },
      };
    case 'done':
      return t?.phase === 'running' ? { ...state, turn: null } : state;
  }
}

/**
 * Whether there is a question with no answer to try again: one that ended unsent, or — stopped,
 * failed, or read back from the history — a conversation whose last message is the person's.
 */
export function awaitingRetry(state: ConversationState): boolean {
  if (state.turn?.phase === 'running') return false;
  return unsentQuestion(state) !== null || state.messages.at(-1)?.role === 'USER';
}

/** The question a finished turn left unsent, if any — what trying again would send. */
export function unsentQuestion(state: ConversationState): string | null {
  const t = state.turn;
  return t === null || t.phase === 'running' ? null : t.unsent;
}
