import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { ServiceAreasService } from './service-areas.service';

const actor = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const req = { correlationId: 'c' };
const dto = { kind: 'RADIUS' as const, label: 'x', centre: { lon: 44.52, lat: 40.19 }, radiusKm: 10 };

const build = (insert: () => unknown) => {
  const db = {
    select: () => ({ from: () => ({ where: async () => [{ n: 0 }] }) }),
    insert: () => ({ values: () => ({ returning: insert }) }),
  };
  const authz = {
    requireActive: vi.fn().mockResolvedValue(undefined),
    requirePermission: vi.fn().mockResolvedValue(undefined),
    requirePersonalWorkspace: vi.fn().mockResolvedValue(undefined),
    requireRole: vi.fn().mockResolvedValue(undefined),
    visible: vi.fn(async (_a: unknown, row: unknown) => row),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const profiles = { findMine: vi.fn().mockResolvedValue({ id: 'p1' }) };
  return {
    service: new ServiceAreasService(db as never, authz as never, audit as never, profiles as never),
    audit,
  };
};

describe('service area invariants', () => {
  it('fails loudly when the insert returns no row', async () => {
    const { service, audit } = build(async () => []);
    await expect(service.createMine(actor, dto, req)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('passes through a failure that is not a database refusal', async () => {
    // A connection error carries no Postgres error code; it must not be reported as a bad shape.
    const boom = new Error('connection terminated');
    const { service } = build(async () => {
      throw boom;
    });
    await expect(service.createMine(actor, dto, req)).rejects.toBe(boom);
  });
});
