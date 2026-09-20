import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { QuotesService } from './quotes.service';

const investigator = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const customer = testActor({ userId: 'c1', roles: ['CUSTOMER'] });
const req = { correlationId: 'c' };
const offer = {
  priceMinor: 250_000,
  currency: 'AMD',
  estimatedDurationDays: 14,
  scope: 'Records research.',
  deliverables: 'A written report.',
  cancellationTerms: 'Full refund before work starts.',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

/**
 * The paths a real database will not produce on demand: a write that reports success and
 * returns no row, and a failure that is not the one being handled.
 *
 * Both are worth holding to behaviour. Returning a half-built quote, or reporting a connection
 * error as "you have already quoted", sends the investigator to fix the wrong thing.
 */
const build = (
  over: { insert?: () => Promise<unknown[]>; update?: () => Promise<unknown[]> } = {},
) => {
  const mission = { id: 'm1', status: 'QUOTED', version: 1, customerId: 'c1' };
  const quote = {
    id: 'q1',
    status: 'SUBMITTED',
    missionId: 'm1',
    investigatorProfileId: 'p1',
    // Live, so acceptance reaches the UPDATE rather than being refused on expiry.
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
  const tx = {
    // `where(...)` is awaited directly by the unlocked mission read and chained into
    // `.for('update')` by the locked reads, so it must be a thenable that also carries `for`.
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [quote],
          then: (resolve: (value: unknown) => void) => resolve([mission]),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: over.insert ?? (async () => []) }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: over.update ?? (async () => []) }) }),
    }),
  };
  const db = { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx) };
  const authz = {
    requireActive: vi.fn().mockResolvedValue(undefined),
    requirePermission: vi.fn().mockResolvedValue(undefined),
    requirePersonalWorkspace: vi.fn().mockResolvedValue(undefined),
    requireRole: vi.fn().mockResolvedValue(undefined),
    stateAllows: vi.fn().mockResolvedValue(undefined),
    visible: vi.fn(async (_a: unknown, row: unknown) => row),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const profiles = {
    findMine: vi.fn().mockResolvedValue({
      id: 'p1',
      visibility: 'PUBLISHED',
      verificationStatus: 'VERIFIED',
      acceptingWork: true,
    }),
  };
  const service = new QuotesService(
    db as never,
    authz as never,
    audit as never,
    // A fresh claim, so acceptance runs the work rather than replaying a stored answer.
    { claim: vi.fn().mockResolvedValue({ status: 'CLAIMED' }), complete: vi.fn() } as never,
    { apply: vi.fn() } as never,
    profiles as never,
  );
  return { service, audit };
};

describe('a write that returns no row', () => {
  it('fails loudly when submitting, rather than returning half a quote', async () => {
    const { service, audit } = build();
    await expect(service.submit(investigator, 'm1', offer as never, req)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    // Nothing recorded: there is no quote to record anything about.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a conflict when an acceptance matched nothing', async () => {
    // The UPDATE matches on the quote still being SUBMITTED. Between the locked read and the
    // write it stopped being so — so this acceptance changes nothing rather than producing a
    // second agreement on the same mission.
    const { service, audit } = build();
    await expect(service.accept(customer, 'q1', 'key-1', req)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a conflict when a withdrawal matched nothing', async () => {
    // The UPDATE matches on the status that was read. No row means somebody else got there
    // first — an acceptance, most likely — and the right answer is "re-read", not "carry on".
    const { service, audit } = build();
    await expect(service.withdraw(investigator, 'q1', req)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('a failure that is not a duplicate quote', () => {
  it('is passed through as it is', async () => {
    // A connection error carries no Postgres error code. Reporting it as ALREADY_QUOTED would
    // tell the investigator to withdraw a quote that does not exist.
    const boom = new Error('connection terminated');
    const { service } = build({
      insert: async () => {
        throw boom;
      },
    });
    await expect(service.submit(investigator, 'm1', offer as never, req)).rejects.toBe(boom);
  });
});
