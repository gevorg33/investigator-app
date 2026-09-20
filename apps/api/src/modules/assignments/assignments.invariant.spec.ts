import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AssignmentsService } from './assignments.service';

const authorization = {
  reference: 'pi_1',
  authorizedAt: new Date(),
  amountMinor: 1000,
  currency: 'AMD',
};

/**
 * Creation paths a real database will not produce on demand.
 *
 * This is the money-adjacent one, so the failure modes matter more than usual: an assignment
 * that exists without a payment, or two assignments for one payment, are both worse than an
 * error the caller can retry.
 */
const build = (
  over: {
    /**
     * Which row the lock finds nothing for. A `missing` flag rather than passing `undefined`
     * for the row itself: an absent property and a property set to undefined are the same
     * thing to a default, so the first version of this stub quietly returned the real row and
     * both "has gone" tests passed through to a successful creation.
     */
    missing?: 'quote' | 'mission';
    insert?: () => Promise<unknown[]>;
  } = {},
) => {
  const quote =
    over.missing === 'quote'
      ? undefined
      : { id: 'q1', status: 'ACCEPTED', missionId: 'm1', priceMinor: 1000, currency: 'AMD' };
  const mission =
    over.missing === 'mission'
      ? undefined
      : { id: 'm1', status: 'CUSTOMER_CONFIRMED', version: 2, customerId: 'c1' };

  let selectCall = 0;
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => {
            selectCall += 1;
            // First lock is the quote, second is the mission — the order the service reads them.
            const row = selectCall === 1 ? quote : mission;
            return row === undefined ? [] : [row];
          },
        }),
      }),
    }),
    // `values(...)` is both awaited directly (the creation history row) and chained into
    // `.returning()` (the assignment insert), so the stub has to be a thenable that also
    // carries `returning` — the same shape the missions invariant spec needs.
    insert: () => ({
      values: () => ({
        returning: over.insert ?? (async () => [{ id: 'a1', status: 'PENDING_ACCEPTANCE' }]),
        then: (resolve: (value: unknown) => void) => resolve(undefined),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{}] }) }) }),
  };
  const db = { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new AssignmentsService(
    db as never,
    {
      requireActive: vi.fn(),
      requirePermission: vi.fn(),
      requirePersonalWorkspace: vi.fn(),
      requireRole: vi.fn(),
      stateAllows: vi.fn(),
      visible: vi.fn(),
    } as never,
    audit as never,
    { claim: vi.fn().mockResolvedValue({ status: 'CLAIMED' }), complete: vi.fn() } as never,
    { apply: vi.fn() } as never,
    { apply: vi.fn().mockResolvedValue({ id: 'm1', status: 'PAID', version: 3 }) } as never,
  );
  return { service, audit };
};

const create = (service: AssignmentsService) =>
  service.createForAuthorizedPayment({
    quoteId: 'q1',
    authorization,
    idempotencyKey: randomUUID(),
  });

describe('creating an assignment for a payment', () => {
  it('refuses when the quote has gone', async () => {
    const { service } = build({ missing: 'quote' });
    await expect(create(service)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses when the mission has gone', async () => {
    // Money arrived for a mission that no longer exists. That is a payments problem to
    // reconcile, never a reason to commit an investigator.
    const { service } = build({ missing: 'mission' });
    await expect(create(service)).rejects.toMatchObject({ status: 404 });
  });

  it('turns a duplicate into a conflict rather than a second assignment', async () => {
    // The unique indexes on mission_id and quote_id are what hold this; the service's job is
    // to report the violation as a conflict the caller can retry against.
    const duplicate = Object.assign(new Error('duplicate key'), { cause: { code: '23505' } });
    const { service } = build({
      insert: async () => {
        throw duplicate;
      },
    });
    await expect(create(service)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('passes through a failure that is not a duplicate', async () => {
    const boom = new Error('connection terminated');
    const { service } = build({
      insert: async () => {
        throw boom;
      },
    });
    await expect(create(service)).rejects.toBe(boom);
  });

  it('fails loudly when the insert returns no row', async () => {
    const { service, audit } = build({ insert: async () => [] });
    await expect(create(service)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
