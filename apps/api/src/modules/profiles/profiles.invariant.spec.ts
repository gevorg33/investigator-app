import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { ProfilesService } from './profiles.service';

/**
 * Activation creates a profile with INSERT ... RETURNING, which always yields the row
 * against Postgres — so this cannot be provoked through the database. What is pinned here
 * is the consequence of handling it quietly: a role granted with no profile behind it, and
 * an audit row saying the activation succeeded.
 */
describe('role activation invariants', () => {
  const build = () => {
    const db: Record<string, unknown> = {
      // The role already exists and is live, so activation goes straight to the profile.
      query: { userRoles: { findFirst: vi.fn().mockResolvedValue({ id: 'r1', revokedAt: null }) } },
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
    };
    // Role activation writes the role and its consent rows in one transaction (T-022).
    db['transaction'] = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
    const authz = { requireActive: vi.fn().mockResolvedValue(undefined) };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const noProfile = { findMine: vi.fn().mockResolvedValue(undefined) };
    const service = new ProfilesService(
      db as never,
      authz as never,
      audit as never,
      noProfile as never,
      noProfile as never,
      { requireAcceptance: vi.fn().mockResolvedValue(undefined) } as never,
    );
    return { service, audit };
  };

  it.each(['INVESTIGATOR', 'CUSTOMER'] as const)(
    'fails loudly when creating the %s profile returns no row',
    async (role) => {
      const { service, audit } = build();
      await expect(
        service.activateRole(testActor({ userId: 'u1', roles: [] }), role, { correlationId: 'c' }),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      // Never recorded as an activation: a role with no profile behind it is not one.
      expect(audit.record).not.toHaveBeenCalled();
    },
  );
});
