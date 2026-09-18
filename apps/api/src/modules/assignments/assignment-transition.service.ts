import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor, StaffScope } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { Tx } from '../../database/database.module';
import { assignments, assignmentStatusHistory, outboxEvents } from '../../database/schema';
import {
  isTransitionAllowed,
  type AssignmentStatus,
  type TransitionAuthority,
} from './assignment-transitions';

/** Who is moving the assignment. The caller has established their relationship to it. */
export type TransitionBy =
  | { kind: 'CUSTOMER' | 'INVESTIGATOR'; actor: Actor }
  | { kind: 'STAFF'; actor: Actor; scope: StaffScope }
  | { kind: 'SYSTEM' };

/** The assignment as read under a row lock in the same transaction. */
export interface LockedAssignment {
  id: string;
  status: AssignmentStatus;
  version: number;
}

export interface TransitionMeta {
  /** Why. Shown in the assignment's history; free text, so never copied into the audit log. */
  reason?: string | undefined;
  correlationId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/** Columns that change together with a status, and only ever as part of a transition. */
export type TransitionFields = Partial<Pick<typeof assignments.$inferInsert, 'acceptedAt'>>;

const authorityOf = (by: TransitionBy): TransitionAuthority =>
  by.kind === 'STAFF' ? `STAFF:${by.scope}` : by.kind;

/**
 * The only code that writes `assignments.status` — a static test fails the build if anything
 * else does, exactly as for missions.
 *
 * In the caller's transaction it checks the move against the map, checks the performer's
 * authority for it, writes the status, appends history, appends the audit entry and appends
 * the outbox event. All of it commits together or not at all.
 *
 * Concurrency has the same two guards as the mission machine: callers read the row
 * `FOR UPDATE`, and the UPDATE additionally matches the version and status that were read, so
 * a caller that skipped the lock fails rather than overwrites.
 */
@Injectable()
export class AssignmentTransitionService {
  constructor(
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  async apply(
    tx: Tx,
    assignment: LockedAssignment,
    to: AssignmentStatus,
    by: TransitionBy,
    meta: TransitionMeta = {},
    fields: TransitionFields = {},
  ): Promise<LockedAssignment> {
    const ctx: AuthzContext = {
      action: `assignment.transition.${to.toLowerCase()}`,
      resourceType: 'assignment',
      resourceId: assignment.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
    };

    // Defence in depth: a STAFF performer is only as good as the scope it actually holds.
    if (by.kind === 'STAFF') await this.authz.requireStaffScope(by.actor, by.scope, ctx);

    if (!isTransitionAllowed(assignment.status, to, authorityOf(by))) {
      // A person asking for an illegal move is refused, and the refusal is audited. The system
      // asking for one is a bug or a race it lost, and says so.
      if (by.kind === 'SYSTEM') throw AppError.stateConflict();
      await this.authz.stateAllows(by.actor, false, ctx);
    }

    const [moved] = await tx
      .update(assignments)
      .set({ ...fields, status: to, version: assignment.version + 1, updatedAt: new Date() })
      .where(
        and(
          eq(assignments.id, assignment.id),
          eq(assignments.version, assignment.version),
          eq(assignments.status, assignment.status),
        ),
      )
      .returning({
        id: assignments.id,
        status: assignments.status,
        version: assignments.version,
      });
    if (!moved) throw AppError.stateConflict();

    const actorId = by.kind === 'SYSTEM' ? null : by.actor.userId;
    await tx.insert(assignmentStatusHistory).values({
      assignmentId: assignment.id,
      fromStatus: assignment.status,
      toStatus: to,
      actorKind: by.kind,
      actorId,
      staffScope: by.kind === 'STAFF' ? by.scope : null,
      reason: meta.reason ?? null,
    });
    await this.audit.record(
      {
        actorId: actorId ?? undefined,
        actorRole: by.kind === 'STAFF' ? `STAFF:${by.scope}` : by.kind,
        action: 'assignment.status_changed',
        resourceType: 'assignment',
        resourceId: assignment.id,
        reason: `${assignment.status}->${to}`,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      tx,
    );
    await tx.insert(outboxEvents).values({
      aggregateType: 'assignment',
      aggregateId: assignment.id,
      eventType: 'assignment.status_changed',
      payload: { assignmentId: assignment.id, from: assignment.status, to, version: moved.version },
      correlationId: meta.correlationId ?? null,
    });

    return moved;
  }
}
