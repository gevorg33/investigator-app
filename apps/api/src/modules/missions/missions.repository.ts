import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, type SQL } from 'drizzle-orm';
import { ActorScopedRepository } from '../../common/authz/actor-scoped.repository';
import type { Actor } from '../../common/authz/contract';
import { DB, type Db } from '../../database/database.module';
import { missions } from '../../database/schema';

export type MissionRow = typeof missions.$inferSelect;

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
}
