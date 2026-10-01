import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, max, or } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  assignments,
  investigatorProfiles,
  missions,
  quotes,
  userBlocks,
  users,
} from '../../database/schema';

/** An assignment still under way: the block leaves it running, and staff decide what happens. */
export const LIVE_ASSIGNMENT = [
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'IN_PROGRESS',
  'REPORT_SUBMITTED',
  'SUSPENDED',
] as const;

/**
 * How many people blocking one account makes a pattern staff should look at (provisional — the
 * number is a starting point for trust and safety to tune, not a finding about anyone).
 */
export const BLOCK_SIGNAL_THRESHOLD = 3;

export type BlockSource = 'profile' | 'mission' | 'assignment';

/** Where the blocker is when they block — exactly one. */
export interface BlockTarget {
  investigatorProfileId?: string | undefined;
  missionId?: string | undefined;
  assignmentId?: string | undefined;
}

export interface BlockView {
  id: string;
  source: BlockSource;
  /**
   * The name the blocker could see when they blocked: an investigator's pseudonym (T-181), null when
   * they had none; none for a customer blocked from a mission.
   */
  label: string | null;
  /** The blocked person's investigator profile, when they have one. */
  investigatorProfileId: string | null;
  createdAt: Date;
}

export interface BlockResult extends BlockView {
  /** Assignments still under way between the two: they continue, and staff have them. */
  liveAssignments: number;
}

export interface LiveAssignmentFlag {
  blockId: string;
  blockedAt: Date;
  /** Which side blocked. The staff member sees both parties' assignment. */
  blockedBy: 'CUSTOMER' | 'INVESTIGATOR';
  assignmentId: string;
  assignmentStatus: string;
}

export interface BlockSignal {
  userId: string;
  blockedBy: number;
  lastBlockedAt: Date;
}

const STAFF_LIST_LIMIT = 100;

/**
 * Blocking (T-052): one person refusing future engagement with another.
 *
 * What a block takes away is held by the database — `app_blocked_users()` in the missions and
 * quotes policies and in discovery (migration 0034) — so this service decides only whom a block
 * names, records it, and follows through on what the blocker had already set going:
 *
 * - an investigator's own open quotes to the person they block are withdrawn, as they could have
 *   withdrawn them themselves — the customer sees an ordinary withdrawal;
 * - an assignment under way between the two is **not** touched. Blocking must never be a way to
 *   walk away from work owed or a payment due; it goes to staff, who decide.
 *
 * Private: nothing the blocked person can do returns anything different because of it.
 */
@Injectable()
export class BlocksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly platform: PlatformContext,
  ) {}

  async block(actor: Actor, target: BlockTarget, req: RequestContext): Promise<BlockResult> {
    const c = ctx('block.create', 'user_block', req);
    await this.authz.requireActive(actor, c);
    const named = await this.named(actor, target, c);
    if (named.userId === actor.userId) {
      throw AppError.validation([
        { field: 'target', code: 'SELF', messageKey: 'error.validation.block.self' },
      ]);
    }

    // What the blocker can see is settled above, in their own workspace. What follows reaches
    // quotes and assignments in whichever workspaces the two of them work in, so it runs in the
    // audited system context — still as this person, whose ids fill the block's defaults.
    return this.platform.asSystem('block.follow_through', req, () =>
      this.db.transaction(async (tx) => {
        // Never the caller: an assignment's investigator is never its customer (T-142), and
        // `user_blocks_not_self` refuses it regardless.
        const other = named.userId ?? (await investigatorOf(tx, named.profileId!));
        const [profile] = await tx
          .select({ id: investigatorProfiles.id, pseudonym: investigatorProfiles.pseudonym })
          .from(investigatorProfiles)
          .where(eq(investigatorProfiles.userId, other));
        // The name the blocker could see. An investigator is known to customers by the pseudonym
        // they chose, never their legal name (T-181) — null until chosen. A customer blocked from a
        // mission is anonymous (T-100); one blocked from an assignment was named to the investigator
        // who was hired.
        const asInvestigator = named.source === 'profile' || named.profileId !== undefined;
        const label = asInvestigator
          ? // Their profile was found just above: an investigator was named by it.
            profile!.pseudonym
          : named.source === 'mission'
            ? null
            : // The customer's account row exists (the assignment references it); its name may not.
              (
                await tx.select({ name: users.displayName }).from(users).where(eq(users.id, other))
              )[0]!.name;

        const [made] = await tx
          .insert(userBlocks)
          .values({
            blockedId: other,
            blockedProfileId: profile?.id ?? null,
            source: named.source,
            label,
          })
          .onConflictDoNothing()
          .returning();
        const [row] =
          made === undefined
            ? await tx
                .select()
                .from(userBlocks)
                .where(and(eq(userBlocks.blockerId, actor.userId), eq(userBlocks.blockedId, other)))
            : [made];

        // Done again on a repeat, so a block whose follow-through failed half-way is finished by
        // blocking again.
        await this.withdrawOpenQuotes(tx, actor, other, req);
        const live = await liveBetween(tx, actor.userId, other);
        if (made !== undefined) {
          await this.record(tx, actor, req, 'user.blocked', 'user', other);
          for (const assignment of live) {
            await this.record(tx, actor, req, 'block.live_assignment', 'assignment', assignment.id);
          }
        }
        return { ...view(row!), liveAssignments: live.length };
      }),
    );
  }

  /** The caller's own blocks, newest first. */
  async list(actor: Actor, req: RequestContext): Promise<BlockView[]> {
    await this.authz.requireActive(actor, ctx('block.list', 'user_block', req));
    const rows = await this.db
      .select()
      .from(userBlocks)
      .orderBy(desc(userBlocks.createdAt), desc(userBlocks.id));
    return rows.map(view);
  }

  /** Removes one of the caller's blocks. Anyone else's reads as one that does not exist. */
  async unblock(actor: Actor, blockId: string, req: RequestContext): Promise<void> {
    const c = ctx('block.remove', 'user_block', req, blockId);
    await this.authz.requireActive(actor, c);
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(userBlocks)
        .where(eq(userBlocks.id, blockId))
        .returning({ blockedId: userBlocks.blockedId });
      if (removed === undefined) throw AppError.notFound();
      await this.record(tx, actor, req, 'user.unblocked', 'user', removed.blockedId);
    });
  }

  /** Blocks made while an assignment between the two is still under way (dispute staff). */
  async liveAssignments(actor: Actor, req: RequestContext): Promise<LiveAssignmentFlag[]> {
    const c = ctx('block.live_assignments', 'user_block', req);
    await this.authz.requireActive(actor, c);
    return this.platform.asStaff(
      actor,
      { scope: 'DISPUTES', purpose: 'block.live_assignments' },
      req,
      async () => {
        const rows = await this.db
          .select({
            blockId: userBlocks.id,
            blockedAt: userBlocks.createdAt,
            blocker: userBlocks.blockerId,
            customer: assignments.customerId,
            assignmentId: assignments.id,
            assignmentStatus: assignments.status,
          })
          .from(userBlocks)
          .innerJoin(
            investigatorProfiles,
            or(
              eq(investigatorProfiles.userId, userBlocks.blockerId),
              eq(investigatorProfiles.userId, userBlocks.blockedId),
            ),
          )
          .innerJoin(
            assignments,
            and(
              eq(assignments.investigatorProfileId, investigatorProfiles.id),
              inArray(assignments.status, [...LIVE_ASSIGNMENT]),
              or(
                and(
                  eq(assignments.customerId, userBlocks.blockerId),
                  eq(investigatorProfiles.userId, userBlocks.blockedId),
                ),
                and(
                  eq(assignments.customerId, userBlocks.blockedId),
                  eq(investigatorProfiles.userId, userBlocks.blockerId),
                ),
              ),
            ),
          )
          .orderBy(userBlocks.createdAt, assignments.id)
          .limit(STAFF_LIST_LIMIT);
        return rows.map((r) => ({
          blockId: r.blockId,
          blockedAt: r.blockedAt,
          blockedBy: r.blocker === r.customer ? ('CUSTOMER' as const) : ('INVESTIGATOR' as const),
          assignmentId: r.assignmentId,
          assignmentStatus: r.assignmentStatus,
        }));
      },
    );
  }

  /** Accounts blocked by several people — a pattern to look at, not a verdict (trust and safety). */
  async signals(actor: Actor, req: RequestContext): Promise<BlockSignal[]> {
    const c = ctx('block.signals', 'user_block', req);
    await this.authz.requireActive(actor, c);
    return this.platform.asStaff(
      actor,
      { scope: 'ENFORCEMENT', purpose: 'block.signals' },
      req,
      async () => {
        const blockedBy = count(userBlocks.blockerId);
        const rows = await this.db
          .select({
            userId: userBlocks.blockedId,
            blockedBy,
            lastBlockedAt: max(userBlocks.createdAt),
          })
          .from(userBlocks)
          .groupBy(userBlocks.blockedId)
          .having(gte(blockedBy, BLOCK_SIGNAL_THRESHOLD))
          .orderBy(desc(blockedBy), userBlocks.blockedId)
          .limit(STAFF_LIST_LIMIT);
        return rows.map((r) => ({
          userId: r.userId,
          blockedBy: r.blockedBy,
          lastBlockedAt: r.lastBlockedAt!,
        }));
      },
    );
  }

  /**
   * Whom the block names, as far as the caller can see: a published profile, a mission they can
   * see, or an assignment they are party to. Anything else is the same 404 as nothing at all.
   */
  private async named(
    actor: Actor,
    target: BlockTarget,
    c: AuthzContext,
  ): Promise<{ source: BlockSource; userId?: string; profileId?: string }> {
    const given = [target.investigatorProfileId, target.missionId, target.assignmentId].filter(
      (t) => t !== undefined,
    );
    if (given.length !== 1) {
      throw AppError.validation([
        { field: 'target', code: 'ONE_OF', messageKey: 'error.validation.block.target' },
      ]);
    }
    if (target.investigatorProfileId !== undefined) {
      const [profile] = await this.db
        .select({ userId: investigatorProfiles.userId })
        .from(investigatorProfiles)
        .where(eq(investigatorProfiles.id, target.investigatorProfileId));
      const found = await this.authz.visible(actor, profile, c);
      return { source: 'profile', userId: found.userId };
    }
    if (target.missionId !== undefined) {
      const [mission] = await this.db
        .select({ customerId: missions.customerId })
        .from(missions)
        .where(eq(missions.id, target.missionId));
      const found = await this.authz.visible(actor, mission, c);
      return { source: 'mission', userId: found.customerId };
    }
    const [assignment] = await this.db
      .select({
        customerId: assignments.customerId,
        profileId: assignments.investigatorProfileId,
      })
      .from(assignments)
      .where(eq(assignments.id, target.assignmentId!));
    const found = await this.authz.visible(actor, assignment, c);
    // The customer blocks the investigator; anyone on the supplier's side, the customer. The
    // investigator's person is read in the system step: their profile may no longer be public.
    return found.customerId === actor.userId
      ? { source: 'assignment', profileId: found.profileId }
      : { source: 'assignment', userId: found.customerId };
  }

  /** The blocker's own quotes, still open, on the other person's missions. */
  private async withdrawOpenQuotes(
    tx: Tx,
    actor: Actor,
    other: string,
    req: RequestContext,
  ): Promise<void> {
    const now = new Date();
    const withdrawn = await tx
      .update(quotes)
      .set({ status: 'WITHDRAWN', withdrawnAt: now, updatedAt: now })
      .where(
        and(
          eq(quotes.status, 'SUBMITTED'),
          inArray(
            quotes.investigatorProfileId,
            tx
              .select({ id: investigatorProfiles.id })
              .from(investigatorProfiles)
              .where(eq(investigatorProfiles.userId, actor.userId)),
          ),
          inArray(
            quotes.missionId,
            tx.select({ id: missions.id }).from(missions).where(eq(missions.customerId, other)),
          ),
        ),
      )
      .returning({ id: quotes.id });
    for (const quote of withdrawn) {
      await this.record(tx, actor, req, 'quote.withdrawn', 'quote', quote.id, 'blocked');
    }
  }

  private async record(
    tx: Tx,
    actor: Actor,
    req: RequestContext,
    action: string,
    resourceType: string,
    resourceId: string,
    reason?: string,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: actor.userId,
        action,
        resourceType,
        resourceId,
        reason,
      },
      tx,
    );
  }
}

async function investigatorOf(tx: Tx, profileId: string): Promise<string> {
  const [profile] = await tx
    .select({ userId: investigatorProfiles.userId })
    .from(investigatorProfiles)
    .where(eq(investigatorProfiles.id, profileId));
  return profile!.userId;
}

/** Assignments still under way between two people, whichever of them is the customer. */
async function liveBetween(tx: Tx, a: string, b: string): Promise<Array<{ id: string }>> {
  return tx
    .select({ id: assignments.id })
    .from(assignments)
    .innerJoin(investigatorProfiles, eq(investigatorProfiles.id, assignments.investigatorProfileId))
    .where(
      and(
        inArray(assignments.status, [...LIVE_ASSIGNMENT]),
        or(
          and(eq(assignments.customerId, a), eq(investigatorProfiles.userId, b)),
          and(eq(assignments.customerId, b), eq(investigatorProfiles.userId, a)),
        ),
      ),
    );
}

function view(row: typeof userBlocks.$inferSelect): BlockView {
  return {
    id: row.id,
    source: row.source as BlockSource,
    label: row.label,
    investigatorProfileId: row.blockedProfileId,
    createdAt: row.createdAt,
  };
}

const ctx = (
  action: string,
  resourceType: string,
  req: RequestContext,
  resourceId?: string,
): AuthzContext => ({
  action,
  resourceType,
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});
