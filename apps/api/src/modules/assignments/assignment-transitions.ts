import type { StaffScope } from '../../common/authz/contract';
import { assignmentStatus } from '../../database/schema';

export type AssignmentStatus = (typeof assignmentStatus.enumValues)[number];

export const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = assignmentStatus.enumValues;

/** Who may perform a move. A staff member acts under one named scope, never "any staff". */
export type TransitionAuthority = 'CUSTOMER' | 'INVESTIGATOR' | 'SYSTEM' | `STAFF:${StaffScope}`;

const CUSTOMER = 'CUSTOMER';
const INVESTIGATOR = 'INVESTIGATOR';
const SYSTEM = 'SYSTEM';
const MODERATION = 'STAFF:MODERATION';
const DISPUTES = 'STAFF:DISPUTES';

/**
 * THE assignment state machine — a **separate machine** from the mission's, as
 * `mission-state-machine` requires. Collapsing them would be wrong in both directions: a
 * payment can fail while the mission sits in CUSTOMER_CONFIRMED, and a policy halt is an
 * assignment-level event with no mission meaning.
 *
 * No document enumerated these states. This map is the smallest set that covers what the
 * knowledge base already promises, and it is now the specification: the exhaustive matrix is
 * generated from it, so every pair not listed here is asserted to be refused. Adding a state
 * or an edge is a plan change, not a code change.
 *
 * Sources for each edge:
 * - "Until you accept, the work is not yours" and the acceptance window
 *   (`kb-investigator-assignments`)
 * - "Decline before accepting, and do it promptly" — the customer is then released
 * - The two policy-refusal windows (`mission-state-machine`): decline before acceptance,
 *   halt at any point after it
 * - "You can [cancel after the investigator has started], but the cancellation terms in your
 *   accepted quote determine what you are refunded" (`kb-customer-assignments-progress`)
 * - "When you submit your report and the customer accepts it. They may request revisions first."
 */
export const ASSIGNMENT_TRANSITIONS: Readonly<
  Record<
    AssignmentStatus,
    Readonly<Partial<Record<AssignmentStatus, readonly TransitionAuthority[]>>>
  >
> = {
  PENDING_ACCEPTANCE: {
    ACCEPTED: [INVESTIGATOR],
    // The investigator declines, or the acceptance window closes and releases the customer.
    CANCELLED: [INVESTIGATOR, SYSTEM, CUSTOMER],
  },
  ACCEPTED: {
    IN_PROGRESS: [INVESTIGATOR],
    // Window 2 of policy refusal: the halt is available at any point after committing.
    SUSPENDED: [INVESTIGATOR, MODERATION],
    CANCELLED: [CUSTOMER, DISPUTES],
  },
  IN_PROGRESS: {
    REPORT_SUBMITTED: [INVESTIGATOR],
    SUSPENDED: [INVESTIGATOR, MODERATION],
    CANCELLED: [CUSTOMER, DISPUTES],
  },
  REPORT_SUBMITTED: {
    COMPLETED: [CUSTOMER],
    // Revisions requested: back to the investigator rather than a new state.
    IN_PROGRESS: [CUSTOMER],
    CANCELLED: [DISPUTES],
  },
  // Either the material is removed and the work resumes, or the assignment is cancelled.
  SUSPENDED: {
    IN_PROGRESS: [MODERATION],
    CANCELLED: [MODERATION, DISPUTES],
  },
  COMPLETED: {},
  CANCELLED: {},
};

export function isTransitionAllowed(
  from: AssignmentStatus,
  to: AssignmentStatus,
  by: TransitionAuthority,
): boolean {
  return ASSIGNMENT_TRANSITIONS[from][to]?.includes(by) ?? false;
}
