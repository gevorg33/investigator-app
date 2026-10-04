import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  assignments,
  legalHolds,
  mediaAssets,
  missions,
  tenants,
  users,
} from '../../database/schema';
import type {
  LegalHoldListQueryDto,
  PlaceLegalHoldDto,
  ReleaseLegalHoldDto,
} from './legal-hold.dto';
import {
  clampLimit,
  decodeHoldCursor,
  encodeHoldCursor,
  type LegalHoldResource,
} from './legal-hold.policy';

/** A hold as COMPLIANCE staff read it. */
export interface LegalHoldView {
  id: string;
  resourceType: LegalHoldResource;
  resourceId: string;
  reason: string;
  placedBy: string;
  placedAt: Date;
  /** Null while the hold is in force. */
  release: { at: Date; by: string; reason: string } | null;
}

export interface LegalHoldPage {
  items: LegalHoldView[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/** Where each kind of resource lives, so a hold is never placed on an id that names nothing. */
const RESOURCE_TABLES: Record<LegalHoldResource, { table: PgTable; id: PgColumn }> = {
  USER: { table: users, id: users.id },
  TENANT: { table: tenants, id: tenants.id },
  MISSION: { table: missions, id: missions.id },
  ASSIGNMENT: { table: assignments, id: assignments.id },
  MEDIA_ASSET: { table: mediaAssets, id: mediaAssets.id },
};

/**
 * Legal holds (T-035): placing one, releasing one, and reading them — COMPLIANCE staff only, each
 * call its own crossing into `PlatformContext`, since what a hold names may be in any workspace.
 *
 * Placing is checked against the resource existing, and nothing else: a hold preserves data, so the
 * cost of an unnecessary one is storage, while the cost of a refused one is evidence lost. Releasing
 * is the deliberate act — its own reason, its own audit row, and once only (409 after that).
 *
 * What a hold does is `RetentionGuard`'s: every retention deletion goes through it.
 */
@Injectable()
export class LegalHoldService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly platform: PlatformContext,
    private readonly audit: AuditService,
  ) {}

  /** Holds, newest first: in force unless asked otherwise, optionally on one resource. */
  async list(
    actor: Actor,
    query: LegalHoldListQueryDto,
    req: RequestContext,
  ): Promise<LegalHoldPage> {
    const c = this.ctx('legal_hold.list', req);
    await this.requireCompliance(actor, c);
    if ((query.resourceType === undefined) !== (query.resourceId === undefined)) {
      throw AppError.validation([
        {
          field: query.resourceType === undefined ? 'resourceType' : 'resourceId',
          code: 'REQUIRED_TOGETHER',
          messageKey: 'error.validation.legal_hold.resource_pair',
        },
      ]);
    }

    return this.platform.asStaff(
      actor,
      { scope: 'COMPLIANCE', purpose: 'legal_hold.list' },
      req,
      async () => {
        const limit = clampLimit(query.limit);
        const after = query.cursor === undefined ? undefined : decodeHoldCursor(query.cursor);
        const status = query.status ?? 'ACTIVE';

        const where: SQL[] = [];
        if (status === 'ACTIVE') where.push(isNull(legalHolds.releasedAt));
        if (status === 'RELEASED') where.push(isNotNull(legalHolds.releasedAt));
        if (query.resourceType !== undefined && query.resourceId !== undefined) {
          where.push(eq(legalHolds.resourceType, query.resourceType));
          where.push(eq(legalHolds.resourceId, query.resourceId));
        }
        if (after !== undefined) {
          where.push(
            or(
              lt(legalHolds.placedAt, after.at),
              and(eq(legalHolds.placedAt, after.at), lt(legalHolds.id, after.id)),
            )!,
          );
        }

        const rows = await this.db
          .select()
          .from(legalHolds)
          .where(and(...where))
          .orderBy(desc(legalHolds.placedAt), desc(legalHolds.id))
          .limit(limit + 1);

        const hasNextPage = rows.length > limit;
        const items = rows.slice(0, limit).map(view);
        const last = items.at(-1);
        return {
          items,
          pageInfo: {
            nextCursor:
              hasNextPage && last !== undefined
                ? encodeHoldCursor({ at: last.placedAt, id: last.id })
                : null,
            hasNextPage,
          },
        };
      },
    );
  }

  /** Places a hold in force on one resource that exists. */
  async place(actor: Actor, dto: PlaceLegalHoldDto, req: RequestContext): Promise<LegalHoldView> {
    const c = this.ctx('legal_hold.place', req);
    await this.requireCompliance(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'COMPLIANCE', purpose: 'legal_hold.place' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          if (!(await this.exists(tx, dto.resourceType, dto.resourceId))) {
            throw AppError.notFound();
          }
          const [hold] = await tx
            .insert(legalHolds)
            .values({
              resourceType: dto.resourceType,
              resourceId: dto.resourceId,
              reason: dto.reason.trim(),
              placedBy: actor.userId,
            })
            .returning();
          await this.record(actor, c, 'legal_hold.placed', hold!, tx);
          return view(hold!);
        }),
    );
  }

  /** Releases a hold in force, with a reason. A hold already released is a conflict. */
  async release(
    actor: Actor,
    holdId: string,
    dto: ReleaseLegalHoldDto,
    req: RequestContext,
  ): Promise<LegalHoldView> {
    const c = this.ctx('legal_hold.release', req, holdId);
    await this.requireCompliance(actor, c);

    return this.platform.asStaff(
      actor,
      { scope: 'COMPLIANCE', purpose: 'legal_hold.release' },
      req,
      () =>
        this.db.transaction(async (tx) => {
          const [hold] = await tx
            .select()
            .from(legalHolds)
            .where(eq(legalHolds.id, holdId))
            .for('update');
          if (hold === undefined) throw AppError.notFound();
          if (hold.releasedAt !== null) throw AppError.stateConflict();

          const reason = dto.reason.trim();
          const [released] = await tx
            .update(legalHolds)
            .set({
              // Never before it was placed — a wall clock is not monotonic (T-167), and the CHECK
              // forbidding the reverse is the backstop.
              releasedAt: sql`greatest(now(), ${legalHolds.placedAt})`,
              releasedBy: actor.userId,
              releaseReason: reason,
            })
            .where(eq(legalHolds.id, holdId))
            .returning();
          await this.record(actor, c, 'legal_hold.released', released!, tx);
          return view(released!);
        }),
    );
  }

  private async exists(tx: Tx, type: LegalHoldResource, id: string): Promise<boolean> {
    const { table, id: column } = RESOURCE_TABLES[type];
    const rows = await tx.select({ id: column }).from(table).where(eq(column, id)).limit(1);
    return rows.length > 0;
  }

  private async requireCompliance(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'STAFF', c);
    await this.authz.requireStaffScope(actor, 'COMPLIANCE', c);
  }

  private async record(
    actor: Actor,
    c: AuthzContext,
    action: 'legal_hold.placed' | 'legal_hold.released',
    hold: typeof legalHolds.$inferSelect,
    tx: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        actorRole: 'STAFF',
        staffScope: 'COMPLIANCE',
        action,
        resourceType: 'legal_hold',
        resourceId: hold.id,
        // What is held, by reference. The reasons stay on the hold, which only platform access
        // reads: they can name a case or a person, and an audit row is no place for either.
        reason: `${hold.resourceType} ${hold.resourceId}`,
      },
      tx,
    );
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'legal_hold',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

const view = (h: typeof legalHolds.$inferSelect): LegalHoldView => ({
  id: h.id,
  resourceType: h.resourceType,
  resourceId: h.resourceId,
  reason: h.reason,
  placedBy: h.placedBy,
  placedAt: h.placedAt,
  release:
    h.releasedAt === null
      ? null
      : { at: h.releasedAt, by: h.releasedBy!, reason: h.releaseReason! },
});
