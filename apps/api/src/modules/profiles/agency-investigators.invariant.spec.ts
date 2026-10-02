import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { AgencyInvestigatorsService } from './agency-investigators.service';

/**
 * Making a profile translates one refusal — the person already holds one here — and nothing else.
 * Any other failure of the insert cannot be provoked through a database that is up, so what is
 * pinned here is that it is passed on as it is, and never recorded as a profile made.
 */
describe('making an agency profile, when the insert fails for another reason', () => {
  it('passes the failure on and audits nothing', async () => {
    const rows = [[{ userId: 'u2', status: 'ACTIVE' }], [{ id: 'role' }]];
    const lost = Object.assign(new Error('connection lost'), { cause: { code: '08006' } });
    const db = {
      select: () => ({ from: () => ({ where: async () => rows.shift() }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.reject(lost) }) }),
    };
    const allow = vi.fn().mockResolvedValue(undefined);
    const authz = {
      requireActive: allow,
      requireAgencyWorkspace: allow,
      requirePermission: allow,
      stateAllows: allow,
      visible: async (_actor: unknown, row: unknown) => row,
    };
    const audit = { record: vi.fn() };
    const service = new AgencyInvestigatorsService(
      db as never,
      authz as never,
      audit as never,
      {} as never,
    );

    await expect(
      service.create(testActor({ userId: 'u1' }), 'membership', { correlationId: 'c' }),
    ).rejects.toBe(lost);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
