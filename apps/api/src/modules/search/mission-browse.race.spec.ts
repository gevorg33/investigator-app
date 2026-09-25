import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import type { AuthzService } from '../../common/authz/authz.service';
import type { Db } from '../../database/database.module';
import type { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { MissionBrowseService } from './mission-browse.service';

/**
 * The browse reads twice: which missions, then their fields. A mission hired or withdrawn in
 * between is dropped rather than half-shown — a race the database suite cannot stage, so the
 * second read is made to come back empty here.
 */
describe('mission browse, between its two reads', () => {
  it('drops a mission that stopped being published, rather than showing half of it', async () => {
    const where = vi.fn().mockResolvedValue([]);
    const db = {
      execute: vi.fn().mockResolvedValue([{ id: 'm-1', k1: -1, k2: -1, distanceM: null }]),
      select: () => ({ from: () => ({ where }) }),
    } as unknown as Db;
    const authz = {
      requireActive: vi.fn(),
      requireRole: vi.fn(),
      requirePermission: vi.fn(),
      visible: async (_: unknown, row: unknown) => row,
      stateAllows: vi.fn(),
    } as unknown as AuthzService;
    const profiles = {
      findMine: async () => ({
        id: 'p-1',
        visibility: 'PUBLISHED',
        verificationStatus: 'VERIFIED',
        acceptingWork: true,
      }),
    } as unknown as OwnInvestigatorProfileRepository;

    const service = new MissionBrowseService(db, authz, profiles);
    const page = await service.browse(
      testActor({ userId: 'u-1', roles: ['INVESTIGATOR'] }),
      {},
      { ip: '198.51.100.1', userAgent: 'vitest', correlationId: 'c-1' },
    );
    expect(where).toHaveBeenCalled();
    expect(page.items).toEqual([]);
  });
});
