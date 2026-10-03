import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  missionModerationDecisions,
  missions,
  missionScreenings,
  missionStatusHistory,
} from '../../database/schema';
import { MissionTransitionService } from '../missions/mission-transition.service';
import type { MissionStatus } from '../missions/mission-transitions';
import type {
  DecideModerationDto,
  ModerationOutcome,
  ModerationQueueQueryDto,
} from './mission-moderation.dto';
import {
  bandRank,
  clampLimit,
  decodeModerationCursor,
  encodeModerationCursor,
} from './mission-moderation.policy';
import type { RiskBandValue, ScreeningOutcome } from './mission-screening';

/** One mission waiting for a moderator, as the queue lists it. */
export interface ModerationQueueItem {
  id: string;
  title: string | null;
  taxonomyNodeId: string | null;
  riskBand: RiskBandValue;
  screeningOutcome: ScreeningOutcome;
  flagCount: number;
  /** When it entered review — how long the customer has been waiting. */
  queuedAt: Date;
  /** The customer's deadline; a mission not published by then is no use to them. */
  deadline: string | null;
}

export interface ModerationQueuePage {
  items: ModerationQueueItem[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/** A decision as staff read it, with the note the customer never sees. */
export interface ModerationDecisionView {
  outcome: ModerationOutcome;
  reason: string;
  internalNote: string | null;
  decidedBy: string;
  decidedAt: Date;
  missionVersion: number;
}

/**
 * One mission with everything a moderator decides it on (T-051): the brief as submitted, the
 * screening that sorted it — its band, flags and ruleset — and any AI classification, labelled as
 * input; the decisions on its earlier submissions; and whether this moderator may decide it.
 *
 * Not the customer: who they are is not what is being decided, and a moderator who needs to know
 * whether they are party to it is told so as `party`, never by being shown the account.
 */
export interface ModerationReviewView {
  id: string;
  status: MissionStatus;
  version: number;
  title: string | null;
  description: string | null;
  purpose: string | null;
  subjectRelationship: string | null;
  protectiveOrderDeclared: boolean | null;
  taxonomyNodeId: string | null;
  countryCode: string | null;
  locationLabel: string | null;
  languages: string[];
  startBy: string | null;
  deadline: string | null;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  currency: string | null;
  submittedAt: Date | null;
  queuedAt: Date | null;
  screening: {
    outcome: ScreeningOutcome;
    riskBand: RiskBandValue;
    flags: string[];
    rulesetVersion: string;
    screenedAt: Date;
    /** A model's opinion, when one exists. Input to the moderator; it never decides (plan §10). */
    aiClassification: unknown;
  } | null;
  decisions: ModerationDecisionView[];
  /** The moderator is the mission's customer: they cannot decide it. */
  party: boolean;
}

/** Where each outcome moves the mission. The transition map says who may make each move. */
const TARGET: Record<ModerationOutcome, MissionStatus> = {
  PUBLISHED: 'QUOTED',
  REJECTED: 'REJECTED',
  CHANGES_REQUESTED: 'DRAFT',
};

/**
 * The moderation queue and the three decisions — the publication gate (T-051, plan §10).
 *
 * No mission reaches investigators without a moderator publishing it here: `publish` is the only
 * caller that asks the transition service for QUOTED, and the map lets nobody but
 * `STAFF:MODERATION` make that move. Screening sorted the queue; it decides nothing, and nothing
 * it or a model produced chooses an outcome — the moderator names one every time.
 *
 * Every read and every decision enters through `PlatformContext` first: missions belong to their
 * customers' workspaces, and this is where staff cross them, each crossing audited on its own.
 *
 * The gate is closed: every mission is reviewed (plan §10, decided 2026-09-19). Each decision
 * records its category, band and queue time, so review latency per category and band exists from
 * the first day — the data any later decision to open the gate for a low-risk category rests on.
 */
@Injectable()
export class MissionModerationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly transitions: MissionTransitionService,
    private readonly platform: PlatformContext,
  ) {}

  /** Missions under review: the most sensitive band first, then whoever has waited longest. */
  async queue(
    actor: Actor,
    query: ModerationQueueQueryDto,
    req: RequestContext,
  ): Promise<ModerationQueuePage> {
    const c = this.ctx('mission_moderation.queue', req);
    await this.requireModerator(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'MODERATION', purpose: 'mission_moderation.queue' },
      req,
      async () => {
        const limit = clampLimit(query.limit);
        const after = query.cursor === undefined ? undefined : decodeModerationCursor(query.cursor);

        const rows = (await this.db.execute(sql`
          WITH queued AS (
            SELECT m.id, m.title, m.taxonomy_node_id, m.deadline,
                   s.risk_band, s.outcome AS screening_outcome,
                   jsonb_array_length(s.flags)::int AS flag_count,
                   (array_position(enum_range(NULL::risk_band), s.risk_band) - 1)::int AS rank,
                   q.queued_at
              FROM missions m
              -- The latest screening: the one for this submission. By version, not by clock — a
              -- clock can step back between two transactions (T-167).
              CROSS JOIN LATERAL (
                SELECT ms.risk_band, ms.outcome, ms.flags
                  FROM mission_screenings ms
                 WHERE ms.mission_id = m.id
                 ORDER BY ms.mission_version DESC, ms.id DESC
                 LIMIT 1
              ) s
              -- When it entered review this time: the latest such move, by the order it was
              -- written. Milliseconds, so a cursor that round-trips through a JavaScript Date
              -- reads back exactly what it was built from (T-134).
              CROSS JOIN LATERAL (
                SELECT date_trunc('milliseconds', h.occurred_at) AS queued_at
                  FROM mission_status_history h
                 WHERE h.mission_id = m.id AND h.to_status = 'UNDER_REVIEW'
                 ORDER BY h.seq DESC
                 LIMIT 1
              ) q
             WHERE m.status = 'UNDER_REVIEW'
          )
          SELECT * FROM queued
           WHERE ${
             after === undefined
               ? sql`true`
               : sql`(rank < ${after.rank}
                      OR (rank = ${after.rank} AND queued_at > ${after.queuedAt.toISOString()}::timestamptz)
                      OR (rank = ${after.rank} AND queued_at = ${after.queuedAt.toISOString()}::timestamptz
                          AND id > ${after.id}::uuid))`
           }
           ORDER BY rank DESC, queued_at ASC, id ASC
           LIMIT ${limit + 1}`)) as unknown as Array<{
          id: string;
          title: string | null;
          taxonomy_node_id: string | null;
          deadline: string | null;
          risk_band: RiskBandValue;
          screening_outcome: ScreeningOutcome;
          flag_count: number;
          rank: number;
          queued_at: Date | string;
        }>;

        const hasNextPage = rows.length > limit;
        const page = rows.slice(0, limit);
        const items = page.map((r) => ({
          id: r.id,
          title: r.title,
          taxonomyNodeId: r.taxonomy_node_id,
          riskBand: r.risk_band,
          screeningOutcome: r.screening_outcome,
          flagCount: r.flag_count,
          queuedAt: new Date(r.queued_at),
          deadline: r.deadline,
        }));
        const last = items.at(-1);
        return {
          items,
          pageInfo: {
            // A next page means this one is full, so it has a last row to continue from.
            nextCursor:
              hasNextPage && last !== undefined
                ? encodeModerationCursor({
                    rank: bandRank(last.riskBand),
                    queuedAt: last.queuedAt,
                    id: last.id,
                  })
                : null,
            hasNextPage,
          },
        };
      },
    );
  }

  /** One mission, with everything a moderator decides it on. */
  async getForReview(
    actor: Actor,
    missionId: string,
    req: RequestContext,
  ): Promise<ModerationReviewView> {
    const c = this.ctx('mission_moderation.review', req, missionId);
    await this.requireModerator(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'MODERATION', purpose: 'mission_moderation.review' },
      req,
      async () => {
        const [row] = await this.db.select().from(missions).where(eq(missions.id, missionId));
        // A draft nobody submitted is not the moderator's to read: only what reached review is.
        const m = await this.authz.visible(
          actor,
          row !== undefined && row.submittedAt !== null ? row : undefined,
          c,
        );

        const screening = await this.latestScreening(this.db, m.id);
        const queuedAt = await this.queuedAt(this.db, m.id);
        const decisions = await this.db
          .select()
          .from(missionModerationDecisions)
          .where(eq(missionModerationDecisions.missionId, m.id))
          .orderBy(
            asc(missionModerationDecisions.missionVersion),
            asc(missionModerationDecisions.id),
          );

        return {
          id: m.id,
          status: m.status,
          version: m.version,
          title: m.title,
          description: m.description,
          purpose: m.purpose,
          subjectRelationship: m.subjectRelationship,
          protectiveOrderDeclared: m.protectiveOrderDeclared,
          taxonomyNodeId: m.taxonomyNodeId,
          countryCode: m.countryCode,
          locationLabel: m.locationLabel,
          languages: m.languages,
          startBy: m.startBy,
          deadline: m.deadline,
          budgetMinMinor: m.budgetMinMinor,
          budgetMaxMinor: m.budgetMaxMinor,
          currency: m.currency,
          submittedAt: m.submittedAt,
          queuedAt,
          screening:
            screening === undefined
              ? null
              : {
                  outcome: screening.outcome,
                  riskBand: screening.riskBand,
                  flags: screening.flags,
                  rulesetVersion: screening.rulesetVersion,
                  screenedAt: screening.createdAt,
                  aiClassification: screening.aiClassification ?? null,
                },
          decisions: decisions.map(decisionView),
          party: this.isParty(actor, m),
        };
      },
    );
  }

  /**
   * Publishes, rejects, or returns a mission for changes — one move out of review, with its reason,
   * recorded with the move.
   *
   * Refused: a mission that is not under review, or that moved since the moderator read it (409 —
   * decided by someone else, or cancelled); one the moderator is party to (403).
   */
  async decide(
    actor: Actor,
    missionId: string,
    dto: DecideModerationDto,
    req: RequestContext,
  ): Promise<ModerationDecisionView> {
    const c = this.ctx('mission_moderation.decide', req, missionId);
    await this.requireModerator(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'MODERATION', purpose: 'mission_moderation.decide' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(missions)
            .where(eq(missions.id, missionId))
            .for('update');
          const m = await this.authz.visible(
            actor,
            row !== undefined && row.submittedAt !== null ? row : undefined,
            c,
          );

          // Nobody moderates their own mission.
          await this.authz.stateAllows(actor, !this.isParty(actor, m), c);
          // Moved since it was read: decided by another moderator, or cancelled by the customer.
          if (m.status !== 'UNDER_REVIEW' || m.version !== dto.version) {
            throw AppError.stateConflict();
          }

          const screening = await this.latestScreening(tx, m.id);
          const queuedAt = await this.queuedAt(tx, m.id);
          // Every submission is screened in the transaction that moves it into review, so a
          // mission under review without either is a broken invariant, not a request to refuse.
          if (screening === undefined || queuedAt === null) {
            throw new Error(`mission ${m.id} is under review with no screening or queue entry`);
          }

          const reason = dto.reason.trim();
          await this.transitions.apply(
            tx,
            m,
            TARGET[dto.outcome],
            { kind: 'STAFF', actor, scope: 'MODERATION' },
            {
              // What the customer reads, as written (`review`, T-119).
              reason,
              correlationId: req.correlationId,
              ipAddress: req.ip,
              userAgent: req.userAgent,
            },
            // Returned for changes, it is a draft again, and its next submission is confirmed
            // afresh (missions.md, "The lawful-purpose confirmation").
            dto.outcome === 'CHANGES_REQUESTED' ? { lawfulPurposeConfirmedAt: null } : {},
          );

          const [decision] = await tx
            .insert(missionModerationDecisions)
            .values({
              missionId: m.id,
              missionVersion: m.version,
              screeningId: screening.id,
              outcome: dto.outcome,
              reason,
              internalNote: dto.internalNote?.trim() ?? null,
              decidedBy: actor.userId,
              queuedAt,
              // Timed by the database, and never before the queue entry it closes: a wall clock
              // is not monotonic (T-167), and the CHECK forbidding the reverse is the backstop.
              decidedAt: sql`greatest(now(), ${queuedAt.toISOString()}::timestamptz)`,
              taxonomyNodeId: m.taxonomyNodeId,
              riskBand: screening.riskBand,
            })
            .returning();
          return decisionView(decision!);
        }),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Staff, acting as staff, holding MODERATION — never "any staff" (authorization). `requireRole`
   * is what makes a narrowed session count: someone who is staff and a customer, working as the
   * customer, is not a moderator at that moment.
   */
  private async requireModerator(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'STAFF', c);
    await this.authz.requireStaffScope(actor, 'MODERATION', c);
  }

  private async latestScreening(db: Db | Tx, missionId: string) {
    const [screening] = await db
      .select()
      .from(missionScreenings)
      .where(eq(missionScreenings.missionId, missionId))
      .orderBy(desc(missionScreenings.missionVersion), desc(missionScreenings.id))
      .limit(1);
    return screening;
  }

  /** When the mission last entered review, or null if it never has. */
  private async queuedAt(db: Db | Tx, missionId: string): Promise<Date | null> {
    const [entry] = await db
      .select({ occurredAt: missionStatusHistory.occurredAt })
      .from(missionStatusHistory)
      .where(
        and(
          eq(missionStatusHistory.missionId, missionId),
          eq(missionStatusHistory.toStatus, 'UNDER_REVIEW'),
        ),
      )
      .orderBy(desc(missionStatusHistory.seq))
      .limit(1);
    return entry?.occurredAt ?? null;
  }

  /**
   * Whether the moderator is party to the mission: its customer. Under review nobody has quoted
   * yet, and a customer's mission lives in their own Personal workspace — agencies are
   * supplier-only in v1 (tenancy.md §3) — so the customer is the only party there is. When
   * workspaces can commission missions, this widens to the commissioning workspace's members.
   */
  private isParty(actor: Actor, m: { customerId: string }): boolean {
    return m.customerId === actor.userId;
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'mission',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

const decisionView = (
  d: typeof missionModerationDecisions.$inferSelect,
): ModerationDecisionView => ({
  outcome: d.outcome,
  reason: d.reason,
  internalNote: d.internalNote,
  decidedBy: d.decidedBy,
  decidedAt: d.decidedAt,
  missionVersion: d.missionVersion,
});
