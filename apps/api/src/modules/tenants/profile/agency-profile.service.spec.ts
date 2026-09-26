import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agencyImage, agencyProfile, agencySettings } from '../../../../test/agency-fixtures';
import { testPool } from '../../../../test/db';
import { FakeStorage } from '../../../../test/media-fixtures';
import { agencyContext, personalContext, scopedDb } from '../../../../test/workspace-context';
import { agency, member } from '../../../../test/workspace-fixtures';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { PlatformContext } from '../../../common/context/platform-context';
import { runInContext, type ExecutionContext } from '../../../common/context/execution-context';
import * as schema from '../../../database/schema';
import { auditLogs, tenantProfiles } from '../../../database/schema';
import { MemoryRateLimitStore, RateLimitService } from '../../auth/rate-limit.service';
import { OwnMediaRepository, ViewableMediaRepository } from '../../media/media.repository';
import { MediaService } from '../../media/media.service';
import { AgencyProfileService } from './agency-profile.service';

describe('agency profile (T-084)', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let profiles: AgencyProfileService;
  const req = () => ({ ip: '198.51.100.84', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const authz = new AuthzService(new AuditService(db));
    const media = new MediaService(
      db,
      authz,
      new AuditService(db),
      new RateLimitService(new MemoryRateLimitStore()),
      new OwnMediaRepository(db),
      new ViewableMediaRepository(db),
      new FakeStorage(),
      new PlatformContext(new AuditService(db)),
    );
    profiles = new AgencyProfileService(db, authz, new AuditService(db), media);
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  interface Member {
    actor: Actor;
    context: ExecutionContext;
  }

  const setUp = async (...roles: string[]) => {
    const people = await Promise.all([undefined, ...roles].map(() => member(ownerSql)));
    const { tenantId } = await agency(
      ownerSql,
      people.map((p, i) => ({ userId: p.actor.userId, ...(i > 0 && { role: roles[i - 1] }) })),
    );
    const members: Member[] = await Promise.all(
      people.map(async (p) => ({
        actor: p.actor,
        context: await agencyContext(ownerSql, p.actor.userId, tenantId),
      })),
    );
    const [row] = await ownerSql<
      { name: string }[]
    >`SELECT name FROM tenants WHERE id = ${tenantId}`;
    return { tenantId, name: row!.name, owner: members[0]!, others: members.slice(1) };
  };

  /** Someone with no part in the agency, in their own Personal workspace. */
  const stranger = async (): Promise<Member> => {
    const { actor } = await member(ownerSql);
    return { actor, context: await personalContext(ownerSql, actor.userId) };
  };

  const as = <T>(m: Member, fn: () => Promise<T>) => runInContext(m.context, fn);
  const audited = async (correlationId: string) =>
    ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, correlationId));
  const stored = async (tenantId: string) =>
    (await ownerDb.select().from(tenantProfiles).where(eq(tenantProfiles.tenantId, tenantId)))[0];

  describe('the agency’s own view', () => {
    it('is a draft under the registered name until something is saved, and says what publishing needs', async () => {
      const a = await setUp();
      expect(await as(a.owner, () => profiles.readOwn(a.owner.actor, req()))).toEqual({
        name: a.name,
        displayName: null,
        headline: null,
        about: null,
        logo: null,
        cover: null,
        publishedAt: null,
        version: 0,
        missing: ['headline'],
      });
    });

    it('says an unfinished agency must be finished first', async () => {
      const a = await setUp();
      await ownerSql`UPDATE tenants SET status = 'CREATING' WHERE id = ${a.tenantId}`;
      expect((await as(a.owner, () => profiles.readOwn(a.owner.actor, req()))).missing).toEqual([
        'agency_setup',
        'headline',
      ]);
    });

    it('is readable by every member — a viewer included — and by nobody outside', async () => {
      const a = await setUp('VIEWER');
      await agencyProfile(ownerSql, a.tenantId, { displayName: 'Ararat Checks' });
      const viewer = a.others[0]!;
      expect(await as(viewer, () => profiles.readOwn(viewer.actor, req()))).toMatchObject({
        name: 'Ararat Checks',
        version: 1,
        missing: [],
      });
      const other = await setUp();
      // Another agency's owner reads their own — nothing of this one.
      expect(
        (await as(other.owner, () => profiles.readOwn(other.owner.actor, req()))).version,
      ).toBe(0);
    });

    it('does not exist in a Personal workspace', async () => {
      const s = await stranger();
      const r = req();
      await expect(as(s, () => profiles.readOwn(s.actor, r))).rejects.toMatchObject({
        status: 403,
      });
      expect((await audited(r.correlationId))[0]).toMatchObject({
        reason: 'workspace_kind_forbidden',
      });
    });

    it('shows a ready image as a link, and one still being scanned without one', async () => {
      const a = await setUp();
      const logo = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
      });
      const cover = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
        category: 'AGENCY_COVER',
        scanStatus: 'PENDING',
      });
      await agencyProfile(ownerSql, a.tenantId, { logoMediaId: logo, coverMediaId: cover });
      const own = await as(a.owner, () => profiles.readOwn(a.owner.actor, req()));
      expect(own.logo).toEqual({
        mediaId: logo,
        link: { signedUrl: expect.stringContaining('signature=sig'), expiresAt: expect.any(Date) },
      });
      expect(own.cover).toEqual({ mediaId: cover, link: null });
    });
  });

  describe('changing it', () => {
    it('saves a first change at version 1, trimmed, and audits it', async () => {
      const a = await setUp();
      const r = req();
      const saved = await as(a.owner, () =>
        profiles.update(
          a.owner.actor,
          { version: 0, displayName: '  Ararat Checks ', headline: 'Due diligence', about: '   ' },
          r,
        ),
      );
      expect(saved).toMatchObject({
        name: 'Ararat Checks',
        displayName: 'Ararat Checks',
        headline: 'Due diligence',
        about: null,
        version: 1,
        missing: [],
      });
      expect(await audited(r.correlationId)).toMatchObject([
        {
          action: 'agency.profile.updated',
          actorId: a.owner.actor.userId,
          resourceType: 'tenant_profile',
        },
      ]);
    });

    it('leaves what a change does not name, clears what it sets to null, and moves the version on', async () => {
      const a = await setUp('ADMIN');
      const admin = a.others[0]!;
      await agencyProfile(ownerSql, a.tenantId, {
        displayName: 'Ararat Checks',
        about: 'Since 2019.',
      });
      const saved = await as(admin, () =>
        profiles.update(admin.actor, { version: 1, displayName: null }, req()),
      );
      expect(saved).toMatchObject({
        name: a.name,
        displayName: null,
        about: 'Since 2019.',
        version: 2,
      });
    });

    it('refuses text of the wrong length, every field at once, as field errors', async () => {
      const a = await setUp();
      await expect(
        as(a.owner, () =>
          profiles.update(
            a.owner.actor,
            { version: 0, displayName: ' A ', headline: 'x'.repeat(161), about: 'y'.repeat(3001) },
            req(),
          ),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [
          {
            field: 'displayName',
            code: 'LENGTH',
            messageKey: 'error.validation.agency_profile.displayName_length',
          },
          { field: 'headline', code: 'LENGTH' },
          { field: 'about', code: 'LENGTH' },
        ],
      });
    });

    it('refuses a change made against a version that is no longer current', async () => {
      const a = await setUp();
      await agencyProfile(ownerSql, a.tenantId);
      for (const version of [0, 2]) {
        await expect(
          as(a.owner, () => profiles.update(a.owner.actor, { version, about: 'x' }, req())),
        ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      }
    });

    it('lets exactly one of two first saves through', async () => {
      const a = await setUp();
      const save = (headline: string) =>
        as(a.owner, () => profiles.update(a.owner.actor, { version: 0, headline }, req()));
      const results = await Promise.allSettled([save('One'), save('Two')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('takes the agency’s own uploaded logo and cover', async () => {
      const a = await setUp();
      const logo = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
      });
      const cover = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
        category: 'AGENCY_COVER',
      });
      await as(a.owner, () =>
        profiles.update(
          a.owner.actor,
          { version: 0, logoMediaId: logo, coverMediaId: cover },
          req(),
        ),
      );
      expect(await stored(a.tenantId)).toMatchObject({ logoMediaId: logo, coverMediaId: cover });
    });

    it('refuses an image that is not this agency’s, not the right kind, or not uploaded yet', async () => {
      const a = await setUp();
      const b = await setUp();
      const theirs = await agencyImage(ownerSql, {
        tenantId: b.tenantId,
        uploadedBy: b.owner.actor.userId,
      });
      const cover = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
        category: 'AGENCY_COVER',
      });
      const unfinished = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
        uploadStatus: 'AUTHORIZED',
      });
      for (const [logoMediaId, coverMediaId] of [
        [theirs, undefined],
        [cover, undefined],
        [unfinished, undefined],
        [undefined, randomUUID()],
      ] as const) {
        const images = {
          ...(logoMediaId !== undefined && { logoMediaId }),
          ...(coverMediaId !== undefined && { coverMediaId }),
        };
        await expect(
          as(a.owner, () => profiles.update(a.owner.actor, { version: 0, ...images }, req())),
        ).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
          details: [
            {
              field: logoMediaId === undefined ? 'coverMediaId' : 'logoMediaId',
              code: 'NOT_USABLE',
              messageKey: 'error.validation.agency_profile.image',
            },
          ],
        });
      }
      expect(await stored(a.tenantId)).toBeUndefined();
    });

    it('refuses another agency’s logo even while their published profile makes it visible', async () => {
      const a = await setUp();
      const b = await setUp();
      const theirs = await agencyImage(ownerSql, {
        tenantId: b.tenantId,
        uploadedBy: b.owner.actor.userId,
      });
      await agencyProfile(ownerSql, b.tenantId, { logoMediaId: theirs, published: true });
      await expect(
        as(a.owner, () =>
          profiles.update(a.owner.actor, { version: 0, logoMediaId: theirs }, req()),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ code: 'NOT_USABLE' }] });
    });

    it('keeps a published profile’s headline — it would publish a profile that says nothing', async () => {
      const a = await setUp();
      await agencyProfile(ownerSql, a.tenantId, { published: true });
      await expect(
        as(a.owner, () => profiles.update(a.owner.actor, { version: 1, headline: '  ' }, req())),
      ).rejects.toMatchObject({ details: [{ field: 'headline', code: 'REQUIRED' }] });
      // Anything else may still change while it is published.
      await expect(
        as(a.owner, () =>
          profiles.update(a.owner.actor, { version: 1, about: 'Now open.' }, req()),
        ),
      ).resolves.toMatchObject({ about: 'Now open.', version: 2 });
    });

    it('is for those who may change the company — not a manager or a viewer', async () => {
      const a = await setUp('MANAGER', 'VIEWER');
      for (const m of a.others) {
        const r = req();
        await expect(
          as(m, () => profiles.update(m.actor, { version: 0, headline: 'x' }, r)),
        ).rejects.toMatchObject({ status: 403 });
        expect((await audited(r.correlationId))[0]).toMatchObject({
          reason: 'permission_not_held',
        });
      }
    });
  });

  describe('publishing', () => {
    it('needs a finished agency and a headline, and says which is missing', async () => {
      const a = await setUp();
      await ownerSql`UPDATE tenants SET status = 'CREATING' WHERE id = ${a.tenantId}`;
      await agencyProfile(ownerSql, a.tenantId, { headline: null });
      await expect(
        as(a.owner, () => profiles.publish(a.owner.actor, 1, req())),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [
          {
            field: 'agency_setup',
            code: 'REQUIRED',
            messageKey: 'error.validation.agency_profile.agency_setup',
          },
          {
            field: 'headline',
            code: 'REQUIRED',
            messageKey: 'error.validation.agency_profile.headline',
          },
        ],
      });
      expect((await stored(a.tenantId))?.publishedAt).toBeNull();
    });

    it('cannot publish a profile never saved — there is no headline', async () => {
      const a = await setUp();
      await expect(
        as(a.owner, () => profiles.publish(a.owner.actor, 0, req())),
      ).rejects.toMatchObject({
        details: [{ field: 'headline' }],
      });
    });

    it('publishes, keeps the first moment it went out, and audits both ways', async () => {
      const a = await setUp();
      await agencyProfile(ownerSql, a.tenantId);
      const r = req();
      const out = await as(a.owner, () => profiles.publish(a.owner.actor, 1, r));
      expect(out.publishedAt).toBeInstanceOf(Date);
      expect(out.version).toBe(2);
      const again = await as(a.owner, () => profiles.publish(a.owner.actor, 2, req()));
      expect(again.publishedAt).toEqual(out.publishedAt);

      const back = req();
      const draft = await as(a.owner, () => profiles.unpublish(a.owner.actor, 3, back));
      expect(draft).toMatchObject({ publishedAt: null, version: 4 });
      expect(await audited(r.correlationId)).toMatchObject([
        { action: 'agency.profile.published' },
      ]);
      expect(await audited(back.correlationId)).toMatchObject([
        { action: 'agency.profile.unpublished' },
      ]);
    });

    it('refuses a publish made against a version that is no longer current', async () => {
      const a = await setUp();
      await agencyProfile(ownerSql, a.tenantId);
      await expect(
        as(a.owner, () => profiles.publish(a.owner.actor, 0, req())),
      ).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
    });

    it('has nothing to take down when nothing was ever saved', async () => {
      const a = await setUp();
      const r = req();
      await expect(
        as(a.owner, () => profiles.unpublish(a.owner.actor, 0, r)),
      ).rejects.toMatchObject({
        status: 403,
      });
      expect((await audited(r.correlationId))[0]).toMatchObject({ reason: 'state_forbids_action' });
    });

    it('is for those who may change the company', async () => {
      const a = await setUp('MANAGER');
      await agencyProfile(ownerSql, a.tenantId);
      const manager = a.others[0]!;
      await expect(
        as(manager, () => profiles.publish(manager.actor, 1, req())),
      ).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('the database as the last line', () => {
    it('refuses a published profile without a headline, whatever writes it', async () => {
      const a = await setUp();
      await expect(
        agencyProfile(ownerSql, a.tenantId, { headline: null, published: true }),
      ).rejects.toThrow(/tenant_profiles_published_has_headline/);
    });

    it('refuses a logo that is not an AGENCY_LOGO, and a cover that is not an AGENCY_COVER', async () => {
      const a = await setUp();
      const photo = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
        category: 'PROFILE_IMAGE',
      });
      const logo = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
      });
      await expect(agencyProfile(ownerSql, a.tenantId, { logoMediaId: photo })).rejects.toThrow(
        /tenant_profiles_logo_category/,
      );
      await expect(agencyProfile(ownerSql, a.tenantId, { coverMediaId: logo })).rejects.toThrow(
        /tenant_profiles_cover_category/,
      );
    });

    it('refuses another workspace’s file, and a profile for a Personal workspace', async () => {
      const a = await setUp();
      const b = await setUp();
      const theirs = await agencyImage(ownerSql, {
        tenantId: b.tenantId,
        uploadedBy: b.owner.actor.userId,
      });
      await expect(agencyProfile(ownerSql, a.tenantId, { logoMediaId: theirs })).rejects.toThrow(
        /tenant_profiles_logo_fk/,
      );
      const s = await stranger();
      await expect(agencyProfile(ownerSql, s.context.tenantId)).rejects.toThrow(
        /tenant_profiles_tenant_kind_fk/,
      );
    });
  });

  describe('the public projection', () => {
    /** A published agency with private things around it that must never come through. */
    const published = async () => {
      const a = await setUp('VIEWER');
      const logo = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
      });
      const cover = await agencyImage(ownerSql, {
        tenantId: a.tenantId,
        uploadedBy: a.owner.actor.userId,
        category: 'AGENCY_COVER',
        scanStatus: 'PENDING',
      });
      await agencyProfile(ownerSql, a.tenantId, {
        headline: 'Due diligence across Armenia',
        about: 'Company checks, court records, site visits.',
        logoMediaId: logo,
        coverMediaId: cover,
        published: true,
      });
      await agencySettings(ownerSql, a.tenantId, { value: { accentColor: '#166534' } });
      return { ...a, logo };
    };

    it('is exactly the projection — no settings, members, customers, contact or money', async () => {
      const a = await published();
      const s = await stranger();
      const seen = await as(s, () => profiles.readPublished(s.actor, a.tenantId, req()));
      expect(seen).toEqual({
        id: a.tenantId,
        name: a.name,
        headline: 'Due diligence across Armenia',
        about: 'Company checks, court records, site visits.',
        countryCode: 'AM',
        logo: { signedUrl: expect.stringContaining('signature=sig'), expiresAt: expect.any(Date) },
        // Still being scanned: not shown, rather than shown unscanned.
        cover: null,
      });
      const [agencyRow] = await ownerSql<{ business_email: string }[]>`
        SELECT business_email FROM tenants WHERE id = ${a.tenantId}`;
      const text = JSON.stringify(seen);
      for (const secret of [
        agencyRow!.business_email,
        'AMD',
        'Asia/Yerevan',
        '#166534',
        a.owner.actor.userId,
        a.others[0]!.actor.userId,
      ]) {
        expect(text).not.toContain(secret);
      }
    });

    it('shows the display name when there is one', async () => {
      const a = await published();
      await ownerSql`UPDATE tenant_profiles SET display_name = 'Ararat Checks' WHERE tenant_id = ${a.tenantId}`;
      const s = await stranger();
      expect((await as(s, () => profiles.readPublished(s.actor, a.tenantId, req()))).name).toBe(
        'Ararat Checks',
      );
    });

    it('shows no image it cannot show — one still being scanned, or none at all', async () => {
      const a = await published();
      const s = await stranger();
      const read = () => as(s, () => profiles.readPublished(s.actor, a.tenantId, req()));
      await ownerSql`UPDATE media_assets SET scan_status = 'PENDING' WHERE id = ${a.logo}`;
      expect((await read()).logo).toBeNull();
      await ownerSql`UPDATE tenant_profiles SET logo_media_id = NULL, cover_media_id = NULL
                      WHERE tenant_id = ${a.tenantId}`;
      expect(await read()).toMatchObject({ logo: null, cover: null });
    });

    it('answers the same 404 for a draft, a suspended agency, a Personal workspace and nothing at all', async () => {
      const draft = await setUp();
      await agencyProfile(ownerSql, draft.tenantId);
      const suspended = await published();
      await ownerSql`UPDATE tenants SET status = 'SUSPENDED' WHERE id = ${suspended.tenantId}`;
      const s = await stranger();
      for (const id of [draft.tenantId, suspended.tenantId, s.context.tenantId, randomUUID()]) {
        const r = req();
        await expect(as(s, () => profiles.readPublished(s.actor, id, r))).rejects.toMatchObject({
          status: 404,
        });
        expect((await audited(r.correlationId))[0]).toMatchObject({
          reason: 'resource_not_visible',
        });
      }
    });

    it('does not show a draft even to the agency’s own members, through this door', async () => {
      const a = await setUp();
      await agencyProfile(ownerSql, a.tenantId);
      await expect(
        as(a.owner, () => profiles.readPublished(a.owner.actor, a.tenantId, req())),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
