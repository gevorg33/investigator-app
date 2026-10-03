import { formatBudget, formatDateTime, formatMoneyRange, type Locale } from '@investigator/i18n';
import { X } from 'lucide-react';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import type { BrowseFilters, OwnServiceArea } from '@/lib/api/types';
import type { Named } from '@/lib/taxonomy';
import { browseHref, narrowingCount } from './browse-query';

/** `lang` where the label is a category's or tag's, which may be in English on any page (T-197). */
type Chip = { key: string; label: string; lang?: string | undefined; without: BrowseFilters };

const without = (f: BrowseFilters, ...keys: Array<keyof BrowseFilters>): BrowseFilters => {
  const next = { ...f };
  for (const k of keys) delete next[k];
  return next;
};

/**
 * What narrows the list, as chips under the controls (T-054): each says what it is in words and
 * removes itself in one tap — a link to the same browse without it. Nothing at all when nothing
 * narrows the list.
 */
export async function ActiveFilters({
  filters,
  categories,
  areas,
  tags,
  locale,
}: {
  filters: BrowseFilters;
  categories: ReadonlyMap<string, Named>;
  /** Tag names by id (T-055). */
  tags: ReadonlyMap<string, Named>;
  areas: readonly OwnServiceArea[];
  locale: Locale;
}) {
  if (narrowingCount(filters) === 0) return null;
  const t = await getT();
  const names = new Intl.DisplayNames([locale], { type: 'language' });
  const chips: Chip[] = [];
  const node = filters.taxonomyNodeIds?.[0];
  if (node !== undefined) {
    const category = categories.get(node);
    chips.push({
      key: 'category',
      label: category?.label ?? t('missions.browse.category'),
      lang: category?.lang,
      without: without(filters, 'taxonomyNodeIds'),
    });
  }
  const languages = filters.languages ?? [];
  for (const code of languages) {
    const rest = languages.filter((l) => l !== code);
    chips.push({
      key: `language-${code}`,
      label: names.of(code)!,
      without: rest.length === 0 ? without(filters, 'languages') : { ...filters, languages: rest },
    });
  }
  const tagIds = filters.tagIds ?? [];
  for (const id of tagIds) {
    const rest = tagIds.filter((other) => other !== id);
    const tag = tags.get(id);
    chips.push({
      key: `tag-${id}`,
      // A tag retired since the address was made is still a filter; it is named as one.
      label: tag?.label ?? t('missions.browse.tag'),
      lang: tag?.lang,
      without: rest.length === 0 ? without(filters, 'tagIds') : { ...filters, tagIds: rest },
    });
  }
  const { currency, budgetMinMinor: min, budgetMaxMinor: max } = filters;
  if (currency !== undefined) {
    chips.push({
      key: 'budget',
      label:
        min !== undefined && max !== undefined
          ? formatMoneyRange(min, max, currency, locale)
          : min !== undefined
            ? t('missions.browse.chip.budget_from', { amount: formatBudget(min, currency, locale) })
            : max !== undefined
              ? t('missions.browse.chip.budget_to', { amount: formatBudget(max, currency, locale) })
              : currency,
      // A budget is one filter: removing it removes its currency and both ends.
      without: without(
        filters,
        'currency',
        'budgetMinMinor',
        'budgetMaxMinor',
        ...(filters.sort === 'budget' ? (['sort'] as const) : []),
      ),
    });
  }
  if (filters.deadlineTo !== undefined) {
    chips.push({
      key: 'due',
      label: t('missions.browse.chip.due', {
        date: formatDateTime(filters.deadlineTo, { locale, timeZone: 'UTC', style: 'date' }),
      }),
      without: without(filters, 'deadlineTo'),
    });
  }
  if (filters.postedWithinDays !== undefined) {
    chips.push({
      key: 'posted',
      label: t('missions.browse.posted_days', { days: filters.postedWithinDays }),
      without: without(filters, 'postedWithinDays'),
    });
  }
  if (filters.serviceAreaId !== undefined) {
    chips.push({
      key: 'area',
      label: areas.find((a) => a.id === filters.serviceAreaId)?.label ?? t('missions.browse.area'),
      without: without(filters, 'serviceAreaId'),
    });
  }
  if (filters.withinKm !== undefined) {
    chips.push({
      key: 'within',
      label:
        filters.withinKm === 0
          ? t('missions.browse.within_inside')
          : t('missions.browse.within_km', { km: filters.withinKm }),
      without: without(filters, 'withinKm'),
    });
  }

  const keep = {
    ...(filters.q !== undefined ? { q: filters.q } : {}),
    ...(filters.sort !== undefined && filters.sort !== 'budget' ? { sort: filters.sort } : {}),
  };
  return (
    <ul
      className="mt-3 flex flex-wrap items-center gap-2"
      aria-label={t('missions.browse.filters')}
    >
      {chips.map((chip) => (
        <li key={chip.key}>
          {/* Named "Remove filter: …" from its content, so the label inside the name keeps its
              language; what is seen is the label alone. */}
          <Link
            href={browseHref(chip.without)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary bg-primary-subtle pr-3 pl-4 text-sm font-medium text-primary transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-sunken"
          >
            <span className="sr-only">
              {t.rich('missions.browse.chip.remove', {
                name: () => <span lang={chip.lang}>{chip.label}</span>,
              })}
            </span>
            <span aria-hidden lang={chip.lang}>
              {chip.label}
            </span>
            <X aria-hidden className="size-4" />
          </Link>
        </li>
      ))}
      <li>
        <Link
          href={browseHref(keep)}
          className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('missions.browse.clear')}
        </Link>
      </li>
    </ul>
  );
}
