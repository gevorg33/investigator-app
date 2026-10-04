import { NextResponse } from 'next/server';

/**
 * The page's Content-Security-Policy, with a nonce of its own (T-025). On the request, Next reads
 * the nonce from it and puts it on every script it renders; on the response, the browser enforces
 * it. Never at the edge: the policy is this application's, built from `@investigator/config`.
 * Pages are rendered per request (`ƒ` in the build), as a nonce requires.
 */
export function withPolicy(
  headers: Headers,
  policyFor: (nonce: string, development: boolean) => string,
): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const policy = policyFor(nonce, process.env.NODE_ENV === 'development');
  headers.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  return response;
}
