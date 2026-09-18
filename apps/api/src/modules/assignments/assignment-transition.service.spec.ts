import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { AppError } from '../../common/errors/app-error';
import {
  AssignmentTransitionService,
  type LockedAssignment,
} from './assignment-transition.service';

const investigator = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const moderator = testActor({ userId: 'u2', roles: ['STAFF'], staffScopes: ['MODERATION'] });
const pending: LockedAssignment = { id: 'a1', status: 'PENDING_ACCEPTANCE', version: 3 };

/**
 * A transaction stub that records what was written to which table, so a test can assert the
 * status, the history row, the audit entry and the outbox event all happened — and, on a
 * refusal, that none of them did.
 */
const build = (updateReturns: unknown[] = [{ id: 'a1', status: 'ACCEPTED', version: 4 }]) => {
  const inserted: Array<{ values: unknown }> = [];
  const updates: unknown[] = [];
  const tx = {
    update: () => ({
      set: (values: unknown) => {
        updates.push(values);
        return { where: () => ({ returning: async () => updateReturns }) };
      },
    }),
    insert: () => ({
      values: async (values: unknown) => {
        inserted.push({ values });
      },
    }),
  };
  const authz = {
    requireStaffScope: vi.fn().mockResolvedValue(undefined),
    stateAllows: vi.fn(async (_a: unknown, allowed: boolean) => {
      if (!allowed) throw AppError.forbidden();
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new AssignmentTransitionService(authz as never, audit as never);
  return { service, tx: tx as never, inserted, updates, authz, audit };
};

describe('applying a legal transition', () => {
  it('writes the status, the history, the audit entry and the outbox event together', async () => {
    const { service, tx, inserted, updates, audit } = build();
    const moved = await service.apply(
      tx,
      pending,
      'ACCEPTED',
      { kind: 'INVESTIGATOR', actor: investigator },
      { correlationId: 'corr-1' },
      { acceptedAt: new Date('2026-09-18T12:00:00Z') },
    );

    expect(moved).toEqual({ id: 'a1', status: 'ACCEPTED', version: 4 });
    expect(updates[0]).toMatchObject({ status: 'ACCEPTED', version: 4 });
    // The field that changes with the status travels in the same UPDATE: an assignment that is
    // ACCEPTED without the instant it was accepted cannot be reviewed later.
    expect(updates[0]).toMatchObject({ acceptedAt: new Date('2026-09-18T12:00:00Z') });

    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.values).toMatchObject({
      assignmentId: 'a1',
      fromStatus: 'PENDING_ACCEPTANCE',
      toStatus: 'ACCEPTED',
      actorKind: 'INVESTIGATOR',
      actorId: 'u1',
      staffScope: null,
    });
    expect(inserted[1]?.values).toMatchObject({
      aggregateType: 'assignment',
      aggregateId: 'a1',
      eventType: 'assignment.status_changed',
      payload: { assignmentId: 'a1', from: 'PENDING_ACCEPTANCE', to: 'ACCEPTED', version: 4 },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assignment.status_changed',
        reason: 'PENDING_ACCEPTANCE->ACCEPTED',
      }),
      tx,
    );
  });

  it('records the scope a staff member acted under', async () => {
    const { service, tx, inserted, authz } = build([
      { id: 'a1', status: 'IN_PROGRESS', version: 9 },
    ]);
    await service.apply(tx, { id: 'a1', status: 'SUSPENDED', version: 8 }, 'IN_PROGRESS', {
      kind: 'STAFF',
      actor: moderator,
      scope: 'MODERATION',
    });
    expect(authz.requireStaffScope).toHaveBeenCalledWith(
      moderator,
      'MODERATION',
      expect.anything(),
    );
    expect(inserted[0]?.values).toMatchObject({
      actorKind: 'STAFF',
      staffScope: 'MODERATION',
      actorId: 'u2',
    });
  });

  it('records a system move with no actor', async () => {
    // The acceptance window closing is the system's only decision here.
    const { service, tx, inserted } = build([{ id: 'a1', status: 'CANCELLED', version: 4 }]);
    await service.apply(tx, pending, 'CANCELLED', { kind: 'SYSTEM' });
    expect(inserted[0]?.values).toMatchObject({
      actorKind: 'SYSTEM',
      actorId: null,
      staffScope: null,
    });
  });
});

describe('refusing an illegal transition', () => {
  it('refuses a person with a 403 and writes nothing', async () => {
    const { service, tx, inserted, updates, audit } = build();
    // An investigator cannot complete the work; only the customer accepts a report.
    await expect(
      service.apply(tx, { id: 'a1', status: 'REPORT_SUBMITTED', version: 5 }, 'COMPLETED', {
        kind: 'INVESTIGATOR',
        actor: investigator,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(updates).toEqual([]);
    expect(inserted).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses the system with a conflict rather than a denial', async () => {
    const { service, tx, inserted } = build();
    await expect(service.apply(tx, pending, 'ACCEPTED', { kind: 'SYSTEM' })).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(inserted).toEqual([]);
  });

  it('refuses a staff member who does not hold the scope the move names', async () => {
    const { service, tx, inserted } = build();
    const disputesOnly = testActor({ userId: 'u3', roles: ['STAFF'], staffScopes: ['DISPUTES'] });
    await expect(
      service.apply(tx, { id: 'a1', status: 'SUSPENDED', version: 1 }, 'IN_PROGRESS', {
        kind: 'STAFF',
        actor: disputesOnly,
        scope: 'DISPUTES',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(inserted).toEqual([]);
  });
});

describe('losing a race', () => {
  it('fails with a conflict when the row no longer matches what was read', async () => {
    // The UPDATE matches on the version and status that were read. Another transition got
    // there first, so this one changes nothing rather than overwriting it.
    const { service, tx, inserted } = build([]);
    await expect(
      service.apply(tx, pending, 'ACCEPTED', { kind: 'INVESTIGATOR', actor: investigator }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(inserted).toEqual([]);
  });
});
