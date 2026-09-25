'use client';

import { formatRelativeTime, type Locale } from '@investigator/i18n';
import { ArrowLeft, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AiSession, AssistantApi, SessionMatch } from '@/lib/api/assistant';
import { ApiError } from '@/lib/api/errors';

/** The API's shortest search (`SearchSessionsQuery`): below it, the list is shown instead. */
export const MIN_SEARCH = 2;
/** How long typing pauses before a search is sent. */
export const SEARCH_DELAY_MS = 250;

type Shelf = 'current' | 'archived';

interface ListState {
  status: 'loading' | 'ready' | 'failed';
  items: Array<AiSession | SessionMatch>;
  cursor: string | null;
  error: ApiError | null;
}

const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal');

/**
 * The reader's conversations in this workspace (T-057): current or archived, most recent first, a
 * page at a time — or, once two characters are typed, those whose name or messages match, best
 * first. Choosing one opens it: at its end, or reaching back to where a search found it.
 *
 * Inside the assistant, in place of the conversation: on a phone that is the full-screen sheet
 * (responsive-design — never a squeezed sidebar), on a desktop the docked panel.
 */
export function SessionList({
  api,
  currentId,
  Title = 'h2',
  onOpen,
  onBack,
  onClose,
}: {
  api: AssistantApi;
  currentId: string | null;
  Title?: ComponentType<{ className: string; children: ReactNode }> | 'h2';
  onOpen: (session: AiSession, focus: number | null) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('assistant');
  const locale = useLocale() as Locale;
  const [shelf, setShelf] = useState<Shelf>('current');
  const [q, setQ] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<ListState>({
    status: 'loading',
    items: [],
    cursor: null,
    error: null,
  });
  const query = q.trim();
  const searching = query.length >= MIN_SEARCH;

  useEffect(() => {
    let live = true;
    setList((l) => ({ ...l, status: 'loading', error: null }));
    const read = async () => {
      try {
        const next = searching
          ? { items: await api.search(query), cursor: null }
          : await api.list(shelf === 'archived').then((p) => ({
              items: p.items,
              cursor: p.pageInfo.nextCursor,
            }));
        if (!live) return;
        setList({ status: 'ready', ...next, error: null });
      } catch (e) {
        if (!live) return;
        setList({ status: 'failed', items: [], cursor: null, error: asApiError(e) });
      }
    };
    // A search waits for a pause in typing; the list does not.
    const timer = setTimeout(() => void read(), searching ? SEARCH_DELAY_MS : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, shelf, query, searching, attempt]);

  const more = async () => {
    try {
      const page = await api.list(shelf === 'archived', list.cursor!);
      setList((l) => ({
        ...l,
        items: [...l.items, ...page.items],
        cursor: page.pageInfo.nextCursor,
      }));
    } catch (e) {
      setList((l) => ({ ...l, error: asApiError(e) }));
    }
  };

  const now = new Date();
  const empty = searching
    ? t('sessions.no_match', { q: query })
    : shelf === 'current'
      ? t('sessions.empty_current')
      : t('sessions.empty_archived');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label={t('sessions.back')}
          // Focus comes here when the list opens: the button that opened it is gone.
          autoFocus
        >
          <ArrowLeft aria-hidden />
        </Button>
        <Title className="min-w-0 flex-1 truncate text-base font-semibold">
          {t('sessions.title')}
        </Title>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('close')}>
          <X aria-hidden />
        </Button>
      </header>

      <div className="grid gap-3 border-b border-border px-4 py-3">
        <InputGroup>
          <InputGroupInput
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('sessions.search')}
            placeholder={t('sessions.search')}
            maxLength={200}
          />
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
        </InputGroup>
        {!searching && (
          <ToggleGroup
            type="single"
            value={shelf}
            onValueChange={(v) => v !== '' && setShelf(v as Shelf)}
            aria-label={t('sessions.title')}
          >
            <ToggleGroupItem value="current">{t('sessions.current')}</ToggleGroupItem>
            <ToggleGroupItem value="archived">{t('sessions.archived')}</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
        aria-busy={list.status === 'loading'}
      >
        {list.status === 'loading' && list.items.length === 0 && (
          <div className="grid gap-2 px-2 py-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}

        {list.status === 'failed' && (
          <div className="grid gap-3 px-2 py-2">
            <p className="text-sm">{t('sessions.failed')}</p>
            <FormError error={list.error} />
            <Button
              variant="outline"
              onClick={() => setAttempt((n) => n + 1)}
              className="self-start"
            >
              <RotateCcw aria-hidden />
              {t('turn.retry')}
            </Button>
          </div>
        )}

        {list.status === 'ready' && list.items.length === 0 && (
          <p className="px-2 py-4 text-sm text-text-muted" role="status">
            {empty}
          </p>
        )}

        {list.items.length > 0 && (
          <ul className="grid gap-1">
            {list.items.map((s) => {
              const here = s.id === currentId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onOpen(s, 'firstMatchSequence' in s ? s.firstMatchSequence : null)
                    }
                    aria-current={here ? 'true' : undefined}
                    className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-surface-sunken aria-[current=true]:bg-primary-subtle"
                  >
                    <span className="w-full truncate font-medium">
                      {s.title ?? t('sessions.untitled')}
                    </span>
                    <span className="text-sm text-text-muted">
                      {here
                        ? t('sessions.here')
                        : formatRelativeTime(s.lastActivityAt, now, locale)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {list.status === 'ready' && list.error !== null && <FormError error={list.error} />}

        {!searching && list.status === 'ready' && list.cursor !== null && (
          <Button variant="ghost" onClick={() => void more()} className="mt-2 w-full">
            {t('sessions.more')}
          </Button>
        )}
      </div>
    </div>
  );
}
