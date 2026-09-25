'use client';

import { Bookmark, BookmarkPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { callApi } from '@/lib/api/browser';
import type { BrowseFilters, SavedMissionSearch } from '@/lib/api/types';
import { browseHref } from './browse-query';

function Remove({ search }: { search: SavedMissionSearch }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, error, onSubmit } = useSubmit(
    () => callApi(`/search/missions/saved/${encodeURIComponent(search.id)}`, { method: 'DELETE' }),
    () => router.refresh(),
  );
  return (
    <form onSubmit={onSubmit} className="contents">
      <FormError error={error} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="rounded-full"
        disabled={pending}
        aria-label={t('missions.browse.saved.remove', { name: search.name })}
      >
        <X aria-hidden />
      </Button>
    </form>
  );
}

/**
 * An investigator's saved browses (T-054): a row of chips above the list, each running its search
 * again from the first page — a saved search holds filters, never a page position. Nothing at all
 * while there are none.
 */
export function SavedSearchList({ saved }: { saved: readonly SavedMissionSearch[] }) {
  const t = useTranslations();
  if (saved.length === 0) return null;
  return (
    <section aria-labelledby="saved-title" className="mt-4 grid gap-2">
      <h2
        id="saved-title"
        className="text-xs font-semibold tracking-wide text-text-muted uppercase"
      >
        {t('missions.browse.saved.title')}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {saved.map((s) => (
          <li
            key={s.id}
            className="flex items-center rounded-full border border-border-control bg-surface-raised"
          >
            <Link
              href={browseHref(s.filters)}
              className="inline-flex min-h-11 items-center gap-2 pl-4 text-sm font-medium"
            >
              <Bookmark aria-hidden className="size-4 text-primary" />
              {s.name}
            </Link>
            <Remove search={s} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Saving the browse on screen under a name: one quiet button next to the active filters, which opens
 * into a name field. Offered only when something narrows the list.
 */
export function SaveSearch({ current }: { current: BrowseFilters }) {
  const t = useTranslations();
  const tl = t as unknown as LooseT;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, setError, onSubmit } = useSubmit(
    (data) =>
      callApi('/search/missions/saved', {
        body: { name: String(data.get('name')), filters: current },
      }),
    () => {
      setOpen(false);
      router.refresh();
    },
  );
  const nameError = fieldErrorKeys(error, tl)['name'];
  if (!open) {
    return (
      <Button variant="ghost" className="text-primary" onClick={() => setOpen(true)}>
        <BookmarkPlus aria-hidden />
        {t('missions.browse.saved.save_open')}
      </Button>
    );
  }
  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 grid gap-2 rounded-lg border border-border bg-surface-raised p-4"
    >
      {nameError === undefined && <FormError error={error} />}
      <label htmlFor="saved-name" className="text-sm font-medium">
        {t('missions.browse.saved.name')}
      </label>
      <Input
        id="saved-name"
        name="name"
        required
        maxLength={80}
        autoFocus
        aria-invalid={nameError === undefined ? undefined : true}
        aria-describedby={nameError === undefined ? undefined : 'saved-name-error'}
      />
      {nameError !== undefined && (
        <p id="saved-name-error" className="text-sm text-danger">
          {tl(nameError)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('missions.browse.saved.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setError(null);
            setOpen(false);
          }}
        >
          {t('missions.browse.saved.cancel')}
        </Button>
      </div>
    </form>
  );
}
