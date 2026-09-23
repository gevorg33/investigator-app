import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  investigatorProfiles,
  investigatorSpecialties,
  mediaAssets,
  serviceAreas,
  verificationDecisions,
  verificationRequestDocuments,
  verificationRequests,
  type DeclaredScope,
} from '../../database/schema';
import { MediaService, type DeliveryUrl } from '../media/media.service';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import type {
  DecideVerificationDto,
  QueueQueryDto,
  SubmitVerificationDto,
} from './verification.dto';
import { clampLimit, decodeQueueCursor, encodeQueueCursor } from './verification.policy';

export type VerificationRequestRow = typeof verificationRequests.$inferSelect;
type DecisionRow = typeof verificationDecisions.$inferSelect;

/**
 * An application as the applicant sees it.
 *
 * The decision's reason is theirs to read — it is written for them. The reviewer's identity is
 * not: attribution exists for disputes and audit, and handing an applicant the name of the
 * person who rejected them serves neither.
 */
export interface ApplicantRequestView {
  id: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: Date;
  decidedAt: Date | null;
  documentIds: string[];
  declaredScope: DeclaredScope;
  decision: { outcome: 'APPROVED' | 'REJECTED'; reason: string; decidedAt: Date } | null;
}

export interface QueueItem {
  id: string;
  profileId: string;
  submittedAt: Date;
  documentCount: number;
}

export interface QueuePage {
  items: QueueItem[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/** One earlier or current application in a profile's trail, with who decided it. */
export interface TrailEntry {
  requestId: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: Date;
  decision: {
    outcome: 'APPROVED' | 'REJECTED';
    reason: string;
    decidedBy: string;
    decidedAt: Date;
  } | null;
}

/** What a reviewer works from: the application, the documents, and every earlier decision. */
export interface ReviewView {
  id: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: Date;
  declaredScope: DeclaredScope;
  profile: {
    id: string;
    userId: string;
    headline: string | null;
    verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
    verifiedAt: Date | null;
  };
  /** Metadata only. Opening a document is a separate, audited request. */
  documents: Array<{
    mediaAssetId: string;
    declaredMimeType: string;
    bytes: number | null;
    scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';
  }>;
  /** Every application this profile has made, newest first, the current one included. */
  trail: TrailEntry[];
}

/**
 * Investigator verification (plan.md §23): an application, a review, a recorded decision.
 *
 * `investigator_profiles.verification_status` is written here and nowhere else — a static spec
 * holds that. It is the column discovery and quoting refuse on, so a status that changed
 * without a request and a decision behind it is an investigator listed on nobody's say-so.
 *
 * Decisions are whole-application: approve what was declared, or reject it. Partial approval
 * needs verification tracked per specialty and area, which discovery and quoting would have to
 * honour; it is its own task rather than an outcome this service pretends to support.
 */
@Injectable()
export class VerificationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
    private readonly profiles: OwnInvestigatorProfileRepository,
    private readonly platform: PlatformContext,
  ) {}

  // ── The applicant's side ──────────────────────────────────────────────────────

  /**
   * Applies for verification with the given documents.
   *
   * The declaration is read from the profile, not the request, and frozen onto the application:
   * what a reviewer checks the documents against must not move while they are checking.
   */
  async submit(
    actor: Actor,
    dto: SubmitVerificationDto,
    req: RequestContext,
  ): Promise<ApplicantRequestView> {
    const c = this.ctx('verification.submit', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigators.update', c);
    const profile = await this.authz.visible(actor, await this.profiles.findMine(actor), c);

    const documentIds = [...new Set(dto.documentIds)];

    return this.db.transaction(async (tx) => {
      // Serialises submissions per profile, and holds the status still until it is rewritten.
      await tx
        .select({ id: investigatorProfiles.id })
        .from(investigatorProfiles)
        .where(eq(investigatorProfiles.id, profile.id))
        .for('update');

      await this.requireUsableDocuments(tx, actor, documentIds);
      const declaredScope = await this.declaredScope(tx, profile.id);

      let request: VerificationRequestRow | undefined;
      try {
        [request] = await tx
          .insert(verificationRequests)
          .values({ profileId: profile.id, declaredScope })
          .returning();
      } catch (e) {
        // One open application per profile, held by a partial unique index. The row lock above
        // means the index is what answers, not a race.
        if (uniqueViolation(e)) throw AppError.stateConflict();
        throw e;
      }
      if (!request) throw new AppError('INTERNAL_ERROR');

      await tx
        .insert(verificationRequestDocuments)
        .values(documentIds.map((mediaAssetId) => ({ requestId: request.id, mediaAssetId })));

      // Applying is what makes a profile PENDING. A VERIFIED profile applying for additions
      // stays VERIFIED: "your existing verified scope is unaffected" while they are reviewed.
      await tx
        .update(investigatorProfiles)
        .set({ verificationStatus: 'PENDING', updatedAt: new Date() })
        .where(
          and(
            eq(investigatorProfiles.id, profile.id),
            inArray(investigatorProfiles.verificationStatus, ['UNVERIFIED', 'REJECTED']),
          ),
        );

      await this.record(actor, req, 'verification.submitted', request.id, tx, 'INVESTIGATOR');
      return applicantView(request, documentIds, null);
    });
  }

  /** The caller's own applications, newest first, with the reason for each decision. */
  async listMine(actor: Actor, req: RequestContext): Promise<ApplicantRequestView[]> {
    const c = this.ctx('verification.list_own', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigators.read', c);
    const profile = await this.authz.visible(actor, await this.profiles.findMine(actor), c);

    const requests = await this.db
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.profileId, profile.id))
      .orderBy(desc(verificationRequests.submittedAt), desc(verificationRequests.id));
    if (requests.length === 0) return [];

    const ids = requests.map((r) => r.id);
    const [documents, decisions] = await Promise.all([
      this.db
        .select()
        .from(verificationRequestDocuments)
        .where(inArray(verificationRequestDocuments.requestId, ids)),
      this.db
        .select()
        .from(verificationDecisions)
        .where(inArray(verificationDecisions.requestId, ids)),
    ]);

    return requests.map((r) =>
      applicantView(
        r,
        documents.filter((d) => d.requestId === r.id).map((d) => d.mediaAssetId),
        decisions.find((d) => d.requestId === r.id) ?? null,
      ),
    );
  }

  // ── The reviewer's side ───────────────────────────────────────────────────────

  /**
   * Open applications, oldest first. An unreviewed application is an investigator who can
   * neither appear nor quote, so waiting time is the ordering that matters.
   */
  async queue(actor: Actor, query: QueueQueryDto, req: RequestContext): Promise<QueuePage> {
    const c = this.ctx('verification.queue', req);
    await this.requireReviewer(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'VERIFICATION', purpose: 'verification.queue' },
      req,
      async () => {
      const limit = clampLimit(query.limit);
      const after = query.cursor === undefined ? undefined : decodeQueueCursor(query.cursor);

      const rows = await this.db
        .select({
          id: verificationRequests.id,
          profileId: verificationRequests.profileId,
          submittedAt: verificationRequests.submittedAt,
          // A join, not a correlated subquery: inside a `sql` fragment drizzle writes a column
          // unqualified, and a bare "id" there binds to the documents table, not this one.
          documentCount: sql<number>`count(${verificationRequestDocuments.id})::int`,
        })
        .from(verificationRequests)
        .leftJoin(
          verificationRequestDocuments,
          eq(verificationRequestDocuments.requestId, verificationRequests.id),
        )
        .where(
          and(
            eq(verificationRequests.status, 'SUBMITTED'),
            after === undefined
              ? undefined
              : or(
                  sql`${submittedAtMs} > ${after.submittedAt.toISOString()}::timestamptz`,
                  and(
                    sql`${submittedAtMs} = ${after.submittedAt.toISOString()}::timestamptz`,
                    gt(verificationRequests.id, after.id),
                  ),
                ),
          ),
        )
        .groupBy(verificationRequests.id)
        .orderBy(asc(submittedAtMs), asc(verificationRequests.id))
        .limit(limit + 1);

      const hasNextPage = rows.length > limit;
      const items = rows.slice(0, limit);
      return {
        items,
        pageInfo: {
          // A next page means this one is full, so it has a last row to continue from.
          nextCursor: hasNextPage ? encodeQueueCursor(items.at(-1)!) : null,
          hasNextPage,
        },
      };
    });
  }

  /** One application with everything a reviewer needs to decide it, including the history. */
  async getForReview(actor: Actor, requestId: string, req: RequestContext): Promise<ReviewView> {
    const c = this.ctx('verification.review', req, requestId);
    await this.requireReviewer(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'VERIFICATION', purpose: 'verification.review' },
      req,
      async () => {
      const [request] = await this.db
        .select()
        .from(verificationRequests)
        .where(eq(verificationRequests.id, requestId));
      const found = await this.authz.visible(actor, request, c);

      const [profile] = await this.db
        .select()
        .from(investigatorProfiles)
        .where(eq(investigatorProfiles.id, found.profileId));
      // profile_id is a restricting foreign key: the profile exists for as long as the request.
      const p = profile!;

      const documents = await this.db
        .select({
          mediaAssetId: mediaAssets.id,
          declaredMimeType: mediaAssets.declaredMimeType,
          bytes: mediaAssets.bytes,
          scanStatus: mediaAssets.scanStatus,
        })
        .from(verificationRequestDocuments)
        .innerJoin(mediaAssets, eq(mediaAssets.id, verificationRequestDocuments.mediaAssetId))
        .where(eq(verificationRequestDocuments.requestId, found.id))
        .orderBy(asc(verificationRequestDocuments.createdAt), asc(mediaAssets.id));

      const history = await this.db
        .select({ request: verificationRequests, decision: verificationDecisions })
        .from(verificationRequests)
        .leftJoin(verificationDecisions, eq(verificationDecisions.requestId, verificationRequests.id))
        .where(eq(verificationRequests.profileId, found.profileId))
        .orderBy(desc(verificationRequests.submittedAt), desc(verificationRequests.id));

      return {
        id: found.id,
        status: found.status,
        submittedAt: found.submittedAt,
        declaredScope: found.declaredScope,
        profile: {
          id: p.id,
          userId: p.userId,
          headline: p.headline,
          verificationStatus: p.verificationStatus,
          verifiedAt: p.verifiedAt,
        },
        documents,
        trail: history.map(({ request: r, decision: d }) => ({
          requestId: r.id,
          status: r.status,
          submittedAt: r.submittedAt,
          decision:
            d === null
              ? null
              : {
                  outcome: d.outcome,
                  reason: d.reason,
                  decidedBy: d.decidedBy,
                  decidedAt: d.decidedAt,
                },
        })),
      };
    });
  }

  /**
   * Decides an application, whole.
   *
   * Approval makes the profile VERIFIED. Rejection makes it REJECTED — unless it was already
   * VERIFIED and this was an application for additions, in which case the existing verification
   * stands: a rejected addition does not unverify what was verified before.
   */
  async decide(
    actor: Actor,
    requestId: string,
    dto: DecideVerificationDto,
    req: RequestContext,
  ): Promise<TrailEntry> {
    const c = this.ctx('verification.decide', req, requestId);
    await this.requireReviewer(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'VERIFICATION', purpose: 'verification.decide' },
      req,
      async () => {
      return this.db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(verificationRequests)
          .where(eq(verificationRequests.id, requestId))
          .for('update');
        const found = await this.authz.visible(actor, request, c);

        const [profile] = await tx
          .select()
          .from(investigatorProfiles)
          .where(eq(investigatorProfiles.id, found.profileId))
          .for('update');
        const p = profile!;

        // Nobody verifies themselves. A reviewer who is also the applicant is refused as a state
        // of this request, not hidden from it: they can already see it as its owner.
        await this.authz.stateAllows(
          actor,
          found.status === 'SUBMITTED' && p.userId !== actor.userId,
          c,
        );

        // The decision is timed by the database, never the application server, and never before
        // the submission it decides. A wall clock is not monotonic — the dev database's clock
        // was seen stepping back 74 ms under load, so even two now()s from the same server can
        // run backwards. `greatest` records the decision no earlier than the submission; the
        // CHECK that forbids the reverse stays as the backstop.
        const [decided] = await tx
          .update(verificationRequests)
          .set({
            status: dto.outcome,
            decidedAt: sql`greatest(now(), ${verificationRequests.submittedAt})`,
            version: found.version + 1,
            updatedAt: sql`greatest(now(), ${verificationRequests.submittedAt})`,
          })
          .where(
            and(
              eq(verificationRequests.id, found.id),
              eq(verificationRequests.status, 'SUBMITTED'),
              eq(verificationRequests.version, found.version),
            ),
          )
          .returning();
        if (!decided) throw AppError.stateConflict();
        // Set by the UPDATE above; the CHECK ties it to the status just written.
        const now = decided.decidedAt!;

        const [decision] = await tx
          .insert(verificationDecisions)
          .values({
            requestId: found.id,
            outcome: dto.outcome,
            reason: dto.reason.trim(),
            decidedBy: actor.userId,
            decidedAt: now,
          })
          .returning();
        const d = decision!;

        if (dto.outcome === 'APPROVED') {
          await tx
            .update(investigatorProfiles)
            .set({
              verificationStatus: 'VERIFIED',
              // "When the current VERIFIED status was granted" — an approved addition does not
              // move it.
              verifiedAt: p.verificationStatus === 'VERIFIED' ? p.verifiedAt : now,
              updatedAt: now,
            })
            .where(eq(investigatorProfiles.id, p.id));
        } else if (p.verificationStatus !== 'VERIFIED') {
          await tx
            .update(investigatorProfiles)
            .set({ verificationStatus: 'REJECTED', updatedAt: now })
            .where(eq(investigatorProfiles.id, p.id));
        }

        await this.record(
          actor,
          req,
          dto.outcome === 'APPROVED' ? 'verification.approved' : 'verification.rejected',
          found.id,
          tx,
          'STAFF',
        );

        return {
          requestId: decided.id,
          status: decided.status,
          submittedAt: decided.submittedAt,
          decision: {
            outcome: d.outcome,
            reason: d.reason,
            decidedBy: d.decidedBy,
            decidedAt: d.decidedAt,
          },
        };
      });
    });
  }

  /**
   * A short-lived link to one document of one application.
   *
   * Addressed through the application rather than the asset, so what is recorded is not just
   * "a verification document was opened" but which application it was opened for. The link
   * itself comes from the media module, which re-checks the asset and refuses anything not
   * scanned clean — "a malware scan runs before any reviewer opens a document".
   */
  async openDocument(
    actor: Actor,
    requestId: string,
    mediaAssetId: string,
    req: RequestContext,
  ): Promise<DeliveryUrl> {
    const c = this.ctx('verification.open_document', req, requestId);
    await this.requireReviewer(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'VERIFICATION', purpose: 'verification.open_document' },
      req,
      async () => {
      const [membership] = await this.db
        .select({ requestId: verificationRequestDocuments.requestId })
        .from(verificationRequestDocuments)
        .where(
          and(
            eq(verificationRequestDocuments.requestId, requestId),
            eq(verificationRequestDocuments.mediaAssetId, mediaAssetId),
          ),
        );
      // A document that is not part of this application is answered as absent, whether or not
      // the asset exists: the application is the only door to it here.
      await this.authz.visible(actor, membership, c);

      const url = await this.media.getDeliveryUrl(actor, mediaAssetId, req);
      await this.audit.record({
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: actor.userId,
        actorRole: 'STAFF',
        action: 'verification.document_opened',
        resourceType: 'verification_request',
        resourceId: requestId,
        reason: mediaAssetId,
      });
      return url;
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Staff, acting as staff, holding the VERIFICATION scope. `requireRole` is what makes a
   * narrowed session count: someone who is staff and an investigator, working as the
   * investigator, is not a reviewer at that moment.
   */
  private async requireReviewer(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'STAFF', c);
    await this.authz.requireStaffScope(actor, 'VERIFICATION', c);
  }

  /**
   * Every document must be the applicant's own verification upload, finished, and not found
   * infected. A scan still running is allowed — reviewers cannot open it until it is clean —
   * but a file already known to be bad is refused here, at the door.
   */
  private async requireUsableDocuments(tx: Tx, actor: Actor, ids: string[]): Promise<void> {
    const rows = await tx
      .select({
        id: mediaAssets.id,
        uploadStatus: mediaAssets.uploadStatus,
        scanStatus: mediaAssets.scanStatus,
      })
      .from(mediaAssets)
      .where(
        and(
          inArray(mediaAssets.id, ids),
          eq(mediaAssets.ownerId, actor.userId),
          eq(mediaAssets.category, 'VERIFICATION_DOCUMENT'),
          isNull(mediaAssets.deletedAt),
        ),
      );

    // Someone else's file and no file at all are the same answer.
    if (rows.length !== ids.length) {
      throw AppError.validation([
        {
          field: 'documentIds',
          code: 'NOT_FOUND',
          messageKey: 'error.validation.verification.document_not_found',
        },
      ]);
    }
    const unusable = rows.some(
      (r) => r.uploadStatus !== 'READY' || r.scanStatus === 'INFECTED' || r.scanStatus === 'FAILED',
    );
    if (unusable) {
      throw AppError.validation([
        {
          field: 'documentIds',
          code: 'NOT_READY',
          messageKey: 'error.validation.verification.document_not_ready',
        },
      ]);
    }
  }

  /** The profile's declaration as it stands right now: specialties and service areas. */
  private async declaredScope(tx: Tx, profileId: string): Promise<DeclaredScope> {
    const [specialties, areas] = await Promise.all([
      tx
        .select({ id: investigatorSpecialties.taxonomyNodeId })
        .from(investigatorSpecialties)
        .where(eq(investigatorSpecialties.profileId, profileId))
        .orderBy(asc(investigatorSpecialties.taxonomyNodeId)),
      tx
        .select({
          id: serviceAreas.id,
          label: serviceAreas.label,
          countryCode: serviceAreas.countryCode,
          region: serviceAreas.region,
          city: serviceAreas.city,
        })
        .from(serviceAreas)
        .where(eq(serviceAreas.profileId, profileId))
        .orderBy(asc(serviceAreas.id)),
    ]);
    return { specialtyNodeIds: specialties.map((s) => s.id), serviceAreas: areas };
  }

  private async record(
    actor: Actor,
    req: RequestContext,
    action: string,
    resourceId: string,
    tx: Tx,
    role: string,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: actor.userId,
        actorRole: role,
        action,
        resourceType: 'verification_request',
        resourceId,
      },
      tx,
    );
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'verification_request',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

/**
 * `submitted_at` as the queue's cursor sees it (T-134). PostgreSQL keeps microseconds and the cursor
 * round-trips through a JavaScript Date, which keeps milliseconds — so the cursor read back
 * *earlier* than the row it was built from, and every next page began with that same row: paging
 * never advanced. Ordering and comparing on the millisecond value makes the cursor exact; the id
 * breaks ties. `PolicyRefusalService.queue` does the same.
 */
const submittedAtMs = sql<Date>`date_trunc('milliseconds', ${verificationRequests.submittedAt})`;

/** Postgres reports a unique-index violation as 23505; anything else is not ours to interpret. */
const uniqueViolation = (e: unknown): boolean =>
  (e as { cause?: { code?: string } }).cause?.code === '23505';

const applicantView = (
  r: VerificationRequestRow,
  documentIds: string[],
  d: DecisionRow | null,
): ApplicantRequestView => ({
  id: r.id,
  status: r.status,
  submittedAt: r.submittedAt,
  decidedAt: r.decidedAt,
  documentIds,
  declaredScope: r.declaredScope,
  decision: d === null ? null : { outcome: d.outcome, reason: d.reason, decidedAt: d.decidedAt },
});
