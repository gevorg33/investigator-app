import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { auditLogs, mediaAssets } from '../../database/schema';
import { expectAuthorized } from '../../../test/authz-cases';
import { FakeStorage, makeReady, person, type TestDb } from '../../../test/media-fixtures';
import { MemoryRateLimitStore, RateLimitService } from '../auth/rate-limit.service';
import { DELIVERY_URL_TTL_SECONDS } from './media.policy';
import { OwnMediaRepository, ViewableMediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { testPool } from '../../../test/db';
import { asRequests, scopedDb } from '../../../test/workspace-context';


describe('who can obtain a delivery link', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  // Fixtures run as the owner: they write what the application may not (T-073).
  let ownerSql: postgres.Sql;
  let ownerDb: TestDb;
  let storage: FakeStorage;
  let media: MediaService;
  const req = () => ({ ip: '198.51.100.41', userAgent: 'vitest', correlationId: randomUUID() });

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
      ),
      ownerSql,
    );
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  /** An uploaded, scanned asset owned by a fresh investigator. */
  const asset = async (
    category: 'VERIFICATION_DOCUMENT' | 'PROFILE_IMAGE' = 'VERIFICATION_DOCUMENT',
    scan: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED' = 'CLEAN',
  ): Promise<{ owner: Actor; assetId: string }> => {
    const owner = await person(ownerDb);
    const input =
      category === 'VERIFICATION_DOCUMENT'
        ? { category, mimeType: 'application/pdf', bytes: 10 }
        : { category, mimeType: 'image/png', bytes: 10 };
    const { assetId } = await media.authorizeUpload(owner, input, req());
    await makeReady(ownerDb, assetId, scan);
    return { owner, assetId };
  };

  const deliver = (actor: Actor, assetId: string) => media.getDeliveryUrl(actor, assetId, req());

  it('gives the owner a five-minute link', async () => {
    const { owner, assetId } = await asset();
    const before = Date.now();
    const out = await deliver(owner, assetId);
    expect(out.signedUrl).toContain('expires_at=');
    const ttl = out.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan((DELIVERY_URL_TTL_SECONDS - 5) * 1000);
    expect(ttl).toBeLessThanOrEqual(DELIVERY_URL_TTL_SECONDS * 1000 + 1000);
  });

  describe('a non-owner cannot obtain a link', () => {
    it('another investigator gets 404, the same as for an id that does not exist', async () => {
      // The criterion T-008 names. 404 rather than 403 so the refusal confirms nothing.
      const { assetId } = await asset();
      const stranger = await person(ownerDb);
      const notYours = await deliver(stranger, assetId).catch((e: { status?: number; code?: string }) => e);
      const missing = await deliver(stranger, randomUUID()).catch((e: { status?: number; code?: string }) => e);
      expect(notYours).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect({ status: (notYours as { status?: number }).status, code: (notYours as { code?: string }).code }).toEqual({
        status: (missing as { status?: number }).status,
        code: (missing as { code?: string }).code,
      });
      expect(storage.signedDownloadUrl).not.toHaveBeenCalled();
    });

    it('a customer gets 404', async () => {
      const { assetId } = await asset();
      await expect(deliver(await person(ownerDb, { roles: ['CUSTOMER'] }), assetId)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('nobody but the owner can see a profile image yet', async () => {
      // Serving it to others must respect the profile's published state; until that link
      // exists the restrictive answer applies.
      const { assetId } = await asset('PROFILE_IMAGE');
      await expect(deliver(await person(ownerDb, { roles: ['CUSTOMER'] }), assetId)).rejects.toMatchObject({
        status: 404,
      });
      const reviewer = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['VERIFICATION'] });
      await expect(deliver(reviewer, assetId)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('staff', () => {
    it('with the VERIFICATION scope can open a verification document', async () => {
      const { assetId } = await asset();
      const reviewer = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['VERIFICATION'] });
      await expect(deliver(reviewer, assetId)).resolves.toHaveProperty('signedUrl');
    });

    it('with any other scope cannot — a moderator is not a verification reviewer', async () => {
      const { assetId } = await asset();
      const moderator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION', 'PAYMENTS'] });
      // 404, not 403: staff outside the scope should not learn the document exists either.
      await expect(deliver(moderator, assetId)).rejects.toMatchObject({ status: 404 });
    });

    it('do not carry staff access into another workspace', async () => {
      const { assetId } = await asset();
      const narrowed = await person(ownerDb, {
        roles: ['STAFF', 'CUSTOMER'],
        staffScopes: ['VERIFICATION'],
        activeRole: 'CUSTOMER',
      });
      await expect(deliver(narrowed, assetId)).rejects.toMatchObject({ status: 404 });
    });

    it('acting explicitly as staff keeps access', async () => {
      const { assetId } = await asset();
      const asStaff = await person(ownerDb, {
        roles: ['STAFF', 'CUSTOMER'],
        staffScopes: ['VERIFICATION'],
        activeRole: 'STAFF',
      });
      await expect(deliver(asStaff, assetId)).resolves.toHaveProperty('signedUrl');
    });
  });

  describe('fails closed', () => {
    it.each(['PENDING', 'INFECTED', 'FAILED'] as const)(
      'refuses a %s scan, even to the owner',
      async (scan) => {
        const { owner, assetId } = await asset('VERIFICATION_DOCUMENT', scan);
        await expect(deliver(owner, assetId)).rejects.toMatchObject({ status: 403 });
        expect(storage.signedDownloadUrl).not.toHaveBeenCalled();
      },
    );

    it('refuses an upload that never completed', async () => {
      const owner = await person(ownerDb);
      const { assetId } = await media.authorizeUpload(
        owner,
        { category: 'VERIFICATION_DOCUMENT', mimeType: 'application/pdf', bytes: 10 },
        req(),
      );
      await expect(deliver(owner, assetId)).rejects.toMatchObject({ status: 403 });
    });

    it('refuses a soft-deleted asset as if it did not exist', async () => {
      const { owner, assetId } = await asset();
      await ownerDb.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, assetId));
      await expect(deliver(owner, assetId)).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a suspended owner', async () => {
      const { owner, assetId } = await asset();
      await expect(deliver({ ...owner, status: 'SUSPENDED' }, assetId)).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('auditing', () => {
    it('records who opened which file, and never the link itself', async () => {
      const { assetId } = await asset();
      const reviewer = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['VERIFICATION'] });
      const r = req();
      const { signedUrl } = await media.getDeliveryUrl(reviewer, assetId, r);

      const rows = await ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, r.correlationId));
      expect(rows).toContainEqual(
        expect.objectContaining({
          action: 'media.delivered',
          actorId: reviewer.userId,
          resourceId: assetId,
          reason: 'VERIFICATION_DOCUMENT',
        }),
      );
      expect(JSON.stringify(rows)).not.toContain(signedUrl);
      expect(JSON.stringify(rows)).not.toContain('signature');
    });

    it('audits a refused attempt too', async () => {
      const { assetId } = await asset();
      const r = req();
      await media.getDeliveryUrl(await person(ownerDb), assetId, r).catch(() => undefined);
      const rows = await ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, r.correlationId));
      expect(rows.map((x) => x.action)).toContain('authz.denied.media.deliver');
    });
  });

  it('meets the seven-case authorization contract', async () => {
    const { owner, assetId } = await asset();
    const reviewer = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['VERIFICATION'] });
    const otherInvestigator = await person(ownerDb);

    await expectAuthorized((actor) => deliver(actor, assetId), {
      owner,
      otherOfSameRole: otherInvestigator,
      suspended: { ...owner, status: 'SUSPENDED' },
      wrongState: {
        actor: owner,
        setup: async () => {
          await ownerDb.update(mediaAssets).set({ scanStatus: 'PENDING' }).where(eq(mediaAssets.id, assetId));
        },
      },
    });
    // Out-of-scope staff answer 404 rather than the helper's 403 — asserted separately above.
    await makeReady(ownerDb, assetId, 'CLEAN');
    await expect(deliver(reviewer, assetId)).resolves.toHaveProperty('signedUrl');
  });
});
