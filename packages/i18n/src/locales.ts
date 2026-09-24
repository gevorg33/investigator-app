/**
 * The launch locales (plan.md, localization skill). Adding a fourth touches this list and the
 * catalogs — never the domain model.
 */
export const LOCALES = ['en', 'ru', 'hy'] as const;
export type Locale = (typeof LOCALES)[number];

/** What a reader gets when nothing says otherwise, and what every catalog falls back to. */
export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

/**
 * Each locale's name in its own language — what a reader looks for when their current one is
 * unreadable to them. From `Intl.DisplayNames`, not a hand-typed list.
 */
export function localeName(locale: Locale): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale)!;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

export interface ResolvedLocale {
  locale: Locale;
  /** Which signal decided — so a fallback can be reported rather than silently taken. */
  source: 'choice' | 'browser' | 'default';
}

/**
 * The reader's locale, from the strongest signal present: their own choice, then what their
 * browser asks for (`Accept-Language`, by preference weight), then English.
 *
 * A signed-in user's saved choice (T-127) arrives as `choice` too — the caller passes whichever it
 * has. Neither input is trusted to be well-formed: an unknown or malformed value is skipped, never
 * an error.
 */
export function resolveLocale(input: {
  choice?: string | undefined;
  acceptLanguage?: string | null | undefined;
}): ResolvedLocale {
  if (isLocale(input.choice)) return { locale: input.choice, source: 'choice' };
  const wanted = (input.acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      // A weight that is present but not a number drops the entry — it is not a weight of 1.
      const q = params.map((p) => /^\s*q=(.*)$/.exec(p)?.[1]).find((v) => v !== undefined);
      const weight = q === undefined ? 1 : /^[\d.]+$/.test(q.trim()) ? Number(q) : Number.NaN;
      return { language: tag.split('-')[0]!.toLowerCase(), q: weight, index };
    })
    .filter((w) => w.q > 0 && Number.isFinite(w.q))
    // Highest weight first; the header's own order breaks ties.
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const match = wanted.find((w) => isLocale(w.language));
  return match === undefined
    ? { locale: DEFAULT_LOCALE, source: 'default' }
    : { locale: match.language as Locale, source: 'browser' };
}
