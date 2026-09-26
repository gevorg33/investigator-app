import { ApiError, bodyOf, toApiError } from './errors';
import { scopeHeaders } from './workspace';

/**
 * A call from the browser to the API, which is same-origin at `/api` (ADR-0002; in development
 * Next's rewrite stands in for Caddy). Signing in, out and up go this way on purpose: the API sets
 * and clears the session cookie on this response itself, so there is one owner of its attributes
 * (T-025) and no copy of them here. Every call names the workspace the page was rendered in
 * (`X-Workspace`, T-092), so a page keeps acting where it shows even if another tab switched, and the
 * role the reader chose to act as (`X-Active-Role`, T-145).
 */
export async function callApi<T = null>(
  path: string,
  {
    method = 'POST',
    body,
    idempotencyKey,
  }: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    /** For a route that requires one: the same key on a retry returns the first result. */
    idempotencyKey?: string;
  } = {},
): Promise<T | null> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...scopeHeaders(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await toApiError(res);
  return bodyOf<T>(res);
}

export { ApiError };
