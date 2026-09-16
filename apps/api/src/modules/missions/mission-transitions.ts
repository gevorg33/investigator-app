import type { StaffScope } from '../../common/authz/contract';
import { missionStatus } from '../../database/schema';

export type MissionStatus = (typeof missionStatus.enumValues)[number];

export const MISSION_STATUSES: readonly MissionStatus[] = missionStatus.enumValues;

/**
 * Who may perform a move. A staff member acts under exactly one scope, named here — never
 * "any staff" (authorization).
 */
export type TransitionAuthority = 'CUSTOMER' | 'INVESTIGATOR' | 'SYSTEM' | `STAFF:${StaffScope}`;

const CUSTOMER = 'CUSTOMER';
const INVESTIGATOR = 'INVESTIGATOR';
const SYSTEM = 'SYSTEM';
const MODERATION = 'STAFF:MODERATION';
const DISPUTES = 'STAFF:DISPUTES';

/**
 * THE mission state machine. This map is the specification: the transition service consults
 * nothing else, and the exhaustive test is generated from it — every pair not listed here is
 * asserted to be refused.
 *
 * Sources: plan.md §8, docs/product/mission-lifecycle.md and
 * `.claude/skills/mission-state-machine/SKILL.md`. T-010 exercises the moves up to review;
 * the rest are declared now so the whole machine is readable and tested in one place, and
 * later tasks call them rather than adding their own. Adding or changing a move is a plan
 * change, not a code change.
 *
 * Deliberately absent:
 * - Anything reaching QUOTED except a moderator publishing from UNDER_REVIEW. Screening
 *   never publishes (T-051).
 * - SUBMITTED → REJECTED. Every rejection is a moderator's, made from UNDER_REVIEW.
 * - A way out of COMPLETED, CANCELLED, REJECTED or EXPIRED. They are terminal; a rejected
 *   customer revises in a new submission.
 */
export const MISSION_TRANSITIONS: Readonly<
  Record<MissionStatus, Readonly<Partial<Record<MissionStatus, readonly TransitionAuthority[]>>>>
> = {
  DRAFT: { SUBMITTED: [CUSTOMER], CANCELLED: [CUSTOMER] },
  // Screening runs in the submitting transaction, so SUBMITTED is never observed from outside.
  SUBMITTED: { UNDER_REVIEW: [SYSTEM] },
  UNDER_REVIEW: {
    QUOTED: [MODERATION], // publish
    REJECTED: [MODERATION], // reject, with a reason the customer can act on
    DRAFT: [MODERATION], // request changes
    CANCELLED: [CUSTOMER],
  },
  QUOTED: { CUSTOMER_CONFIRMED: [CUSTOMER], EXPIRED: [SYSTEM], CANCELLED: [CUSTOMER] },
  CUSTOMER_CONFIRMED: { PAID: [SYSTEM], CANCELLED: [CUSTOMER] },
  // Payment is confirmed by verified webhook, never by a client callback.
  PAID: { ASSIGNED: [SYSTEM] },
  // Window 1: declining before acceptance, including on policy grounds.
  ASSIGNED: { ACCEPTED: [INVESTIGATOR], CANCELLED: [INVESTIGATOR] },
  // Window 2: a policy halt, available at any point after committing.
  ACCEPTED: { IN_PROGRESS: [INVESTIGATOR], SUSPENDED: [INVESTIGATOR, MODERATION] },
  IN_PROGRESS: { REPORT_SUBMITTED: [INVESTIGATOR], SUSPENDED: [INVESTIGATOR, MODERATION] },
  REPORT_SUBMITTED: { CUSTOMER_REVIEW: [SYSTEM] },
  CUSTOMER_REVIEW: { COMPLETED: [CUSTOMER], IN_PROGRESS: [CUSTOMER], DISPUTED: [CUSTOMER] },
  DISPUTED: { COMPLETED: [DISPUTES], CANCELLED: [DISPUTES] },
  // Resolved: the material is dealt with and work resumes, or the assignment is cancelled.
  SUSPENDED: { IN_PROGRESS: [MODERATION], CANCELLED: [MODERATION] },
  COMPLETED: {},
  CANCELLED: {},
  REJECTED: {},
  EXPIRED: {},
};

export function isTransitionAllowed(
  from: MissionStatus,
  to: MissionStatus,
  by: TransitionAuthority,
): boolean {
  return MISSION_TRANSITIONS[from][to]?.includes(by) ?? false;
}
