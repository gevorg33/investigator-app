import { AsyncLocalStorage } from 'node:async_hooks';
import type { StaffScope } from '../authz/contract';

/**
 * Where platform access is *held*, separately from where it is *entered* (T-079).
 *
 * The split is not taste: the scoped client has to read this on every query, `PlatformContext`
 * has to write an audit row on every entry, and the audit service reaches the database through
 * the scoped client. One module doing both would close that circle, and the classes in it would
 * start resolving as `undefined`. So this file imports nothing but a type, and
 * `platform-context.ts` — the only thing that may call `enterPlatformAccess` — sits above it.
 */
export type PlatformScope = StaffScope | 'SYSTEM';

/**
 * A purpose a route defines for itself. The route *is* the reason, so there is nothing to type
 * in — and nothing for a reviewer to skim past.
 */
export type RoutePurpose =
  | 'verification.queue'
  | 'verification.review'
  | 'verification.decide'
  | 'verification.open_document'
  | 'media.deliver'
  | 'taxonomy.create_node'
  | 'taxonomy.update_node'
  | 'taxonomy.set_label'
  | 'policy_review.queue'
  | 'policy_review.resolve';

/** A purpose with no fixed route behind it. These must say why, in words, every time. */
export type AdHocPurpose = 'support.lookup';

/** Work no person triggers. It has no actor, so the purpose is all the record there is. */
export type SystemPurpose = 'assignment.create_from_payment';

export interface PlatformAccess {
  readonly scope: PlatformScope;
  readonly purpose: RoutePurpose | AdHocPurpose | SystemPurpose;
  /** Typed by the person, for access no route defines. */
  readonly reason: string | null;
  /** The staff member, or null for a system operation. */
  readonly actorId: string | null;
}

const storage = new AsyncLocalStorage<PlatformAccess>();

/** The platform access the current code runs under, if any. */
export function currentPlatformAccess(): PlatformAccess | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` with `access` in force. `PlatformContext` is the only caller — it checks who is
 * asking and audits the crossing first, and `tenant-plumbing.spec.ts` holds that.
 */
export function enterPlatformAccess<T>(access: PlatformAccess, fn: () => T): T {
  return storage.run(Object.freeze(access), fn);
}
