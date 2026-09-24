import { resolveLocale, type ResolvedLocale } from '@investigator/i18n';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { LOCALE_COOKIE } from './cookie';
import { createT } from './translator';

/**
 * The reader's locale for this request: their choice (the cookie), else their browser's
 * `Accept-Language`, else English. Read once per request. When accounts arrive (T-127), a
 * signed-in user's saved language is written to this cookie at sign-in and on change.
 */
export const getLocale = cache(async (): Promise<ResolvedLocale> => {
  const [jar, sent] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    choice: jar.get(LOCALE_COOKIE)?.value,
    acceptLanguage: sent.get('accept-language'),
  });
});

/** The translator for this request's reader. */
export async function getT() {
  return createT((await getLocale()).locale);
}
