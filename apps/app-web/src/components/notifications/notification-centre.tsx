'use client';

import { formatRelativeTime, type Locale } from '@investigator/i18n';
import { BellOff, CheckCheck, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { callApi } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';
import type { NotificationPage, NotificationView } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { useUnread } from './notifications-provider';

interface ListState {
  status: 'loading' | 'ready' | 'failed';
  items: NotificationView[];
  cursor: string | null;
  error: ApiError | null;
}

const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal');

const page = (cursor: string | null) =>
  callApi<NotificationPage>(
    cursor === null ? '/notifications' : `/notifications?cursor=${encodeURIComponent(cursor)}`,
    { method: 'GET' },
  ).then((p) => p ?? { items: [], nextCursor: null });

/**
 * The notification centre (T-169): the reader's notifications in this workspace, newest first, a
 * page at a time. Each says what kind of thing happened and leads to it — never the thing itself
 * (T-036) — and opening one marks it read. Read when opened, so it is never staler than the moment
 * the reader looked; the shell's count is refreshed with it.
 *
 * The frame is the caller's: a popover from `md` up, a sheet on a phone (`NotificationBell`).
 */
export function NotificationCentre({
  title,
  close,
  onNavigate,
}: {
  /** The frame's own title element — a popover's heading, or the sheet's `DrawerTitle`. */
  title: ReactNode;
  /** A close button, where the frame needs one. */
  close?: ReactNode;
  /** Called as a notification is opened, so the frame can close behind it. */
  onNavigate: () => void;
}) {
  const t = useTranslations('notifications');
  const locale = useLocale() as Locale;
  const unread = useUnread();
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<ListState>({
    status: 'loading',
    items: [],
    cursor: null,
    error: null,
  });
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<ApiError | null>(null);

  const { refresh } = unread;
  useEffect(() => {
    let live = true;
    setList((l) => ({ ...l, status: 'loading', error: null }));
    void page(null).then(
      (p) => {
        if (!live) return;
        setList({ status: 'ready', items: p.items, cursor: p.nextCursor, error: null });
        void refresh();
      },
      (e: unknown) => {
        if (!live) return;
        setList({ status: 'failed', items: [], cursor: null, error: asApiError(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [attempt, refresh]);

  const more = async () => {
    try {
      const p = await page(list.cursor);
      setList((l) => ({ ...l, items: [...l.items, ...p.items], cursor: p.nextCursor }));
    } catch (e) {
      setList((l) => ({ ...l, error: asApiError(e) }));
    }
  };

  const open = (n: NotificationView) => {
    if (n.readAt === null) {
      const readAt = new Date().toISOString();
      setList((l) => ({
        ...l,
        items: l.items.map((i) => (i.id === n.id ? { ...i, readAt } : i)),
      }));
      unread.set((c) => c - 1);
      // The page it leads to opens either way; a mark that did not land is read again next time.
      callApi(`/notifications/${encodeURIComponent(n.id)}/read`).catch(() => void refresh());
    }
    onNavigate();
  };

  const markAll = async () => {
    setMarking(true);
    setMarkError(null);
    try {
      await callApi('/notifications/read-all');
      const readAt = new Date().toISOString();
      setList((l) => ({ ...l, items: l.items.map((i) => ({ ...i, readAt: i.readAt ?? readAt })) }));
      unread.set(() => 0);
    } catch (e) {
      setMarkError(asApiError(e));
    } finally {
      setMarking(false);
    }
  };

  const now = new Date();
  const anyUnread = (unread.count ?? 0) > 0 || list.items.some((i) => i.readAt === null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-4">
        <div className="min-w-0 flex-1 truncate">{title}</div>
        {close}
      </div>

      {list.status === 'ready' && anyUnread && (
        <div className="grid justify-items-end gap-2 border-b border-border px-2 py-1">
          <Button
            variant="ghost"
            onClick={() => void markAll()}
            disabled={marking}
            aria-busy={marking}
            className="whitespace-normal"
          >
            <CheckCheck aria-hidden />
            {t('mark_all')}
          </Button>
          <FormError error={markError} />
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
        aria-busy={list.status === 'loading'}
      >
        {list.status === 'loading' && list.items.length === 0 && (
          <div className="grid gap-2 p-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {list.status === 'failed' && (
          <div className="grid gap-3 p-2">
            <p className="text-sm">{t('failed')}</p>
            <FormError error={list.error} />
            <Button
              variant="outline"
              onClick={() => setAttempt((n) => n + 1)}
              className="justify-self-start"
            >
              <RotateCcw aria-hidden />
              {t('retry')}
            </Button>
          </div>
        )}

        {list.status === 'ready' && list.items.length === 0 && (
          <div role="status" className="grid justify-items-center gap-2 px-4 py-8 text-center">
            <BellOff aria-hidden className="size-6 text-text-muted" />
            <p className="font-medium">{t('empty.title')}</p>
            <p className="text-sm text-text-muted">{t('empty.body')}</p>
          </div>
        )}

        {list.items.length > 0 && (
          <ul className="grid gap-1">
            {list.items.map((n) => {
              const isUnread = n.readAt === null;
              return (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => open(n)}
                    className="flex min-h-11 items-start gap-3 rounded-md px-3 py-2 hover:bg-surface-sunken"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-2 size-2 shrink-0 rounded-full',
                        isUnread ? 'bg-primary' : 'bg-transparent',
                      )}
                    />
                    <span className="grid min-w-0 gap-0.5">
                      <span className={cn(isUnread && 'font-semibold')}>{t(`kind.${n.kind}`)}</span>
                      <span className="text-sm text-text-muted">
                        {/* Not by weight and a dot alone: said in words for a screen reader. */}
                        {isUnread && <span className="sr-only">{t('unread')}, </span>}
                        {formatRelativeTime(n.createdAt, now, locale)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {list.status === 'ready' && list.error !== null && <FormError error={list.error} />}

        {list.status === 'ready' && list.cursor !== null && (
          <Button variant="ghost" onClick={() => void more()} className="mt-2 w-full">
            {t('more')}
          </Button>
        )}
      </div>
    </div>
  );
}
