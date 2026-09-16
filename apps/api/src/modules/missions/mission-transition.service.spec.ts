import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { AppError } from '../../common/errors/app-error';
import { MissionTransitionService, type LockedMission } from './mission-transition.service';

const customer = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const moderator = testActor({ userId: 'u2', roles: ['STAFF'], staffScopes: ['MODERATION'] });
const draft: LockedMission = { id: 'm1', status: 'DRAFT', version: 3 };

/**
 * A transaction stub that records what was written to which table, so a test can assert that
 * the history row, the audit entry and the outbox event all happened — and, on a refusal, that
 * none of them did.
 */
const build = (updateReturns: unknown[] = [{ id: 'm1', status: 'SUBMITTED', version: 4 }]) => {
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const updates: unknown[] = [];
  const tx = {
    update: () => ({
      set: (values: unknown) => {
        updates.push(values);
        return { where: () => ({ returning: async () => updateReturns }) };
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        inserted.push({ table, values });
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
  const service = new MissionTransitionService(authz as never, audit as never);
  return { service, tx: tx as never, inserted, updates, authz, audit };
};

describe('applying a legal transition', () => {
  it('writes the status, the history, the audit entry and the outbox event together', async () => {
    const { service, tx, inserted, updates, audit } = build();
    const moved = await service.apply(
      tx,
      draft,
      'SUBMITTED',
      { kind: 'CUSTOMER', actor: customer },
      {
        correlationId: 'corr-1',
      },
    );

    expect(moved).toEqual({ id: 'm1', status: 'SUBMITTED', version: 4 });
    expect(updates[0]).toMatchObject({ status: 'SUBMITTED', version: 4 });
    // Two inserts: the history row and the outbox event. The audit entry goes through the
    // audit service — and takes the same transaction, or it could survive a rollback.
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.values).toMatchObject({
      missionId: 'm1',
      fromStatus: 'DRAFT',
      toStatus: 'SUBMITTED',
      actorKind: 'CUSTOMER',
      actorId: 'u1',
      staffScope: null,
    });
    expect(inserted[1]?.values).toMatchObject({
      aggregateType: 'mission',
      aggregateId: 'm1',
      eventType: 'mission.status_changed',
      payload: { missionId: 'm1', from: 'DRAFT', to: 'SUBMITTED', version: 4 },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mission.status_changed', reason: 'DRAFT->SUBMITTED' }),
      tx,
    );
  });

  it('carries the fields that change with the status in the same UPDATE', async () => {
    // The lawful-purpose confirmation is written with the submission, never before it.
    const { service, tx, updates } = build();
    const at = new Date('2026-09-14T10:00:00Z');
    await service.apply(
      tx,
      draft,
      'SUBMITTED',
      { kind: 'CUSTOMER', actor: customer },
      {},
      {
        lawfulPurposeConfirmedAt: at,
        submittedAt: at,
      },
    );
    expect(updates[0]).toMatchObject({
      lawfulPurposeConfirmedAt: at,
      submittedAt: at,
      status: 'SUBMITTED',
    });
  });

  it('records the scope a staff member acted under', async () => {
    const { service, tx, inserted, authz } = build([{ id: 'm1', status: 'QUOTED', version: 8 }]);
    await service.apply(tx, { id: 'm1', status: 'UNDER_REVIEW', version: 7 }, 'QUOTED', {
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
    const { service, tx, inserted } = build([{ id: 'm1', status: 'UNDER_REVIEW', version: 5 }]);
    await service.apply(tx, { id: 'm1', status: 'SUBMITTED', version: 4 }, 'UNDER_REVIEW', {
      kind: 'SYSTEM',
    });
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
    // Publication is a moderator's decision; a customer cannot make it from a draft or anywhere.
    await expect(
      service.apply(tx, draft, 'QUOTED', { kind: 'CUSTOMER', actor: customer }),
    ).rejects.toMatchObject({ status: 403 });
    expect(updates).toEqual([]);
    expect(inserted).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses the system with a conflict rather than a denial', async () => {
    // Nobody to refuse: a system move that is not on the map is a bug or a lost race.
    const { service, tx, inserted } = build();
    await expect(service.apply(tx, draft, 'QUOTED', { kind: 'SYSTEM' })).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(inserted).toEqual([]);
  });

  it('refuses a staff member who does not hold the scope the move names', async () => {
    const { service, tx, inserted } = build();
    const disputesOnly = testActor({ userId: 'u3', roles: ['STAFF'], staffScopes: ['DISPUTES'] });
    await expect(
      service.apply(tx, { id: 'm1', status: 'UNDER_REVIEW', version: 1 }, 'QUOTED', {
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
      service.apply(tx, draft, 'SUBMITTED', { kind: 'CUSTOMER', actor: customer }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(inserted).toEqual([]);
  });
});
