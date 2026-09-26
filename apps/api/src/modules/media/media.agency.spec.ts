import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agencyImage, agencyProfile } from '../../../test/agency-fixtures';
import { testPool } from '../../../test/db';
import { FakeStorage, type TestDb } from '../../../test/media-fixtures';
import { agencyContext, personalContext, scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import { PlatformContext } from '../../common/context/platform-context';
import { runInContext, type ExecutionContext } from '../../common/context/execution-context';
import * as schema from '../../database/schema';
import { auditLogs, mediaAssets } from '../../database/schema';
import { MemoryRateLimitStore, RateLimitService } from '../auth/rate-limit.service';
import { OwnMediaRepository, ViewableMediaRepository } from './media.repository';
import { MediaService } from './media.service';

/**
 * An agency's logo and cover (T-084): uploaded by whoever may change the agency's settings, in the
 * agency, and shown to others only through its published profile.
 */
describe('agency media', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  let ownerSql: postgres.Sql;
  let ownerDb: TestDb;
  let storage: FakeStorage;
  let media: MediaService;
  const req = () => ({ ip: '198.51.100.84', userAgent: 'vitest', correlationId: randomUUID() });
  const logo = { category: 'AGENCY_LOGO' as const, mimeType: 'image/png', bytes: 40_000 };

  beforeAll(() => {
    sql = testPool();
    db = scopedDb(sql);
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
  });

  beforeEach(() => {
    storage = new FakeStorage();
    media = new MediaService(
      db,
      new AuthzService(new AuditService(db)),
      new AuditService(db),
      new RateLimitService(new MemoryRateLimitStore()),
      new OwnMediaRepository(db),
      new ViewableMediaRepository(db),
      storage,
      new PlatformContext(new AuditService(db)),
    );
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  /** An agency with an owner and, if asked, a second member in the given role. */
  const setUp = async (role?: string) => {
    const owner = await member(ownerSql, { roles: ['INVESTIGATOR'] });
    const other = await member(ownerSql);
    const { tenantId } = await agency(ownerSql, [
      { userId: owner.actor.userId },
      ...(role === undefined ? [] : [{ userId: other.actor.userId, role }]),
    ]);
    return {
      tenantId,
      owner: {
        actor: owner.actor,
        context: await agencyContext(ownerSql, owner.actor.userId, tenantId),
      },
      other: {
        actor: other.actor,
        context:
          role === undefined
            ? undefined
            : await agencyContext(ownerSql, other.actor.userId, tenantId),
      },
    };
  };

  const within = <T>(context: ExecutionContext, fn: () => Promise<T>) => runInContext(context, fn);
  const denial = async (correlationId: string) =>
    (await ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, correlationId)))[0];

  describe('uploading', () => {
    it('lets an owner upload a logo into the agency, as a public-profile image', async () => {
      const a = await setUp();
      const out = await within(a.owner.context, () =>
        media.authorizeUpload(a.owner.actor, logo, req()),
      );
      const [row] = await ownerDb.select().from(mediaAssets).where(eq(mediaAssets.id, out.assetId));
      expect(row).toMatchObject({
        tenantId: a.tenantId,
        ownerId: a.owner.actor.userId,
        category: 'AGENCY_LOGO',
        visibility: 'PUBLIC_PROFILE',
      });
      expect(storage.signUpload.mock.calls.at(-1)?.[0].allowedFormats.sort()).toEqual([
        'jpg',
        'png',
        'webp',
      ]);
    });

    it('lets an admin upload one too — the permission decides, not a role name', async () => {
      const a = await setUp('ADMIN');
      await expect(
        within(a.other.context!, () =>
          media.authorizeUpload(a.other.actor, { ...logo, category: 'AGENCY_COVER' }, req()),
        ),
      ).resolves.toMatchObject({ assetId: expect.any(String) });
    });

    it('refuses a member without settings.update, and audits why', async () => {
      const a = await setUp('MANAGER');
      const r = req();
      await expect(
        within(a.other.context!, () => media.authorizeUpload(a.other.actor, logo, r)),
      ).rejects.toMatchObject({ status: 403 });
      expect(await denial(r.correlationId)).toMatchObject({ reason: 'permission_not_held' });
    });

    it('refuses an agency image in a Personal workspace', async () => {
      const { actor } = await member(ownerSql);
      const r = req();
      await expect(
        within(await personalContext(ownerSql, actor.userId), () =>
          media.authorizeUpload(actor, logo, r),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(await denial(r.correlationId)).toMatchObject({ reason: 'workspace_kind_forbidden' });
    });

    it('holds a logo to its own size limit', async () => {
      const a = await setUp();
      await expect(
        within(a.owner.context, () =>
          media.authorizeUpload(a.owner.actor, { ...logo, bytes: 3 * 1024 * 1024 }, req()),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('links for a profile’s images', () => {
    it('asks nothing of the database for no images', async () => {
      await expect(media.profileImageLinks([])).resolves.toEqual(new Map());
    });

    it('signs the agency’s own ready, clean images for its members, published or not', async () => {
      const a = await setUp();
      const clean = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
      });
      const pending = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
        category: 'AGENCY_COVER',
        scanStatus: 'PENDING',
      });
      const links = await within(a.owner.context, () => media.profileImageLinks([clean, pending]));
      expect([...links.keys()]).toEqual([clean]);
      expect(links.get(clean)).toMatchObject({
        signedUrl: expect.stringContaining('signature=sig'),
        expiresAt: expect.any(Date),
      });
    });

    it('shows another workspace a published agency’s logo, and nothing of a draft', async () => {
      const a = await setUp();
      const image = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
      });
      await agencyProfile(ownerSql, a.tenantId, { logoMediaId: image });
      const outsider = await member(ownerSql);
      const elsewhere = await personalContext(ownerSql, outsider.actor.userId);

      expect((await within(elsewhere, () => media.profileImageLinks([image]))).size).toBe(0);
      await ownerSql`UPDATE tenant_profiles SET published_at = now() WHERE tenant_id = ${a.tenantId}`;
      expect((await within(elsewhere, () => media.profileImageLinks([image]))).size).toBe(1);
    });

    it('never signs another kind of file, even one the reader may see', async () => {
      const a = await setUp();
      const photo = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
        category: 'PROFILE_IMAGE',
      });
      expect((await within(a.owner.context, () => media.profileImageLinks([photo]))).size).toBe(0);
      const [row] = await ownerDb
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, photo), eq(mediaAssets.category, 'PROFILE_IMAGE')));
      expect(row).toBeDefined();
    });
  });
});
