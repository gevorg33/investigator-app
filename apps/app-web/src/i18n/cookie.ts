/** The cookie holding the reader's language choice. */
export const LOCALE_COOKIE = 'locale';

/** A year: a language choice is not something to make again every visit. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Host-only (no `domain`), HTTP-only and `Secure`, like every cookie on `app.` (ADR-0002). One
 * definition for both places that set it — the language choice and a link carrying `?lang=` —
 * so the two can never disagree about scope or lifetime.
 */
export const LOCALE_COOKIE_OPTIONS = {
  path: '/',
  maxAge: ONE_YEAR_SECONDS,
  sameSite: 'lax',
  secure: true,
  httpOnly: true,
} as const;
