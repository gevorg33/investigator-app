import { describe, expect, it, vi } from 'vitest';
import { AuthzService } from '../src/common/authz/authz.service';
import type { Actor } from '../src/common/authz/contract';
import { expectAuthorized, expectRejectsAnonymous } from './authz-cases';
import { testActor } from './actor';

/**
 * The helper is a checklist, and a checklist that cannot fail is decoration. These drive
 * a deliberately broken subject past each of the seven cases and assert the helper
 * notices — so a real endpoint cannot pass it by being wrong in a way it does not look at.
 */
describe('the seven-case helper', () => {
  const authz = new AuthzService({ record: vi.fn().mockResolvedValue(undefined) } as never);
  const ctx = { action: 'thing.do', resourceType: 'thing', resourceId: 't1' };

  const OWNER = testActor({ userId: 'owner' });
  const STRANGER = testActor({ userId: 'stranger' });
  const INVESTIGATOR = testActor({ userId: 'inv', roles: ['INVESTIGATOR'] });
  const SUSPENDED = testActor({ userId: 'owner', status: 'SUSPENDED' });
  const MODERATOR = testActor({ userId: 's1', roles: ['STAFF'], staffScopes: ['MODERATION'] });
  const DISPUTES = testActor({ userId: 's2', roles: ['STAFF'], staffScopes: ['DISPUTES'] });

  /** A correct subject: owned by OWNER, customer-only, needs the DISPUTES scope for staff. */
  const correct = async (actor: Actor): Promise<unknown> => {
    if (actor.roles.includes('STAFF')) {
      await authz.requireStaffScope(actor, 'DISPUTES', ctx);
      return 'ok';
    }
    await authz.requireActive(actor, ctx);
    await authz.requireRole(actor, 'CUSTOMER', ctx);
    return authz.visible(actor, actor.userId === 'owner' ? { id: 't1' } : undefined, ctx);
  };

  const allCases = {
    owner: OWNER,
    otherOfSameRole: STRANGER,
    wrongRole: INVESTIGATOR,
    suspended: SUSPENDED,
    staffOutsideScope: MODERATOR,
    staffInScope: DISPUTES,
  };

  it('passes a subject that gets every case right', async () => {
    await expect(expectAuthorized(correct, allCases)).resolves.toBeUndefined();
  });

  it('fails when the owner is refused', async () => {
    const refusesEveryone = async (): Promise<never> => authz.visible(OWNER, undefined, ctx);
    await expect(expectAuthorized(refusesEveryone, allCases)).rejects.toThrow(/owner must be allowed/);
  });

  it('fails when a stranger reaches the resource — the IDOR case', async () => {
    // The failure this whole helper exists for: an endpoint that only ever got tested
    // with its owner.
    const ignoresOwnership = async (): Promise<unknown> => ({ id: 't1' });
    await expect(expectAuthorized(ignoresOwnership, allCases)).rejects.toThrow(/IDOR/);
  });

  it('fails when a stranger is refused with 403 instead of 404', async () => {
    // 403 confirms the id is real to somebody who should not know it exists.
    const leaksExistence = async (actor: Actor): Promise<unknown> =>
      actor.userId === 'owner' ? { id: 't1' } : authz.stateAllows(actor, false, ctx);
    await expect(expectAuthorized(leaksExistence, allCases)).rejects.toThrow(/IDOR/);
  });

  it('fails when the wrong role is allowed', async () => {
    const noRoleCheck = async (actor: Actor): Promise<unknown> => {
      await authz.requireActive(actor, ctx);
      return authz.visible(actor, actor.userId === 'owner' ? { id: 't1' } : undefined, ctx);
    };
    await expect(expectAuthorized(noRoleCheck, allCases)).rejects.toThrow(/wrong role/);
  });

  it('fails when a suspended account is allowed', async () => {
    const noStatusCheck = async (actor: Actor): Promise<unknown> => {
      if (actor.roles.includes('STAFF')) {
        await authz.requireStaffScope(actor, 'DISPUTES', ctx);
        return 'ok';
      }
      await authz.requireRole(actor, 'CUSTOMER', ctx);
      return authz.visible(actor, actor.userId === 'owner' ? { id: 't1' } : undefined, ctx);
    };
    await expect(expectAuthorized(noStatusCheck, allCases)).rejects.toThrow(/suspended/);
  });

  it('fails when staff outside the scope are allowed — isStaff is never the check', async () => {
    const trustsIsStaff = async (actor: Actor): Promise<unknown> => {
      if (actor.roles.includes('STAFF')) return 'ok';
      return correct(actor);
    };
    await expect(expectAuthorized(trustsIsStaff, allCases)).rejects.toThrow(/different scope/);
  });

  it('fails when the right staff scope is refused, catching a blanket no', async () => {
    const refusesAllStaff = async (actor: Actor): Promise<unknown> => {
      if (actor.roles.includes('STAFF')) return authz.stateAllows(actor, false, ctx);
      return correct(actor);
    };
    await expect(expectAuthorized(refusesAllStaff, allCases)).rejects.toThrow(/blanket no/);
  });

  it('fails when resource state cannot forbid the action', async () => {
    let cancelled = false;
    const ignoresState = async (actor: Actor): Promise<unknown> => correct(actor);
    await expect(
      expectAuthorized(ignoresState, {
        ...allCases,
        wrongState: {
          actor: OWNER,
          setup: async () => {
            cancelled = true;
          },
        },
      }),
    ).rejects.toThrow(/state must be able to forbid/);
    expect(cancelled).toBe(true);
  });

  it('checks the anonymous case separately, since it takes no actor', async () => {
    await expect(
      expectRejectsAnonymous(async () => {
        throw Object.assign(new Error('no identity'), { status: 401 });
      }),
    ).resolves.toBeUndefined();

    await expect(expectRejectsAnonymous(async () => 'served')).rejects.toThrow(/no identity/);
  });
});
