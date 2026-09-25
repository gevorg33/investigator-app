import type { Locale } from '@investigator/i18n';
import type { NodeLabel, Place, Window } from '@/lib/api/assistant';

// `Intl.DisplayNames` falls back to the code itself for one it has no name for (its default
// `fallback: 'code'`), so a name is always there — never `undefined`, whatever its type says.

/** A language's name in the reader's language — "Armenian", «армянский» — from its code. */
export function languageName(code: string, locale: Locale): string {
  return new Intl.DisplayNames([locale], { type: 'language' }).of(code)!;
}

/** A country's name in the reader's language, from its ISO code. */
export function countryName(code: string, locale: Locale): string {
  return new Intl.DisplayNames([locale], { type: 'region' }).of(code)!;
}

/** A weekday's name, 0 = Monday — the week as investigators declare their hours. */
export function weekday(day: number, locale: Locale): string {
  // 2024-01-01 was a Monday; the zone is fixed so the name never shifts with the reader's.
  const monday = Date.UTC(2024, 0, 1);
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(monday + day * 86_400_000),
  );
}

/** Minutes from midnight as a time of day, in the reader's convention. */
export function clock(minutes: number, locale: Locale): string {
  // 1440 is the end of the day: shown as midnight, the way a person reads "until midnight".
  const at = new Date(Date.UTC(2024, 0, 1, 0, minutes % 1440));
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    at,
  );
}

/** A weekly window as a day and hours. */
export function windowParts(w: Window, locale: Locale) {
  return { day: weekday(w.dayOfWeek, locale), from: clock(w.startMinute, locale), to: clock(w.endMinute, locale) };
}

/** A place, most specific first: city, region, country. */
export function placeName(p: Place, locale: Locale): string {
  return [p.city, p.region, p.countryCode === undefined ? undefined : countryName(p.countryCode, locale)]
    .filter((part) => part !== undefined)
    .join(', ');
}

/** Names in a list, joined the reader's way — "fraud, audit and tracing". */
export function list(items: readonly string[], locale: Locale): string {
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
}

/** Taxonomy labels, with a node that has no label in this language shown by nothing rather than an id. */
export function labels(nodes: readonly NodeLabel[]): string[] {
  return nodes.map((n) => n.label).filter((l): l is string => l !== null);
}
