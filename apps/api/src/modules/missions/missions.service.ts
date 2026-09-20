import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { FieldIssue } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { missions, missionStatusHistory, taxonomyNodes } from '../../database/schema';
import type { LonLat } from '../../database/schema/types';
import { RateLimitService } from '../auth/rate-limit.service';
import { MissionPolicyService } from '../mission-policy/mission-policy.service';
import {
  PERSONAL_RELATIONSHIPS,
  type SubjectRelationshipValue,
} from '../mission-policy/mission-screening';
import { coarsen } from '../service-areas/service-areas.policy';
import { MissionTransitionService, type TransitionMeta } from './mission-transition.service';
import type { MissionStatus } from './mission-transitions';
import type {
  CancelMissionDto,
  SaveMissionDraftDto,
  SubmitMissionDto,
  UpdateMissionDraftDto,
} from './missions.dto';
import { isCalendarDate } from './missions.policy';
import { OwnMissionRepository, type MissionRow } from './missions.repository';

/** A mission as its own customer sees it. Screening flags are staff-only and never appear here. */
export interface OwnMission {
  id: string;
  status: MissionStatus;
  version: number;
  taxonomyNodeId: string | null;
  title: string | null;
  description: string | null;
  countryCode: string | null;
  locationLabel: string | null;
  location: LonLat | null;
  startBy: string | null;
  deadline: string | null;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  currency: string | null;
  languages: string[];
  purpose: string | null;
  subjectRelationship: SubjectRelationshipValue | null;
  protectiveOrderDeclared: boolean | null;
  lawfulPurposeConfirmedAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Required before a mission may be submitted. The database enforces the same list. */
const REQUIRED_AT_SUBMISSION = [
  'taxonomyNodeId',
  'title',
  'description',
  'countryCode',
  'deadline',
  'budgetMinMinor',
  'budgetMaxMinor',
  'currency',
  'purpose',
  'subjectRelationship',
] as const satisfies readonly (keyof MissionRow)[];

@Injectable()
export class MissionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly repository: OwnMissionRepository,
    private readonly transitions: MissionTransitionService,
    private readonly policy: MissionPolicyService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async listMine(actor: Actor, req: RequestContext): Promise<OwnMission[]> {
    await this.requireCustomer(actor, this.ctx('mission.list', req));
    return (await this.repository.listMine(actor)).map(view);
  }

  async getMine(actor: Actor, id: string, req: RequestContext): Promise<OwnMission> {
    const c = this.ctx('mission.read', req, id);
    await this.requireCustomer(actor, c);
    return view(
      await this.authz.visible(actor, await this.repository.findOneForActor(actor, id), c),
    );
  }

  async createDraft(
    actor: Actor,
    dto: SaveMissionDraftDto,
    req: RequestContext,
  ): Promise<OwnMission> {
    const c = this.ctx('mission.create', req);
    await this.requireCustomer(actor, c);
    const patch = this.patch(dto);

    return this.db.transaction(async (tx) => {
      await this.requireUsableCategory(tx, patch.taxonomyNodeId ?? null);
      const [created] = await tx
        .insert(missions)
        .values({ ...patch, customerId: actor.userId })
        .returning();
      // RETURNING on a single-row insert always yields the row; an invariant, not a case.
      if (!created) throw new AppError('INTERNAL_ERROR');

      // The one history row not written by a transition: a mission's first status is not a
      // move from anywhere, and `from_status` is null exactly here.
      await tx.insert(missionStatusHistory).values({
        missionId: created.id,
        toStatus: created.status,
        actorKind: 'CUSTOMER',
        actorId: actor.userId,
      });
      await this.record(actor, req, 'mission.created', created.id, tx);
      return view(created);
    });
  }

  async updateDraft(
    actor: Actor,
    id: string,
    dto: UpdateMissionDraftDto,
    req: RequestContext,
  ): Promise<OwnMission> {
    const c = this.ctx('mission.update', req, id);
    await this.requireCustomer(actor, c);
    const patch = this.patch(dto);

    return this.db.transaction(async (tx) => {
      const mission = await this.lockMine(tx, actor, id, c);
      // Editing is a draft-only operation. Once investigators may be quoting against a
      // mission, changing it under them is what produces disputes.
      await this.authz.stateAllows(actor, mission.status === 'DRAFT', c);
      requireVersion(mission, dto.version);
      await this.requireUsableCategory(
        tx,
        patch.taxonomyNodeId === undefined ? mission.taxonomyNodeId : patch.taxonomyNodeId,
      );

      const [updated] = await tx
        .update(missions)
        .set({ ...patch, version: mission.version + 1, updatedAt: new Date() })
        .where(and(eq(missions.id, mission.id), eq(missions.version, mission.version)))
        .returning();
      if (!updated) throw AppError.stateConflict();

      await this.record(actor, req, 'mission.draft_updated', mission.id, tx);
      return view(updated);
    });
  }

  /**
   * Hands the mission in: confirmed, screened, and waiting for a moderator.
   *
   * One transaction covers all of it — the status, the history, the audit entries, the outbox
   * event and the screening record. A mission cannot end up under review with no record of why,
   * and cannot be screened without having moved.
   */
  async submit(
    actor: Actor,
    id: string,
    dto: SubmitMissionDto,
    req: RequestContext,
  ): Promise<OwnMission> {
    const c = this.ctx('mission.submit', req, id);
    await this.requireCustomer(actor, c);
    // Every submission costs a moderator's attention, and that queue is the publication gate.
    await this.rateLimit.consume('missionSubmitPerAccount', actor.userId);

    return this.db.transaction(async (tx) => {
      const mission = await this.lockMine(tx, actor, id, c);
      requireVersion(mission, dto.version);
      this.requireComplete(mission);
      await this.requireUsableCategory(tx, mission.taxonomyNodeId);

      const meta: TransitionMeta = {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
      };
      const now = new Date();
      // The confirmation is written with the transition, never before it: a draft that failed
      // to submit must not be left looking confirmed.
      const submitted = await this.transitions.apply(
        tx,
        mission,
        'SUBMITTED',
        { kind: 'CUSTOMER', actor },
        meta,
        {
          lawfulPurposeConfirmedAt: now,
          submittedAt: now,
        },
      );

      const screening = await this.policy.screenSubmission(tx, mission, submitted.version);

      // Screening sorts the queue; it never publishes and never rejects. The only move it can
      // produce is into review.
      const reviewed = await this.transitions.apply(
        tx,
        submitted,
        'UNDER_REVIEW',
        { kind: 'SYSTEM' },
        {
          ...meta,
          reason: `${screening.outcome}:${screening.riskBand}`,
        },
      );

      await this.record(actor, req, 'mission.submitted', mission.id, tx);
      return view({
        ...mission,
        ...screeningFreeFields(reviewed),
        lawfulPurposeConfirmedAt: now,
        submittedAt: now,
      });
    });
  }

  async cancel(
    actor: Actor,
    id: string,
    dto: CancelMissionDto,
    req: RequestContext,
  ): Promise<OwnMission> {
    const c = this.ctx('mission.cancel', req, id);
    await this.requireCustomer(actor, c);

    return this.db.transaction(async (tx) => {
      const mission = await this.lockMine(tx, actor, id, c);
      requireVersion(mission, dto.version);
      // Which statuses may be cancelled is the transition map's answer, not this method's.
      const cancelled = await this.transitions.apply(
        tx,
        mission,
        'CANCELLED',
        { kind: 'CUSTOMER', actor },
        {
          reason: dto.reason,
          correlationId: req.correlationId,
          ipAddress: req.ip,
          userAgent: req.userAgent,
        },
      );
      await this.record(actor, req, 'mission.cancelled', mission.id, tx);
      return view({ ...mission, ...screeningFreeFields(cancelled) });
    });
  }

  /**
   * The caller's own mission, locked for the rest of the transaction.
   *
   * `FOR UPDATE` is what makes concurrent transitions safe: a second one waits here and then
   * reads the first one's result, so it can never act on a status that has already changed.
   * The customer id is in the predicate, so somebody else's id simply matches nothing.
   */
  private async lockMine(tx: Tx, actor: Actor, id: string, c: AuthzContext): Promise<MissionRow> {
    const [row] = await tx
      .select()
      .from(missions)
      .where(and(eq(missions.id, id), eq(missions.customerId, actor.userId)))
      .for('update');
    return this.authz.visible(actor, row, c);
  }

  private requireComplete(mission: MissionRow): void {
    const issues: FieldIssue[] = [];
    const missing = (field: string) =>
      issues.push({ field, code: 'REQUIRED', messageKey: 'error.validation.mission.required' });

    for (const field of REQUIRED_AT_SUBMISSION) if (mission[field] === null) missing(field);
    if (mission.languages.length === 0) missing('languages');
    // Asked where the relationship is personal, because that is where it decides the answer.
    if (
      mission.subjectRelationship !== null &&
      PERSONAL_RELATIONSHIPS.has(mission.subjectRelationship) &&
      mission.protectiveOrderDeclared === null
    ) {
      missing('protectiveOrderDeclared');
    }
    // A deadline in the past describes work nobody can accept.
    if (mission.deadline !== null && mission.deadline < today()) {
      issues.push({
        field: 'deadline',
        code: 'IN_THE_PAST',
        messageKey: 'error.validation.mission.deadline_past',
      });
    }
    if (issues.length > 0) throw AppError.validation(issues);
  }

  /** A category must exist and be current. Deprecated nodes keep old missions valid, not new ones. */
  private async requireUsableCategory(tx: Tx, taxonomyNodeId: string | null): Promise<void> {
    if (taxonomyNodeId === null) return;
    const [node] = await tx
      .select({ status: taxonomyNodes.status })
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.id, taxonomyNodeId));
    if (node?.status !== 'ACTIVE') {
      throw AppError.validation([
        {
          field: 'taxonomyNodeId',
          code: 'UNAVAILABLE',
          messageKey: 'error.validation.mission.category_unavailable',
        },
      ]);
    }
  }

  /** Only the fields the client sent. An absent field is unchanged; an explicit null clears it. */
  private patch(dto: SaveMissionDraftDto): Partial<typeof missions.$inferInsert> {
    const p: Partial<typeof missions.$inferInsert> = {};
    if (dto.taxonomyNodeId !== undefined) p.taxonomyNodeId = dto.taxonomyNodeId;
    if (dto.title !== undefined) p.title = dto.title;
    if (dto.description !== undefined) p.description = dto.description;
    if (dto.countryCode !== undefined) p.countryCode = dto.countryCode;
    if (dto.locationLabel !== undefined) p.locationLabel = dto.locationLabel;
    if (dto.location !== undefined) {
      // Coarsened before storage, like a service-area centre: a mission's location is often
      // where its subject lives, and two decimal places is about a kilometre.
      p.location =
        dto.location === null
          ? null
          : { lon: coarsen(dto.location.lon), lat: coarsen(dto.location.lat) };
    }
    if (dto.startBy !== undefined) p.startBy = this.date(dto.startBy, 'startBy');
    if (dto.deadline !== undefined) p.deadline = this.date(dto.deadline, 'deadline');
    if (dto.budgetMinMinor !== undefined) p.budgetMinMinor = dto.budgetMinMinor;
    if (dto.budgetMaxMinor !== undefined) p.budgetMaxMinor = dto.budgetMaxMinor;
    if (dto.currency !== undefined) p.currency = dto.currency;
    if (dto.languages !== undefined) p.languages = dto.languages ?? [];
    if (dto.purpose !== undefined) p.purpose = dto.purpose;
    if (dto.subjectRelationship !== undefined) p.subjectRelationship = dto.subjectRelationship;
    if (dto.protectiveOrderDeclared !== undefined)
      p.protectiveOrderDeclared = dto.protectiveOrderDeclared;
    return p;
  }

  /** `2026-02-31` has the shape of a date and is not one. Caught here, as a field error. */
  private date(value: string | null, field: string): string | null {
    if (value !== null && !isCalendarDate(value)) {
      throw AppError.validation([
        { field, code: 'INVALID', messageKey: 'error.validation.date.invalid' },
      ]);
    }
    return value;
  }

  private async requireCustomer(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'CUSTOMER', c);
    // A mission belongs to the workspace it was written in (T-076), and agencies are
    // supplier-only in v1: a customer acts in their Personal workspace or not at all.
    await this.authz.requirePersonalWorkspace(actor, c);
  }

  private async record(
    actor: Actor,
    req: RequestContext,
    action: string,
    resourceId: string,
    tx: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: actor.userId,
        actorRole: 'CUSTOMER',
        action,
        resourceType: 'mission',
        resourceId,
      },
      tx,
    );
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

/** Today in UTC, as a date string, for comparison with a `date` column. */
const today = (): string => new Date().toISOString().slice(0, 10);

const requireVersion = (mission: MissionRow, expected: number): void => {
  // Somebody else changed this mission since the client read it. Re-read rather than overwrite.
  if (mission.version !== expected) throw AppError.stateConflict();
};

/** Status and version as the transition left them. */
const screeningFreeFields = (moved: { status: MissionStatus; version: number }) => ({
  status: moved.status,
  version: moved.version,
});

const view = (m: MissionRow): OwnMission => ({
  id: m.id,
  status: m.status,
  version: m.version,
  taxonomyNodeId: m.taxonomyNodeId,
  title: m.title,
  description: m.description,
  countryCode: m.countryCode,
  locationLabel: m.locationLabel,
  location: m.location,
  startBy: m.startBy,
  deadline: m.deadline,
  budgetMinMinor: m.budgetMinMinor,
  budgetMaxMinor: m.budgetMaxMinor,
  currency: m.currency,
  languages: m.languages,
  purpose: m.purpose,
  subjectRelationship: m.subjectRelationship,
  protectiveOrderDeclared: m.protectiveOrderDeclared,
  lawfulPurposeConfirmedAt: m.lawfulPurposeConfirmedAt,
  submittedAt: m.submittedAt,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});
