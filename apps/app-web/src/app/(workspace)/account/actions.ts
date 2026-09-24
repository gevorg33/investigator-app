'use server';

import { isLocale } from '@investigator/i18n';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/i18n/cookie';

/**
 * Records the reader's language choice. Anything that is not a launch locale changes nothing —
 * the value comes from a form, and a form can be edited.
 *
 * Setting it re-renders the page in the new language. T-127 also saves the choice to the account.
 */
export async function chooseLocale(form: FormData): Promise<void> {
  const locale = form.get('locale');
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, LOCALE_COOKIE_OPTIONS);
}
