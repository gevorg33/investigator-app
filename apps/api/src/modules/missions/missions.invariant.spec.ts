import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { MissionsService } from './missions.service';

const actor = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const req = { correlationId: 'c' };

/**
 * The two "cannot happen" paths, which a real database will not produce on demand: a write
 * that reports success and returns no row.
 *
 * They are worth holding to behaviour anyway. Both must fail loudly and write nothing —
 * returning a half-built mission, or carrying on as though an update had applied, is how a
 * mission ends up with a status nobody can explain.
 */
const build = (
  over: { returning?: () => Promise<unknown[]>; row?: Record<string, unknown> } = {},
) => {
  const returning = over.returning ?? (async () => []);
  const row = over.row ?? { id: 'm1', status: 'DRAFT', version: 1, taxonomyNodeId: null };
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => [row] }) }) }),
    // `values(...)` is both awaited directly (the history row) and chained into `.returning()`
    // (the insert), so the stub has to be a thenable that also carries `returning`.
    insert: () => ({
      values: () => ({
        returning,
        then: (resolve: (value: unknown) => void) => resolve(undefined),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
  };
  const db = { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx) };
  const authz = {
    requireActive: vi.fn().mockResolvedValue(undefined),
    requireRole: vi.fn().mockResolvedValue(undefined),
    stateAllows: vi.fn().mockResolvedValue(undefined),
    visible: vi.fn(async (_a: unknown, r: unknown) => r),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new MissionsService(
    db as never,
    authz as never,
    audit as never,
    { listMine: vi.fn(), findOneForActor: vi.fn() } as never,
    { apply: vi.fn() } as never,
    { screenSubmission: vi.fn() } as never,
    { consume: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, audit };
};

describe('a write that returns no row', () => {
  it('fails loudly when creating a draft, rather than returning half a mission', async () => {
    const { service, audit } = build();
    await expect(service.createDraft(actor, { title: 'x' }, req)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    // Nothing recorded: there is no mission to record anything about.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a conflict when an edit matched nothing', async () => {
    // The UPDATE matches on the version that was read. No row means somebody else got there
    // first, and the right answer is "re-read", not "carry on".
    const { service, audit } = build();
    await expect(
      service.updateDraft(actor, 'm1', { version: 1, title: 'x' }, req),
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
