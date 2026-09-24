import { catalogs, en, type Locale } from '@investigator/i18n';
import { createTranslator, type IntlError } from 'use-intl/core';

/**
 * How a message that cannot be shown is handled, on the server and in the browser alike
 * (localization skill: missing values fall back to English and are reported — never a raw key).
 *
 * A missing key cannot reach here: every catalog is typed against English, so it fails the build.
 * What can is a message that fails to format — a bad argument from the calling code. That is
 * reported, and the English text stands in for it.
 */
export function report(error: IntlError, locale: Locale): void {
  // The code and the key, never the values: an argument can be a person's name.
  console.error(`[i18n] ${error.code} (${locale}): ${error.message}`);
}

/** The English text at a key path, or '' — so even a double failure never shows the key. */
export function englishText(path: string): string {
  let node: unknown = en;
  for (const part of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : '';
}

export function intlConfig(locale: Locale) {
  return {
    locale,
    onError: (error: IntlError) => report(error, locale),
    getMessageFallback: ({ namespace, key }: { namespace?: string; key: string }) =>
      englishText(namespace === undefined ? key : `${namespace}.${key}`),
  };
}

/** A translator for `locale`, for code that is not a React component (server components included). */
export function createT(locale: Locale) {
  return createTranslator({ ...intlConfig(locale), messages: catalogs[locale] });
}
