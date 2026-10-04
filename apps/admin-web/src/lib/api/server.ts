import { cookies, headers as incoming } from 'next/headers';
import { SESSION_COOKIE } from '@investigator/config';
import { cache } from 'react';
import { ApiError, bodyOf, toApiError } from './errors';

/** The API's session cookie — set by the API on this origin, host-only (ADR-0002, T-025). */
export { SESSION_COOKIE };

/** Where the server reaches the API. In production, the internal address; in development, local. */
const apiOrigin = (): string => process.env['API_INTERNAL_URL'] ?? 'http://localhost:3001';

/**
 * A call from the console's server to the API, as the reader: their session cookie on this origin
 * is forwarded, and the client's address Caddy gave this server as `X-Forwarded-For` — the API
 * trusts this server as a hop and reads the client from it (T-138). Nothing is cached — every read
 * is this reviewer's, now.
 */
export async function serverApi<T>(path: string): Promise<T | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const forwardedFor = (await incoming()).get('x-forwarded-for');
  const res = await fetch(`${apiOrigin()}/api/v1${path}`, {
    headers: {
      ...(session === undefined ? {} : { cookie: `${SESSION_COOKIE}=${session}` }),
      ...(forwardedFor === null ? {} : { 'x-forwarded-for': forwardedFor }),
    },
    cache: 'no-store',
  });
  if (!res.ok) throw await toApiError(res);
  return bodyOf<T>(res);
}

/** The signed-in account, as `GET /me` describes it — the parts the console reads. */
export interface Account {
  id: string;
  email: string;
  roles: Array<'CUSTOMER' | 'INVESTIGATOR' | 'STAFF'>;
  timezone: string;
}

/** Who is signed in on this origin, or null — read once per request. */
export const getAccount = cache(async (): Promise<Account | null> => {
  try {
    return await serverApi<Account>('/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
});
