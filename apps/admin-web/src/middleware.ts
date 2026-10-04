import { contentSecurityPolicy } from '@investigator/config';
import { type NextRequest, type NextResponse } from 'next/server';
import { withPolicy } from '@/lib/csp';

/**
 * The path and query the reviewer asked for, handed to server components (which cannot read the
 * URL) so the sign-in gate can bring them back to it. Always set here, over anything a client sent.
 */
export const PATHNAME_HEADER = 'x-pathname';

/** Every page carries the console's own Content-Security-Policy, nonce and all (T-025). */
export function middleware(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return withPolicy(headers, (nonce, development) =>
    contentSecurityPolicy('admin', { nonce, development }),
  );
}

export const config = {
  // Pages only: never the API, Next's own assets, the favicon or files with an extension.
  matcher: ['/((?!api/|_next/|favicon.ico|.*\\..*).*)'],
};
