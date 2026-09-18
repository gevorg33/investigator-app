import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { verificationRequests } from '../../database/schema';
import { VerificationService } from './verification.service';

const investigator = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const staff = testActor({ userId: 's1', roles: ['STAFF'], staffScopes: ['VERIFICATION'] });
const req = { correlationId: 'c' };

/**
 * The paths a real database will not produce on demand: a write that reports success and
 * returns no row, and a failure that is not the one being handled.
 *
 * Both are held to behaviour. Returning half an application, or reporting a connection error
 * as "you already have an open application", sends the investigator to fix the wrong thing.
 */
const build = (over: { insert?: () => Promise<unknown[]> } = {}) => {
  const request = { id: 'r1', profileId: 'p1', status: 'SUBMITTED', version: 1 };
  const profile = { id: 'p1', userId: 'u1', verificationStatus: 'PENDING', verifiedAt: null };
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          // Locked reads: the request, or the profile.
          for: async () => [table === verificationRequests ? request : profile],
          // The declaration snapshot.
          orderBy: async () => [],
          // The document check, awaited directly: one usable document.
          then: (resolve: (value: unknown) => void) =>
            resolve([{ id: 'd1', uploadStatus: 'READY', scanStatus: 'CLEAN' }]),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: over.insert ?? (async () => []) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  };
  const db = { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx) };
  const authz = {
    requireActive: vi.fn().mockResolvedValue(undefined),
    requireRole: vi.fn().mockResolvedValue(undefined),
    requireStaffScope: vi.fn().mockResolvedValue(undefined),
    stateAllows: vi.fn().mockResolvedValue(undefined),
    visible: vi.fn(async (_a: unknown, row: unknown) => row),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const profiles = { findMine: vi.fn().mockResolvedValue({ id: 'p1' }) };
  const service = new VerificationService(
    db as never,
    authz as never,
    audit as never,
    { getDeliveryUrl: vi.fn() } as never,
    profiles as never,
  );
  return { service, audit };
};

describe('a write that returns no row', () => {
  it('fails loudly when applying, rather than returning half an application', async () => {
    const { service, audit } = build();
    await expect(service.submit(investigator, { documentIds: ['d1'] }, req)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a conflict when a decision matched nothing', async () => {
    // The UPDATE matches on the status and version that were read. No row means the request
    // moved between the read and the write — the answer is "re-read", never a second verdict.
    const { service, audit } = build();
    await expect(
      service.decide(staff, 'r1', { outcome: 'APPROVED', reason: 'Checked.' }, req),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('a failure that is not a second open application', () => {
  it('is passed through as it is', async () => {
    const boom = new Error('connection terminated');
    const { service } = build({
      insert: async () => {
        throw boom;
      },
    });
    await expect(service.submit(investigator, { documentIds: ['d1'] }, req)).rejects.toBe(boom);
  });
});
