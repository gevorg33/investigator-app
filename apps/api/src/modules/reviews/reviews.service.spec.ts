import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignment } from '../../../test/assignment-fixtures';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import {
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
} from '../../../test/quote-fixtures';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import { auditLogs, investigatorProfiles, reviewTexts, reviews } from '../../database/schema';
import { ReviewsService } from './reviews.service';

/**
 * Reviews, through the service, against the real database (T-037).
 *
 * What the service adds to the database's own rules is shape: a clear refusal before the trigger
 * refuses, the views each reader gets, the public list's filters, the moderation queue and the
 * audit trail. Each is held here; the rules themselves are also held underneath, in
 * `test/isolation/reviews.spec.ts`.
 */
describe('reviews', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: ReviewsService;
  let moderator: Actor;
  let reader: Actor;
  const req = () => ({ ip: '198.51.100.37', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    moderator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION'] });
    reader = (await quotableMission(ownerDb)).actor;
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(
      new ReviewsService(db, new AuthzService(audit), audit, new PlatformContext(audit)),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  /** A completed assignment on `profileId` (a new investigator's, unless one is given). */
  const completed = async (investigator?: Awaited<ReturnType<typeof eligibleInvestigator>>) => {
    const mission = await quotableMission(ownerDb);
    const who = investigator ?? (await eligibleInvestigator(ownerDb));
    const quote = await submittedQuote(ownerDb, {
      missionId: mission.missionId,
      investigatorProfileId: who.profileId,
    });
    const row = await assignment(ownerDb, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status: 'COMPLETED',
    });
    return {
      customer: mission.actor,
      investigator: who.actor,
      profileId: who.profileId,
      id: row.id,
    };
  };

  const auditFor = (resourceId: string) =>
    ownerDb
      .select({ action: auditLogs.action, reason: auditLogs.reason, role: auditLogs.actorRole })
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, resourceId));

  describe('writing one', () => {
    it('records the rating at once, and the words as pending', async () => {
      const a = await completed();
      const review = await service.create(
        a.customer,
        a.id,
        { rating: 4, text: '  Clear and on time.  ' },
        req(),
      );

      expect(review).toMatchObject({
        assignmentId: a.id,
        rating: 4,
        removed: false,
        text: { body: 'Clear and on time.', status: 'PENDING', hiddenReason: null },
        response: null,
      });
    });

    it('takes a rating with no words, and treats blank words as none', async () => {
      const a = await completed();
      expect(
        (await service.create(a.customer, a.id, { rating: 3, text: '   ' }, req())).text,
      ).toBeNull();
    });

    it('audits the rating and whether words were given — never the words', async () => {
      const a = await completed();
      const review = await service.create(
        a.customer,
        a.id,
        { rating: 2, text: 'Named Ms Petrosyan.' },
        req(),
      );
      const rows = await auditFor(review.id);

      expect(rows).toEqual([
        {
          action: 'review.created',
          reason: 'rating 2, with words awaiting moderation',
          role: 'CUSTOMER',
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain('Petrosyan');
    });

    it('happens once: a second attempt is a conflict, and so is the loser of a race', async () => {
      const a = await completed();
      await service.create(a.customer, a.id, { rating: 5 }, req());
      await expect(service.create(a.customer, a.id, { rating: 1 }, req())).rejects.toMatchObject({
        status: 409,
      });

      const b = await completed();
      const outcomes = await Promise.allSettled([
        service.create(b.customer, b.id, { rating: 5 }, req()),
        service.create(b.customer, b.id, { rating: 4 }, req()),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.find((o) => o.status === 'rejected')).toMatchObject({
        reason: { status: 409 },
      });
    });
  });

  describe('responding', () => {
    it('is the investigator’s, once, and pending like the review', async () => {
      const a = await completed();
      await service.create(a.customer, a.id, { rating: 3, text: 'Slow to start.' }, req());
      const view = await service.respond(
        a.investigator,
        a.id,
        { text: 'The records office was closed that week.' },
        req(),
      );

      expect(view.text?.body).toBe('Slow to start.');
      expect(view.response).toMatchObject({
        status: 'PENDING',
        body: 'The records office was closed that week.',
      });
      await expect(
        service.respond(a.investigator, a.id, { text: 'And another thing.' }, req()),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('is refused on a removed review', async () => {
      const a = await completed();
      const review = await service.create(a.customer, a.id, { rating: 1 }, req());
      await service.remove(
        moderator,
        review.id,
        { reason: 'Removed as abusive, per the policy.' },
        req(),
      );
      await expect(
        service.respond(a.investigator, a.id, { text: 'Too late.' }, req()),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('is a 404 when there is no review to respond to', async () => {
      const a = await completed();
      await expect(
        service.respond(a.investigator, a.id, { text: 'Pre-emptive thanks.' }, req()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('moderating and reporting', () => {
    const withBoth = async () => {
      const a = await completed();
      await service.create(
        a.customer,
        a.id,
        { rating: 2, text: 'They missed the second site.' },
        req(),
      );
      await service.respond(a.investigator, a.id, { text: 'It was out of scope.' }, req());
      const texts = await ownerDb
        .select()
        .from(reviewTexts)
        .innerJoin(reviews, eq(reviews.id, reviewTexts.reviewId))
        .where(eq(reviews.assignmentId, a.id));
      const idOf = (kind: 'REVIEW' | 'RESPONSE') =>
        texts.find((t) => t.review_texts.kind === kind)!.review_texts.id;
      return {
        ...a,
        reviewId: texts[0]!.reviews.id,
        words: idOf('REVIEW'),
        reply: idOf('RESPONSE'),
      };
    };

    it('queues pending words oldest first, with the rating, for a moderator', async () => {
      const w = await withBoth();
      const items: Awaited<ReturnType<ReviewsService['queue']>>['items'] = [];
      let cursor: string | undefined;
      do {
        const page = await service.queue(moderator, { limit: 1, cursor }, req());
        items.push(...page.items);
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor !== undefined);

      const ours = items.filter((i) => i.reviewId === w.reviewId);
      expect(ours.map((i) => i.kind)).toEqual(['REVIEW', 'RESPONSE']);
      expect(ours[0]).toMatchObject({
        body: 'They missed the second site.',
        rating: 2,
        report: null,
      });
      // Oldest first, across the whole queue, with no row twice.
      const times = items.map((i) => i.createdAt);
      expect([...times].sort()).toEqual(times);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    });

    it('publishes, and hides only with a reason the author is shown', async () => {
      const w = await withBoth();
      await expect(
        service.moderate(moderator, w.words, { decision: 'HIDE' }, req()),
      ).rejects.toMatchObject({ status: 422 });

      await service.moderate(
        moderator,
        w.words,
        { decision: 'HIDE', reason: 'Names a private individual.' },
        req(),
      );
      await service.moderate(moderator, w.reply, { decision: 'PUBLISH' }, req());
      const view = await service.getForParty(w.customer, w.id, req());

      expect(view.text).toMatchObject({
        status: 'HIDDEN',
        hiddenReason: 'Names a private individual.',
      });
      expect(view.response).toMatchObject({ status: 'PUBLISHED', hiddenReason: null });
      expect(await auditFor(w.words)).toEqual([
        { action: 'review_text.moderated', reason: 'review hidden', role: 'STAFF' },
      ]);
    });

    it('refuses a decision that changes nothing', async () => {
      const w = await withBoth();
      await service.moderate(moderator, w.words, { decision: 'PUBLISH' }, req());
      await expect(
        service.moderate(moderator, w.words, { decision: 'PUBLISH' }, req()),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('lets the other party report published words back to the queue, with the reason for staff', async () => {
      const w = await withBoth();
      await service.moderate(moderator, w.words, { decision: 'PUBLISH' }, req());
      await service.moderate(moderator, w.reply, { decision: 'PUBLISH' }, req());

      const byInvestigator = await service.report(
        w.investigator,
        w.id,
        { part: 'REVIEW', reason: 'It misstates the agreed scope.' },
        req(),
      );
      expect(byInvestigator.text?.status).toBe('PENDING');
      expect(byInvestigator.response?.status).toBe('PUBLISHED');
      const byCustomer = await service.report(
        w.customer,
        w.id,
        { part: 'RESPONSE', reason: 'It discloses my case details.' },
        req(),
      );
      expect(byCustomer.response?.status).toBe('PENDING');

      const queued = (await service.queue(moderator, { limit: 100 }, req())).items.find(
        (i) => i.id === w.words,
      );
      expect(queued?.report?.reason).toBe('It misstates the agreed scope.');
      expect(await auditFor(w.words)).toContainEqual({
        action: 'review_text.reported',
        reason: 'review sent back to moderation',
        role: 'INVESTIGATOR',
      });
    });

    it('refuses a report of one’s own words, or of words that are not published', async () => {
      const w = await withBoth();
      // Not published yet.
      await expect(
        service.report(
          w.investigator,
          w.id,
          { part: 'REVIEW', reason: 'It is not accurate at all.' },
          req(),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await service.moderate(moderator, w.words, { decision: 'PUBLISH' }, req());
      // The customer's own review.
      await expect(
        service.report(
          w.customer,
          w.id,
          { part: 'REVIEW', reason: 'I changed my mind about it.' },
          req(),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('removes a review once, with the reason audited, and the parties still see it marked', async () => {
      const w = await withBoth();
      const reason = 'Posted by someone other than the customer, per support ticket.';
      const removed = await service.remove(moderator, w.reviewId, { reason }, req());

      expect(removed).toMatchObject({ removed: true, removalReason: reason });
      expect(await auditFor(w.reviewId)).toContainEqual({
        action: 'review.removed',
        reason,
        role: 'STAFF',
      });
      await expect(service.remove(moderator, w.reviewId, { reason }, req())).rejects.toMatchObject({
        status: 403,
      });
      expect((await service.getForParty(w.investigator, w.id, req())).removed).toBe(true);
    });
  });

  describe('a profile’s public reviews', () => {
    it('lists standing reviews with published words only, newest first, and no reviewer', async () => {
      const investigator = await eligibleInvestigator(ownerDb);
      const first = await completed(investigator);
      const second = await completed(investigator);
      const third = await completed(investigator);
      const r1 = await service.create(
        first.customer,
        first.id,
        { rating: 5, text: 'Excellent.' },
        req(),
      );
      await service.create(
        second.customer,
        second.id,
        { rating: 3, text: 'Still pending.' },
        req(),
      );
      const r3 = await service.create(third.customer, third.id, { rating: 1 }, req());
      const words = await ownerDb
        .select()
        .from(reviewTexts)
        .where(and(eq(reviewTexts.reviewId, r1.id)));
      await service.moderate(moderator, words[0]!.id, { decision: 'PUBLISH' }, req());
      await service.remove(
        moderator,
        r3.id,
        { reason: 'Removed: written about a different investigator.' },
        req(),
      );

      const page = await service.forProfile(reader, investigator.profileId, {}, req());

      expect(page.summary).toEqual({ count: 2, average: 4 });
      expect(page.items.map((i) => [i.rating, i.text])).toEqual([
        [3, null],
        [5, 'Excellent.'],
      ]);
      expect(JSON.stringify(page)).not.toContain(first.customer.userId);
      expect(JSON.stringify(page)).not.toContain('Still pending.');
    });

    it('keeps to the public list for the parties too: no removed review, no pending words', async () => {
      const a = await completed();
      const r = await service.create(
        a.customer,
        a.id,
        { rating: 2, text: 'Pending words.' },
        req(),
      );
      await service.remove(
        moderator,
        r.id,
        { reason: 'Removed for testing what the parties see.' },
        req(),
      );
      for (const who of [a.customer, a.investigator]) {
        const page = await service.forProfile(who, a.profileId, {}, req());
        expect(page.items).toEqual([]);
        expect(page.summary).toEqual({ count: 0, average: null });
      }
    });

    it('shows the parties no unmoderated words on the public list, though their own policy would', async () => {
      // An outsider is kept from pending and hidden words by the database; a party is not — both
      // parties may read their texts in any state — so this filter is the service's to hold.
      const a = await completed();
      const r = await service.create(
        a.customer,
        a.id,
        { rating: 4, text: 'Awaiting a moderator.' },
        req(),
      );
      await service.respond(a.investigator, a.id, { text: 'Hidden by a moderator.' }, req());
      const [reply] = await ownerDb
        .select({ id: reviewTexts.id })
        .from(reviewTexts)
        .where(and(eq(reviewTexts.reviewId, r.id), eq(reviewTexts.kind, 'RESPONSE')));
      await service.moderate(
        moderator,
        reply!.id,
        { decision: 'HIDE', reason: 'Names the subject.' },
        req(),
      );

      for (const who of [a.customer, a.investigator]) {
        const page = await service.forProfile(who, a.profileId, {}, req());
        expect(page.items).toEqual([
          expect.objectContaining({ id: r.id, rating: 4, text: null, response: null }),
        ]);
      }
    });

    it('pages without repeating or skipping a review', async () => {
      const investigator = await eligibleInvestigator(ownerDb);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const a = await completed(investigator);
        ids.push((await service.create(a.customer, a.id, { rating: 1 + (i % 5) }, req())).id);
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.forProfile(
          reader,
          investigator.profileId,
          { limit: 2, cursor },
          req(),
        );
        seen.push(...page.items.map((i) => i.id));
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor !== undefined);
      expect([...seen].sort()).toEqual([...ids].sort());
      expect(new Set(seen).size).toBe(5);
    });

    it('is a 404 for a profile that is not published, and refuses a cursor it did not issue', async () => {
      const a = await completed();
      await ownerDb
        .update(investigatorProfiles)
        .set({ visibility: 'DRAFT' })
        .where(eq(investigatorProfiles.id, a.profileId));
      await expect(service.forProfile(reader, a.profileId, {}, req())).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.forProfile(reader, randomUUID(), {}, req())).rejects.toMatchObject({
        status: 404,
      });

      const b = await completed();
      for (const cursor of [
        'not-a-cursor',
        Buffer.from('null').toString('base64url'),
        Buffer.from('1').toString('base64url'),
        Buffer.from('[]').toString('base64url'),
        Buffer.from('{"t":"x","i":"y"}').toString('base64url'),
        Buffer.from('{"t":1,"i":"y"}').toString('base64url'),
        Buffer.from('{"t":"2026-09-25T00:00:00.000Z","i":7}').toString('base64url'),
        Buffer.from('{"t":"2026-09-25T00:00:00.000Z","i":""}').toString('base64url'),
      ]) {
        await expect(
          service.forProfile(reader, b.profileId, { cursor }, req()),
        ).rejects.toMatchObject({ status: 422 });
      }
    });
  });
});
