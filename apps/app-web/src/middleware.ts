import { isLocale } from '@investigator/i18n';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/i18n/cookie';

/** The query parameter a link into the app may carry to say which language its reader chose. */
export const LANG_PARAM = 'lang';

/**
 * Carries a language choice across the domain boundary (ADR-0013).
 *
 * The marketing site keeps its locale in the URL (`/ru/pricing`, domain-and-seo) and cannot set
 * a cookie on `app.` — cookies here are host-only. So its links into the app add `?lang=ru`: on
 * arrival that becomes the reader's choice, exactly as if they had picked it under Account, and
 * the parameter is removed so it is never bookmarked, shared or logged as part of the page. An
 * unknown value is removed and changes nothing.
 *
 * Anyone can link with `?lang=`, so anyone can change the language a reader sees — the same as the
 * language control itself, visible and one tap to undo, and nothing else.
 */
export function middleware(request: NextRequest): NextResponse {
  const lang = request.nextUrl.searchParams.get(LANG_PARAM);
  if (lang === null) return NextResponse.next();
  const clean = request.nextUrl.clone();
  clean.searchParams.delete(LANG_PARAM);
  const response = NextResponse.redirect(clean, 303);
  if (isLocale(lang)) response.cookies.set(LOCALE_COOKIE, lang, LOCALE_COOKIE_OPTIONS);
  return response;
}

export const config = {
  // Pages only: never Next's own assets, the favicon or files with an extension.
  matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'],
};
