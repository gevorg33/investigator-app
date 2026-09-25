import type { Locale } from './locales.js';

/**
 * Formatting at render time, in the reader's locale (localization skill). The server sends ISO
 * timestamps and integer minor units with a currency code; these turn them into text. Nothing
 * here stores or returns a formatted value as data.
 */

/**
 * A date, a time or both. **The time zone is required** — there is no default, because the
 * default on a server is the server's zone, and a deadline shown in it is wrong for the reader.
 */
export function formatDateTime(
  value: Date | string,
  {
    locale,
    timeZone,
    style = 'dateTime',
  }: { locale: Locale; timeZone: string; style?: 'date' | 'time' | 'dateTime' },
): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'date'
      ? { dateStyle: 'medium' }
      : style === 'time'
        ? { timeStyle: 'short' }
        : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(value));
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Money from integer minor units and an ISO 4217 code: `formatMoney(150000, 'AMD', 'hy')`. The
 * currency's own number of minor digits comes from `Intl` — 2 for AMD and USD, 0 for JPY — so no
 * table of exponents is kept here to drift.
 */
export function formatMoney(minorUnits: number, currency: string, locale: Locale): string {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
  // Always set for a currency format; only the type says it may be absent.
  const digits = format.resolvedOptions().maximumFractionDigits!;
  return format.format(minorUnits / 10 ** digits);
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** "3 hours ago", "in 2 days", "yesterday" — relative to `now`, which the caller supplies. */
export function formatRelativeTime(value: Date | string, now: Date, locale: Locale): string {
  const seconds = (new Date(value).getTime() - now.getTime()) / 1000;
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? UNITS[UNITS.length - 1]!;
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(seconds / size),
    unit,
  );
}
