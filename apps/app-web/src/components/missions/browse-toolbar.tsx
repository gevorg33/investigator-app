'use client';

import { ArrowUpDown, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useTranslations } from 'use-intl';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { NativeSelect } from '@/components/ui/native-select';
import type { BrowseFilters, MissionSort, OwnServiceArea } from '@/lib/api/types';
import { browseHref, SORTS } from './browse-query';
import type { CategoryOption } from '@/lib/taxonomy';
import { FilterSheet } from './filter-sheet';

/**
 * The browse controls (T-054): words to look for across the top; under them the filters and the
 * order, side by side on a phone and on one line with the search from `md`. Every change becomes the
 * address, and the page is rendered from it.
 */
export function BrowseToolbar({
  filters,
  categories,
  areas,
  languages,
}: {
  filters: BrowseFilters;
  categories: readonly CategoryOption[];
  areas: readonly OwnServiceArea[];
  languages: readonly string[];
}) {
  const t = useTranslations('missions.browse');
  const router = useRouter();
  // Closest needs somewhere to measure from.
  const sorts = SORTS.filter((s) => s !== 'closest' || areas.length > 0);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q')).trim();
    const { q: _q, sort, ...rest } = filters;
    // Words order the list by themselves; clearing them goes back to the order that was chosen.
    router.push(
      browseHref(
        q === ''
          ? { ...rest, ...(sort !== undefined && sort !== 'relevance' ? { sort } : {}) }
          : { ...rest, q, sort: 'relevance' },
      ),
    );
  };

  return (
    <div className="mt-6 grid gap-3 md:flex md:items-center">
      <form role="search" onSubmit={search} className="md:flex-1">
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            name="q"
            maxLength={200}
            defaultValue={filters.q ?? ''}
            placeholder={t('search_placeholder')}
            aria-label={t('search')}
            enterKeyHint="search"
          />
        </InputGroup>
      </form>
      <div className="grid grid-cols-2 gap-3 md:flex md:items-center">
        <FilterSheet
          filters={filters}
          categories={categories}
          areas={areas}
          languages={languages}
        />
        {filters.q === undefined ? (
          <label className="relative block md:w-56">
            <span className="sr-only">{t('sort')}</span>
            <ArrowUpDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-text-muted"
            />
            <NativeSelect
              className="pl-9"
              value={filters.sort ?? 'newest'}
              onChange={(e) =>
                router.push(browseHref({ ...filters, sort: e.target.value as MissionSort }))
              }
            >
              {sorts.map((s) => (
                <option key={s} value={s}>
                  {t(`sort_${s}`)}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : (
          <p className="self-center text-sm text-text-muted md:w-56">{t('sort_relevance')}</p>
        )}
      </div>
    </div>
  );
}
