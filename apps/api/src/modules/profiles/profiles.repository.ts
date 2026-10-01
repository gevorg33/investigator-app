import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { ActorScopedRepository } from '../../common/authz/actor-scoped.repository';
import type { Actor } from '../../common/authz/contract';
import { DB, type Db } from '../../database/database.module';
import { customerProfiles, investigatorProfiles } from '../../database/schema';

/** The workspace the request acts in — from the context, never from code (tenancy.md §6). */
const THIS_WORKSPACE = sql`app_current_tenant()`;

export type InvestigatorProfileRow = typeof investigatorProfiles.$inferSelect;
export type CustomerProfileRow = typeof customerProfiles.$inferSelect;

/**
 * An investigator's own profile.
 *
 * Scoped to the owner. Reading somebody else's profile is a different operation with a
 * different result shape — the public projection — and goes through a separate, deliberately
 * named method rather than this one with a flag. A boolean parameter deciding how much of a
 * row a caller sees is one typo away from showing everything.
 */
@Injectable()
export class OwnInvestigatorProfileRepository extends ActorScopedRepository<InvestigatorProfileRow> {
  constructor(@Inject(DB) db: Db) {
    super(db, investigatorProfiles);
  }

  /**
   * Theirs, and in the workspace the request acts in (T-087). A person may hold a profile in their
   * Personal workspace and another in each agency, and a published one is readable from every
   * workspace — so without the second half, a request in an agency could pick up their Personal
   * profile and act with it there.
   */
  protected scopeFor(actor: Actor): SQL | undefined {
    return and(
      eq(investigatorProfiles.userId, actor.userId),
      eq(investigatorProfiles.tenantId, THIS_WORKSPACE),
    );
  }

  /** The owner's profile here, found by who they are rather than by an id they supply. */
  async findMine(actor: Actor): Promise<InvestigatorProfileRow | undefined> {
    const rows = await this.findAllForActor(actor);
    return rows[0];
  }
}

@Injectable()
export class OwnCustomerProfileRepository extends ActorScopedRepository<CustomerProfileRow> {
  constructor(@Inject(DB) db: Db) {
    super(db, customerProfiles);
  }

  protected scopeFor(actor: Actor): SQL | undefined {
    return eq(customerProfiles.userId, actor.userId);
  }

  async findMine(actor: Actor): Promise<CustomerProfileRow | undefined> {
    const rows = await this.findAllForActor(actor);
    return rows[0];
  }
}
