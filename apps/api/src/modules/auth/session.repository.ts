import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { ActorScopedRepository } from '../../common/authz/actor-scoped.repository';
import type { Actor } from '../../common/authz/contract';
import { DB, type Db } from '../../database/database.module';
import { userSessions } from '../../database/schema';

export type SessionRow = typeof userSessions.$inferSelect;

/**
 * Sessions, scoped to the person they belong to.
 *
 * The first consumer of ActorScopedRepository, and the reference for the pattern: what
 * makes a row "mine" is stated once, in `scopeFor`, and every read then goes through it.
 * Revoking someone else's session by id is not prevented by a comparison that could be
 * forgotten — the row is simply not in the result set.
 */
@Injectable()
export class SessionRepository extends ActorScopedRepository<SessionRow> {
  constructor(@Inject(DB) db: Db) {
    super(db, userSessions);
  }

  /**
   * Mine, and still live. Revoked rows are excluded here rather than filtered afterwards,
   * so a revoked session cannot be acted on through any read on this repository.
   *
   * Staff get no widening. Another person's sessions are not a moderation surface, and
   * were they ever to become one it would be a distinct, separately scoped query.
   */
  protected scopeFor(actor: Actor): SQL | undefined {
    return and(eq(userSessions.userId, actor.userId), isNull(userSessions.revokedAt));
  }
}
