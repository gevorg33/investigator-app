import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../../database/database.module';
import type { Actor } from './contract';

/**
 * Base for any repository over rows that belong to somebody.
 *
 * The authorization skill's query rule is that the actor's scope belongs *in the query*,
 * not in a comparison afterwards:
 *
 * ```ts
 * // Wrong: reads someone else's row, then decides.
 * const row = await repo.findById(id);
 * if (row.customerId !== actor.userId) throw forbidden();
 *
 * // Right: the scope is part of the query, and a miss is simply a miss.
 * const row = await repo.findOneForActor(actor, id);
 * ```
 *
 * The wrong form fails open. A forgotten branch, an early return, a refactor that moves
 * the comparison — any of them leaves the row already fetched and in hand. The right form
 * has no such failure: the row never leaves the database.
 *
 * This class has no `findById`. That is the design. Every read here demands an Actor, so
 * fetching unscoped means leaving the repository and touching `db` directly — which is
 * conspicuous in review rather than something that blends in.
 *
 * Subclasses answer one question: what makes a row this actor's?
 */
export abstract class ActorScopedRepository<TRow> {
  protected constructor(
    protected readonly db: Db,
    protected readonly table: PgTable & { id: PgColumn },
  ) {}

  /**
   * The predicate that limits rows to this actor.
   *
   * Returning `undefined` means "no restriction" and is therefore a decision to expose
   * every row — only ever right for a staff scope that genuinely spans the table, and
   * worth a comment at the override when it is.
   */
  protected abstract scopeFor(actor: Actor): SQL | undefined;

  /**
   * One row, if it is this actor's.
   *
   * `undefined` deliberately conflates "does not exist" with "not yours". The caller
   * passes it to `AuthzService.visible`, which turns both into the same 404 — so an id
   * cannot be confirmed by the shape of the refusal.
   */
  async findOneForActor(actor: Actor, id: string): Promise<TRow | undefined> {
    const scope = this.scopeFor(actor);
    const predicate =
      scope === undefined ? eq(this.table.id, id) : and(eq(this.table.id, id), scope);
    const rows = (await this.db.select().from(this.table).where(predicate).limit(1)) as TRow[];
    return rows[0];
  }

  /** Every row this actor may see. Same predicate, without the id. */
  async findAllForActor(actor: Actor): Promise<TRow[]> {
    const scope = this.scopeFor(actor);
    const q = this.db.select().from(this.table);
    return (scope === undefined ? await q : await q.where(scope)) as TRow[];
  }
}
