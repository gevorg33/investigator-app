import type { LonLat, PricingModel } from '@/lib/api/types';

/**
 * Finding investigators (T-120) as it lives in the address bar: a customer's filters, typed and
 * closed — exactly the set `POST /search/investigators` accepts (`discovery.md`). Anything read
 * from the URL is re-checked and dropped when it is not the right shape; the API checks it again.
 *
 * A location is **never** here. "Near me" is the device's position, and coordinates do not
 * belong in URLs, history or logs (`discovery.md`); it lives in the page's memory only.
 *
 * `lang` is not used for the language filter: the middleware reads `?lang=` as a language choice
 * for the whole app (ADR-0013), so the filter is `language`, as in the mission browse.
 */

export const PRICING: readonly PricingModel[] = ['HOURLY', 'FIXED_FEE', 'RETAINER', 'MIXED'];

/** The distances offered around "near me", in kilometres. 0: the location is inside their area. */
export const RADII = [0, 10, 25, 50, 100] as const;

export const DISCOVERY_PATH = '/missions/investigators';

export interface DiscoveryFilters {
  countryCode?: string;
  city?: string;
  /** One category — alternatives are what the tree walk is for (ADR-0007). */
  taxonomyNodeId?: string;
  /** All of them: someone who needs Armenian and English needs both. */
  languages?: string[];
  /** 0 = Monday (ISO 8601) through 6 = Sunday: available for some part of that day. */
  day?: number;
  pricingModel?: PricingModel;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const all = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((s) => s.trim()).filter(Boolean);

/** The filters the address asks for, each kept only when it is one the API would accept. */
export function parseDiscovery(params: SearchParams): DiscoveryFilters {
  const filters: DiscoveryFilters = {};
  const country = first(params['country'])?.toUpperCase();
  if (country !== undefined && /^[A-Z]{2}$/.test(country)) filters.countryCode = country;
  const city = first(params['city'])?.slice(0, 80);
  if (city !== undefined) filters.city = city;
  const category = first(params['category']);
  if (category !== undefined && UUID.test(category)) filters.taxonomyNodeId = category;
  const languages = [...new Set(all(params['language']).filter((l) => /^[a-z]{2}$/.test(l)))];
  // The API takes at most 20 values in a filter (`MAX_FILTER_VALUES`).
  if (languages.length > 0) filters.languages = languages.slice(0, 20);
  const day = first(params['day']);
  if (day !== undefined && /^[0-6]$/.test(day)) filters.day = Number(day);
  const pricing = PRICING.find((p) => p === first(params['pricing']));
  if (pricing !== undefined) filters.pricingModel = pricing;
  return filters;
}

/** The address of a search with these filters. */
export function discoveryHref(filters: DiscoveryFilters): string {
  const q = new URLSearchParams();
  if (filters.taxonomyNodeId !== undefined) q.set('category', filters.taxonomyNodeId);
  for (const l of filters.languages ?? []) q.append('language', l);
  if (filters.countryCode !== undefined) q.set('country', filters.countryCode);
  if (filters.city !== undefined) q.set('city', filters.city);
  if (filters.day !== undefined) q.set('day', String(filters.day));
  if (filters.pricingModel !== undefined) q.set('pricing', filters.pricingModel);
  const query = q.toString();
  return query === '' ? DISCOVERY_PATH : `${DISCOVERY_PATH}?${query}`;
}

/** How many filters narrow the list — a language each, since each is its own requirement. */
export function narrowingCount(filters: DiscoveryFilters): number {
  return (
    (filters.taxonomyNodeId !== undefined ? 1 : 0) +
    (filters.languages?.length ?? 0) +
    (filters.countryCode !== undefined ? 1 : 0) +
    (filters.city !== undefined ? 1 : 0) +
    (filters.day !== undefined ? 1 : 0) +
    (filters.pricingModel !== undefined ? 1 : 0)
  );
}

/** The body `POST /search/investigators` takes for these filters and, when given, a location. */
export function searchBody(
  filters: DiscoveryFilters,
  near: { centre: LonLat; radiusKm: number } | null,
  cursor: string | null,
): Record<string, unknown> {
  return {
    ...(filters.countryCode !== undefined ? { countryCode: filters.countryCode } : {}),
    ...(filters.city !== undefined ? { city: filters.city } : {}),
    ...(filters.taxonomyNodeId !== undefined ? { taxonomyNodeIds: [filters.taxonomyNodeId] } : {}),
    ...(filters.languages !== undefined ? { languages: filters.languages } : {}),
    // Any part of the day: the API matches on overlap, not containment.
    ...(filters.day !== undefined
      ? { availableDuring: { dayOfWeek: filters.day, startMinute: 0, endMinute: 1440 } }
      : {}),
    ...(filters.pricingModel !== undefined ? { pricingModel: filters.pricingModel } : {}),
    ...(near !== null ? { near: near.centre, radiusKm: near.radiusKm } : {}),
    ...(cursor !== null ? { cursor } : {}),
  };
}
