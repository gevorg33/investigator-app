import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthzService, type AuthzContext } from './authz.service';
import { testActor } from '../../../test/actor';
import type { Actor } from './contract';

const ctx: AuthzContext = { action: 'mission.publish', resourceType: 'mission', resourceId: 'm1' };

describe('the six checks', () => {
  let audit: { record: ReturnType<typeof vi.fn> };
  let authz: AuthzService;

  const statusOf = async (run: Promise<unknown>): Promise<number | 'ok'> =>
    run.then(() => 'ok' as const).catch((e: { status?: number }) => e.status ?? 500);

  beforeEach(() => {
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    authz = new AuthzService(audit as never);
  });

  describe('check 2 — account status', () => {
    it('allows an active account', async () => {
      expect(await statusOf(authz.requireActive(testActor({ userId: 'u1' }), ctx))).toBe('ok');
    });

    for (const status of ['SUSPENDED', 'DELETED', 'PENDING_VERIFICATION'] as const) {
      it(`refuses ${status}`, async () => {
        const actor = testActor({ userId: 'u1', status });
        expect(await statusOf(authz.requireActive(actor, ctx))).toBe(403);
      });
    }
  });

  describe('check 3 — role held', () => {
    it('allows a role the actor holds', async () => {
      const actor = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
      expect(await statusOf(authz.requireRole(actor, 'INVESTIGATOR', ctx))).toBe('ok');
    });

    it('refuses a role the actor does not hold', async () => {
      const actor = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
      expect(await statusOf(authz.requireRole(actor, 'INVESTIGATOR', ctx))).toBe(403);
    });

    it('allows either role when the actor holds both and has not narrowed', async () => {
      const both = testActor({ userId: 'u1', roles: ['CUSTOMER', 'INVESTIGATOR'] });
      expect(await statusOf(authz.requireRole(both, 'CUSTOMER', ctx))).toBe('ok');
      expect(await statusOf(authz.requireRole(both, 'INVESTIGATOR', ctx))).toBe('ok');
    });
  });

  describe('role switching narrows and never widens', () => {
    const both = (active: 'CUSTOMER' | 'INVESTIGATOR'): Actor =>
      testActor({ userId: 'u1', roles: ['CUSTOMER', 'INVESTIGATOR'], activeRole: active });

    it('allows the role switched to', async () => {
      expect(await statusOf(authz.requireRole(both('INVESTIGATOR'), 'INVESTIGATOR', ctx))).toBe(
        'ok',
      );
    });

    it('refuses the other held role while narrowed to one', async () => {
      // Narrowing removes permissions. Acting as an investigator means not acting as a
      // customer in the same request, even though both roles are held.
      expect(await statusOf(authz.requireRole(both('INVESTIGATOR'), 'CUSTOMER', ctx))).toBe(403);
    });

    it('cannot grant a role that is not held', async () => {
      // The Actor is built by intersection, so this state is unreachable through the
      // guard. Asserted anyway: the whole safety of role switching rests on it.
      const lying = testActor({ userId: 'u1', roles: ['CUSTOMER'], activeRole: 'STAFF' });
      expect(await statusOf(authz.requireRole(lying, 'STAFF', ctx))).toBe(403);
    });
  });

  describe('check 6 — staff scope, never isStaff', () => {
    const moderator = testActor({
      userId: 'staff1',
      roles: ['STAFF'],
      staffScopes: ['MODERATION'],
    });

    it('allows a staff member holding the scope', async () => {
      expect(await statusOf(authz.requireStaffScope(moderator, 'MODERATION', ctx))).toBe('ok');
    });

    it('refuses a moderator acting as a payments reviewer', async () => {
      expect(await statusOf(authz.requireStaffScope(moderator, 'PAYMENTS', ctx))).toBe(403);
    });

    it('refuses a non-staff actor holding no scopes', async () => {
      const customer = testActor({ userId: 'u1' });
      expect(await statusOf(authz.requireStaffScope(customer, 'MODERATION', ctx))).toBe(403);
    });

    it('refuses a non-staff actor even if scopes were somehow attached', async () => {
      const odd = testActor({ userId: 'u1', roles: ['CUSTOMER'], staffScopes: ['PAYMENTS'] });
      expect(await statusOf(authz.requireStaffScope(odd, 'PAYMENTS', ctx))).toBe(403);
    });
  });

  describe('check 4 — resource relationship', () => {
    it('returns the row when it is visible', async () => {
      const row = { id: 'm1' };
      await expect(authz.visible(testActor({ userId: 'u1' }), row, ctx)).resolves.toBe(row);
    });

    for (const [label, value] of [
      ['undefined', undefined],
      ['null', null],
    ] as const) {
      it(`answers 404 for ${label}, never 403`, async () => {
        // 403 would confirm the id is real to somebody who should not know it exists.
        expect(await statusOf(authz.visible(testActor({ userId: 'u1' }), value, ctx))).toBe(404);
      });
    }
  });

  describe('check 5 — resource state', () => {
    it('allows a permitted state', async () => {
      expect(await statusOf(authz.stateAllows(testActor({ userId: 'u1' }), true, ctx))).toBe('ok');
    });

    it('answers 403, because the actor already knows the resource exists', async () => {
      expect(await statusOf(authz.stateAllows(testActor({ userId: 'u1' }), false, ctx))).toBe(403);
    });
  });

  describe('denials are audited and say nothing to the caller', () => {
    it('records which check failed', async () => {
      const actor = testActor({ userId: 'u1', status: 'SUSPENDED' });
      await authz.requireActive(actor, ctx).catch(() => undefined);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'u1',
          action: 'authz.denied.mission.publish',
          resourceType: 'mission',
          reason: 'account_not_active',
        }),
      );
    });

    it('audits every denial, so a burst of them across ids is visible', async () => {
      // Enumeration is invisible without these rows.
      const actor = testActor({ userId: 'u1' });
      for (const id of ['m1', 'm2', 'm3']) {
        await authz.visible(actor, undefined, { ...ctx, resourceId: id }).catch(() => undefined);
      }
      expect(audit.record).toHaveBeenCalledTimes(3);
    });

    it('tells the caller nothing about which check failed', async () => {
      const suspended = testActor({ userId: 'u1', status: 'SUSPENDED' });
      const wrongRole = testActor({ userId: 'u2', roles: ['CUSTOMER'] });
      const outOfScope = testActor({ userId: 'u3', roles: ['STAFF'], staffScopes: ['MODERATION'] });

      const bodies = await Promise.all([
        authz.requireActive(suspended, ctx).catch((e: Error) => JSON.stringify(e)),
        authz.requireRole(wrongRole, 'INVESTIGATOR', ctx).catch((e: Error) => JSON.stringify(e)),
        authz.requireStaffScope(outOfScope, 'PAYMENTS', ctx).catch((e: Error) => JSON.stringify(e)),
      ]);
      // Three different reasons, one indistinguishable refusal.
      expect(new Set(bodies).size).toBe(1);
      for (const b of bodies) expect(b).not.toContain('reason');
    });
  });
});
