import { cookies } from 'next/headers';
import { cache } from 'react';
import { ACTIVE_ROLE_COOKIE, SESSION_COOKIE } from '@/lib/session-cookies';
import { ApiError, bodyOf, toApiError } from './errors';
import type { LegalDocument, WorkspaceView } from './types';

/** Where the server reaches the API. In production, the internal address; in development, local. */
const apiOrigin = (): string => process.env['API_INTERNAL_URL'] ?? 'http://localhost:3001';

/**
 * A call from the Next server to the API, as the reader: their session cookie is forwarded, and
 * the role they chose to act as travels as `X-Active-Role` (which the API only ever narrows by).
 * Nothing is cached — every read is this reader's, now.
 */
export async function serverApi<T>(
  path: string,
  { method = 'GET', body }: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T | null> {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  const role = jar.get(ACTIVE_ROLE_COOKIE)?.value;
  const headers: Record<string, string> = {};
  if (session !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${session}`;
  if (role !== undefined) headers['x-active-role'] = role;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${apiOrigin()}/api/v1${path}`, {
    method,
    headers,
    cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await toApiError(res);
  return bodyOf<T>(res);
}

/** The signed-in account, as `GET /me` describes it. */
export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  roles: Array<'CUSTOMER' | 'INVESTIGATOR' | 'STAFF'>;
  activeRole: 'CUSTOMER' | 'INVESTIGATOR' | 'STAFF' | null;
  locale: string;
  timezone: string;
}

/** Who is signed in for this request, or null — read once per request. */
export const getAccount = cache(async (): Promise<Account | null> => {
  try {
    return await serverApi<Account>('/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
});

/**
 * The reader's workspaces — read once per request. The API lists them only to an active account,
 * and an account is not active until its address is confirmed: an unconfirmed reader has none to
 * use, so it is not asked, and is not refused (T-164).
 */
export const getWorkspaces = cache(async (): Promise<WorkspaceView[]> => {
  const account = await getAccount();
  if (account?.emailVerified !== true) return [];
  return (await serverApi<WorkspaceView[]>('/workspaces'))!;
});

/** The documents this account still has to accept — read once per request. */
export const getOutstanding = cache(
  async (): Promise<LegalDocument[]> =>
    (await serverApi<LegalDocument[]>('/legal/outstanding')) ?? [],
);
