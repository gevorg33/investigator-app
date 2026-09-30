'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { callApi } from '@/lib/api/browser';

interface Unread {
  /** How many of the reader's notifications are unread; null until known, or when it cannot be. */
  count: number | null;
  /** Ask the API again. */
  refresh: () => Promise<void>;
  /** What the centre has just done to it: marked one read, or all. */
  set: (update: (count: number) => number) => void;
}

const UnreadContext = createContext<Unread | null>(null);

/**
 * The reader's unread count (T-169), once for the whole shell: the sidebar's bell and the phone's
 * share it, and the centre updates it as it marks things read. Read when the app loads and again
 * whenever the tab comes back into view — nothing arrives on its own until browser push (T-170), so
 * that is when a new notification is most likely to be waiting. A count that cannot be read shows
 * no badge; it is never a guess.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await callApi<{ count: number }>('/notifications/unread', { method: 'GET' });
      setCount(res?.count ?? null);
    } catch {
      setCount(null);
    }
  }, []);
  const set = useCallback(
    (update: (count: number) => number) =>
      setCount((c) => (c === null ? c : Math.max(0, update(c)))),
    [],
  );
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);
  return (
    <UnreadContext.Provider value={{ count, refresh, set }}>{children}</UnreadContext.Provider>
  );
}

export function useUnread(): Unread {
  const unread = useContext(UnreadContext);
  if (unread === null) throw new Error('useUnread outside NotificationsProvider');
  return unread;
}
