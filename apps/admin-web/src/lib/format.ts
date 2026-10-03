import { formatDateTime, formatRelativeTime } from '@investigator/i18n';
import { LOCALE } from '@/i18n/messages';

/** A moment in the reviewer's own time zone — never the server's (localization). */
export const when = (value: string, timeZone: string): string =>
  formatDateTime(value, { locale: LOCALE, timeZone });

/** "3 hours ago": how long something has waited, against `now`, which the caller supplies. */
export const ago = (value: string, now: Date): string => formatRelativeTime(value, now, LOCALE);

/** A short, stable handle for an id: enough to tell rows apart, not a thing to type. */
export const shortId = (id: string): string => id.slice(0, 8);

/** A file size a person reads: KB below a megabyte, MB with one decimal above. */
export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * How long a wait took, in the one unit that reads best: minutes under an hour, hours under two
 * days, days beyond — "45 min", "2.5 hr", "3.2 days" (T-193).
 */
export function duration(ms: number): string {
  const [value, unit] =
    ms < HOUR
      ? [ms / MINUTE, 'minute']
      : ms < 48 * HOUR
        ? [ms / HOUR, 'hour']
        : [ms / (24 * HOUR), 'day'];
  return new Intl.NumberFormat(LOCALE, {
    style: 'unit',
    unit,
    unitDisplay: unit === 'day' ? 'long' : 'short',
    maximumFractionDigits: unit === 'minute' ? 0 : 1,
  }).format(value);
}
