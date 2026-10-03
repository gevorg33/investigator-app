import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import { auditLogs, tags } from '../../database/schema';
import { TagsService } from './tags.service';

const REASON = 'Agreed at the vocabulary review, see minutes 4';

describe('the tag vocabulary (T-055)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: TagsService;
  let curator: Actor;
  const req = (correlationId = randomUUID()) => ({
    ip: '198.51.100.55',
    userAgent: 'vitest',
    correlationId,
  });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    curator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['TAXONOMY'] });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(
      new TagsService(db, new AuthzService(audit), audit, new PlatformContext(audit)),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const slug = (stem = 'tag') => `${stem}-${randomUUID().slice(0, 8)}`;
  const added = (label = 'Remote work', as: Actor = curator) =>
    service.create(as, { slug: slug(), label, reason: REASON }, req());
  const auditOf = (resourceId: string, action: string) =>
    ownerDb
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, resourceId), eq(auditLogs.action, action)));
  const rowOf = async (id: string) =>
    (await ownerDb.select().from(tags).where(eq(tags.id, id)))[0]!;

  describe('reading', () => {
    it('lists active tags in the locale asked for, English where untranslated, in label order', async () => {
      const zebra = await added('Zebra crossing');
      const apple = await added('Apple orchard');
      await service.setLabel(
        curator,
        apple.id,
        'ru',
        { label: 'Яблоневый сад', reason: REASON },
        req(),
      );

      const en = (await service.list()).filter((t) => [zebra.id, apple.id].includes(t.id));
      expect(en.map((t) => [t.label, t.labelLocale])).toEqual([
        ['Apple orchard', 'en'],
        ['Zebra crossing', 'en'],
      ]);
      const ru = (await service.list('ru')).filter((t) => [zebra.id, apple.id].includes(t.id));
      expect(ru.map((t) => [t.id, t.label, t.labelLocale])).toEqual(
        expect.arrayContaining([
          [apple.id, 'Яблоневый сад', 'ru'],
          [zebra.id, 'Zebra crossing', 'en'],
        ]),
      );
    });

    it('leaves out a retired tag, and one with no label at all', async () => {
      const retired = await added('Retired');
      await service.deprecate(curator, retired.id, { reason: REASON }, req());
      const [unnamed] = await ownerDb
        .insert(tags)
        .values({ slug: slug('unnamed') })
        .returning();
      const ids = (await service.list()).map((t) => t.id);
      expect(ids).not.toContain(retired.id);
      expect(ids).not.toContain(unnamed!.id);
    });

    it('names tags retired or not, in the locale asked for, and nothing it cannot', async () => {
      const kept = await added('Kept');
      const retired = await added('Retired name');
      await service.deprecate(curator, retired.id, { reason: REASON }, req());
      await service.setLabel(curator, kept.id, 'hy', { label: 'Պահված', reason: REASON }, req());
      const names = await service.labels([kept.id, retired.id, randomUUID()], 'hy');
      expect(Object.fromEntries(names)).toEqual({
        [kept.id]: 'Պահված',
        [retired.id]: 'Retired name',
      });
    });
  });

  describe('maintaining', () => {
    it('adds a tag with its English label, audited with the reason', async () => {
      const correlationId = randomUUID();
      const tag = await service.create(
        curator,
        { slug: slug(), label: '  Remote work  ', reason: REASON },
        req(correlationId),
      );
      expect(tag).toMatchObject({
        status: 'ACTIVE',
        mergedIntoId: null,
        labels: { en: 'Remote work' },
      });
      expect(await auditOf(tag.id, 'tag.created')).toEqual([
        expect.objectContaining({
          actorId: curator.userId,
          staffScope: 'TAXONOMY',
          reason: `${tag.slug} — ${REASON}`,
        }),
      ]);
      const crossings = await ownerDb
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.correlationId, correlationId), eq(auditLogs.action, 'platform.access')),
        );
      expect(crossings.map((a) => a.resourceId)).toEqual(['tag.create']);
    });

    it('refuses a slug already in use', async () => {
      const first = await added();
      await expect(
        service.create(curator, { slug: first.slug, label: 'Again', reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('relabels in one locale, and relabels again in place', async () => {
      const tag = await added('Rush job');
      await service.setLabel(curator, tag.id, 'ru', { label: 'Срочно', reason: REASON }, req());
      const relabelled = await service.setLabel(
        curator,
        tag.id,
        'ru',
        { label: ' Срочная работа ', reason: REASON },
        req(),
      );
      expect(relabelled.labels).toEqual({ en: 'Rush job', ru: 'Срочная работа' });
      expect(await auditOf(tag.id, 'tag.label_set')).toHaveLength(2);
    });

    it('retires a tag once, and keeps it', async () => {
      const tag = await added();
      const retired = await service.deprecate(curator, tag.id, { reason: REASON }, req());
      expect(retired.status).toBe('DEPRECATED');
      expect(await auditOf(tag.id, 'tag.deprecated')).toHaveLength(1);
      await expect(
        service.deprecate(curator, tag.id, { reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 409 });
      expect(await rowOf(tag.id)).toMatchObject({ status: 'DEPRECATED' });
    });

    it('merges a tag into an active one: retired, and naming the tag it became', async () => {
      const old = await added('Overseas');
      const into = await added('Abroad');
      const merged = await service.merge(
        curator,
        old.id,
        { intoId: into.id, reason: REASON },
        req(),
      );
      expect(merged).toMatchObject({ status: 'DEPRECATED', mergedIntoId: into.id });
      expect(await auditOf(old.id, 'tag.merged')).toEqual([
        expect.objectContaining({ reason: `${old.slug} → ${into.id} — ${REASON}` }),
      ]);
    });

    it('refuses to merge twice, into itself, or into a tag not in use', async () => {
      const a = await added();
      const b = await added();
      await service.merge(curator, a.id, { intoId: b.id, reason: REASON }, req());
      await expect(
        service.merge(curator, a.id, { intoId: b.id, reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 409 });

      const c = await added();
      await expect(
        service.merge(curator, c.id, { intoId: c.id, reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 409 });

      const retired = await added();
      await service.deprecate(curator, retired.id, { reason: REASON }, req());
      for (const intoId of [retired.id, randomUUID()]) {
        await expect(
          service.merge(curator, c.id, { intoId, reason: REASON }, req()),
        ).rejects.toMatchObject({ status: 422 });
      }
      expect(await rowOf(c.id)).toMatchObject({ status: 'ACTIVE', mergedIntoId: null });
    });

    it('retires and merges a tag that has no label yet', async () => {
      const [bare] = await ownerDb
        .insert(tags)
        .values({ slug: slug('bare') })
        .returning();
      const [other] = await ownerDb
        .insert(tags)
        .values({ slug: slug('bare') })
        .returning();
      expect(await service.deprecate(curator, bare!.id, { reason: REASON }, req())).toMatchObject({
        status: 'DEPRECATED',
        labels: {},
      });
      const into = await added();
      expect(
        await service.merge(curator, other!.id, { intoId: into.id, reason: REASON }, req()),
      ).toMatchObject({ mergedIntoId: into.id, labels: {} });
    });

    it('does not find a tag that does not exist', async () => {
      for (const write of [
        () => service.setLabel(curator, randomUUID(), 'en', { label: 'x', reason: REASON }, req()),
        () => service.deprecate(curator, randomUUID(), { reason: REASON }, req()),
        () => service.merge(curator, randomUUID(), { intoId: randomUUID(), reason: REASON }, req()),
      ]) {
        await expect(write()).rejects.toMatchObject({ status: 404 });
      }
    });

    it.each([
      ['someone who is not staff', ['CUSTOMER'] as const, [] as const],
      [
        'staff without the TAXONOMY scope',
        ['STAFF'] as const,
        ['MODERATION', 'VERIFICATION'] as const,
      ],
    ])('refuses %s every write', async (_who, roles, staffScopes) => {
      const actor = await person(ownerDb, { roles: [...roles], staffScopes: [...staffScopes] });
      const tag = await added();
      await expect(added('Nope', actor)).rejects.toMatchObject({ status: 403 });
      await expect(
        service.setLabel(actor, tag.id, 'en', { label: 'x', reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.deprecate(actor, tag.id, { reason: REASON }, req()),
      ).rejects.toMatchObject({
        status: 403,
      });
      const other = await added();
      await expect(
        service.merge(actor, tag.id, { intoId: other.id, reason: REASON }, req()),
      ).rejects.toMatchObject({ status: 403 });
      expect(await rowOf(tag.id)).toMatchObject({ status: 'ACTIVE', mergedIntoId: null });
    });
  });

  describe('what the database holds, whoever writes', () => {
    it('keeps a slug, keeps a merge where it is, and merges only into a tag in use', async () => {
      const a = await added();
      const b = await added();
      const c = await added();
      await expect(owner`UPDATE tags SET slug = 'renamed-tag' WHERE id = ${a.id}`).rejects.toThrow(
        /tag_slug_fixed/,
      );
      await service.merge(curator, a.id, { intoId: b.id, reason: REASON }, req());
      await expect(
        owner`UPDATE tags SET merged_into_id = ${c.id} WHERE id = ${a.id}`,
      ).rejects.toThrow(/tag_merged_once/);
      await expect(owner`UPDATE tags SET status = 'ACTIVE' WHERE id = ${a.id}`).rejects.toThrow(
        /tag_merged_once|tags_merged_is_deprecated/,
      );
      await service.deprecate(curator, c.id, { reason: REASON }, req());
      const d = await added();
      await expect(
        owner`UPDATE tags SET status = 'DEPRECATED', merged_into_id = ${c.id} WHERE id = ${d.id}`,
      ).rejects.toThrow(/tag_merge_target_active/);
    });

    it('lets nobody but staff, inside PlatformContext, write the vocabulary', async () => {
      await expect(
        sql.begin((tx) => tx`INSERT INTO tags (slug) VALUES (${slug()})`),
      ).rejects.toThrow(/row-level security/);
      await expect(sql`DELETE FROM tags`).rejects.toThrow(/permission denied/);
    });
  });
});
