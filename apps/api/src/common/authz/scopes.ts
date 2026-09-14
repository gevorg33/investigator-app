import type { Role, StaffScope } from './contract';

/**
 * The runtime list of staff scopes.
 *
 * It lives here rather than being imported from `@investigator/auth` because that package
 * is ESM and this app is CommonJS — a runtime import would not resolve. Rather than let
 * the two drift silently, `Missing` below fails the build if a scope is ever added to the
 * shared union and not to this list.
 */
export const STAFF_SCOPES = [
  'VERIFICATION',
  'MODERATION',
  'DISPUTES',
  'PAYMENTS',
  'TAXONOMY',
  'ENFORCEMENT',
] as const satisfies readonly StaffScope[];

/** Compile-time proof that the list above covers the union. Never evaluated. */
type Missing = Exclude<StaffScope, (typeof STAFF_SCOPES)[number]>;
const _everyScopeIsListed: Missing extends never ? true : ['staff scope missing:', Missing] = true;
void _everyScopeIsListed;

export const ROLES = ['CUSTOMER', 'INVESTIGATOR', 'STAFF'] as const satisfies readonly Role[];

type MissingRole = Exclude<Role, (typeof ROLES)[number]>;
const _everyRoleIsListed: MissingRole extends never ? true : ['role missing:', MissingRole] = true;
void _everyRoleIsListed;
