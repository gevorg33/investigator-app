import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/common/audit/audit.service';
import { runInContext, type ExecutionContext } from '../../src/common/context/execution-context';
import { PlatformContext } from '../../src/common/context/platform-context';
import * as schema from '../../src/database/schema';
import { scopedClient } from '../../src/database/scoped-client';
import { testPool } from '../db';
import { personalContext } from '../workspace-context';
import { member } from '../workspace-fixtures';
import { seedAssignment } from './graph';

/**
 * Reviews under row-level security, as `investigator_app` (T-037).
 *
 * The rules a review lives by are held by the database, not by the service: once per assignment,
 * only after COMPLETED, never rewritten, a public rating but pre-moderated words, and staff alone
 * moderating or removing. Each is exercised here with direct writes, so none of them depends on
 * the application remembering it.
 */
describe('reviews under row-level security', () => {
  let app: postgres.Sql;
  let scoped: postgres.Sql;
  let owner: postgres.Sql;
  let platform: PlatformContext;
  let outsider: ExecutionContext;
  let staff: {
    userId: string;
    roles: readonly ['STAFF'];
    staffScopes: readonly ['MODERATION'];
    activeRole: undefined;
  };

  beforeAll(async () => {
    app = testPool({ max: 2 });
    scoped = scopedClient(app);
    owner = testPool({ max: 2, role: 'owner' });
    platform = new PlatformContext(new AuditService(drizzle(scoped, { schema })));
    outsider = await personalContext(owner, (await member(owner)).actor.userId);
    staff = {
      userId: outsider.userId,
      roles: ['STAFF'],
      staffScopes: ['MODERATION'],
      activeRole: undefined,
    };
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  const as = <T>(context: ExecutionContext, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    runInContext(context, () => scoped.begin(fn));

  const asStaff = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    runInContext(outsider, () =>
      platform.asStaff(
        staff as never,
        { scope: 'MODERATION', purpose: 'review.moderate' },
        {},
        () => scoped.begin(fn),
      ),
    );

  /** A completed assignment, its two parties' contexts, and nothing reviewed yet. */
  const completed = async (input: Parameters<typeof seedAssignment>[1] = {}) => {
    const seeded = await seedAssignment(owner, input);
    return {
      ...seeded,
      customer: await personalContext(owner, seeded.customer.userId),
      supplier: await personalContext(owner, seeded.supplier.userId),
    };
  };

  const review = (context: ExecutionContext, assignmentId: string, rating = 5) =>
    as(
      context,
      (tx) => tx<
        {
          id: string;
          investigator_profile_id: string;
          customer_tenant_id: string;
          supplier_tenant_id: string;
        }[]
      >`
        INSERT INTO reviews (assignment_id, rating) VALUES (${assignmentId}, ${rating})
        RETURNING id, investigator_profile_id, customer_tenant_id, supplier_tenant_id`,
    );

  const text = (
    context: ExecutionContext,
    reviewId: string,
    kind: 'REVIEW' | 'RESPONSE',
    body = 'Careful work, clearly reported.',
  ) =>
    as(
      context,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO review_texts (review_id, kind, body, author_id)
        VALUES (${reviewId}, ${kind}, ${body}, ${context.userId}) RETURNING id`,
    );

  const visible = (context: ExecutionContext, table: 'reviews' | 'review_texts', id: string) =>
    as(context, async (tx) => (await tx`SELECT 1 FROM ${tx(table)} WHERE id = ${id}`).length);

  const moderate = (id: string, status: 'PUBLISHED' | 'HIDDEN', reason: string | null = null) =>
    asStaff(
      (tx) => tx`
        UPDATE review_texts
           SET status = ${status}, moderated_by = ${staff.userId}, moderated_at = now(),
               moderation_reason = ${reason}
         WHERE id = ${id}`,
    );

  describe('writing a review', () => {
    it('is the customer’s, on a completed assignment, with both parties copied from it', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);

      expect(row).toMatchObject({
        investigator_profile_id: a.profileId,
        customer_tenant_id: a.customer.tenantId,
        supplier_tenant_id: a.supplier.tenantId,
      });
    });

    it('happens once per assignment — the second is refused by the unique index', async () => {
      const a = await completed();
      await review(a.customer, a.assignmentId);
      await expect(review(a.customer, a.assignmentId, 1)).rejects.toThrow(
        /reviews_one_per_assignment/,
      );
    });

    it.each(['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS', 'REPORT_SUBMITTED', 'CANCELLED'])(
      'is refused while the assignment is %s',
      async (status) => {
        const a = await completed({ status });
        await expect(review(a.customer, a.assignmentId)).rejects.toThrow(/review_after_completion/);
      },
    );

    it('is refused to the investigator’s workspace and to anyone else', async () => {
      const a = await completed();
      await expect(review(a.supplier, a.assignmentId)).rejects.toThrow(/row-level security/);
      // The outsider cannot see the assignment, so its status reads as none, and nothing is filled.
      await expect(review(outsider, a.assignmentId)).rejects.toThrow(/review_after_completion/);
    });

    it('takes a rating from 1 to 5, and nothing else', async () => {
      const a = await completed();
      await expect(review(a.customer, a.assignmentId, 6)).rejects.toThrow(/reviews_rating_range/);
      await expect(review(a.customer, a.assignmentId, 0)).rejects.toThrow(/reviews_rating_range/);
    });

    it('cannot be written already removed', async () => {
      const a = await completed();
      await expect(
        as(
          a.customer,
          (tx) => tx`
            INSERT INTO reviews (assignment_id, rating, removed_at, removed_by, removal_reason)
            VALUES (${a.assignmentId}, 4, now(), ${a.customer.userId}, 'Removed before it was written, somehow')`,
        ),
      ).rejects.toThrow(/review_removed_by_staff|row-level security/);
    });
  });

  describe('keeping and removing a review', () => {
    it('is never rewritten: the customer’s update reaches no row, staff’s is refused', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId, 2);

      await as(a.customer, (tx) => tx`UPDATE reviews SET rating = 5 WHERE id = ${row!.id}`);
      const [kept] = await owner<
        { rating: number }[]
      >`SELECT rating FROM reviews WHERE id = ${row!.id}`;
      expect(kept!.rating).toBe(2);

      await expect(
        asStaff((tx) => tx`UPDATE reviews SET rating = 5 WHERE id = ${row!.id}`),
      ).rejects.toThrow(/review_is_kept/);
    });

    it('is removed by staff once, with a reason, and not again', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      const remove = (reason: string) =>
        asStaff(
          (tx) => tx`
            UPDATE reviews SET removed_at = now(), removed_by = ${staff.userId}, removal_reason = ${reason}
             WHERE id = ${row!.id}`,
        );

      await expect(remove('spam')).rejects.toThrow(/reviews_removed_in_full/);
      await remove('Names a third party by address, which the policy does not allow.');
      await expect(
        remove('A second removal of the same review, which is refused.'),
      ).rejects.toThrow(/review_is_kept/);
    });

    it('cannot be removed by either party', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      for (const party of [a.customer, a.supplier]) {
        await as(
          party,
          (tx) => tx`
            UPDATE reviews SET removed_at = now(), removed_by = ${party.userId},
                   removal_reason = 'I would rather it were not there at all.'
             WHERE id = ${row!.id}`,
        );
      }
      const [kept] = await owner<{ removed: Date | null }[]>`
        SELECT removed_at AS removed FROM reviews WHERE id = ${row!.id}`;
      expect(kept!.removed).toBeNull();
    });
  });

  describe('the public projection of a rating', () => {
    it('reaches another workspace once the profile is published, and while the review stands', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      expect(await visible(outsider, 'reviews', row!.id)).toBe(1);

      await asStaff(
        (tx) => tx`
          UPDATE reviews SET removed_at = now(), removed_by = ${staff.userId},
                 removal_reason = 'Removed for the projection test, with a reason.'
           WHERE id = ${row!.id}`,
      );
      expect(await visible(outsider, 'reviews', row!.id)).toBe(0);
      // The parties still see it: removal hides a review from the public, not from its record.
      expect(await visible(a.customer, 'reviews', row!.id)).toBe(1);
      expect(await visible(a.supplier, 'reviews', row!.id)).toBe(1);
    });

    it('does not reach another workspace while the profile is a draft — it would reveal the profile', async () => {
      const a = await completed({ profileVisibility: 'DRAFT' });
      const [row] = await review(a.customer, a.assignmentId);
      expect(await visible(outsider, 'reviews', row!.id)).toBe(0);
      expect(await visible(a.supplier, 'reviews', row!.id)).toBe(1);
    });
  });

  describe('the words of a review and its response', () => {
    it('start pending, readable by both parties and by nobody else', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      const [words] = await text(a.customer, row!.id, 'REVIEW');

      expect(await visible(a.customer, 'review_texts', words!.id)).toBe(1);
      expect(await visible(a.supplier, 'review_texts', words!.id)).toBe(1);
      expect(await visible(outsider, 'review_texts', words!.id)).toBe(0);
    });

    it('cannot be written already published', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      await expect(
        as(
          a.customer,
          (tx) => tx`
            INSERT INTO review_texts (review_id, kind, body, author_id, status, moderated_by, moderated_at)
            VALUES (${row!.id}, 'REVIEW', 'Self-published.', ${a.customer.userId}, 'PUBLISHED',
                    ${a.customer.userId}, now())`,
        ),
      ).rejects.toThrow(/review_text_starts_pending/);
    });

    it('are the customer’s for the review and the investigator’s for the response, once each', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);

      await expect(text(a.supplier, row!.id, 'REVIEW')).rejects.toThrow(/row-level security/);
      await expect(text(a.customer, row!.id, 'RESPONSE')).rejects.toThrow(/row-level security/);
      await expect(text(outsider, row!.id, 'REVIEW')).rejects.toThrow();

      await text(a.customer, row!.id, 'REVIEW');
      await text(a.supplier, row!.id, 'RESPONSE', 'Thank you — the second site is in the annex.');
      await expect(text(a.supplier, row!.id, 'RESPONSE')).rejects.toThrow(
        /review_texts_one_per_kind/,
      );
      await expect(text(a.customer, row!.id, 'REVIEW')).rejects.toThrow(
        /review_texts_one_per_kind/,
      );
    });

    it('reach another workspace only while published, and only while the review stands', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      const [words] = await text(a.customer, row!.id, 'REVIEW');

      await moderate(words!.id, 'PUBLISHED');
      expect(await visible(outsider, 'review_texts', words!.id)).toBe(1);

      await moderate(words!.id, 'HIDDEN', 'Names the subject of the investigation.');
      expect(await visible(outsider, 'review_texts', words!.id)).toBe(0);

      await moderate(words!.id, 'PUBLISHED');
      await asStaff(
        (tx) => tx`
          UPDATE reviews SET removed_at = now(), removed_by = ${staff.userId},
                 removal_reason = 'Removed, and its words with it, from the public.'
           WHERE id = ${row!.id}`,
      );
      expect(await visible(outsider, 'review_texts', words!.id)).toBe(0);
      expect(await visible(a.customer, 'review_texts', words!.id)).toBe(1);
    });

    it('are hidden only with a reason', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      const [words] = await text(a.customer, row!.id, 'REVIEW');
      await expect(moderate(words!.id, 'HIDDEN')).rejects.toThrow(/review_texts_moderated_in_full/);
    });

    it('are moderated only by staff: a party’s attempt reaches no row', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      const [words] = await text(a.customer, row!.id, 'REVIEW');
      await as(
        a.customer,
        (tx) => tx`
          UPDATE review_texts SET status = 'PUBLISHED', moderated_by = ${a.customer.userId},
                 moderated_at = now()
           WHERE id = ${words!.id}`,
      );
      const [kept] = await owner<{ status: string }[]>`
        SELECT status FROM review_texts WHERE id = ${words!.id}`;
      expect(kept!.status).toBe('PENDING');
    });

    it('are never rewritten, even by staff', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      const [words] = await text(a.customer, row!.id, 'REVIEW');
      await expect(
        asStaff((tx) => tx`UPDATE review_texts SET body = 'Edited.' WHERE id = ${words!.id}`),
      ).rejects.toThrow(/review_text_is_kept/);
    });

    it('cannot be added to a removed review', async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      await asStaff(
        (tx) => tx`
          UPDATE reviews SET removed_at = now(), removed_by = ${staff.userId},
                 removal_reason = 'Removed before the investigator responded.'
           WHERE id = ${row!.id}`,
      );
      await expect(text(a.supplier, row!.id, 'RESPONSE')).rejects.toThrow(
        /review_text_on_removed_review/,
      );
    });
  });

  describe('reporting published words', () => {
    const published = async () => {
      const a = await completed();
      const [row] = await review(a.customer, a.assignmentId);
      const [words] = await text(a.customer, row!.id, 'REVIEW');
      const [reply] = await text(a.supplier, row!.id, 'RESPONSE', 'We disagree, respectfully.');
      await moderate(words!.id, 'PUBLISHED');
      await moderate(reply!.id, 'PUBLISHED');
      return { ...a, words: words!.id, reply: reply!.id };
    };

    const report = (
      context: ExecutionContext,
      id: string,
      reason = 'It names my client by name.',
    ) =>
      as(
        context,
        (tx) => tx`
          UPDATE review_texts
             SET status = 'PENDING', reported_by = ${context.userId}, reported_at = now(),
                 report_reason = ${reason}
           WHERE id = ${id}`,
      );

    const statusOf = async (id: string) =>
      (await owner<{ status: string }[]>`SELECT status FROM review_texts WHERE id = ${id}`)[0]!
        .status;

    it('sends the other party’s text back to moderation, out of public view', async () => {
      const p = await published();
      await report(p.supplier, p.words);
      await report(p.customer, p.reply);

      expect(await statusOf(p.words)).toBe('PENDING');
      expect(await statusOf(p.reply)).toBe('PENDING');
      expect(await visible(outsider, 'review_texts', p.words)).toBe(0);
    });

    it('is not open to the author of the text, nor to anyone outside the assignment', async () => {
      const p = await published();
      await report(p.customer, p.words);
      await report(p.supplier, p.reply);
      await report(outsider, p.words);

      expect(await statusOf(p.words)).toBe('PUBLISHED');
      expect(await statusOf(p.reply)).toBe('PUBLISHED');
    });

    it('changes nothing but the status and the report', async () => {
      const p = await published();
      await expect(
        as(
          p.supplier,
          (tx) => tx`
            UPDATE review_texts
               SET status = 'PENDING', reported_by = ${p.supplier.userId}, reported_at = now(),
                   report_reason = 'It is unfair to us.', moderated_by = NULL, moderated_at = NULL
             WHERE id = ${p.words}`,
        ),
      ).rejects.toThrow(/review_text_report_only/);
    });

    it('is left as it was by staff moderating afterwards', async () => {
      const p = await published();
      await report(p.supplier, p.words);
      await expect(
        asStaff(
          (tx) => tx`
            UPDATE review_texts SET status = 'PUBLISHED', reported_by = NULL, reported_at = NULL,
                   report_reason = NULL, moderated_at = now()
             WHERE id = ${p.words}`,
        ),
      ).rejects.toThrow(/review_text_moderation_only/);
      await moderate(p.words, 'PUBLISHED');
      expect(await statusOf(p.words)).toBe('PUBLISHED');
    });
  });
});
