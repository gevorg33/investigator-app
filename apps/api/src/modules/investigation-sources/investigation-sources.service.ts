import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  assignments,
  investigationSources,
  investigatorProfiles,
  type assignmentStatus,
} from '../../database/schema';
import type { CreateSourceDto, UpdateSourceDto } from './investigation-sources.dto';

type SourceRow = typeof investigationSources.$inferSelect;
type AssignmentRow = typeof assignments.$inferSelect;
type AssignmentStatus = (typeof assignmentStatus.enumValues)[number];

export interface SourceView {
  id: string;
  assignmentId: string;
  type: SourceRow['type'];
  title: string;
  locator: string | null;
  accessedAt: string | null;
  reliability: SourceRow['reliability'];
  reliabilityRationale: string | null;
  shared: boolean;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The states in which the work is live (owner decision, 2026-09-23). REPORT_SUBMITTED is among
 * them because a customer's review can send the investigator back to the sources; before
 * acceptance the work is not theirs, and after completion or cancellation it is a record.
 */
export const SOURCES_WRITABLE: ReadonlySet<AssignmentStatus> = new Set([
  'ACCEPTED',
  'IN_PROGRESS',
  'REPORT_SUBMITTED',
]);

/**
 * Where information in an assignment came from (plan.md §8, T-031).
 *
 * The investigator on the assignment records, corrects and withdraws sources while the work is
 * live. The customer reads the ones the investigator has shared, and nothing else: a source can
 * name a witness, and who the witnesses are is the investigator's to disclose. Anyone else gets
 * the same 404 as an id that does not exist. Row-level security holds the same lines underneath.
 *
 * Audit entries record the type and which fields changed — never a title or locator, which can
 * name a person (`audit-logging`).
 */
@Injectable()
export class InvestigationSourcesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The assignment's live sources: all of them for its investigator, the shared ones for its
   * customer.
   *
   * Which rows the customer sees is decided in one place, the `customer_reads_shared` policy, and
   * not here as well. A second filter in this method would always agree with the policy, so no
   * test could ever tell whether it did anything — it was removed for exactly that reason (T-031).
   */
  async list(actor: Actor, assignmentId: string, req: RequestContext): Promise<SourceView[]> {
    const c = ctx('investigation_source.list', req, assignmentId);
    await this.authz.requireActive(actor, c);
    await this.authz.requirePermission(actor, 'investigations.read', c);
    await this.requireParty(actor, assignmentId, c);

    const rows = await this.db
      .select()
      .from(investigationSources)
      .where(
        and(
          eq(investigationSources.assignmentId, assignmentId),
          isNull(investigationSources.withdrawnAt),
        ),
      )
      .orderBy(asc(investigationSources.createdAt), asc(investigationSources.id));
    return rows.map(view);
  }

  async create(
    actor: Actor,
    assignmentId: string,
    dto: CreateSourceDto,
    req: RequestContext,
  ): Promise<SourceView> {
    const c = ctx('investigation_source.create', req, assignmentId);
    await this.requireInvestigator(actor, c);
    requireRationale(dto.reliability ?? 'UNKNOWN', dto.reliabilityRationale);

    return this.db.transaction(async (tx) => {
      const assignment = await this.holdAsInvestigator(tx, actor, assignmentId, c);
      await this.authz.stateAllows(actor, SOURCES_WRITABLE.has(assignment.status), c);

      const [row] = await tx
        .insert(investigationSources)
        .values({
          assignmentId,
          type: dto.type,
          title: dto.title.trim(),
          locator: dto.locator ?? null,
          accessedAt: dto.accessedAt === undefined ? null : new Date(dto.accessedAt),
          reliability: dto.reliability ?? 'UNKNOWN',
          reliabilityRationale: dto.reliabilityRationale ?? null,
          shared: dto.shared ?? false,
          addedBy: actor.userId,
        })
        .returning();
      await this.record(actor, c, 'investigation_source.created', row!, `${row!.type}`, tx);
      return view(row!);
    });
  }

  async update(
    actor: Actor,
    assignmentId: string,
    sourceId: string,
    dto: UpdateSourceDto,
    req: RequestContext,
  ): Promise<SourceView> {
    const c = ctx('investigation_source.update', req, sourceId);
    await this.requireInvestigator(actor, c);

    return this.db.transaction(async (tx) => {
      const { assignment, source } = await this.holdSource(tx, actor, assignmentId, sourceId, c);
      await this.authz.stateAllows(actor, SOURCES_WRITABLE.has(assignment.status), c);

      const next = {
        type: dto.type ?? source.type,
        title: dto.title === undefined ? source.title : dto.title.trim(),
        locator: dto.locator === undefined ? source.locator : dto.locator,
        accessedAt: dto.accessedAt === undefined ? source.accessedAt : new Date(dto.accessedAt),
        reliability: dto.reliability ?? source.reliability,
        reliabilityRationale:
          dto.reliabilityRationale === undefined
            ? source.reliabilityRationale
            : dto.reliabilityRationale,
        shared: dto.shared ?? source.shared,
      };
      requireRationale(next.reliability, next.reliabilityRationale ?? undefined);

      // Names, not values: which fields moved is the trail; what they now say can name a person.
      const changed = (Object.keys(next) as Array<keyof typeof next>).filter(
        (k) => String(next[k]) !== String(source[k]),
      );
      if (changed.length === 0) return view(source);

      const [row] = await tx
        .update(investigationSources)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(investigationSources.id, sourceId))
        .returning();
      await this.record(
        actor,
        c,
        'investigation_source.updated',
        row!,
        `changed: ${changed.join(', ')}${changed.includes('shared') ? ` (now ${row!.shared ? 'shared' : 'private'})` : ''}`,
        tx,
      );
      return view(row!);
    });
  }

  /** Taken out of use and out of the customer's sight, and kept: evidence may cite it (T-116). */
  async withdraw(
    actor: Actor,
    assignmentId: string,
    sourceId: string,
    req: RequestContext,
  ): Promise<void> {
    const c = ctx('investigation_source.withdraw', req, sourceId);
    await this.requireInvestigator(actor, c);

    await this.db.transaction(async (tx) => {
      const { assignment, source } = await this.holdSource(tx, actor, assignmentId, sourceId, c);
      await this.authz.stateAllows(actor, SOURCES_WRITABLE.has(assignment.status), c);
      await tx
        .update(investigationSources)
        .set({ withdrawnAt: new Date(), updatedAt: new Date() })
        .where(eq(investigationSources.id, sourceId));
      await this.record(actor, c, 'investigation_source.withdrawn', source, `${source.type}`, tx);
    });
  }

  private async requireInvestigator(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigations.update', c);
  }

  /**
   * Either party to the assignment. Somebody who is neither matches nothing and gets the same 404
   * as an id that does not exist — the assignment's existence is not theirs to learn.
   */
  private async requireParty(actor: Actor, assignmentId: string, c: AuthzContext): Promise<void> {
    const [row] = await this.db
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
    await this.authz.visible(actor, row?.assignment, c);
  }

  /**
   * The assignment, share-locked, if this actor is its investigator. The lock is what stops a
   * source being added in the same instant the assignment completes: the transition takes the
   * row for update, and waits for this to commit.
   */
  private async holdAsInvestigator(
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
      .for('share', { of: assignments });
    return this.authz.visible(actor, row?.assignment, c);
  }

  /** A live source of this assignment, for its investigator. A withdrawn one is gone from here. */
  private async holdSource(
    tx: Tx,
    actor: Actor,
    assignmentId: string,
    sourceId: string,
    c: AuthzContext,
  ): Promise<{ assignment: AssignmentRow; source: SourceRow }> {
    const assignment = await this.holdAsInvestigator(tx, actor, assignmentId, c);
    const [source] = await tx
      .select()
      .from(investigationSources)
      .where(
        and(
          eq(investigationSources.id, sourceId),
          eq(investigationSources.assignmentId, assignmentId),
          isNull(investigationSources.withdrawnAt),
        ),
      )
      .for('update');
    return { assignment, source: await this.authz.visible(actor, source, c) };
  }

  private async record(
    actor: Actor,
    c: AuthzContext,
    action: string,
    source: SourceRow,
    what: string,
    tx: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        actorRole: 'INVESTIGATOR',
        action,
        resourceType: 'investigation_source',
        resourceId: source.id,
        reason: what,
      },
      tx,
    );
  }
}

/** A reliability judgement needs its reason; UNKNOWN is the honest default and needs none. */
function requireRationale(reliability: SourceRow['reliability'], rationale: string | undefined) {
  if (reliability !== 'UNKNOWN' && (rationale === undefined || rationale.trim().length === 0)) {
    throw AppError.validation([
      {
        field: 'reliabilityRationale',
        code: 'REQUIRED',
        messageKey: 'error.validation.investigation_source.rationale_required',
      },
    ]);
  }
}

const ctx = (action: string, req: RequestContext, resourceId?: string): AuthzContext => ({
  action,
  resourceType: 'investigation_source',
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});

const view = (s: SourceRow): SourceView => ({
  id: s.id,
  assignmentId: s.assignmentId,
  type: s.type,
  title: s.title,
  locator: s.locator,
  accessedAt: s.accessedAt?.toISOString() ?? null,
  reliability: s.reliability,
  reliabilityRationale: s.reliabilityRationale,
  shared: s.shared,
  addedBy: s.addedBy,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
