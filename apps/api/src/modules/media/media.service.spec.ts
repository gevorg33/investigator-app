import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformContext } from '../../common/context/platform-context';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { auditLogs, mediaAssets } from '../../database/schema';
import { FakeStorage, makeReady, person, type TestDb } from '../../../test/media-fixtures';
import { MemoryRateLimitStore, RateLimitService } from '../auth/rate-limit.service';
import { LIMITS } from '../auth/rate-limit.service';
import { MEDIA_POLICY, UPLOAD_AUTHORIZATION_TTL_SECONDS } from './media.policy';
import { OwnMediaRepository, ViewableMediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { testPool } from '../../../test/db';
import { asRequests, personalContext, scopedDb } from '../../../test/workspace-context';

describe('media upload flow', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  // Fixtures run as the owner: they write what the application may not (T-073).
  let ownerSql: postgres.Sql;
  let ownerDb: TestDb;
  let storage: FakeStorage;
  let media: MediaService;
  const req = () => ({ ip: '198.51.100.40', userAgent: 'vitest', correlationId: randomUUID() });
  const savedFolder = process.env['CLOUDINARY_FOLDER'];

  beforeAll(() => {
    sql = testPool();
    db = scopedDb(sql);
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
  });

  beforeEach(() => {
    storage = new FakeStorage();
    media = asRequests(
      new MediaService(
        db,
        new AuthzService(new AuditService(db)),
        new AuditService(db),
        new RateLimitService(new MemoryRateLimitStore()),
        new OwnMediaRepository(db),
        new ViewableMediaRepository(db),
        storage,
        new PlatformContext(new AuditService(db)),
      ),
      ownerSql,
    );
  });

  afterEach(() => {
    if (savedFolder === undefined) delete process.env['CLOUDINARY_FOLDER'];
    else process.env['CLOUDINARY_FOLDER'] = savedFolder;
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  const rowOf = async (id: string) =>
    (await ownerDb.select().from(mediaAssets).where(eq(mediaAssets.id, id)))[0];
  const pdf = {
    category: 'VERIFICATION_DOCUMENT' as const,
    mimeType: 'application/pdf',
    bytes: 2048,
  };

  describe('authorizing an upload', () => {
    it('records the authorization and signs a server-chosen path', async () => {
      const actor = await person(ownerDb);
      const before = Date.now();
      const out = await media.authorizeUpload(actor, pdf, req());
      const row = await rowOf(out.assetId);

      expect(row).toMatchObject({
        ownerId: actor.userId,
        category: 'VERIFICATION_DOCUMENT',
        visibility: 'STAFF_REVIEW_ONLY',
        uploadStatus: 'AUTHORIZED',
        scanStatus: 'PENDING',
        declaredMimeType: 'application/pdf',
        declaredBytes: 2048,
      });
      // The signed fields name exactly the row's public ID — the client chose neither.
      expect(out.upload.fields['public_id']).toBe(row?.publicId);
      expect(storage.signUpload).toHaveBeenCalledWith({
        publicId: row?.publicId,
        resourceType: 'image',
        allowedFormats: Object.values(MEDIA_POLICY.VERIFICATION_DOCUMENT.formats),
      });
      const ttl = out.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan((UPLOAD_AUTHORIZATION_TTL_SECONDS - 5) * 1000);
      expect(ttl).toBeLessThanOrEqual(UPLOAD_AUTHORIZATION_TTL_SECONDS * 1000 + 1000);
    });

    it('stores the file where storage said, and asks storage for that path by category', async () => {
      // Where the path comes from is the storage layer's business (T-080) — the service's part
      // is to ask for one and to store what it is given, unchanged, on the row it signs.
      const actor = await person(ownerDb);
      const out = await media.authorizeUpload(actor, pdf, req());
      expect(storage.publicIdFor).toHaveBeenCalledWith('VERIFICATION_DOCUMENT');
      const derived = storage.publicIdFor.mock.results.at(-1)?.value as string;
      expect((await rowOf(out.assetId))?.publicId).toBe(derived);
      expect(storage.signUpload).toHaveBeenCalledWith(
        expect.objectContaining({ publicId: derived }),
      );
    });

    it('puts the file in the workspace the request is acting in', async () => {
      // The derived path carries the workspace, so one workspace's uploads never land in
      // another's folder — the check that a caller cannot influence it is in the adapter's spec.
      const actor = await person(ownerDb);
      const out = await media.authorizeUpload(actor, pdf, req());
      const workspace = await personalContext(ownerSql, actor.userId);
      expect((await rowOf(out.assetId))?.publicId).toContain(`/tenant/${workspace.tenantId}/`);
    });

    it('audits the authorization', async () => {
      const r = req();
      const out = await media.authorizeUpload(await person(ownerDb), pdf, r);
      const rows = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, r.correlationId));
      expect(rows).toContainEqual(
        expect.objectContaining({ action: 'media.upload.authorized', resourceId: out.assetId }),
      );
    });

    it('refuses a role the category does not admit', async () => {
      const customer = await person(ownerDb, { roles: ['CUSTOMER'] });
      await expect(media.authorizeUpload(customer, pdf, req())).rejects.toMatchObject({
        status: 403,
      });
    });

    it('refuses a suspended account', async () => {
      const suspended = await person(ownerDb, { status: 'SUSPENDED' });
      await expect(media.authorizeUpload(suspended, pdf, req())).rejects.toMatchObject({
        status: 403,
      });
    });

    it.each(['image/svg+xml', 'text/html', 'application/octet-stream'])(
      'refuses %s before signing anything',
      async (mimeType) => {
        await expect(
          media.authorizeUpload(await person(ownerDb), { ...pdf, mimeType }, req()),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(storage.signUpload).not.toHaveBeenCalled();
      },
    );

    it('refuses a declared size over the category limit', async () => {
      await expect(
        media.authorizeUpload(
          await person(ownerDb),
          { ...pdf, bytes: MEDIA_POLICY.VERIFICATION_DOCUMENT.maxBytes + 1 },
          req(),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('rate-limits authorizations per account', async () => {
      const actor = await person(ownerDb);
      for (let i = 0; i < LIMITS.mediaUploadPerAccount.max; i++) {
        await media.authorizeUpload(actor, pdf, req());
      }
      await expect(media.authorizeUpload(actor, pdf, req())).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
    });

    it('leaves no row behind when storage refuses to sign', async () => {
      const actor = await person(ownerDb);
      storage.signUpload.mockImplementationOnce(() => {
        throw new Error('not configured');
      });
      await expect(media.authorizeUpload(actor, pdf, req())).rejects.toThrow('not configured');
      const rows = await ownerDb
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.ownerId, actor.userId));
      expect(rows).toHaveLength(0);
    });
  });

  describe('completing an upload', () => {
    const authorized = async (actor?: Actor) => {
      const owner = actor ?? (await person(ownerDb));
      const out = await media.authorizeUpload(owner, pdf, req());
      const row = await rowOf(out.assetId);
      return { owner, assetId: out.assetId, publicId: row?.publicId ?? '' };
    };

    it('reads the asset back and records what storage holds', async () => {
      const { owner, assetId, publicId } = await authorized();
      storage.put(publicId, { bytes: 1999, version: 4, width: 800, height: 600, etag: 'etag-x' });

      await expect(media.completeUpload(owner, assetId, req())).resolves.toEqual({
        assetId,
        uploadStatus: 'READY',
        scanStatus: 'PENDING',
      });
      expect(await rowOf(assetId)).toMatchObject({
        uploadStatus: 'READY',
        bytes: 1999,
        version: 4,
        format: 'pdf',
        width: 800,
        height: 600,
        etag: 'etag-x',
      });
    });

    it('stores missing dimensions as null', async () => {
      const { owner, assetId, publicId } = await authorized();
      storage.put(publicId, { width: undefined, height: undefined, etag: undefined });
      await media.completeUpload(owner, assetId, req());
      expect(await rowOf(assetId)).toMatchObject({ width: null, height: null, etag: null });
    });

    it('answers 409 when nothing has been uploaded yet, and allows a retry', async () => {
      const { owner, assetId, publicId } = await authorized();
      await expect(media.completeUpload(owner, assetId, req())).rejects.toMatchObject({
        status: 409,
      });
      expect((await rowOf(assetId))?.uploadStatus).toBe('AUTHORIZED');

      storage.put(publicId);
      await expect(media.completeUpload(owner, assetId, req())).resolves.toMatchObject({
        uploadStatus: 'READY',
      });
    });

    it('refuses completion after the authorization window, and destroys the file', async () => {
      const { owner, assetId, publicId } = await authorized();
      storage.put(publicId);
      await ownerDb
        .update(mediaAssets)
        .set({ authorizationExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(mediaAssets.id, assetId));

      await expect(media.completeUpload(owner, assetId, req())).rejects.toMatchObject({
        status: 409,
      });
      expect((await rowOf(assetId))?.uploadStatus).toBe('EXPIRED');
      expect(storage.destroyed).toContain(publicId);
    });

    it.each([
      ['a format other than the one declared', { format: 'jpg' }, 'FORMAT_MISMATCH'],
      [
        'a file larger than the category allows',
        { bytes: MEDIA_POLICY.VERIFICATION_DOCUMENT.maxBytes + 1 },
        'TOO_LARGE',
      ],
      ['a file stored as public', { type: 'upload' }, 'NOT_PRIVATE'],
      [
        'an asset under a different public ID',
        { publicId: 'somewhere/else' },
        'PUBLIC_ID_MISMATCH',
      ],
    ] as const)('rejects %s, destroys it, and records why', async (_label, over, reason) => {
      const r = req();
      const { owner, assetId, publicId } = await authorized();
      storage.put(publicId, over);

      await expect(media.completeUpload(owner, assetId, r)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect((await rowOf(assetId))?.uploadStatus).toBe('REJECTED');
      expect(storage.destroyed).toContain(publicId);
      const audit = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, r.correlationId));
      expect(audit).toContainEqual(
        expect.objectContaining({ action: 'media.upload.rejected', reason }),
      );
    });

    it('keeps the row AUTHORIZED if destroying a rejected file fails', async () => {
      // Otherwise a REJECTED row would describe a file that is still sitting in storage.
      const { owner, assetId, publicId } = await authorized();
      storage.put(publicId, { format: 'jpg' });
      storage.failDestroy = true;
      await expect(media.completeUpload(owner, assetId, req())).rejects.toThrow(
        'storage unavailable',
      );
      expect((await rowOf(assetId))?.uploadStatus).toBe('AUTHORIZED');
    });

    it('refuses to complete the same upload twice', async () => {
      const { owner, assetId, publicId } = await authorized();
      storage.put(publicId);
      await media.completeUpload(owner, assetId, req());
      await expect(media.completeUpload(owner, assetId, req())).rejects.toMatchObject({
        status: 403,
      });
    });

    it('lets only one of two concurrent completions win', async () => {
      const { owner, assetId, publicId } = await authorized();
      storage.put(publicId);
      // Another request completes it between this one's read and its write.
      storage.onFind = async () => {
        storage.onFind = undefined;
        await makeReady(ownerDb, assetId, 'PENDING');
      };
      await expect(media.completeUpload(owner, assetId, req())).rejects.toMatchObject({
        status: 403,
      });
    });

    it('will not let another user complete someone else’s upload', async () => {
      const { assetId, publicId } = await authorized();
      storage.put(publicId);
      await expect(
        media.completeUpload(await person(ownerDb), assetId, req()),
      ).rejects.toMatchObject({
        status: 404,
      });
      expect((await rowOf(assetId))?.uploadStatus).toBe('AUTHORIZED');
    });
  });
});
