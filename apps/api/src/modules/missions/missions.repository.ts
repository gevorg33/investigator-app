import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
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

/** A mission's tags as its customer reads them: what they suggested, and what it was published with. */
export interface MissionTagIds {
  suggested: string[];
  confirmed: string[];
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
   * Each mission's tags, by mission: those the customer suggested (T-055), in the order suggested,
   * and those a moderator confirmed at publication (T-194), in the order confirmed. One tag may be
   * both; one the moderator added was never suggested. A confirmed tag merged since is given as the
   * tag it became — what investigators now find the mission under (`tag-closure.ts` walks the other
   * way) — and a tag reached twice is given once. Takes rows already read as the caller's own, as
   * {@link reviewsOf} does.
   */
  async tagsOf(rows: readonly MissionRow[], tx?: Tx): Promise<Map<string, MissionTagIds>> {
    const out = new Map<string, MissionTagIds>(
      rows.map((r) => [r.id, { suggested: [], confirmed: [] }]),
    );
    if (rows.length === 0) return out;
    const found = await (tx ?? this.db)
      .select({
        missionId: missionTags.missionId,
        tagId: missionTags.tagId,
        suggestedAt: missionTags.suggestedAt,
        confirmedAt: missionTags.confirmedAt,
      })
      .from(missionTags)
      .where(
        inArray(
          missionTags.missionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(missionTags.missionId, missionTags.tagId);
    const byTime = (at: (t: (typeof found)[number]) => Date | null) =>
      found.filter((t) => at(t) !== null).sort((a, b) => at(a)!.getTime() - at(b)!.getTime());
    for (const t of byTime((t) => t.suggestedAt)) out.get(t.missionId)!.suggested.push(t.tagId);
    const confirmed = byTime((t) => t.confirmedAt);
    const became = await this.mergedInto(
      confirmed.map((t) => t.tagId),
      tx,
    );
    for (const t of confirmed) {
      const into = out.get(t.missionId)!.confirmed;
      const now = became.get(t.tagId)!;
      if (!into.includes(now)) into.push(now);
    }
    return out;
  }

  /** Each tag as the one it has since become, following merges to the end; unmerged, itself. */
  private async mergedInto(tagIds: string[], tx?: Tx): Promise<Map<string, string>> {
    if (tagIds.length === 0) return new Map();
    const ids = sql.join(
      [...new Set(tagIds)].map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = (await (tx ?? this.db).execute(sql`
      WITH RECURSIVE chain AS (
        SELECT id AS start, id, merged_into_id FROM tags WHERE id IN (${ids})
        UNION
        SELECT c.start, t.id, t.merged_into_id FROM tags t JOIN chain c ON t.id = c.merged_into_id
      )
      SELECT start, id FROM chain WHERE merged_into_id IS NULL`)) as unknown as Array<{
      start: string;
      id: string;
    }>;
    return new Map(rows.map((r) => [r.start, r.id]));
  }
}
