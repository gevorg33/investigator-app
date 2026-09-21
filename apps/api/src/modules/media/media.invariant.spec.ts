import { describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { MediaService } from './media.service';

/**
 * INSERT ... RETURNING always yields the row against Postgres, so this cannot be provoked
 * through the database. Pinned here: an authorization is never handed back for a file the
 * database does not record.
 */
describe('upload authorization invariant', () => {
  it('fails loudly when recording the authorization returns no row', async () => {
    const db = { insert: () => ({ values: () => ({ returning: async () => [] }) }) };
    const authz = {
      requireActive: vi.fn().mockResolvedValue(undefined),
      requirePermission: vi.fn().mockResolvedValue(undefined),
      requirePersonalWorkspace: vi.fn().mockResolvedValue(undefined),
      requireRole: vi.fn().mockResolvedValue(undefined),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const limits = { consume: vi.fn().mockResolvedValue(undefined) };
    const storage = {
      publicIdFor: vi.fn(() => 'probe/tenant/t/verification-document/id'),
      signUpload: vi.fn(() => ({ url: 'u', fields: {} })),
    };
    const service = new MediaService(
      db as never,
      authz as never,
      audit as never,
      limits as never,
      {} as never,
      {} as never,
      storage as never,
    );

    await expect(
      service.authorizeUpload(
        testActor({ userId: 'u1', roles: ['INVESTIGATOR'] }),
        { category: 'VERIFICATION_DOCUMENT', mimeType: 'application/pdf', bytes: 10 },
        { correlationId: 'c' },
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
