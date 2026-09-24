import { isLocale } from '@investigator/i18n';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/i18n/cookie';
import { getAccount } from '@/lib/api/server';
import { safeNext } from '@/lib/safe-next';
import { ACTIVE_ROLE_COOKIE } from '@/lib/session-cookies';

/**
 * Where signing in lands (T-127). The browser now holds the session the API just set; this reads
 * the account once and puts its saved language into the locale cookie — the language someone
 * chose is the one they get back, on any device — then clears any role narrowing left from a
 * previous session, and sends them on to a page on this site.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const account = await getAccount();
  if (account === null) return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  if (isLocale(account.locale))
    response.cookies.set(LOCALE_COOKIE, account.locale, LOCALE_COOKIE_OPTIONS);
  response.cookies.delete(ACTIVE_ROLE_COOKIE);
  return response;
}
