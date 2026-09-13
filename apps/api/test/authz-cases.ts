import { expect } from 'vitest';
import type { Actor, Role, StaffScope } from '../src/common/authz/contract';

/**
 * Lives outside src/ deliberately. It imports vitest, and anything under src/ is compiled
 * into dist -- a shipped build calling require("vitest") would fail on a production
 * install, where vitest is not present. Verified: it did exactly that before the move.
 *
 * The seven authorization cases every protected endpoint must answer
 * (`.claude/skills/authorization/SKILL.md`).
 *
 * It exists because the second case is the one that gets skipped. A suite written by the
 * person who wrote the endpoint tends to exercise the owner, confirm it works, and stop —
 * which proves the happy path and nothing about whether a stranger is kept out. Making
 * all seven a single call means leaving one out is a visible omission rather than an
 * absence nobody notices.
 *
 * ```ts
 * await expectAuthorized(
 *   (actor) => service.publishMission(actor, missionId),
 *   {
 *     owner: customer,
 *     otherOfSameRole: anotherCustomer,   // the IDOR case
 *     wrongRole: investigator,
 *     suspended: suspendedCustomer,
 *     wrongState: { actor: customer, setup: () => cancelMission(missionId) },
 *     staffOutsideScope: moderator,
 *     staffInScope: disputesStaff,
 *   },
 * );
 * ```
 */
export interface AuthorizationCases {
  /** Succeeds. Everything else is measured against this. */
  owner: Actor;
  /**
   * A different user holding the SAME role. The IDOR case.
   *
   * Not a different role — a different *person*. "Is an investigator" is not "is this
   * assignment's investigator", and only this case can tell the two apart.
   */
  otherOfSameRole: Actor;
  /** Right person shape, wrong role for this action. */
  wrongRole?: Actor | undefined;
  /** An account that is not ACTIVE. */
  suspended?: Actor | undefined;
  /** The owner, but with the resource in a state that forbids the action. */
  wrongState?: { actor: Actor; setup: () => Promise<void> } | undefined;
  /** Staff, but holding some other scope. A moderator is not a payments reviewer. */
  staffOutsideScope?: Actor | undefined;
  /** Staff holding the right scope. Succeeds, proving the scope check is not a blanket no. */
  staffInScope?: Actor | undefined;
}

type Attempt = (actor: Actor) => Promise<unknown>;

const statusOf = async (attempt: Attempt, actor: Actor): Promise<number | 'ok'> => {
  try {
    await attempt(actor);
    return 'ok';
  } catch (e) {
    return (e as { status?: number }).status ?? 500;
  }
};

/**
 * Runs every case supplied and asserts the outcome, with a message naming the case so a
 * failure says which of the seven broke rather than only that something did.
 */
export async function expectAuthorized(attempt: Attempt, cases: AuthorizationCases): Promise<void> {
  expect(await statusOf(attempt, cases.owner), 'the owner must be allowed').toBe('ok');

  // 404, not 403: a 403 confirms the id is real to somebody who should not know.
  expect(
    await statusOf(attempt, cases.otherOfSameRole),
    'IDOR: a different user of the same role must not reach this resource',
  ).toBe(404);

  if (cases.wrongRole) {
    expect(await statusOf(attempt, cases.wrongRole), 'the wrong role must be refused').toBe(403);
  }

  if (cases.suspended) {
    expect(
      await statusOf(attempt, cases.suspended),
      'a suspended account must be refused even where it would otherwise be the owner',
    ).toBe(403);
  }

  if (cases.wrongState) {
    await cases.wrongState.setup();
    expect(
      await statusOf(attempt, cases.wrongState.actor),
      'the resource state must be able to forbid the action, not just ownership',
    ).toBe(403);
  }

  if (cases.staffOutsideScope) {
    expect(
      await statusOf(attempt, cases.staffOutsideScope),
      'staff holding a different scope must be refused — isStaff is never the check',
    ).toBe(403);
  }

  if (cases.staffInScope) {
    expect(
      await statusOf(attempt, cases.staffInScope),
      'staff holding the right scope must be allowed, or the scope check is a blanket no',
    ).toBe('ok');
  }
}

/** Case 7 — no identity at all. Separate because it takes no Actor. */
export async function expectRejectsAnonymous(attempt: () => Promise<unknown>): Promise<void> {
  let status: number | 'ok' = 'ok';
  try {
    await attempt();
  } catch (e) {
    status = (e as { status?: number }).status ?? 500;
  }
  expect(status, 'a request with no identity must be rejected').toBe(401);
}

/** Builds an Actor for tests. Defaults to an ordinary active customer. */
export function testActor(over: Partial<Actor> & { userId: string }): Actor {
  return Object.freeze({
    sessionId: `session-${over.userId}`,
    status: 'ACTIVE' as const,
    roles: ['CUSTOMER'] as readonly Role[],
    staffScopes: [] as readonly StaffScope[],
    ...over,
  });
}
