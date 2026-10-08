'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantApi, Plan } from '@/lib/api/assistant';
import { ApiError } from '@/lib/api/errors';

/** How often a confirmed plan is read again while it runs. */
export const POLL_MS = 2_000;

const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal');

/** Confirmed and not yet ended: the worker has it, and the person watches it run. */
export const isRunning = (plan: Plan): boolean =>
  plan.status === 'CONFIRMED' || plan.status === 'EXECUTING';
const isEnded = (plan: Plan): boolean =>
  plan.status === 'COMPLETED' || plan.status === 'FAILED' || plan.status === 'CANCELLED';

/** One plan as the conversation shows it: the plan as last read, and what the person is doing to it. */
export interface PlanEntry {
  plan: Plan;
  /** Set from the first tap until the API answers: nothing can be pressed twice. */
  acting: 'confirm' | 'decline' | null;
  /** The API's refusal of the last answer, said beside the plan while it is still shown. */
  error: ApiError | null;
}

export interface Plans {
  entries: PlanEntry[];
  /** The plans could not be read; `refresh` tries again. */
  failed: boolean;
  refresh: () => Promise<void>;
  confirm: (planId: string) => Promise<void>;
  decline: (planId: string) => Promise<void>;
}

/**
 * The plans of the conversation that is open (T-058): those waiting for the person's answer and those
 * confirmed and running — read when the conversation opens, so one left waiting is there at once when
 * the person comes back, however long ago they closed the browser (T-048).
 *
 * **Never answers for the person.** Confirming and declining happen only through `confirm` and
 * `decline`, which only a person's tap calls; the hash confirmed is the one the plan was shown with,
 * and it goes to the API and nowhere else.
 *
 * **Watches a confirmed plan run** by reading it again every `POLL_MS` until it ends. A plan that
 * ends — here, in another tab, or refused at the last moment — leaves the list, and `onEnded` reads
 * the conversation again: the database has written how it ended there (T-226), which is what says
 * why, never this. Nothing is read while the tab is hidden; shown again, a running plan is read at
 * once, as the notification count is (T-235).
 */
export function usePlans(api: AssistantApi, sessionId: string | null, onEnded: () => void): Plans {
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [failed, setFailed] = useState(false);
  // Whatever answers for a conversation no longer open is ignored.
  const generation = useRef(0);
  const current = useRef(entries);
  current.current = entries;
  const ended = useRef(onEnded);
  ended.current = onEnded;

  const update = useCallback((planId: string, change: (e: PlanEntry) => PlanEntry | null) => {
    setEntries((all) =>
      all.flatMap((e) => {
        if (e.plan.id !== planId) return [e];
        const next = change(e);
        return next === null ? [] : [next];
      }),
    );
  }, []);

  /** A plan read again: kept while open, gone once ended — and then the conversation is read again. */
  const settle = useCallback(
    (planId: string, plan: Plan | null, error: ApiError | null) => {
      if (plan === null || isEnded(plan)) {
        update(planId, () => null);
        ended.current();
        return;
      }
      update(planId, () => ({ plan, acting: null, error }));
    },
    [update],
  );

  const reread = useCallback(
    async (planId: string): Promise<Plan | null | undefined> => {
      try {
        return await api.plan(sessionId!, planId);
      } catch (e) {
        // Gone with its conversation, or no longer the reader's: as ended. Anything else: unknown.
        return e instanceof ApiError && e.code === 'NOT_FOUND' ? null : undefined;
      }
    },
    [api, sessionId],
  );

  const refresh = useCallback(async () => {
    if (sessionId === null) return;
    const gen = generation.current;
    try {
      const open = await api.openPlans(sessionId);
      if (gen !== generation.current) return;
      setFailed(false);
      const before = current.current;
      // A plan shown before and not open now has ended elsewhere: its outcome is in the conversation.
      if (before.some((e) => !open.some((p) => p.id === e.plan.id))) ended.current();
      setEntries(
        // In the order they were proposed, as the conversation reads; the API lists newest first.
        [...open]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((plan) => {
            const known = before.find((e) => e.plan.id === plan.id);
            return { plan, acting: known?.acting ?? null, error: known?.error ?? null };
          }),
      );
    } catch {
      if (gen === generation.current) setFailed(true);
    }
  }, [api, sessionId]);

  // A conversation opened is read for its plans; one left is forgotten.
  useEffect(() => {
    generation.current++;
    setEntries([]);
    setFailed(false);
    void refresh();
  }, [refresh]);

  // Hidden, the panel stays mounted: without this it would read every tick until the plan ends.
  const [hidden, setHidden] = useState(false);
  const wasHidden = useRef(false);
  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === 'hidden');
    onChange();
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const running = entries.filter((e) => isRunning(e.plan)).map((e) => e.plan.id);
  const watching = running.join(',');
  useEffect(() => {
    // Shown again after being hidden: read at once, not a tick later.
    const returned = wasHidden.current && !hidden;
    wasHidden.current = hidden;
    if (watching === '' || hidden) return;
    const gen = generation.current;
    const timer = setTimeout(
      () => {
        void Promise.all(
          watching.split(',').map(async (planId) => {
            const plan = await reread(planId);
            if (gen !== generation.current) return;
            // Not read this time: read again on the next tick.
            if (plan === undefined) return void update(planId, (e) => ({ ...e }));
            settle(planId, plan, null);
          }),
        );
      },
      returned ? 0 : POLL_MS,
    );
    return () => clearTimeout(timer);
  }, [watching, entries, hidden, reread, settle, update]);

  const answer = useCallback(
    async (planId: string, how: 'confirm' | 'decline') => {
      const entry = current.current.find((e) => e.plan.id === planId);
      if (entry === undefined || entry.acting !== null) return;
      const gen = generation.current;
      update(planId, (e) => ({ ...e, acting: how, error: null }));
      try {
        const plan = await (how === 'confirm' ? api.confirm(entry.plan) : api.decline(entry.plan));
        if (gen === generation.current) settle(planId, plan, null);
      } catch (e) {
        if (gen !== generation.current) return;
        const error = asApiError(e);
        // Refused: read it again, to show where it stands — changed, expired, answered elsewhere.
        const plan = await reread(planId);
        if (gen !== generation.current) return;
        if (plan === undefined) update(planId, (x) => ({ ...x, acting: null, error }));
        else settle(planId, plan, error);
      }
    },
    [api, reread, settle, update],
  );

  const confirm = useCallback((planId: string) => answer(planId, 'confirm'), [answer]);
  const decline = useCallback((planId: string) => answer(planId, 'decline'), [answer]);

  return useMemo(
    () => ({ entries, failed, refresh, confirm, decline }),
    [entries, failed, refresh, confirm, decline],
  );
}
