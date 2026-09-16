import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor, StaffScope } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { Tx } from '../../database/database.module';
import { missions, missionStatusHistory, outboxEvents } from '../../database/schema';
import {
  isTransitionAllowed,
  type MissionStatus,
  type TransitionAuthority,
} from './mission-transitions';

/** Who is moving the mission. The caller has already established their relationship to it. */
export type TransitionBy =
  | { kind: 'CUSTOMER' | 'INVESTIGATOR'; actor: Actor }
  | { kind: 'STAFF'; actor: Actor; scope: StaffScope }
  | { kind: 'SYSTEM' };

/** The mission as read under a row lock in the same transaction. */
export interface LockedMission {
  id: string;
  status: MissionStatus;
  version: number;
}

export interface TransitionMeta {
  /** Why. Shown in the mission's history; free text, so never copied into the audit log. */
  reason?: string | undefined;
  correlationId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/** Columns that change together with a status, and only ever as part of a transition. */
export type TransitionFields = Partial<
  Pick<typeof missions.$inferInsert, 'lawfulPurposeConfirmedAt' | 'submittedAt'>
>;

const authorityOf = (by: TransitionBy): TransitionAuthority =>
  by.kind === 'STAFF' ? `STAFF:${by.scope}` : by.kind;

/**
 * The only code that writes `missions.status` — a static test fails the build if anything
 * else does.
 *
 * In the caller's transaction it: checks the move against the map, checks the performer's
 * authority for it, writes the status, appends history, appends the audit entry, and appends
 * the outbox event. All six commit together or not at all (mission-state-machine).
 *
 * Concurrency has two guards. Callers read the row `FOR UPDATE`, so a second transition waits
 * and then sees the first one's result. And the UPDATE matches on the version and status that
 * were read, so a caller that skipped the lock fails rather than overwrites.
 */
@Injectable()
export class MissionTransitionService {
  constructor(
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  async apply(
    tx: Tx,
    mission: LockedMission,
    to: MissionStatus,
    by: TransitionBy,
    meta: TransitionMeta = {},
    fields: TransitionFields = {},
  ): Promise<LockedMission> {
    const ctx: AuthzContext = {
      action: `mission.transition.${to.toLowerCase()}`,
      resourceType: 'mission',
      resourceId: mission.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
    };

    // Defence in depth: a STAFF performer is only as good as the scope it actually holds.
    if (by.kind === 'STAFF') await this.authz.requireStaffScope(by.actor, by.scope, ctx);

    if (!isTransitionAllowed(mission.status, to, authorityOf(by))) {
      // A person asking for an illegal move is refused, and the refusal is audited. The system
      // asking for one is a bug or a race it lost, and says so.
      if (by.kind === 'SYSTEM') throw AppError.stateConflict();
      await this.authz.stateAllows(by.actor, false, ctx);
    }

    const [moved] = await tx
      .update(missions)
      .set({ ...fields, status: to, version: mission.version + 1, updatedAt: new Date() })
      .where(
        and(
          eq(missions.id, mission.id),
          eq(missions.version, mission.version),
          eq(missions.status, mission.status),
        ),
      )
      .returning({ id: missions.id, status: missions.status, version: missions.version });
    if (!moved) throw AppError.stateConflict();

    const actorId = by.kind === 'SYSTEM' ? null : by.actor.userId;
    await tx.insert(missionStatusHistory).values({
      missionId: mission.id,
      fromStatus: mission.status,
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
        action: 'mission.status_changed',
        resourceType: 'mission',
        resourceId: mission.id,
        reason: `${mission.status}->${to}`,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      tx,
    );
    await tx.insert(outboxEvents).values({
      aggregateType: 'mission',
      aggregateId: mission.id,
      eventType: 'mission.status_changed',
      payload: { missionId: mission.id, from: mission.status, to, version: moved.version },
      correlationId: meta.correlationId ?? null,
    });

    return moved;
  }
}
