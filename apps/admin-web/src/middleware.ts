import { NextResponse, type NextRequest } from 'next/server';

/**
 * The path and query the reviewer asked for, handed to server components (which cannot read the
 * URL) so the sign-in gate can bring them back to it. Always set here, over anything a client sent.
 */
export const PATHNAME_HEADER = 'x-pathname';

export function middleware(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: never the API, Next's own assets, the favicon or files with an extension.
  matcher: ['/((?!api/|_next/|favicon.ico|.*\\..*).*)'],
};
