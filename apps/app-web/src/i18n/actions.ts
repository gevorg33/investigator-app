'use server';

import { isLocale } from '@investigator/i18n';
import { cookies } from 'next/headers';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import { SESSION_COOKIE } from '@/lib/session-cookies';
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from './cookie';

/**
 * Records the reader's language choice. Anything that is not a launch locale changes nothing —
 * the value comes from a form, and a form can be edited.
 *
 * Signed in, it is saved to the account too (T-127): the account's language is what the next
 * sign-in restores, and what the API's assistant answers in, so the two must agree. The cookie is
 * set first — the page changes language even if saving fails, and a failure to save is reported,
 * not shown as a broken language switch.
 */
export async function chooseLocale(form: FormData): Promise<void> {
  const locale = form.get('locale');
  if (!isLocale(locale)) return;
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, LOCALE_COOKIE_OPTIONS);
  if (jar.get(SESSION_COOKIE) === undefined) return;
  try {
    await serverApi('/me/preferences', { method: 'PATCH', body: { locale } });
  } catch (e) {
    // Signed out since the page loaded: nothing to save to. Anything else is worth knowing about.
    if (!(e instanceof ApiError && e.status === 401))
      console.error('[i18n] saving the language to the account failed', e);
  }
}
