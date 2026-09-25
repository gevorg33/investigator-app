import type { BrowseFilters, MissionSort } from '@/lib/api/types';

/**
 * The mission browse (T-054) as it lives in the address bar.
 *
 * Filters are URL parameters, so a browse is a plain GET form that works before any JavaScript,
 * can be bookmarked, and survives a reload. Everything read from the URL is re-checked here and
 * dropped when it is not the right shape — anyone can write a URL — and the API checks it again.
 * Amounts are whole currency units in the URL, minor units at the API.
 *
 * `lang` is not used for the language filter: the middleware reads `?lang=` as a language choice for
 * the whole app (ADR-0013), so the filter is `language`.
 */

/** The sorts offered as a choice. Relevance is not one: it is what words to look for imply. */
export const SORTS = ['newest', 'closest', 'budget', 'deadline'] as const;

/** The distances offered, in kilometres from a service area's edge. 0 is inside it. */
export const WITHIN_KM = [0, 10, 25, 50, 100, 200] as const;

/** The "posted within" choices, in days. */
export const POSTED_DAYS = [1, 7, 30] as const;

export type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const all = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((s) => s.trim()).filter(Boolean);

/** How many minor units a currency has — 2 for AMD and USD, 0 for JPY — from `Intl`, not a table. */
export function minorDigits(currency: string | undefined): number {
  if (currency === undefined) return 2;
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits!;
  } catch {
    return 2;
  }
}

/** A whole-units amount from the URL or a form, in minor units — or nothing, if it is not one. */
export function toMinorAmount(
  raw: string | undefined,
  currency: string | undefined,
): number | undefined {
  if (raw === undefined || !/^\d{1,12}([.,]\d{1,3})?$/.test(raw)) return undefined;
  const minor = Math.round(Number(raw.replace(',', '.')) * 10 ** minorDigits(currency));
  return minor <= 2_147_483_647 ? minor : undefined;
}

function oneOf<T extends number>(raw: string | undefined, allowed: readonly T[]): T | undefined {
  const n = raw === undefined ? NaN : Number(raw);
  return allowed.find((a) => a === n);
}

/** The browse the address asks for: its filters and, when paging, where to start. */
export function parseBrowse(params: SearchParams): { filters: BrowseFilters; cursor?: string } {
  const currencyRaw = first(params['currency'])?.toUpperCase();
  const currency =
    currencyRaw !== undefined && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : undefined;
  const q = first(params['q'])?.slice(0, 200);
  const sortRaw = first(params['sort']);
  const sort: MissionSort | undefined =
    q !== undefined ? 'relevance' : SORTS.find((s) => s === sortRaw);

  const filters: BrowseFilters = {};
  const category = first(params['category']);
  if (category !== undefined && UUID.test(category)) filters.taxonomyNodeIds = [category];
  const languages = all(params['language'])
    .filter((l) => /^[a-z]{2}$/.test(l))
    .slice(0, 20);
  if (languages.length > 0) filters.languages = languages;
  if (currency !== undefined) filters.currency = currency;
  const min = toMinorAmount(first(params['min']), currency);
  if (min !== undefined) filters.budgetMinMinor = min;
  const max = toMinorAmount(first(params['max']), currency);
  if (max !== undefined) filters.budgetMaxMinor = max;
  const due = first(params['due']);
  if (due !== undefined && DATE.test(due)) filters.deadlineTo = due;
  const area = first(params['area']);
  if (area !== undefined && UUID.test(area)) filters.serviceAreaId = area;
  const within = oneOf(first(params['within']), WITHIN_KM);
  if (within !== undefined) filters.withinKm = within;
  const posted = oneOf(first(params['posted']), POSTED_DAYS);
  if (posted !== undefined) filters.postedWithinDays = posted;
  if (q !== undefined) filters.q = q;
  if (sort !== undefined) filters.sort = sort;

  const cursor = first(params['cursor']);
  return cursor !== undefined && cursor.length <= 512 ? { filters, cursor } : { filters };
}

/** A whole-units amount for the URL and the form, from minor units. */
export function toWhole(minor: number, currency: string | undefined): string {
  return String(minor / 10 ** minorDigits(currency));
}

/** The address of a browse — for paging, and for running a saved search. */
export function browseHref(filters: BrowseFilters, cursor?: string): string {
  const p = new URLSearchParams();
  if (filters.q !== undefined) p.set('q', filters.q);
  if (filters.taxonomyNodeIds?.[0] !== undefined) p.set('category', filters.taxonomyNodeIds[0]);
  for (const l of filters.languages ?? []) p.append('language', l);
  if (filters.currency !== undefined) p.set('currency', filters.currency);
  if (filters.budgetMinMinor !== undefined)
    p.set('min', toWhole(filters.budgetMinMinor, filters.currency));
  if (filters.budgetMaxMinor !== undefined)
    p.set('max', toWhole(filters.budgetMaxMinor, filters.currency));
  if (filters.deadlineTo !== undefined) p.set('due', filters.deadlineTo);
  if (filters.serviceAreaId !== undefined) p.set('area', filters.serviceAreaId);
  if (filters.withinKm !== undefined) p.set('within', String(filters.withinKm));
  if (filters.postedWithinDays !== undefined) p.set('posted', String(filters.postedWithinDays));
  if (filters.sort !== undefined && filters.sort !== 'relevance') p.set('sort', filters.sort);
  if (cursor !== undefined) p.set('cursor', cursor);
  const query = p.toString();
  return query === '' ? '/missions' : `/missions?${query}`;
}

/** How many filters narrow the list — the order and the words to look for are not filters. */
export function narrowingCount(filters: BrowseFilters): number {
  const { q: _q, sort: _sort, ...narrowing } = filters;
  return Object.keys(narrowing).length;
}
