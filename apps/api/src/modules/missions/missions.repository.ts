import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray, type SQL } from 'drizzle-orm';
import { ActorScopedRepository } from '../../common/authz/actor-scoped.repository';
import type { Actor } from '../../common/authz/contract';
import { DB, type Db } from '../../database/database.module';
import { missions, missionStatusHistory } from '../../database/schema';

export type MissionRow = typeof missions.$inferSelect;

/**
 * A moderator's outcome as the customer reads it: rejected, or returned for changes, with the
 * moderator's reason and when.
 */
export interface MissionReview {
  outcome: 'REJECTED' | 'CHANGES_REQUESTED';
  reason: string | null;
  decidedAt: Date;
}

/**
 * A customer's own missions.
 *
 * There is no repository here for reading anyone else's. Investigators see published missions
 * through discovery (T-054) and moderators through the review queue (T-051) — both different
 * questions with different result shapes, and neither reachable by passing a flag to this one.
 */
@Injectable()
export class OwnMissionRepository extends ActorScopedRepository<MissionRow> {
  constructor(@Inject(DB) db: Db) {
    super(db, missions);
  }

  protected scopeFor(actor: Actor): SQL {
    return eq(missions.customerId, actor.userId);
  }

  /** The caller's missions, newest first. */
  async listMine(actor: Actor): Promise<MissionRow[]> {
    return this.db
      .select()
      .from(missions)
      .where(this.scopeFor(actor))
      .orderBy(desc(missions.createdAt));
  }

  /**
   * The moderator's outcome that left each mission where it is, while it still does.
   *
   * Only a mission's **latest** move counts, and only when a moderator made it out of review:
   * once the customer resubmits or cancels, the old outcome no longer describes the mission.
   * Screening's own move into review carries an internal reason (`PRIORITY_REVIEW:HIGH`); it is a
   * SYSTEM move, so it never qualifies — the customer is told a moderator's words, never the
   * detection.
   *
   * Takes rows already read through {@link listMine} or `findOneForActor`, so it can only ever
   * be asked about the caller's own missions.
   */
  async reviewsOf(rows: readonly MissionRow[]): Promise<Map<string, MissionReview>> {
    const out = new Map<string, MissionReview>();
    if (rows.length === 0) return out;
    const h = missionStatusHistory;
    const latest = await this.db
      .selectDistinctOn([h.missionId])
      .from(h)
      .where(
        inArray(
          h.missionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(h.missionId, desc(h.occurredAt));
    for (const move of latest) {
      if (move.actorKind !== 'STAFF' || move.fromStatus !== 'UNDER_REVIEW') continue;
      if (move.toStatus !== 'REJECTED' && move.toStatus !== 'DRAFT') continue;
      out.set(move.missionId, {
        outcome: move.toStatus === 'REJECTED' ? 'REJECTED' : 'CHANGES_REQUESTED',
        reason: move.reason,
        decidedAt: move.occurredAt,
      });
    }
    return out;
  }
}
