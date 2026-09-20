import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor, StaffScope } from '../authz/contract';
import { AppError } from '../errors/app-error';

/**
 * Crossing workspaces on purpose (T-077; completed by T-079, tenancy.md §7).
 *
 * Row-level security confines every query to the caller's workspace. Two kinds of work are not
 * confined to one: platform staff reviewing what investigators submitted, and system operations
 * with no user at all (an assignment created when a payment is authorized). Both run here, and
 * nowhere else: this module is the only code that can turn on `app.platform_access`, which the
 * policies honour. `tenant-plumbing.spec.ts` holds that, and lists every caller.
 *
 * Entering is not authorizing. The caller has already made its checks — and audited a refusal —
 * through AuthzService; entry re-checks the staff role and scope so that a missed check fails
 * closed rather than widening what the database shows.
 *
 * T-079 adds an audit row for every entry, typed reasons for ad-hoc access, and moderation.
 */
export type PlatformScope = StaffScope | 'SYSTEM';

export interface PlatformAccess {
  readonly scope: PlatformScope;
  /** The fixed, route-defined reason this access exists, e.g. `verification.review`. */
  readonly purpose: string;
  /** The staff member, or null for a system operation. */
  readonly actorId: string | null;
}

const storage = new AsyncLocalStorage<PlatformAccess>();

/** The platform access the current code runs under, if any. */
export function currentPlatformAccess(): PlatformAccess | undefined {
  return storage.getStore();
}

export const PlatformContext = {
  /**
   * Runs `fn` with access across workspaces, for a staff member acting as staff and holding
   * `scope`. Someone who is also a customer does not carry it into their customer role.
   */
  asStaff<T>(actor: Actor, scope: StaffScope, purpose: string, fn: () => Promise<T>): Promise<T> {
    const actingAsStaff = actor.activeRole === undefined || actor.activeRole === 'STAFF';
    if (!actingAsStaff || !actor.roles.includes('STAFF') || !actor.staffScopes.includes(scope)) {
      return Promise.reject(AppError.forbidden());
    }
    return storage.run(Object.freeze({ scope, purpose, actorId: actor.userId }), fn);
  },

  /**
   * Runs `fn` as the system: no user, no workspace. Only for operations no person can trigger,
   * which `tenant-plumbing.spec.ts` lists by caller.
   */
  asSystem<T>(purpose: string, fn: () => Promise<T>): Promise<T> {
    return storage.run(Object.freeze({ scope: 'SYSTEM' as const, purpose, actorId: null }), fn);
  },
};
