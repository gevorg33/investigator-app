import { formatDateTime } from '@investigator/i18n';
import { LOCALE } from '@/i18n/messages';

/** A moment in the reviewer's own time zone — never the server's (localization). */
export const when = (value: string, timeZone: string): string =>
  formatDateTime(value, { locale: LOCALE, timeZone });

/** A short, stable handle for an id: enough to tell rows apart, not a thing to type. */
export const shortId = (id: string): string => id.slice(0, 8);

/** A file size a person reads: KB below a megabyte, MB with one decimal above. */
export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
