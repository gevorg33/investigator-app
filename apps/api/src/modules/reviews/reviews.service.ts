import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { assignments, investigatorProfiles, reviewTexts, reviews } from '../../database/schema';
import type {
  CreateReviewDto,
  ModerateReviewTextDto,
  RemoveReviewDto,
  ReportReviewTextDto,
  RespondToReviewDto,
} from './reviews.dto';
import { clampLimit, decodeCursor, encodeCursor } from './reviews.policy';

type ReviewRow = typeof reviews.$inferSelect;
type TextRow = typeof reviewTexts.$inferSelect;
type AssignmentRow = typeof assignments.$inferSelect;
type Part = TextRow['kind'];

export interface ReviewTextView {
  body: string;
  status: TextRow['status'];
  /** Shown to the parties when a moderator hid the text: the author is told why. */
  hiddenReason: string | null;
  createdAt: string;
}

/** A review as its two parties see it: the rating, and both texts in whatever state they are. */
export interface ReviewView {
  id: string;
  assignmentId: string;
  rating: number;
  createdAt: string;
  removed: boolean;
  removalReason: string | null;
  text: ReviewTextView | null;
  response: ReviewTextView | null;
}

/** A review as anyone else sees it: no reviewer, and only published words. */
export interface PublicReviewView {
  id: string;
  rating: number;
  createdAt: string;
  text: string | null;
  response: string | null;
}

/** The ranking input: computed here from standing reviews, never taken from a request. */
export interface RatingSummary {
  count: number;
  /** Two decimals, or null when there is nothing to average. */
  average: number | null;
}

export interface ModerationItem {
  id: string;
  reviewId: string;
  kind: Part;
  body: string;
  rating: number;
  createdAt: string;
  /** Set when the other party sent a published text back; its reason is for the moderator. */
  report: { reason: string; at: string } | null;
}

interface Page<T> {
  items: T[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/**
 * Reviews of completed assignments (plan.md §8, T-037; owner approval 2026-09-25).
 *
 * The customer rates a completed assignment once and may add words; the investigator may respond
 * once. Every text is pre-moderated: it waits PENDING until a moderator publishes it, and the party
 * who did not write a published text may report it back. Staff may remove a review, with a reason
 * that is audited. The rating summary is computed from standing reviews and is the only ranking
 * input reviews provide — discovery does not order by it yet.
 *
 * The database holds every one of these rules (migration 0022). The checks here refuse early with
 * a clear error; the triggers and policies refuse whatever gets past them. Audit entries carry the
 * rating, the part and the decision — never the words, which can name people.
 *
 * A review is not a dispute route: it moves no money and reopens nothing. That is said wherever a
 * review is written (the OpenAPI description, kb-customer-reviews).
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly platform: PlatformContext,
  ) {}

  async create(
    actor: Actor,
    assignmentId: string,
    dto: CreateReviewDto,
    req: RequestContext,
  ): Promise<ReviewView> {
    const c = ctx('review.create', 'assignment', req, assignmentId);
    await this.requireCustomer(actor, c);

    try {
      return await this.db.transaction(async (tx) => {
        const [found] = await tx
          .select()
          .from(assignments)
          .where(and(eq(assignments.id, assignmentId), eq(assignments.customerId, actor.userId)));
        const assignment = await this.authz.visible(actor, found, c);
        await this.authz.stateAllows(actor, assignment.status === 'COMPLETED', c);

        const [review] = await tx
          .insert(reviews)
          // The trigger copies the profile from the assignment regardless; named here for the type.
          .values({
            assignmentId,
            investigatorProfileId: assignment.investigatorProfileId,
            rating: dto.rating,
          })
          .returning();
        const words = dto.text?.trim();
        let text: TextRow | undefined;
        if (words !== undefined && words.length > 0) {
          [text] = await tx
            .insert(reviewTexts)
            .values({ reviewId: review!.id, kind: 'REVIEW', body: words, authorId: actor.userId })
            .returning();
        }
        await this.record(
          tx,
          actor,
          'CUSTOMER',
          c,
          'review.created',
          'review',
          review!.id,
          `rating ${review!.rating}${text === undefined ? '' : ', with words awaiting moderation'}`,
        );
        return reviewView(review!, text, undefined);
      });
    } catch (e) {
      // Two submissions at once: the unique index lets one through, and the other is told it lost.
      if (uniqueViolation(e)) throw AppError.stateConflict();
      throw e;
    }
  }

  /** The assignment's review, for either party. 404 if there is none, or the caller is neither. */
  async getForParty(actor: Actor, assignmentId: string, req: RequestContext): Promise<ReviewView> {
    const c = ctx('review.read', 'assignment', req, assignmentId);
    await this.authz.requireActive(actor, c);
    await this.party(this.db, actor, assignmentId, c);

    const [review] = await this.db
      .select()
      .from(reviews)
      .where(eq(reviews.assignmentId, assignmentId));
    const found = await this.authz.visible(actor, review, c);
    const texts = await this.db
      .select()
      .from(reviewTexts)
      .where(eq(reviewTexts.reviewId, found.id));
    return reviewView(
      found,
      texts.find((t) => t.kind === 'REVIEW'),
      texts.find((t) => t.kind === 'RESPONSE'),
    );
  }

  async respond(
    actor: Actor,
    assignmentId: string,
    dto: RespondToReviewDto,
    req: RequestContext,
  ): Promise<ReviewView> {
    const c = ctx('review.respond', 'assignment', req, assignmentId);
    await this.requireInvestigator(actor, c);

    try {
      return await this.db.transaction(async (tx) => {
        const { review } = await this.reviewAsInvestigator(tx, actor, assignmentId, c);
        await this.authz.stateAllows(actor, review.removedAt === null, c);

        const [response] = await tx
          .insert(reviewTexts)
          .values({
            reviewId: review.id,
            kind: 'RESPONSE',
            body: dto.text.trim(),
            authorId: actor.userId,
          })
          .returning();
        const [text] = await tx
          .select()
          .from(reviewTexts)
          .where(and(eq(reviewTexts.reviewId, review.id), eq(reviewTexts.kind, 'REVIEW')));
        await this.record(
          tx,
          actor,
          'INVESTIGATOR',
          c,
          'review.responded',
          'review',
          review.id,
          'response awaiting moderation',
        );
        return reviewView(review, text, response);
      });
    } catch (e) {
      // "May respond once": the second response loses to the unique index.
      if (uniqueViolation(e)) throw AppError.stateConflict();
      throw e;
    }
  }

  /**
   * The other party's published words, sent back to moderation. The customer reports a response,
   * the investigator a review; nobody reports their own. The reason is kept for the moderator.
   */
  async report(
    actor: Actor,
    assignmentId: string,
    dto: ReportReviewTextDto,
    req: RequestContext,
  ): Promise<ReviewView> {
    const c = ctx('review.report', 'assignment', req, assignmentId);
    await this.authz.requireActive(actor, c);

    return this.db.transaction(async (tx) => {
      const assignment = await this.party(tx, actor, assignmentId, c);
      const isCustomer = assignment.customerId === actor.userId;
      if (isCustomer) {
        await this.authz.requireRole(actor, 'CUSTOMER', c);
        await this.authz.requirePersonalWorkspace(actor, c);
      } else {
        await this.authz.requireRole(actor, 'INVESTIGATOR', c);
        await this.authz.requirePermission(actor, 'investigations.update', c);
      }
      await this.authz.stateAllows(actor, dto.part === (isCustomer ? 'RESPONSE' : 'REVIEW'), c);

      const [review] = await tx
        .select()
        .from(reviews)
        .where(eq(reviews.assignmentId, assignmentId));
      const found = await this.authz.visible(actor, review, c);
      const [target] = await tx
        .select()
        .from(reviewTexts)
        .where(and(eq(reviewTexts.reviewId, found.id), eq(reviewTexts.kind, dto.part)));
      const text = await this.authz.visible(actor, target, c);

      const [reported] = await tx
        .update(reviewTexts)
        .set({
          status: 'PENDING',
          reportedBy: actor.userId,
          reportedAt: new Date(),
          reportReason: dto.reason.trim(),
        })
        // Only a published text is reported, and the condition is the check: it was not read FOR
        // UPDATE, because a row lock needs the UPDATE policy, which admits this party only to a
        // published text. Not yet published, or hidden by a moderator a moment ago, is one refusal.
        .where(and(eq(reviewTexts.id, text.id), eq(reviewTexts.status, 'PUBLISHED')))
        .returning();
      await this.authz.stateAllows(actor, reported !== undefined, c);
      await this.record(
        tx,
        actor,
        isCustomer ? 'CUSTOMER' : 'INVESTIGATOR',
        c,
        'review_text.reported',
        'review_text',
        text.id,
        `${dto.part.toLowerCase()} sent back to moderation`,
      );

      const [other] = await tx
        .select()
        .from(reviewTexts)
        .where(and(eq(reviewTexts.reviewId, found.id), sql`${reviewTexts.kind} <> ${dto.part}`));
      return dto.part === 'REVIEW'
        ? reviewView(found, reported, other)
        : reviewView(found, other, reported);
    });
  }

  /**
   * A published profile's standing reviews, newest first, with the summary. Words appear only once
   * published. Anyone signed in may read them; a profile they cannot see is a 404, as it is on the
   * profile itself. The filters on removal and status are needed here, not only in the policies:
   * the parties' own policy lets them read removed reviews and unpublished words, and this list is
   * the public one whoever asks.
   */
  async forProfile(
    actor: Actor,
    profileId: string,
    query: { limit?: number | undefined; cursor?: string | undefined },
    req: RequestContext,
  ): Promise<Page<PublicReviewView> & { summary: RatingSummary }> {
    const c = ctx('review.list_for_profile', 'investigator_profile', req, profileId);
    await this.authz.requireActive(actor, c);
    const [profile] = await this.db
      .select({ id: investigatorProfiles.id })
      .from(investigatorProfiles)
      .where(
        and(
          eq(investigatorProfiles.id, profileId),
          eq(investigatorProfiles.visibility, 'PUBLISHED'),
        ),
      );
    await this.authz.visible(actor, profile, c);

    const limit = clampLimit(query.limit);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const standing = and(eq(reviews.investigatorProfileId, profileId), isNull(reviews.removedAt));

    const [summary] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        average: sql<string | null>`round(avg(${reviews.rating}), 2)::text`,
      })
      .from(reviews)
      .where(standing);

    const words = alias(reviewTexts, 'words');
    const reply = alias(reviewTexts, 'reply');
    const rows = await this.db
      .select({ review: reviews, text: words.body, response: reply.body })
      .from(reviews)
      .leftJoin(
        words,
        and(
          eq(words.reviewId, reviews.id),
          eq(words.kind, 'REVIEW'),
          eq(words.status, 'PUBLISHED'),
        ),
      )
      .leftJoin(
        reply,
        and(
          eq(reply.reviewId, reviews.id),
          eq(reply.kind, 'RESPONSE'),
          eq(reply.status, 'PUBLISHED'),
        ),
      )
      .where(
        and(
          standing,
          after === undefined
            ? undefined
            : or(
                sql`${createdAtMs} < ${after.at.toISOString()}::timestamptz`,
                and(
                  sql`${createdAtMs} = ${after.at.toISOString()}::timestamptz`,
                  sql`${reviews.id} < ${after.id}::uuid`,
                ),
              ),
        ),
      )
      .orderBy(desc(createdAtMs), desc(reviews.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      summary: {
        count: summary!.count,
        average: summary!.average === null ? null : Number(summary!.average),
      },
      items: page.map((r) => ({
        id: r.review.id,
        rating: r.review.rating,
        createdAt: r.review.createdAt.toISOString(),
        text: r.text,
        response: r.response,
      })),
      pageInfo: {
        hasNextPage: rows.length > limit,
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeCursor({ at: last.review.createdAt, id: last.review.id })
            : null,
      },
    };
  }

  /** Words waiting for a moderator, oldest first — new ones and reported ones alike. */
  async queue(
    actor: Actor,
    query: { limit?: number | undefined; cursor?: string | undefined },
    req: RequestContext,
  ): Promise<Page<ModerationItem>> {
    const c = ctx('review.queue', 'review_text', req);
    await this.requireModerator(actor, c);
    const limit = clampLimit(query.limit);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

    return this.platform.asStaff(
      actor,
      { scope: 'MODERATION', purpose: 'review.queue' },
      req,
      async () => {
        const rows = await this.db
          .select({ text: reviewTexts, rating: reviews.rating })
          .from(reviewTexts)
          .innerJoin(reviews, eq(reviews.id, reviewTexts.reviewId))
          .where(
            and(
              eq(reviewTexts.status, 'PENDING'),
              after === undefined
                ? undefined
                : or(
                    sql`${textCreatedAtMs} > ${after.at.toISOString()}::timestamptz`,
                    and(
                      sql`${textCreatedAtMs} = ${after.at.toISOString()}::timestamptz`,
                      sql`${reviewTexts.id} > ${after.id}::uuid`,
                    ),
                  ),
            ),
          )
          .orderBy(asc(textCreatedAtMs), asc(reviewTexts.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          items: page.map(({ text, rating }) => ({
            id: text.id,
            reviewId: text.reviewId,
            kind: text.kind,
            body: text.body,
            rating,
            createdAt: text.createdAt.toISOString(),
            report:
              text.reportedAt === null || text.reportReason === null
                ? null
                : { reason: text.reportReason, at: text.reportedAt.toISOString() },
          })),
          pageInfo: {
            hasNextPage: rows.length > limit,
            nextCursor:
              rows.length > limit && last !== undefined
                ? encodeCursor({ at: last.text.createdAt, id: last.text.id })
                : null,
          },
        };
      },
    );
  }

  /** Publish or hide a text. Hiding says why, and the author is shown the reason. */
  async moderate(
    actor: Actor,
    textId: string,
    dto: ModerateReviewTextDto,
    req: RequestContext,
  ): Promise<{ id: string; status: TextRow['status'] }> {
    const c = ctx('review.moderate', 'review_text', req, textId);
    await this.requireModerator(actor, c);
    const reason = dto.reason?.trim();
    if (dto.decision === 'HIDE' && (reason === undefined || reason.length === 0)) {
      throw AppError.validation([
        {
          field: 'reason',
          code: 'REQUIRED',
          messageKey: 'error.validation.review.hide_reason_required',
        },
      ]);
    }
    const next = dto.decision === 'PUBLISH' ? 'PUBLISHED' : 'HIDDEN';

    return this.platform.asStaff(
      actor,
      { scope: 'MODERATION', purpose: 'review.moderate' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          const [found] = await tx
            .select()
            .from(reviewTexts)
            .where(eq(reviewTexts.id, textId))
            .for('update');
          const text = await this.authz.visible(actor, found, c);
          await this.authz.stateAllows(actor, text.status !== next, c);

          const [moderated] = await tx
            .update(reviewTexts)
            .set({
              status: next,
              moderatedBy: actor.userId,
              moderatedAt: new Date(),
              moderationReason: reason ?? null,
            })
            .where(eq(reviewTexts.id, textId))
            .returning();
          await this.record(
            tx,
            actor,
            'STAFF',
            c,
            'review_text.moderated',
            'review_text',
            textId,
            `${text.kind.toLowerCase()} ${next.toLowerCase()}`,
          );
          return { id: moderated!.id, status: moderated!.status };
        }),
    );
  }

  /** Remove a whole review — rating and words — from public view. Once, with an audited reason. */
  async remove(
    actor: Actor,
    reviewId: string,
    dto: RemoveReviewDto,
    req: RequestContext,
  ): Promise<ReviewView> {
    const c = ctx('review.remove', 'review', req, reviewId);
    await this.requireModerator(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'MODERATION', purpose: 'review.remove' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          const [found] = await tx
            .select()
            .from(reviews)
            .where(eq(reviews.id, reviewId))
            .for('update');
          const review = await this.authz.visible(actor, found, c);
          await this.authz.stateAllows(actor, review.removedAt === null, c);

          const reason = dto.reason.trim();
          const [removed] = await tx
            .update(reviews)
            .set({ removedAt: new Date(), removedBy: actor.userId, removalReason: reason })
            .where(eq(reviews.id, reviewId))
            .returning();
          await this.record(tx, actor, 'STAFF', c, 'review.removed', 'review', reviewId, reason);

          const texts = await tx
            .select()
            .from(reviewTexts)
            .where(eq(reviewTexts.reviewId, reviewId));
          return reviewView(
            removed!,
            texts.find((t) => t.kind === 'REVIEW'),
            texts.find((t) => t.kind === 'RESPONSE'),
          );
        }),
    );
  }

  private async requireCustomer(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'CUSTOMER', c);
    // An assignment belongs to the customer's Personal workspace; agencies are supplier-only.
    await this.authz.requirePersonalWorkspace(actor, c);
  }

  private async requireInvestigator(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigations.update', c);
  }

  private async requireModerator(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'STAFF', c);
    await this.authz.requireStaffScope(actor, 'MODERATION', c);
  }

  /**
   * The assignment, if the actor is its customer or its investigator. Anyone else matches nothing
   * and gets the same 404 as an id that does not exist.
   */
  private async party(
    db: Db | Tx,
    actor: Actor,
    assignmentId: string,
    c: AuthzContext,
  ): Promise<AssignmentRow> {
    const [row] = await db
      .select({ assignment: assignments })
      .from(assignments)
      .leftJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(
        and(
          eq(assignments.id, assignmentId),
          or(
            eq(assignments.customerId, actor.userId),
            eq(investigatorProfiles.userId, actor.userId),
          ),
        ),
      );
    return this.authz.visible(actor, row?.assignment, c);
  }

  /**
   * The review of an assignment this actor is the investigator on. Not locked: a row lock needs the
   * UPDATE policy, which only staff hold on reviews, and "respond once" is the unique index's job.
   */
  private async reviewAsInvestigator(
    tx: Tx,
    actor: Actor,
    assignmentId: string,
    c: AuthzContext,
  ): Promise<{ review: ReviewRow }> {
    const [row] = await tx
      .select({ review: reviews })
      .from(reviews)
      .innerJoin(assignments, eq(assignments.id, reviews.assignmentId))
      .innerJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(
        and(eq(reviews.assignmentId, assignmentId), eq(investigatorProfiles.userId, actor.userId)),
      );
    return { review: await this.authz.visible(actor, row?.review, c) };
  }

  private async record(
    tx: Tx,
    actor: Actor,
    actorRole: 'CUSTOMER' | 'INVESTIGATOR' | 'STAFF',
    c: AuthzContext,
    action: string,
    resourceType: string,
    resourceId: string,
    what: string,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        actorRole,
        ...(actorRole === 'STAFF' ? { staffScope: 'MODERATION' as const } : {}),
        action,
        resourceType,
        resourceId,
        reason: what,
      },
      tx,
    );
  }
}

/**
 * `created_at` as a cursor sees it. PostgreSQL keeps microseconds and a JavaScript Date keeps
 * milliseconds; comparing on the millisecond value keeps a page from repeating the row the last
 * one ended on (T-050, T-134).
 */
const createdAtMs = sql<Date>`date_trunc('milliseconds', ${reviews.createdAt})`;
const textCreatedAtMs = sql<Date>`date_trunc('milliseconds', ${reviewTexts.createdAt})`;

/** Postgres reports a unique-index violation as 23505; anything else is not ours to interpret. */
const uniqueViolation = (e: unknown): boolean =>
  (e as { cause?: { code?: string } }).cause?.code === '23505';

const ctx = (
  action: string,
  resourceType: string,
  req: RequestContext,
  resourceId?: string,
): AuthzContext => ({
  action,
  resourceType,
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});

const textView = (t: TextRow | undefined): ReviewTextView | null =>
  t === undefined
    ? null
    : {
        body: t.body,
        status: t.status,
        hiddenReason: t.status === 'HIDDEN' ? t.moderationReason : null,
        createdAt: t.createdAt.toISOString(),
      };

const reviewView = (
  r: ReviewRow,
  text: TextRow | undefined,
  response: TextRow | undefined,
): ReviewView => ({
  id: r.id,
  assignmentId: r.assignmentId,
  rating: r.rating,
  createdAt: r.createdAt.toISOString(),
  removed: r.removedAt !== null,
  removalReason: r.removalReason,
  text: textView(text),
  response: textView(response),
});
