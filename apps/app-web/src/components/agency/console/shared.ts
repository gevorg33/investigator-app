import { ApiError } from '@/lib/api/errors';

/**
 * The agency's system roles, in the order the catalog lists them (tenancy.md §3), for choosing and
 * for display only. What a role lets the reader do is the API's to decide: nothing in the console
 * shows, hides or allows an action by a role's name.
 */
export const ROLE_KEYS = ['OWNER', 'ADMIN', 'MANAGER', 'INVESTIGATOR', 'AGENCY_STAFF', 'VIEWER'];

/** How a member is named in the console: the name on their account, else their address. */
export function memberName(m: { displayName: string | null; email: string }): string {
  return m.displayName?.trim() || m.email;
}

/** Any failure as the API's error shape; no response at all is the API's "something went wrong". */
export function asApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal');
}

/** A refusal the reader's role explains, said in the agency's words rather than the generic one. */
export const FORBIDDEN = { FORBIDDEN: 'agency.console.forbidden' } as const;
