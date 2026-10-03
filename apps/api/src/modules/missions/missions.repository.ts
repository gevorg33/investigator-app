import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import { ActorScopedRepository } from '../../common/authz/actor-scoped.repository';
import type { Actor } from '../../common/authz/contract';
import { DB, type Db, type Tx } from '../../database/database.module';
import { missions, missionStatusHistory, missionTags } from '../../database/schema';

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
      // The last move written, not the one with the latest clock: moves in one transaction share a
      // time, and the clock can step back between two (T-155).
      .orderBy(h.missionId, desc(h.seq));
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

  /**
   * The tags the customer suggested on each mission (T-055), by mission, in the order suggested.
   * Takes rows already read as the caller's own, as {@link reviewsOf} does.
   */
  async suggestedTagsOf(rows: readonly MissionRow[], tx?: Tx): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>(rows.map((r) => [r.id, []]));
    if (rows.length === 0) return out;
    const found = await (tx ?? this.db)
      .select({ missionId: missionTags.missionId, tagId: missionTags.tagId })
      .from(missionTags)
      .where(
        and(
          inArray(
            missionTags.missionId,
            rows.map((r) => r.id),
          ),
          isNotNull(missionTags.suggestedAt),
        ),
      )
      .orderBy(missionTags.missionId, missionTags.suggestedAt, missionTags.tagId);
    for (const t of found) out.get(t.missionId)!.push(t.tagId);
    return out;
  }
}
