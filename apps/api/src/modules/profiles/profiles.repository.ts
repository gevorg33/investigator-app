import { Inject, Injectable } from '@nestjs/common';
import { eq, type SQL } from 'drizzle-orm';
import { ActorScopedRepository } from '../../common/authz/actor-scoped.repository';
import type { Actor } from '../../common/authz/contract';
import { DB, type Db } from '../../database/database.module';
import { customerProfiles, investigatorProfiles } from '../../database/schema';

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

  protected scopeFor(actor: Actor): SQL | undefined {
    return eq(investigatorProfiles.userId, actor.userId);
  }

  /** The owner's profile, found by who they are rather than by an id they supply. */
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
