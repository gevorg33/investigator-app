import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  assignments,
  investigatorProfiles,
  moneyDecisions,
  outboxEvents,
  policyReviews,
} from '../../database/schema';
import { AssignmentTransitionService } from './assignment-transition.service';
import type { DeclineReason, MoneyDecisionDto, ResolvePolicyReviewDto } from './assignments.dto';
import { toAssignmentView, type AssignmentRow, type AssignmentView } from './assignments.service';

type ReviewRow = typeof policyReviews.$inferSelect;
type MoneyKind = (typeof moneyDecisions.decision.enumValues)[number];

/** docs/api/pagination.md: default 25, maximum 100, clamped rather than refused. */
const clampLimit = (n: number | undefined) =>
  n === undefined ? 25 : Math.min(Math.max(Math.trunc(n), 1), 100);

/**
 * An investigator's standing on refusals (T-050, `mission-state-machine`).
 *
 * **Counted**: declines, and halts staff found unsubstantiated — "like any other decline or
 * abandonment". **Excused**: refusals staff found substantiated, which count for nothing: the
 * investigator acted correctly. **Pending**: refusals still under review, counted neither way yet.
 * That asymmetry is the whole design; the tests assert it in both directions.
 */
export interface ResponseRecord {
  counted: number;
  excused: number;
  pending: number;
  /** Unsubstantiated refusals staff judged to be excuses. Enforcement reads this (T-049). */
  badFaith: number;
}

export interface PolicyReviewView {
  id: string;
  assignmentId: string;
  missionId: string;
  kind: ReviewRow['kind'];
  ground: string;
  raisedBy: string;
  raisedAt: string;
  finding: ReviewRow['finding'];
  badFaith: boolean;
  disposition: ReviewRow['disposition'];
  reasoning: string | null;
  decidedAt: string | null;
  /** Staff queue only: the raiser's standing, so a pattern is visible at the point of decision. */
  raisedByRecord?: ResponseRecord;
}

/**
 * The refusal right the Terms grant (§3, §4), and staff's review of it (T-050).
 *
 * **Two windows**, because payment precedes acceptance:
 * - before accepting, an investigator **declines**; the money is refunded in full, and a
 *   POLICY_CONCERN decline opens a review of the mission — what worried this investigator will
 *   worry the next;
 * - after accepting, at any point, an investigator **halts**: the assignment is suspended, the
 *   money held, and a review opened.
 *
 * Moderation staff resolve the review once, with reasoning: substantiated or not, and — for a
 * halt — resume or cancel. The money is decided **separately** and recorded as its own row, for
 * payments to carry out (T-110 to T-113); nothing here moves money.
 *
 * The investigator's ground is never shown to the customer. It is not written to the assignment's
 * history, which the customer reads, and the customer's workspace cannot read the review.
 */
@Injectable()
export class PolicyRefusalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly transitions: AssignmentTransitionService,
    private readonly platform: PlatformContext,
  ) {}

  /** Window 1: declining before accepting. The customer is released and refunded in full. */
  async decline(
    actor: Actor,
    assignmentId: string,
    input: { reasonCode?: DeclineReason | undefined; reason?: string | undefined },
    req: RequestContext,
  ): Promise<AssignmentView> {
    const c = ctx('assignment.decline', 'assignment', req, assignmentId);
    await this.requireInvestigator(actor, c);
    const code = input.reasonCode ?? 'OTHER';
    const ground = input.reason?.trim();
    if (code === 'POLICY_CONCERN' && (ground === undefined || ground.length < 20)) {
      throw AppError.validation([
        {
          field: 'reason',
          code: 'GROUND_REQUIRED',
          messageKey: 'error.validation.policy.ground_required',
        },
      ]);
    }

    return this.db.transaction(async (tx) => {
      const assignment = await this.lockAsInvestigator(tx, actor, assignmentId, c);
      // The history is the customer's to read. A policy ground stays out of it; any other
      // reason is the investigator's message to the customer and goes in.
      const moved = await this.transitions.apply(
        tx,
        { id: assignment.id, status: assignment.status, version: assignment.version },
        'CANCELLED',
        { kind: 'INVESTIGATOR', actor },
        {
          reason: code === 'POLICY_CONCERN' || ground === undefined ? code : `${code}: ${ground}`,
          correlationId: req.correlationId,
          ipAddress: req.ip,
          userAgent: req.userAgent,
        },
      );

      const review =
        code === 'POLICY_CONCERN'
          ? await this.openReview(tx, actor, assignment, 'DECLINE', ground!, c)
          : undefined;
      // No work was done and the customer has paid: the refund is owed in full, whatever the reason.
      await this.recordMoney(
        tx,
        actor,
        assignment.id,
        review?.id ?? null,
        'FULL_REFUND',
        {
          reason: 'Declined before acceptance; no work was done',
        },
        c,
      );
      return toAssignmentView({ ...assignment, ...moved });
    });
  }

  /**
   * Window 2: stopping accepted work, at any point — including after evidence has been produced.
   * An investigator who finds at hour twenty that the customer's material was unlawfully obtained
   * must be able to stop, not be trapped by having accepted.
   */
  async halt(
    actor: Actor,
    assignmentId: string,
    ground: string,
    req: RequestContext,
  ): Promise<AssignmentView> {
    const c = ctx('assignment.halt', 'assignment', req, assignmentId);
    await this.requireInvestigator(actor, c);

    return this.db.transaction(async (tx) => {
      const assignment = await this.lockAsInvestigator(tx, actor, assignmentId, c);
      const moved = await this.transitions.apply(
        tx,
        { id: assignment.id, status: assignment.status, version: assignment.version },
        'SUSPENDED',
        { kind: 'INVESTIGATOR', actor },
        {
          reason: 'POLICY_HALT',
          correlationId: req.correlationId,
          ipAddress: req.ip,
          userAgent: req.userAgent,
        },
      );
      const review = await this.openReview(tx, actor, assignment, 'HALT', ground.trim(), c);
      await this.recordMoney(
        tx,
        actor,
        assignment.id,
        review.id,
        'HOLD',
        {
          reason: 'Halted on policy grounds; held while staff review',
        },
        c,
      );
      return toAssignmentView({ ...assignment, ...moved });
    });
  }

  /** The caller's own standing on refusals. */
  async myResponseRecord(actor: Actor, req: RequestContext): Promise<ResponseRecord> {
    const c = ctx('policy_review.record', 'policy_review', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    return this.recordOf(this.db, actor.userId);
  }

  /** Open reviews, oldest first, for moderation staff — each with its raiser's standing. */
  async queue(
    actor: Actor,
    query: { limit?: number | undefined; cursor?: string | undefined },
    req: RequestContext,
  ): Promise<{
    items: PolicyReviewView[];
    pageInfo: { nextCursor: string | null; hasNextPage: boolean };
  }> {
    const c = ctx('policy_review.queue', 'policy_review', req);
    await this.requireModerator(actor, c);
    const limit = clampLimit(query.limit);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

    return this.platform.asStaff(
      actor,
      { scope: 'MODERATION', purpose: 'policy_review.queue' },
      req,
      async () => {
        const rows = await this.db
          .select()
          .from(policyReviews)
          .where(
            and(
              isNull(policyReviews.decidedAt),
              after === undefined
                ? undefined
                : or(
                    sql`${raisedAtMs} > ${after.raisedAt.toISOString()}::timestamptz`,
                    and(
                      sql`${raisedAtMs} = ${after.raisedAt.toISOString()}::timestamptz`,
                      gt(policyReviews.id, after.id),
                    ),
                  ),
            ),
          )
          .orderBy(asc(raisedAtMs), asc(policyReviews.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const items: PolicyReviewView[] = [];
        for (const r of page)
          items.push({
            ...reviewView(r),
            raisedByRecord: await this.recordOf(this.db, r.raisedBy),
          });
        const last = page.at(-1);
        return {
          items,
          pageInfo: {
            hasNextPage: rows.length > limit,
            nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last) : null,
          },
        };
      },
    );
  }

  /**
   * A moderator's decision, made once (T-050). The finding decides the investigator's record; for
   * a halt, the disposition resumes or cancels the assignment through the transition service; the
   * money is decided separately and recorded as its own row.
   */
  async resolve(
    actor: Actor,
    reviewId: string,
    dto: ResolvePolicyReviewDto,
    req: RequestContext,
  ): Promise<PolicyReviewView> {
    const c = ctx('policy_review.resolve', 'policy_review', req, reviewId);
    await this.requireModerator(actor, c);
    if (dto.badFaith === true && dto.finding !== 'UNSUBSTANTIATED') {
      throw invalid('badFaith', 'ONLY_UNSUBSTANTIATED');
    }

    return this.platform.asStaff(
      actor,
      { scope: 'MODERATION', purpose: 'policy_review.resolve' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          const [review] = await tx
            .select()
            .from(policyReviews)
            .where(eq(policyReviews.id, reviewId))
            .for('update');
          const found = await this.authz.visible(actor, review, c);
          await this.authz.stateAllows(actor, found.decidedAt === null, c);

          if (
            found.kind === 'DECLINE' &&
            (dto.disposition !== undefined || dto.money !== undefined)
          ) {
            // A declined assignment is already cancelled and already refunded.
            throw invalid('disposition', 'NOT_FOR_DECLINE');
          }
          if (found.kind === 'HALT' && dto.disposition === undefined)
            throw invalid('disposition', 'REQUIRED');
          if (dto.disposition === 'CANCEL' && dto.money === undefined)
            throw invalid('money', 'REQUIRED');
          if (dto.disposition === 'RESUME' && dto.money !== undefined)
            throw invalid('money', 'NOT_FOR_RESUME');

          const now = new Date();
          const [decided] = await tx
            .update(policyReviews)
            .set({
              finding: dto.finding,
              badFaith: dto.badFaith ?? false,
              disposition: dto.disposition ?? null,
              reasoning: dto.reasoning.trim(),
              decidedBy: actor.userId,
              decidedAt: now,
            })
            .where(eq(policyReviews.id, reviewId))
            .returning();

          if (found.kind === 'HALT') {
            const [assignment] = await tx
              .select()
              .from(assignments)
              .where(eq(assignments.id, found.assignmentId))
              .for('update');
            const resume = dto.disposition === 'RESUME';
            await this.transitions.apply(
              tx,
              { id: assignment!.id, status: assignment!.status, version: assignment!.version },
              resume ? 'IN_PROGRESS' : 'CANCELLED',
              { kind: 'STAFF', actor, scope: 'MODERATION' },
              {
                reason: `POLICY_REVIEW_${dto.finding}`,
                correlationId: req.correlationId,
                ipAddress: req.ip,
                userAgent: req.userAgent,
              },
            );
            if (resume) {
              await this.recordMoney(
                tx,
                actor,
                assignment!.id,
                reviewId,
                'RESUME',
                {
                  reason: 'Halt resolved; the assignment resumes',
                },
                c,
              );
            } else {
              const split = dto.money!.investigatorAmountMinor;
              if (
                dto.money!.decision === 'SPLIT' &&
                split !== undefined &&
                split > assignment!.priceMinor
              ) {
                // The database refuses this too; saying so here gives the moderator a field error.
                throw invalid('money.investigatorAmountMinor', 'EXCEEDS_PRICE');
              }
              await this.recordMoney(
                tx,
                actor,
                assignment!.id,
                reviewId,
                dto.money!.decision,
                dto.money!,
                c,
              );
            }
          }

          await this.audit.record(
            {
              correlationId: c.correlationId,
              ipAddress: c.ipAddress,
              actorId: actor.userId,
              actorRole: 'STAFF:MODERATION',
              staffScope: 'MODERATION',
              action: 'policy_review.resolved',
              resourceType: 'policy_review',
              resourceId: reviewId,
              // The finding and outcome, not the ground or the reasoning: both are free text.
              reason: `${found.kind} ${dto.finding}${dto.badFaith ? ' (bad faith)' : ''}${dto.disposition ? ` -> ${dto.disposition}` : ''}`,
            },
            tx,
          );
          return reviewView(decided!);
        }),
    );
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

  /** The assignment, locked, if this actor is its investigator; otherwise the 404 anyone gets. */
  private async lockAsInvestigator(
    tx: Tx,
    actor: Actor,
    assignmentId: string,
    c: AuthzContext,
  ): Promise<AssignmentRow> {
    const [row] = await tx
      .select({ assignment: assignments })
      .from(assignments)
      .innerJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(and(eq(assignments.id, assignmentId), eq(investigatorProfiles.userId, actor.userId)))
      .for('update', { of: assignments });
    return this.authz.visible(actor, row?.assignment, c);
  }

  private async openReview(
    tx: Tx,
    actor: Actor,
    assignment: AssignmentRow,
    kind: ReviewRow['kind'],
    ground: string,
    c: AuthzContext,
  ): Promise<ReviewRow> {
    const [review] = await tx
      .insert(policyReviews)
      .values({
        assignmentId: assignment.id,
        missionId: assignment.missionId,
        kind,
        ground,
        raisedBy: actor.userId,
      })
      .returning();
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        actorRole: 'INVESTIGATOR',
        action: 'policy_review.opened',
        resourceType: 'policy_review',
        resourceId: review!.id,
        reason: kind,
      },
      tx,
    );
    // For the moderation queue (T-051) and notifications (T-036), when they consume events.
    await tx.insert(outboxEvents).values({
      aggregateType: 'policy_review',
      aggregateId: review!.id,
      eventType: 'policy_review.opened',
      payload: {
        reviewId: review!.id,
        assignmentId: assignment.id,
        missionId: assignment.missionId,
        kind,
      },
      correlationId: c.correlationId ?? null,
    });
    return review!;
  }

  /** A decision about money, never a movement of it. Payments carries it out (T-110 to T-113). */
  private async recordMoney(
    tx: Tx,
    actor: Actor,
    assignmentId: string,
    reviewId: string | null,
    decision: MoneyKind,
    detail: Pick<MoneyDecisionDto, 'reason'> & { investigatorAmountMinor?: number | undefined },
    c: AuthzContext,
  ): Promise<void> {
    if (decision === 'SPLIT' && detail.investigatorAmountMinor === undefined) {
      throw invalid('money.investigatorAmountMinor', 'REQUIRED');
    }
    const [row] = await tx
      .insert(moneyDecisions)
      .values({
        assignmentId,
        policyReviewId: reviewId,
        decision,
        investigatorAmountMinor: decision === 'SPLIT' ? detail.investigatorAmountMinor! : null,
        // Replaced by the assignment's own currency on insert; the column is not the caller's to set.
        currency: 'XXX',
        reason: detail.reason.trim(),
        decidedBy: actor.userId,
      })
      .returning();
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        action: 'money_decision.recorded',
        resourceType: 'assignment',
        resourceId: assignmentId,
        reason:
          decision === 'SPLIT'
            ? `SPLIT ${row!.investigatorAmountMinor} ${row!.currency}`
            : decision,
      },
      tx,
    );
    await tx.insert(outboxEvents).values({
      aggregateType: 'assignment',
      aggregateId: assignmentId,
      eventType: 'money_decision.recorded',
      payload: {
        moneyDecisionId: row!.id,
        assignmentId,
        decision,
        investigatorAmountMinor: row!.investigatorAmountMinor,
        currency: row!.currency,
      },
      correlationId: c.correlationId ?? null,
    });
  }

  /**
   * Counted, excused, pending and bad-faith refusals for one investigator. A decline with no
   * review is counted; one whose review found it substantiated is excused.
   */
  private async recordOf(db: Db | Tx, userId: string): Promise<ResponseRecord> {
    const [row] = (await db.execute(sql`
      WITH declines AS (
        SELECT h.assignment_id
          FROM assignment_status_history h
         WHERE h.actor_kind = 'INVESTIGATOR' AND h.actor_id = ${userId}
           AND h.from_status = 'PENDING_ACCEPTANCE' AND h.to_status = 'CANCELLED'
      ),
      reviews AS (
        SELECT assignment_id, kind, finding, bad_faith, decided_at
          FROM policy_reviews WHERE raised_by = ${userId}
      )
      SELECT
        (SELECT count(*) FROM declines d
          WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.assignment_id = d.assignment_id
                              AND r.kind = 'DECLINE' AND (r.finding = 'SUBSTANTIATED' OR r.decided_at IS NULL)))
        + (SELECT count(*) FROM reviews WHERE kind = 'HALT' AND finding = 'UNSUBSTANTIATED')      AS counted,
        (SELECT count(*) FROM reviews WHERE finding = 'SUBSTANTIATED')                          AS excused,
        (SELECT count(*) FROM reviews WHERE decided_at IS NULL)                                 AS pending,
        (SELECT count(*) FROM reviews WHERE bad_faith)                                          AS bad_faith`)) as unknown as Array<
      Record<'counted' | 'excused' | 'pending' | 'bad_faith', string>
    >;
    return {
      counted: Number(row!.counted),
      excused: Number(row!.excused),
      pending: Number(row!.pending),
      badFaith: Number(row!.bad_faith),
    };
  }
}

/**
 * `raised_at` as the cursor sees it. PostgreSQL keeps microseconds and a JavaScript Date keeps
 * milliseconds, so a cursor built from the last row read back as *earlier* than that row, and the
 * next page began with the row the last one ended on — found by the paging test (T-050). Ordering
 * and comparing on the millisecond value makes the cursor exact; the id breaks ties.
 */
const raisedAtMs = sql<Date>`date_trunc('milliseconds', ${policyReviews.raisedAt})`;

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

const invalid = (field: string, code: string): AppError =>
  AppError.validation([
    { field, code, messageKey: `error.validation.policy_review.${code.toLowerCase()}` },
  ]);

const reviewView = (r: ReviewRow): PolicyReviewView => ({
  id: r.id,
  assignmentId: r.assignmentId,
  missionId: r.missionId,
  kind: r.kind,
  ground: r.ground,
  raisedBy: r.raisedBy,
  raisedAt: r.raisedAt.toISOString(),
  finding: r.finding,
  badFaith: r.badFaith,
  disposition: r.disposition,
  reasoning: r.reasoning,
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

function encodeCursor(r: ReviewRow): string {
  return Buffer.from(JSON.stringify({ t: r.raisedAt.toISOString(), i: r.id }), 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { raisedAt: Date; id: string } {
  const reject = (): never => {
    throw AppError.validation([
      { field: 'cursor', code: 'INVALID', messageKey: 'error.validation.cursor.invalid' },
    ]);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return reject();
  }
  const p = parsed as { t?: unknown; i?: unknown } | null;
  const at = typeof p?.t === 'string' ? new Date(p.t) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime()) || typeof p?.i !== 'string' || !/^[0-9a-f-]{36}$/.test(p.i))
    return reject();
  return { raisedAt: at, id: p.i };
}
