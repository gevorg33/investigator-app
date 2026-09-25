'use client';

import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import type { AiMessage, AiSession, AssistantApi, Workspace } from '@/lib/api/assistant';
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

/** A conversation that has gone — deleted in another tab, or never the reader's: the same 404. */
const isGone = (e: unknown): boolean => e instanceof ApiError && e.code === 'NOT_FOUND';

/** How far back opening at a search match will read before it stops looking (pages). */
export const MAX_PAGES_TO_MATCH = 10;

export interface Conversation {
  state: ConversationState;
  workspace: Workspace | null;
  running: boolean;
  canRetry: boolean;
  /** Opens the conversation to continue: the latest one while it is still active, else a new one. */
  load: () => Promise<void>;
  /** Opens a conversation from the list — at its end, or reaching back to a message a search found. */
  open: (session: AiSession, focus?: number | null) => Promise<void>;
  /** Tries the last opening again after it failed: whichever of `load` and `open` it was. */
  reload: () => Promise<void>;
  loadEarlier: () => Promise<void>;
  send: (question: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
  startNew: () => void;
  /** Rejects with the API's refusal, for the rename form to show; a 404 starts afresh instead. */
  rename: (title: string) => Promise<void>;
  archive: () => Promise<void>;
  restore: () => Promise<void>;
  remove: () => Promise<void>;
}

/**
 * One conversation with the assistant, as the panel shows it (T-056, T-057). It lives above the
 * panel, so closing the panel or moving to another page does not lose it.
 *
 * A session is created with the first question, not on opening — looking at the assistant leaves
 * no empty conversation behind. A conversation opens at its end and reaches back a page at a time,
 * never reading its whole history at once. A turn that ends any way but `done` leaves something to
 * try again: the unsent question, or the stored one with no answer.
 */
export function useConversation(api: AssistantApi): Conversation {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Every load and turn has a generation; whatever finishes after a newer one began is ignored.
  const generation = useRef(0);
  // Set by the first opening, before anything can ask to try it again.
  const lastLoad = useRef<(() => Promise<void>) | null>(null);
  // The state as of the last render, for the actions: they run between renders.
  const latest = useRef(state);
  latest.current = state;

  /** Leaves whatever runs, so whatever it says afterwards is ignored. */
  const leave = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
  }, []);

  /** A conversation's newest page — and, to show a match, older pages until it is there. */
  const read = useCallback(
    async (sessionId: string, focus: number | null) => {
      let { items, earlier } = await api.page(sessionId);
      const reaches = (list: AiMessage[]) => focus === null || list[0]!.sequence <= focus;
      for (let n = 0; earlier !== null && !reaches(items) && n < MAX_PAGES_TO_MATCH; n++) {
        const older = await api.page(sessionId, earlier);
        items = [...older.items, ...items];
        earlier = older.earlier;
      }
      return { items, earlier };
    },
    [api],
  );

  const load = useCallback(async () => {
    lastLoad.current = load;
    leave();
    const gen = generation.current;
    dispatch({ type: 'load' });
    void api.workspaces().then(
      (all) => setWorkspace(all.find((w) => w.current) ?? null),
      // The workspace is shown, never needed: a conversation works without its name.
      () => undefined,
    );
    try {
      const last = await api.latest();
      const session = last?.status === 'ACTIVE' ? last : null;
      const { items, earlier } =
        session === null ? { items: [], earlier: null } : await read(session.id, null);
      if (gen !== generation.current) return;
      dispatch({ type: 'loaded', session, messages: items, earlier });
    } catch (e) {
      if (gen !== generation.current) return;
      dispatch({ type: 'load_failed', error: asApiError(e) });
    }
  }, [api, leave, read]);

  const open = useCallback(
    async (session: AiSession, focus: number | null = null) => {
      lastLoad.current = () => open(session, focus);
      leave();
      const gen = generation.current;
      // The one chosen is the one open from now — named at once, and marked so in the list.
      dispatch({ type: 'load', session });
      try {
        const { items, earlier } = await read(session.id, focus);
        if (gen === generation.current) {
          dispatch({ type: 'loaded', session, messages: items, earlier, focus });
        }
      } catch (e) {
        if (gen !== generation.current) return;
        if (isGone(e)) dispatch({ type: 'reset', notice: 'gone' });
        else dispatch({ type: 'load_failed', error: asApiError(e) });
      }
    },
    [leave, read],
  );

  const reload = useCallback(() => lastLoad.current!(), []);

  // Only offered while there is an earlier page, in a conversation that exists.
  const loadEarlier = useCallback(async () => {
    const { session, earlier } = latest.current;
    const gen = generation.current;
    try {
      const older = await api.page(session!.id, earlier!);
      if (gen === generation.current) {
        dispatch({ type: 'prepended', messages: older.items, earlier: older.earlier });
      }
    } catch (e) {
      if (gen !== generation.current) return;
      if (isGone(e)) {
        leave();
        dispatch({ type: 'reset', notice: 'gone' });
      } else dispatch({ type: 'earlier_failed' });
    }
  }, [api, leave]);

  /**
   * Reads the newest messages back when what the server holds is uncertain. False when it could
   * not — the state stays as uncertain as it was — or when a newer conversation has begun meanwhile.
   */
  const sync = useCallback(
    async (sessionId: string, gen: number): Promise<boolean> => {
      try {
        const { items } = await api.page(sessionId);
        if (gen !== generation.current) return false;
        dispatch({ type: 'synced', messages: items });
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
        // A stream that closed without `done` or `error` was cut off on the way. (Only Stop and
        // leaving the conversation end a turn early, and both abort it — so this turn is current.)
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
        // Deleted meanwhile, in another tab: there is nothing here to answer into.
        if (isGone(e)) {
          dispatch({ type: 'reset', notice: 'gone' });
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
  const send = useCallback((question: string) => run({ content: question }, question), [run]);

  // Only offered while there is something to try again (`canRetry`).
  const retry = useCallback(async () => {
    const unsent = unsentQuestion(latest.current);
    // Unsent, it is sent again; stored, it is answered where it stands — never sent twice.
    if (unsent !== null) await run({ content: unsent }, unsent);
    else await run({ retry: true }, '');
  }, [run]);

  const stop = useCallback(() => controller.current?.abort(), []);

  const startNew = useCallback(() => {
    leave();
    dispatch({ type: 'reset' });
  }, [leave]);

  /**
   * One action on the conversation on screen — which exists: the menu is offered only then. A 404
   * means it has gone, and the panel starts afresh saying so; any other refusal is the caller's.
   */
  const act = useCallback(
    async <T>(action: (id: string) => Promise<T>, after: (result: T) => void) => {
      const id = latest.current.session!.id;
      try {
        after(await action(id));
      } catch (e) {
        if (!isGone(e)) throw e;
        leave();
        dispatch({ type: 'reset', notice: 'gone' });
      }
    },
    [leave],
  );

  const rename = useCallback(
    (title: string) =>
      act(
        (id) => api.rename(id, title),
        (session) => dispatch({ type: 'session', session }),
      ),
    [act, api],
  );
  const restore = useCallback(
    () => act(api.restore, (session) => dispatch({ type: 'session', session })),
    [act, api],
  );
  const archive = useCallback(
    () =>
      act(api.archive, () => {
        leave();
        dispatch({ type: 'reset', notice: 'archived' });
      }),
    [act, api, leave],
  );
  const remove = useCallback(
    () =>
      act(api.remove, () => {
        leave();
        dispatch({ type: 'reset', notice: 'deleted' });
      }),
    [act, api, leave],
  );

  const running = state.turn?.phase === 'running';
  const canRetry = awaitingRetry(state);
  return useMemo(
    () => ({
      state,
      workspace,
      running,
      canRetry,
      load,
      open,
      reload,
      loadEarlier,
      send,
      retry,
      stop,
      startNew,
      rename,
      archive,
      restore,
      remove,
    }),
    [
      state,
      workspace,
      running,
      canRetry,
      load,
      open,
      reload,
      loadEarlier,
      send,
      retry,
      stop,
      startNew,
      rename,
      archive,
      restore,
      remove,
    ],
  );
}
