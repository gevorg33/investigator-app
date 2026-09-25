'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, callApi } from '@/lib/api/browser';
import type { MissionFields, OwnMission } from '@/lib/api/types';

/** How long typing pauses before it is saved. Long enough not to save every keystroke. */
export const SAVE_DELAY_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export const EMPTY: MissionFields = {
  taxonomyNodeId: null,
  title: null,
  description: null,
  countryCode: null,
  locationLabel: null,
  startBy: null,
  deadline: null,
  budgetMinMinor: null,
  budgetMaxMinor: null,
  currency: null,
  languages: [],
  purpose: null,
  subjectRelationship: null,
  protectiveOrderDeclared: null,
};

const fieldsOf = (m: OwnMission | null): MissionFields =>
  m === null
    ? EMPTY
    : (Object.fromEntries(
        (Object.keys(EMPTY) as (keyof MissionFields)[]).map((k) => [k, m[k]]),
      ) as unknown as MissionFields);

/**
 * A draft that saves itself (T-119). Every change is kept here at once and sent a moment after
 * typing pauses; `flush()` sends what is waiting now, and resolves once it is saved — the intake
 * waits for it before moving on, so a step is never left with its answers unsent.
 *
 * Saves go one at a time, each carrying the version the last one returned, so a draft never races
 * itself into a conflict. The first save creates the draft (`POST /missions/me`), and `onCreated`
 * hears its id — until then there is nothing on the server, so opening the intake leaves no empty
 * draft behind. A save that fails keeps its changes to send with the next one.
 */
export function useDraft(initial: OwnMission | null, onCreated: (mission: OwnMission) => void) {
  const [fields, setFields] = useState<MissionFields>(() => fieldsOf(initial));
  const [mission, setMission] = useState<OwnMission | null>(initial);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<ApiError | null>(null);

  const saved = useRef<OwnMission | null>(initial);
  const waiting = useRef<Partial<MissionFields>>({});
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const created = useRef(onCreated);
  created.current = onCreated;

  const send = useCallback(async (): Promise<boolean> => {
    const body = waiting.current;
    if (Object.keys(body).length === 0) return true;
    waiting.current = {};
    setState('saving');
    setError(null);
    try {
      const before = saved.current;
      const next =
        before === null
          ? await callApi<OwnMission>('/missions/me', { body })
          : await callApi<OwnMission>(`/missions/me/${before.id}`, {
              method: 'PATCH',
              body: { ...body, version: before.version },
            });
      saved.current = next;
      setMission(next);
      setState('saved');
      if (before === null) created.current(next!);
      return true;
    } catch (e) {
      // Kept to go with the next save; anything changed since is newer and wins.
      waiting.current = { ...body, ...waiting.current };
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
      setState('failed');
      return false;
    }
  }, []);

  /** Sends what is waiting, after any save already under way. True once it is all saved. */
  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    queue.current = queue.current.then(send);
    return queue.current;
  }, [send]);

  /**
   * Keeps a change, and sends it after the pause. `hold` keeps it without sending, and withdraws
   * those fields from what is waiting — for answers that cannot be saved as they stand (a start
   * after the finish), so that nothing typed on the way there is saved in their place either.
   */
  const change = useCallback(
    (patch: Partial<MissionFields>, hold: readonly (keyof MissionFields)[] = []) => {
      setFields((f) => ({ ...f, ...patch }));
      if (hold.length > 0) {
        waiting.current = Object.fromEntries(
          Object.entries(waiting.current).filter(([k]) => !hold.includes(k as keyof MissionFields)),
        );
        return;
      }
      waiting.current = { ...waiting.current, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Leaving the intake — another screen, another tab — sends what was typed last.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      void flush();
    };
  }, [flush]);

  /** The mission as last saved — current even inside a callback that began before the save. */
  const latest = useCallback(() => saved.current, []);

  return { fields, mission, state, error, change, flush, latest };
}
