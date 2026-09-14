import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { ActorScopedRepository } from '../../common/authz/actor-scoped.repository';
import type { Actor } from '../../common/authz/contract';
import { DB, type Db } from '../../database/database.module';
import { mediaAssets } from '../../database/schema';

export type MediaAssetRow = typeof mediaAssets.$inferSelect;

/** The caller's own uploads. Completing an upload is an owner-only operation. */
@Injectable()
export class OwnMediaRepository extends ActorScopedRepository<MediaAssetRow> {
  constructor(@Inject(DB) db: Db) {
    super(db, mediaAssets);
  }

  protected scopeFor(actor: Actor): SQL | undefined {
    return and(eq(mediaAssets.ownerId, actor.userId), isNull(mediaAssets.deletedAt));
  }
}

/**
 * Files this actor may be given a delivery link for.
 *
 * - The owner, for anything they uploaded.
 * - Staff holding the VERIFICATION scope, for verification documents — and only while acting
 *   as staff. Someone who is both staff and a customer does not carry staff access into
 *   their customer workspace.
 *
 * Deliberately absent: anyone else seeing a PUBLIC_PROFILE image. Serving one to another
 * user must respect the profile's published state — a draft profile's photo must be as
 * invisible as the draft — and that link does not exist yet. Until it does, those images are
 * owner-only, which fails closed.
 */
@Injectable()
export class ViewableMediaRepository extends ActorScopedRepository<MediaAssetRow> {
  constructor(@Inject(DB) db: Db) {
    super(db, mediaAssets);
  }

  protected scopeFor(actor: Actor): SQL | undefined {
    const rules: SQL[] = [eq(mediaAssets.ownerId, actor.userId)];
    const actingAsStaff = actor.activeRole === undefined || actor.activeRole === 'STAFF';
    if (actingAsStaff && actor.roles.includes('STAFF') && actor.staffScopes.includes('VERIFICATION')) {
      rules.push(eq(mediaAssets.category, 'VERIFICATION_DOCUMENT'));
    }
    return and(isNull(mediaAssets.deletedAt), or(...rules));
  }
}
