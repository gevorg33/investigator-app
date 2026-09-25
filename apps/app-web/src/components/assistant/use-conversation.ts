'use client';

import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import type { AssistantApi, Workspace } from '@/lib/api/assistant';
import { ApiError } from '@/lib/api/errors';
import {
  awaitingRetry,
  initialState,
  reduce,
  unsentQuestion,
  type ConversationState,
} from './conversation-state';

const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal');

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export interface Conversation {
  state: ConversationState;
  workspace: Workspace | null;
  running: boolean;
  canRetry: boolean;
  /** Opens the conversation to continue: the latest one while it is still active, else a new one. */
  load: () => Promise<void>;
  send: (question: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
  startNew: () => void;
}

/**
 * One conversation with the assistant, as the panel shows it (T-056). It lives above the panel,
 * so closing the panel or moving to another page does not lose it.
 *
 * A session is created with the first question, not on opening — looking at the assistant leaves
 * no empty conversation behind. A turn that ends any way but `done` leaves something to try again:
 * the unsent question, or the stored one with no answer.
 */
export function useConversation(api: AssistantApi): Conversation {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Every load and turn has a generation; whatever finishes after a newer one began is ignored.
  const generation = useRef(0);
  // The state as of the last render, for the actions: they run between renders.
  const latest = useRef(state);
  latest.current = state;

  const load = useCallback(async () => {
    dispatch({ type: 'load' });
    void api.workspaces().then(
      (all) => setWorkspace(all.find((w) => w.current) ?? null),
      // The workspace is shown, never needed: a conversation works without its name.
      () => undefined,
    );
    try {
      const last = await api.latest();
      const session = last?.status === 'ACTIVE' ? last : null;
      const messages = session === null ? [] : await api.messages(session.id);
      dispatch({ type: 'loaded', session, messages });
    } catch (e) {
      dispatch({ type: 'load_failed', error: asApiError(e) });
    }
  }, [api]);

  /**
   * Reads the conversation back when what the server holds is uncertain. False when it could not
   * — the state stays as uncertain as it was — or when a newer conversation has begun meanwhile.
   */
  const sync = useCallback(
    async (sessionId: string, gen: number): Promise<boolean> => {
      try {
        const messages = await api.messages(sessionId);
        if (gen !== generation.current) return false;
        dispatch({ type: 'synced', messages });
        return true;
      } catch {
        return false;
      }
    },
    [api],
  );

  const run = useCallback(
    async (input: { content: string } | { retry: true }, question: string) => {
      const gen = ++generation.current;
      const stop = new AbortController();
      controller.current = stop;
      const retry = 'retry' in input;
      let stored = retry;
      let ended = false;
      dispatch({ type: 'start', question, stored });
      let sessionId = latest.current.session?.id;
      try {
        if (sessionId === undefined) {
          const session = await api.create();
          sessionId = session.id;
          dispatch({ type: 'session', session });
        }
        await api.turn(
          sessionId,
          input,
          (event) => {
            if (gen !== generation.current) return;
            if (event.type === 'message' && event.message.role === 'USER') stored = true;
            if (event.type === 'done' || event.type === 'error') ended = true;
            dispatch({ type: 'event', event });
          },
          stop.signal,
        );
        // A stream that closed without `done` or `error` was cut off on the way. (Only Stop and a
        // new conversation end a turn early, and both abort it — so this turn is still current.)
        if (!ended) {
          dispatch({ type: 'failed', error: asApiError(null) });
          if (!stored) void sync(sessionId, gen);
        }
      } catch (e) {
        if (gen !== generation.current) return;
        if (isAbort(e)) {
          dispatch({ type: 'stopped' });
          // Stopped before the server said it had the question: ask whether it does. Only the
          // turn itself is aborted, so there is a session by now.
          if (!stored) void sync(sessionId!, gen);
          return;
        }
        const error = asApiError(e);
        // Answered meanwhile — in another tab — so there is nothing left to retry: read it back.
        // A retry is only offered in a session, so there is one.
        if (retry && error.code === 'STATE_CONFLICT' && (await sync(sessionId!, gen))) return;
        dispatch({ type: 'failed', error });
      } finally {
        if (controller.current === stop) controller.current = null;
      }
    },
    [api, sync],
  );

  // Only offered while nothing runs: the composer holds Stop instead of Send meanwhile.
  const send = useCallback(
    (question: string) => run({ content: question }, question),
    [run],
  );

  // Only offered while there is something to try again (`canRetry`).
  const retry = useCallback(async () => {
    const unsent = unsentQuestion(latest.current);
    // Unsent, it is sent again; stored, it is answered where it stands — never sent twice.
    if (unsent !== null) await run({ content: unsent }, unsent);
    else await run({ retry: true }, '');
  }, [run]);

  const stop = useCallback(() => controller.current?.abort(), []);

  const startNew = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: 'reset' });
  }, []);

  const running = state.turn?.phase === 'running';
  const canRetry = awaitingRetry(state);
  return useMemo(
    () => ({ state, workspace, running, canRetry, load, send, retry, stop, startNew }),
    [state, workspace, running, canRetry, load, send, retry, stop, startNew],
  );
}
