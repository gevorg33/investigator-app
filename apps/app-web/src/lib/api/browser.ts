import { ApiError, bodyOf, toApiError } from './errors';

/**
 * A call from the browser to the API, which is same-origin at `/api` (ADR-0002; in development
 * Next's rewrite stands in for Caddy). Signing in, out and up go this way on purpose: the API sets
 * and clears the session cookie on this response itself, so there is one owner of its attributes
 * (T-025) and no copy of them here.
 */
export async function callApi<T = null>(
  path: string,
  { method = 'POST', body }: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T | null> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await toApiError(res);
  return bodyOf<T>(res);
}

export { ApiError };
