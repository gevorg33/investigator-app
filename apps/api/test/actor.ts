import type { Actor, Role, StaffScope } from '../src/common/authz/contract';

/**
 * Separate from `authz-cases.ts` because that file imports vitest, and this one is reached by
 * every fixture — including from `pnpm fixtures:load`, which runs under Node rather than under
 * the test runner and cannot load vitest at all (T-042).
 */
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
