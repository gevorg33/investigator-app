// Shared auth primitives and the Actor type.
//
// This package is the CONTRACT — the vocabulary of roles, staff scopes and the Actor
// shape. It holds no authorization logic on purpose.
//
// The decision lives in apps/api/src/common/authz. Two reasons. Authorization is a
// backend responsibility (CLAUDE.md: the AI proposes, the backend authorizes), and a
// rule shipped to a browser bundle invites the belief that the browser enforces it.
// Practically, this package is ESM and apps/api is CommonJS, so the API consumes these
// as type-only imports, which are erased at compile time; runtime code here would not be
// requirable from the API at all.

/**
 * What a person can be. A single account can hold several — someone may hire an
 * investigator for one thing and take work as one on another, without a second account
 * (plan.md:12).
 */
export type Role = 'CUSTOMER' | 'INVESTIGATOR' | 'STAFF';

/**
 * What a staff member is allowed to be trusted with, one area each.
 *
 * The authorization skill's rule is that `isStaff` is never a sufficient check: "a
 * moderator is not a payments reviewer". These are derived from the staff capabilities
 * in plan.md §7 so that each listed capability maps to exactly one scope.
 */
export type StaffScope =
  /** Review investigator verification submissions (plan.md: "Review investigator verification"). */
  | 'VERIFICATION'
  /** Review flagged missions, moderate profiles and content. Publishes missions. */
  | 'MODERATION'
  /** Manage disputes between customers and investigators. */
  | 'DISPUTES'
  /** Review payments and payouts. Deliberately separate from moderation. */
  | 'PAYMENTS'
  /** Manage categories, translations and policy text. */
  | 'TAXONOMY'
  /** Suspend accounts and assignments. The enforcement scope. */
  | 'ENFORCEMENT';

export const STAFF_SCOPES: readonly StaffScope[] = [
  'VERIFICATION',
  'MODERATION',
  'DISPUTES',
  'PAYMENTS',
  'TAXONOMY',
  'ENFORCEMENT',
] as const;

/** Mirrors the `account_status` enum in the database. */
export type AccountStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DELETED';

/**
 * The authenticated caller, resolved once per request and passed down.
 *
 * Everything needed for checks 1, 2, 3 and 6 of the six-check procedure is here, so a
 * service never has to go back to the database to ask who it is talking to. Checks 4 and
 * 5 — resource relationship and state — depend on the resource and cannot live here.
 *
 * Read-only by construction: an Actor that a downstream service can widen is not a
 * security boundary.
 */
export interface Actor {
  readonly userId: string;
  /** The session this request arrived on, so a mutation can be traced to one device. */
  readonly sessionId: string;
  readonly status: AccountStatus;
  readonly roles: readonly Role[];
  /** Empty unless `roles` includes STAFF. Never consulted for a non-staff actor. */
  readonly staffScopes: readonly StaffScope[];
  /**
   * The single role the caller has narrowed themselves to, if any.
   *
   * Someone who is both a customer and an investigator sees one workspace at a time, and
   * switching between them must not need a new sign-in (T-006). This is that switch.
   *
   * It can only ever REMOVE permissions. It is intersected with `roles` when the Actor is
   * built, so a client naming a role it does not hold ends up with `undefined` — the same
   * position as not switching at all — rather than acquiring the role. Undefined means no
   * narrowing: every held role applies.
   */
  readonly activeRole?: Role | undefined;
}
