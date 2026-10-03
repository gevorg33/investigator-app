import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { posted } from '../../../test/browse-fixtures';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import { category, completeDraft, customer, type TestDb } from '../../../test/mission-fixtures';
import { discoverable, somewhere, type Discoverable } from '../../../test/search-fixtures';
import { confirmedTag, tag } from '../../../test/tag-fixtures';
import { asRequests, inWorkspaceOf, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import { missionScreenings, missionTags, tags } from '../../database/schema';
import { MemoryRateLimitStore, RateLimitService } from '../auth/rate-limit.service';
import { MissionModerationService } from '../mission-policy/mission-moderation.service';
import { MissionPolicyService } from '../mission-policy/mission-policy.service';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import type { BrowseMissionsDto } from '../search/mission-browse.dto';
import { MissionBrowseService } from '../search/mission-browse.service';
import { TagsService } from '../taxonomy/tags.service';
import { MissionTransitionService } from './mission-transition.service';
import { OwnMissionRepository } from './missions.repository';
import { MissionsService } from './missions.service';

const REASON = 'Ordinary company check, nothing personal about the subject.';

/**
 * Mission tags (T-055), end to end: a customer suggests from the curated vocabulary, a moderator
 * confirms at publication, and browse narrows and orders by confirmed tags — while who may see a
 * mission at all is decided exactly as before.
 */
describe('mission tags (T-055)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: TestDb;
  let missionsService: MissionsService;
  let moderation: MissionModerationService;
  let browseService: MissionBrowseService;
  let moderator: Actor;
  let investigator: Discoverable;
  /** This test's own category: browses filter on it, so other suites' missions stay out. */
  let mine: string;
  const req = () => ({ ip: '198.51.100.56', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    moderator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION'] });
  });

  beforeEach(async () => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    const transitions = new MissionTransitionService(authz, audit);
    missionsService = asRequests(
      new MissionsService(
        db,
        authz,
        audit,
        new OwnMissionRepository(db),
        transitions,
        new MissionPolicyService(),
        new RateLimitService(new MemoryRateLimitStore()),
      ),
      owner,
    );
    moderation = asRequests(
      new MissionModerationService(
        db,
        authz,
        transitions,
        new PlatformContext(audit),
        new TagsService(db, authz, audit, new PlatformContext(audit)),
      ),
      owner,
    );
    browseService = asRequests(
      new MissionBrowseService(db, authz, new OwnInvestigatorProfileRepository(db)),
      owner,
    );
    investigator = await discoverable(ownerDb, { centre: somewhere(), radiusKm: 10 });
    mine = await category(ownerDb);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const draft = async (tagIds: string[] = []) => {
    const { actor } = await customer(ownerDb);
    const created = await missionsService.createDraft(
      actor,
      { ...completeDraft(mine), tagIds },
      req(),
    );
    return { actor, ...created };
  };
  const submitted = async (tagIds: string[]) => {
    const d = await draft(tagIds);
    const sent = await missionsService.submit(
      d.actor,
      d.id,
      { version: d.version, lawfulPurposeConfirmed: true },
      req(),
    );
    return { actor: d.actor, id: d.id, version: sent.version, tagIds: sent.tagIds };
  };
  const rowsOf = (missionId: string) =>
    ownerDb.select().from(missionTags).where(eq(missionTags.missionId, missionId));
  const browse = (dto: BrowseMissionsDto = {}) =>
    browseService
      .browse(investigator.actor, { taxonomyNodeIds: [mine], ...dto }, req())
      .then((page) => page.items.map((i) => i.id));

  describe('a customer suggests', () => {
    it('suggests from the vocabulary when creating, replaces the set when editing, and withdraws with []', async () => {
      const [remote, urgent, records] = [
        await tag(ownerDb),
        await tag(ownerDb),
        await tag(ownerDb),
      ];
      const d = await draft([remote, urgent]);
      expect(new Set(d.tagIds)).toEqual(new Set([remote, urgent]));

      const edited = await missionsService.updateDraft(
        d.actor,
        d.id,
        { version: d.version, tagIds: [urgent, records, urgent] },
        req(),
      );
      expect(new Set(edited.tagIds)).toEqual(new Set([urgent, records]));
      expect(new Set((await missionsService.getMine(d.actor, d.id, req())).tagIds)).toEqual(
        new Set([urgent, records]),
      );

      // An edit that says nothing about tags leaves them alone.
      const untouched = await missionsService.updateDraft(
        d.actor,
        d.id,
        { version: edited.version, title: 'Renamed' },
        req(),
      );
      expect(new Set(untouched.tagIds)).toEqual(new Set([urgent, records]));

      const cleared = await missionsService.updateDraft(
        d.actor,
        d.id,
        { version: untouched.version, tagIds: [] },
        req(),
      );
      expect(cleared.tagIds).toEqual([]);
      expect(await rowsOf(d.id)).toEqual([]);
    });

    it('refuses a tag not in the vocabulary, or no longer in use, and saves nothing', async () => {
      const retired = await tag(ownerDb, { status: 'DEPRECATED' });
      const { actor } = await customer(ownerDb);
      for (const [id, key] of [
        [randomUUID(), 'error.validation.tags.unknown'],
        [retired, 'error.validation.tags.deprecated'],
      ] as const) {
        await expect(
          missionsService.createDraft(actor, { ...completeDraft(mine), tagIds: [id] }, req()),
        ).rejects.toMatchObject({ status: 422, details: [{ field: 'tagIds', messageKey: key }] });
      }
      expect((await missionsService.listMine(actor, req())).map((m) => m.id)).toEqual([]);
    });

    it('carries the suggestions through every read: the list, submitting and cancelling', async () => {
      const t = await tag(ownerDb);
      const sent = await submitted([t]);
      expect(sent.tagIds).toEqual([t]);
      expect((await missionsService.listMine(sent.actor, req()))[0]!.tagIds).toEqual([t]);
      const cancelled = await missionsService.cancel(
        sent.actor,
        sent.id,
        { version: sent.version },
        req(),
      );
      expect(cancelled.tagIds).toEqual([t]);
    });

    it('freezes the suggestions once submitted — at the service, and in the database', async () => {
      const [t, other] = [await tag(ownerDb), await tag(ownerDb)];
      const sent = await submitted([t]);
      await expect(
        missionsService.updateDraft(
          sent.actor,
          sent.id,
          { version: sent.version, tagIds: [] },
          req(),
        ),
      ).rejects.toMatchObject({ status: 403 });

      const asCustomer = <T>(fn: (db: ReturnType<typeof scopedDb>) => Promise<T>) =>
        inWorkspaceOf(owner, sent.actor.userId, async () => await fn(scopedDb(sql)));
      await expect(
        asCustomer((db) =>
          db
            .insert(missionTags)
            .values({ missionId: sent.id, tagId: other, suggestedAt: new Date() }),
        ),
      ).rejects.toSatisfy((e: unknown) =>
        /row-level security/.test(String((e as { cause?: Error }).cause?.message)),
      );
      await asCustomer((db) => db.delete(missionTags).where(eq(missionTags.missionId, sent.id)));
      expect((await rowsOf(sent.id)).map((r) => r.tagId)).toEqual([t]);
    });

    it('lets a customer neither confirm a tag nor read anyone else’s', async () => {
      const t = await tag(ownerDb);
      const d = await draft([t]);
      await inWorkspaceOf(
        owner,
        d.actor.userId,
        async () =>
          await scopedDb(sql)
            .update(missionTags)
            .set({ confirmedAt: new Date(), confirmedBy: d.actor.userId })
            .where(eq(missionTags.missionId, d.id)),
      );
      expect((await rowsOf(d.id))[0]!.confirmedAt).toBeNull();

      const other = await draft([t]);
      const seen = await inWorkspaceOf(
        owner,
        d.actor.userId,
        async () =>
          await scopedDb(sql).select().from(missionTags).where(eq(missionTags.missionId, other.id)),
      );
      expect(seen).toEqual([]);
    });

    it('does not change what screening finds: the same mission screens the same, tagged or not', async () => {
      const t = await tag(ownerDb);
      const [plain, tagged] = [await submitted([]), await submitted([t])];
      const screened = async (id: string) =>
        (
          await ownerDb.select().from(missionScreenings).where(eq(missionScreenings.missionId, id))
        )[0]!;
      const [a, b] = [await screened(plain.id), await screened(tagged.id)];
      expect([b.outcome, b.riskBand, b.flags]).toEqual([a.outcome, a.riskBand, a.flags]);
    });
  });

  describe('a moderator confirms, publishing', () => {
    it('confirms the suggestions kept and the tags added; one left out stays only a suggestion', async () => {
      const [kept, dropped, added] = [
        await tag(ownerDb, { labels: { en: 'Kept' } }),
        await tag(ownerDb, { labels: { en: 'Dropped' } }),
        await tag(ownerDb, { labels: { en: 'Added' } }),
      ];
      const m = await submitted([kept, dropped]);
      const before = await moderation.getForReview(moderator, m.id, req());
      expect(before.tags).toHaveLength(2);
      expect(before.tags).toEqual(
        expect.arrayContaining([
          { id: kept, label: 'Kept', suggested: true, confirmed: false },
          { id: dropped, label: 'Dropped', suggested: true, confirmed: false },
        ]),
      );

      await moderation.decide(
        moderator,
        m.id,
        { outcome: 'PUBLISHED', reason: REASON, version: m.version, tagIds: [kept, added] },
        req(),
      );
      const rows = Object.fromEntries((await rowsOf(m.id)).map((r) => [r.tagId, r]));
      expect(rows[kept]).toMatchObject({ confirmedBy: moderator.userId });
      expect(rows[kept]!.suggestedAt).not.toBeNull();
      expect(rows[added]).toMatchObject({ suggestedAt: null, confirmedBy: moderator.userId });
      expect(rows[dropped]).toMatchObject({ confirmedAt: null, confirmedBy: null });

      const after = await moderation.getForReview(moderator, m.id, req());
      expect(after.tags.map((t) => [t.label, t.suggested, t.confirmed])).toEqual(
        expect.arrayContaining([
          ['Kept', true, true],
          ['Dropped', true, false],
          ['Added', false, true],
        ]),
      );
    });

    it('shows the customer what the mission was published with, beside what they suggested (T-194)', async () => {
      const [kept, dropped, added] = [await tag(ownerDb), await tag(ownerDb), await tag(ownerDb)];
      const m = await submitted([kept, dropped]);
      // Suggested together, so in one instant: the order between them is the tag ids'.
      const sorted = (ids: readonly string[]) => [...ids].sort();
      const before = await missionsService.getMine(m.actor, m.id, req());
      expect(sorted(before.tagIds)).toEqual(sorted([kept, dropped]));
      expect(before.confirmedTagIds).toEqual([]);

      await moderation.decide(
        moderator,
        m.id,
        { outcome: 'PUBLISHED', reason: REASON, version: m.version, tagIds: [kept, added] },
        req(),
      );
      const read = await missionsService.getMine(m.actor, m.id, req());
      expect(sorted(read.tagIds)).toEqual(sorted([kept, dropped]));
      expect(sorted(read.confirmedTagIds)).toEqual(sorted([kept, added]));
      const listed = (await missionsService.listMine(m.actor, req())).find((x) => x.id === m.id)!;
      expect(sorted(listed.confirmedTagIds)).toEqual(sorted([kept, added]));
    });

    it('shows the customer a published tag as the one it has since been merged into, once', async () => {
      const [old, into, newer] = [await tag(ownerDb), await tag(ownerDb), await tag(ownerDb)];
      const m = await submitted([old, into]);
      await moderation.decide(
        moderator,
        m.id,
        { outcome: 'PUBLISHED', reason: REASON, version: m.version, tagIds: [old, into] },
        req(),
      );
      // Merged into a tag that is later merged itself: the customer reads the end of the chain,
      // which is what investigators find the mission under — and only once.
      await owner`UPDATE tags SET status = 'DEPRECATED', merged_into_id = ${into} WHERE id = ${old}`;
      await owner`UPDATE tags SET status = 'DEPRECATED', merged_into_id = ${newer} WHERE id = ${into}`;

      const read = await missionsService.getMine(m.actor, m.id, req());
      expect(read.confirmedTagIds).toEqual([newer]);
      // The suggestions are what the customer chose, as they chose them.
      expect([...read.tagIds].sort()).toEqual([old, into].sort());
      expect((await rowsOf(m.id)).map((r) => r.tagId).sort()).toEqual([old, into].sort());
    });

    it('shows a tag with no label as unnamed rather than inventing a name', async () => {
      const [bare] = await ownerDb
        .insert(tags)
        .values({ slug: `bare-${randomUUID().slice(0, 8)}` })
        .returning();
      const m = await submitted([bare!.id]);
      expect((await moderation.getForReview(moderator, m.id, req())).tags).toEqual([
        { id: bare!.id, label: null, suggested: true, confirmed: false },
      ]);
    });

    it('confirms nothing when publishing names no tags', async () => {
      const t = await tag(ownerDb);
      const m = await submitted([t]);
      await moderation.decide(
        moderator,
        m.id,
        { outcome: 'PUBLISHED', reason: REASON, version: m.version },
        req(),
      );
      expect((await rowsOf(m.id)).every((r) => r.confirmedAt === null)).toBe(true);
    });

    it('confirms tags only by publishing, and only tags still in use — refusing leaves the mission under review', async () => {
      const [t, retired] = [await tag(ownerDb), await tag(ownerDb, { status: 'DEPRECATED' })];
      const m = await submitted([t]);
      await expect(
        moderation.decide(
          moderator,
          m.id,
          { outcome: 'REJECTED', reason: REASON, version: m.version, tagIds: [t] },
          req(),
        ),
      ).rejects.toMatchObject({
        status: 422,
        details: [{ messageKey: 'error.validation.moderation.tags_on_publish' }],
      });
      await expect(
        moderation.decide(
          moderator,
          m.id,
          { outcome: 'PUBLISHED', reason: REASON, version: m.version, tagIds: [retired] },
          req(),
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect((await moderation.getForReview(moderator, m.id, req())).status).toBe('UNDER_REVIEW');
      expect((await rowsOf(m.id)).every((r) => r.confirmedAt === null)).toBe(true);
    });
  });

  describe('browse narrows and orders by confirmed tags', () => {
    it('keeps missions carrying every tag asked for — confirmed, never merely suggested', async () => {
      const [a, b] = [await tag(ownerDb), await tag(ownerDb)];
      const both = await posted(ownerDb, mine);
      const onlyA = await posted(ownerDb, mine);
      const none = await posted(ownerDb, mine);
      const suggestedOnly = await posted(ownerDb, mine);
      await confirmedTag(ownerDb, { missionId: both, tagId: a });
      await confirmedTag(ownerDb, { missionId: both, tagId: b });
      await confirmedTag(ownerDb, { missionId: onlyA, tagId: a });
      await ownerDb
        .insert(missionTags)
        .values({ missionId: suggestedOnly, tagId: a, suggestedAt: new Date() });

      const all = await browse();
      expect(all).toEqual(expect.arrayContaining([both, onlyA, none, suggestedOnly]));
      expect(new Set(await browse({ tagIds: [a] }))).toEqual(new Set([both, onlyA]));
      // A second tag narrows further; it never widens.
      expect(await browse({ tagIds: [a, b] })).toEqual([both]);
      expect(await browse({ tagIds: [randomUUID()] })).toEqual([]);
    });

    it('finds, under the tag a merged one became, every mission that carried the old one', async () => {
      const [old, into] = [await tag(ownerDb), await tag(ownerDb)];
      const underOld = await posted(ownerDb, mine);
      const underNew = await posted(ownerDb, mine);
      await confirmedTag(ownerDb, { missionId: underOld, tagId: old });
      await confirmedTag(ownerDb, { missionId: underNew, tagId: into });
      await owner`UPDATE tags SET status = 'DEPRECATED', merged_into_id = ${into} WHERE id = ${old}`;

      expect(new Set(await browse({ tagIds: [into] }))).toEqual(new Set([underOld, underNew]));
      // The mission itself was never rewritten.
      expect((await rowsOf(underOld)).map((r) => r.tagId)).toEqual([old]);
    });

    it('ranks a mission whose confirmed tag names the words above one that only mentions them', async () => {
      const word = `zq${randomUUID().slice(0, 6).replace(/\d/g, 'x')}`;
      const t = await tag(ownerDb, { labels: { en: `${word} audit`, ru: 'аудит' } });
      const mentions = await posted(ownerDb, mine, {
        description: `Somewhere in the brief it says ${word}, once, in passing among other words.`,
      });
      const tagged = await posted(ownerDb, mine);
      await confirmedTag(ownerDb, { missionId: tagged, tagId: t });
      expect(await browse({ q: word, sort: 'relevance' })).toEqual([tagged, mentions]);
    });

    it('decides nothing about who sees a mission: a tag filter never reaches a mission browse would not show', async () => {
      const t = await tag(ownerDb);
      const hired = await posted(ownerDb, mine, { status: 'CUSTOMER_CONFIRMED' });
      const own = await posted(ownerDb, mine, { customerId: investigator.actor.userId });
      const underReview = await posted(ownerDb, mine, { status: 'UNDER_REVIEW' });
      const open = await posted(ownerDb, mine);
      for (const missionId of [hired, own, underReview, open]) {
        await confirmedTag(ownerDb, { missionId, tagId: t });
      }
      expect(await browse({ tagIds: [t] })).toEqual([open]);
      // And the same missions without the filter: a tag adds no one, and takes no one away.
      const unfiltered = await browse();
      expect(unfiltered).toContain(open);
      for (const id of [hired, own, underReview]) expect(unfiltered).not.toContain(id);
    });

    it('lets an investigator read a confirmed tag only on a mission they can see, and never a suggestion', async () => {
      const [confirmed, suggested] = [await tag(ownerDb), await tag(ownerDb)];
      const open = await posted(ownerDb, mine);
      const notOpen = await posted(ownerDb, mine, { status: 'UNDER_REVIEW' });
      await confirmedTag(ownerDb, { missionId: open, tagId: confirmed });
      await confirmedTag(ownerDb, { missionId: notOpen, tagId: confirmed });
      await ownerDb
        .insert(missionTags)
        .values({ missionId: open, tagId: suggested, suggestedAt: new Date() });

      const seen = await inWorkspaceOf(
        owner,
        investigator.userId,
        async () =>
          await scopedDb(sql)
            .select({ missionId: missionTags.missionId, tagId: missionTags.tagId })
            .from(missionTags)
            .where(and(eq(missionTags.tagId, confirmed))),
      );
      expect(seen).toEqual([{ missionId: open, tagId: confirmed }]);
      const suggestions = await inWorkspaceOf(
        owner,
        investigator.userId,
        async () =>
          await scopedDb(sql).select().from(missionTags).where(eq(missionTags.tagId, suggested)),
      );
      expect(suggestions).toEqual([]);
      // The vocabulary itself is everyone's to read.
      const vocabulary = await inWorkspaceOf(
        owner,
        investigator.userId,
        async () => await scopedDb(sql).select().from(tags).where(eq(tags.id, confirmed)),
      );
      expect(vocabulary).toHaveLength(1);
    });
  });
});
