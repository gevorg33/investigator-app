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

export interface ConversationState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  loadError: ApiError | null;
  session: AiSession | null;
  messages: AiMessage[];
  turn: Turn | null;
}

export const initialState: ConversationState = {
  status: 'idle',
  loadError: null,
  session: null,
  messages: [],
  turn: null,
};

export type Action =
  | { type: 'load' }
  | { type: 'loaded'; session: AiSession | null; messages: AiMessage[] }
  | { type: 'load_failed'; error: ApiError }
  /** The conversation read back from the server, when what it holds was uncertain. */
  | { type: 'synced'; messages: AiMessage[] }
  | { type: 'reset' }
  | { type: 'session'; session: AiSession }
  | { type: 'start'; question: string; stored: boolean }
  | { type: 'event'; event: TurnEvent }
  | { type: 'stopped' }
  | { type: 'failed'; error: ApiError };

/** Adds a stored message once, in its place — a message the stream and a reload both bring is one. */
const withMessage = (messages: AiMessage[], m: AiMessage): AiMessage[] =>
  messages.some((x) => x.id === m.id)
    ? messages
    : [...messages, m].sort((a, b) => a.sequence - b.sequence);

/** The running turn's question, if the server has not confirmed storing it. */
const unsentOf = (t: Turn | null): string | null =>
  t?.phase === 'running' && !t.stored ? t.question : null;

export function reduce(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'load':
      return { ...state, status: 'loading', loadError: null };
    case 'loaded':
      return {
        status: 'ready',
        loadError: null,
        session: action.session,
        messages: action.messages,
        turn: null,
      };
    case 'load_failed':
      return { ...state, status: 'failed', loadError: action.error };
    case 'synced': {
      const t = state.turn;
      const last = action.messages.at(-1);
      // A question that turns out to have been stored is no longer unsent: retry answers it.
      const kept =
        t !== null && t.phase !== 'running' && t.unsent !== null && last?.role === 'USER'
          ? { ...t, unsent: last.content === t.unsent ? null : t.unsent }
          : t;
      return { ...state, messages: action.messages, turn: kept?.phase === 'running' ? null : kept };
    }
    case 'reset':
      return { ...initialState, status: 'ready' };
    case 'session':
      return { ...state, session: action.session };
    case 'start':
      return {
        ...state,
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
      const messages = withMessage(state.messages, event.message);
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
