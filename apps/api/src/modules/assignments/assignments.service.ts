import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  assignments,
  assignmentStatusHistory,
  investigatorProfiles,
  missions,
  quotes,
} from '../../database/schema';
import { MissionTransitionService } from '../missions/mission-transition.service';
import { acceptanceDeadline } from '../quotes/quotes.policy';
import { AssignmentTransitionService } from './assignment-transition.service';
import type { AssignmentStatus } from './assignment-transitions';
import type { PaymentAuthorization } from './payment-authorization';

/** What both parties to an assignment may see. There is no third audience. */
export interface AssignmentView {
  id: string;
  missionId: string;
  quoteId: string;
  investigatorProfileId: string;
  status: AssignmentStatus;
  version: number;
  acceptedScope: string;
  deliverables: string;
  assumptions: string | null;
  exclusions: string | null;
  cancellationTerms: string;
  priceMinor: number;
  currency: string;
  estimatedDurationDays: number;
  dueAt: Date | null;
  acceptanceDueAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export type AssignmentRow = typeof assignments.$inferSelect;

/**
 * The agreement, once money has been authorized for it.
 *
 * Nothing here decides that a payment happened. The payments module (Phase 5) verifies a
 * provider webhook and calls `createForAuthorizedPayment` with the authorization in hand —
 * "an assignment becomes paid because a verified webhook said so", never because a client
 * callback or a redirect said so. That is why this module has no payment port to consult: an
 * authorization arrives or nothing happens.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly transitions: AssignmentTransitionService,
    private readonly missionTransitions: MissionTransitionService,
  ) {}

  /**
   * Creates the assignment for an accepted quote whose payment has been authorized.
   *
   * **Exactly once**, and the database is what guarantees it: `assignments.mission_id` and
   * `assignments.quote_id` are both unique, so a second concurrent call violates a constraint
   * rather than racing a read-then-write check. The idempotency key makes a retry return the
   * first call's answer instead of a conflict.
   *
   * A SYSTEM operation with no actor. It is not reachable from any customer or investigator
   * route, because neither party gets to declare that money moved.
   */
  async createForAuthorizedPayment(
    input: { quoteId: string; authorization: PaymentAuthorization; idempotencyKey: string },
    req: RequestContext = {},
  ): Promise<AssignmentView> {
    // No user, no workspace: the quote, the mission and the new assignment belong to the two
    // parties, and neither of them declared that money moved. The system reaches all three
    // through PlatformContext (T-077) — the only way past row-level security.
    return PlatformContext.asSystem('assignment.create_from_payment', async () => {
      return this.db.transaction(async (tx) => {
        const claim = await this.idempotency.claim(tx, {
          // A system actor has no user, and the provider's reference is what scopes the key.
          actorId: SYSTEM_ACTOR_ID,
          endpoint: 'assignment.create',
          key: input.idempotencyKey,
          request: { quoteId: input.quoteId, reference: input.authorization.reference },
        });
        if (claim.status === 'REPLAY') return claim.responseBody as AssignmentView;

        const [quote] = await tx
          .select()
          .from(quotes)
          .where(eq(quotes.id, input.quoteId))
          .for('update');
        if (quote === undefined) throw AppError.notFound();
        // Only an accepted quote becomes an assignment. An expired or withdrawn one never does,
        // whatever a payment says — money arriving for something nobody accepted is a payments
        // problem, not a reason to commit an investigator.
        if (quote.status !== 'ACCEPTED') throw AppError.stateConflict();

        // The amount authorized must be the amount agreed. A mismatch is never resolved in
        // favour of proceeding: it means the two systems disagree about what was bought.
        if (
          input.authorization.amountMinor !== quote.priceMinor ||
          input.authorization.currency !== quote.currency
        ) {
          throw AppError.stateConflict();
        }

        const [mission] = await tx
          .select()
          .from(missions)
          .where(eq(missions.id, quote.missionId))
          .for('update');
        if (mission === undefined) throw AppError.notFound();

        // CUSTOMER_CONFIRMED → PAID → ASSIGNED. Two moves rather than one: the mission machine
        // records that payment landed separately from the assignment existing, and a dispute
        // later needs to tell those apart.
        const paid = await this.missionTransitions.apply(
          tx,
          { id: mission.id, status: mission.status, version: mission.version },
          'PAID',
          { kind: 'SYSTEM' },
          { correlationId: req.correlationId, reason: input.authorization.reference },
        );

        const now = input.authorization.authorizedAt;
        let created: AssignmentRow | undefined;
        try {
          [created] = await tx
            .insert(assignments)
            .values({
              missionId: mission.id,
              quoteId: quote.id,
              customerId: mission.customerId,
              investigatorProfileId: quote.investigatorProfileId,
              // Snapshotted, not joined: the agreement is the quote as it stood at acceptance.
              acceptedScope: quote.scope,
              deliverables: quote.deliverables,
              assumptions: quote.assumptions,
              exclusions: quote.exclusions,
              cancellationTerms: quote.cancellationTerms,
              priceMinor: quote.priceMinor,
              currency: quote.currency,
              estimatedDurationDays: quote.estimatedDurationDays,
              dueAt: new Date(now.getTime() + quote.estimatedDurationDays * 24 * 60 * 60 * 1000),
              paymentReference: input.authorization.reference,
              paymentAuthorizedAt: now,
              acceptanceDueAt: acceptanceDeadline(now),
            })
            .returning();
        } catch (e) {
          // One assignment per mission and per quote, held by unique indexes. A concurrent
          // create loses here rather than producing a second commitment.
          if (uniqueViolation(e)) throw AppError.stateConflict();
          throw e;
        }
        if (!created) throw new AppError('INTERNAL_ERROR');

        // The one history row not written by a transition: an assignment's first status is not a
        // move from anywhere, and `from_status` is null exactly here.
        await tx.insert(assignmentStatusHistory).values({
          assignmentId: created.id,
          toStatus: created.status,
          actorKind: 'SYSTEM',
        });

        await this.missionTransitions.apply(
          tx,
          { id: mission.id, status: paid.status, version: paid.version },
          'ASSIGNED',
          { kind: 'SYSTEM' },
          { correlationId: req.correlationId, reason: created.id },
        );

        await this.audit.record(
          {
            correlationId: req.correlationId,
            actorRole: 'SYSTEM',
            action: 'assignment.created',
            resourceType: 'assignment',
            resourceId: created.id,
            reason: input.authorization.reference,
          },
          tx,
        );

        const response = view(created);
        await this.idempotency.complete(
          tx,
          { actorId: SYSTEM_ACTOR_ID, endpoint: 'assignment.create', key: input.idempotencyKey },
          { status: 201, body: response },
        );
        return response;
      });
    });
  }

  /** The investigator commits to the scope and price. "Until you accept, the work is not yours." */
  async accept(actor: Actor, assignmentId: string, req: RequestContext): Promise<AssignmentView> {
    const c = this.ctx('assignment.accept', req, assignmentId);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);

    return this.db.transaction(async (tx) => {
      const assignment = await this.lockAsInvestigator(tx, actor, assignmentId, c);
      const now = new Date();
      // The window is enforced here, not trusted from a status: time passes without anyone
      // writing a row, and an expired window releases the customer.
      await this.authz.stateAllows(actor, assignment.acceptanceDueAt.getTime() > now.getTime(), c);

      const moved = await this.transitions.apply(
        tx,
        { id: assignment.id, status: assignment.status, version: assignment.version },
        'ACCEPTED',
        { kind: 'INVESTIGATOR', actor },
        { correlationId: req.correlationId, ipAddress: req.ip, userAgent: req.userAgent },
        { acceptedAt: now },
      );
      return view({ ...assignment, ...moved, acceptedAt: now });
    });
  }

  /**
   * The investigator declines before accepting. "Decline before accepting, and do it promptly —
   * the customer can then go to someone else while their timeframe still allows it."
   */
  async decline(
    actor: Actor,
    assignmentId: string,
    reason: string | undefined,
    req: RequestContext,
  ): Promise<AssignmentView> {
    const c = this.ctx('assignment.decline', req, assignmentId);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);

    return this.db.transaction(async (tx) => {
      const assignment = await this.lockAsInvestigator(tx, actor, assignmentId, c);
      const moved = await this.transitions.apply(
        tx,
        { id: assignment.id, status: assignment.status, version: assignment.version },
        'CANCELLED',
        { kind: 'INVESTIGATOR', actor },
        { reason, correlationId: req.correlationId, ipAddress: req.ip, userAgent: req.userAgent },
      );
      return view({ ...assignment, ...moved });
    });
  }

  /** One assignment, for either of its two parties and nobody else. */
  async getForParty(
    actor: Actor,
    assignmentId: string,
    req: RequestContext,
  ): Promise<AssignmentView> {
    const c = this.ctx('assignment.read', req, assignmentId);
    await this.authz.requireActive(actor, c);

    // Both parties in one predicate: the customer by user id, the investigator through their
    // profile. Somebody who is neither matches nothing and gets the same 404 as a bad id.
    const [row] = await this.db
      .select({ assignment: assignments })
      .from(assignments)
      .leftJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(
        and(
          eq(assignments.id, assignmentId),
          or(
            eq(assignments.customerId, actor.userId),
            eq(investigatorProfiles.userId, actor.userId),
          ),
        ),
      );
    return view(await this.authz.visible(actor, row?.assignment, c));
  }

  /** The assignment, locked, if this actor is its investigator. */
  private async lockAsInvestigator(
    tx: Tx,
    actor: Actor,
    assignmentId: string,
    c: AuthzContext,
  ): Promise<AssignmentRow> {
    const [row] = await tx
      .select({ assignment: assignments })
      .from(assignments)
      .innerJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(and(eq(assignments.id, assignmentId), eq(investigatorProfiles.userId, actor.userId)))
      .for('update');
    return this.authz.visible(actor, row?.assignment, c);
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'assignment',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

/**
 * The actor a system operation records against in the idempotency store.
 *
 * Keys are scoped per actor, and a webhook has no user. A fixed, reserved id keeps provider
 * retries colliding with each other — which is the point — without colliding with any person.
 */
const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000000';

/** Postgres reports a unique-index violation as 23505; anything else is not ours to interpret. */
const uniqueViolation = (e: unknown): boolean =>
  (e as { cause?: { code?: string } }).cause?.code === '23505';

const view = (a: AssignmentRow): AssignmentView => ({
  id: a.id,
  missionId: a.missionId,
  quoteId: a.quoteId,
  investigatorProfileId: a.investigatorProfileId,
  status: a.status,
  version: a.version,
  acceptedScope: a.acceptedScope,
  deliverables: a.deliverables,
  assumptions: a.assumptions,
  exclusions: a.exclusions,
  cancellationTerms: a.cancellationTerms,
  priceMinor: a.priceMinor,
  currency: a.currency,
  estimatedDurationDays: a.estimatedDurationDays,
  dueAt: a.dueAt,
  acceptanceDueAt: a.acceptanceDueAt,
  acceptedAt: a.acceptedAt,
  createdAt: a.createdAt,
});
