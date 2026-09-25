import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DB, type Db, type Tx } from '../../database/database.module';
import { missions, quotes } from '../../database/schema';
import { MissionTransitionService } from '../missions/mission-transition.service';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { requireQuotingProfile } from '../profiles/quoting-eligibility';
import type { SubmitQuoteDto } from './quotes.dto';
import { isExpired, MAX_EXPIRY_DAYS, MIN_EXPIRY_MINUTES } from './quotes.policy';

/** A quote as either side sees it. Both parties are entitled to the whole offer. */
export interface QuoteView {
  id: string;
  missionId: string;
  investigatorProfileId: string;
  status: 'SUBMITTED' | 'WITHDRAWN' | 'ACCEPTED' | 'CLOSED' | 'EXPIRED';
  priceMinor: number;
  currency: string;
  estimatedDurationDays: number;
  scope: string;
  deliverables: string;
  assumptions: string | null;
  exclusions: string | null;
  cancellationTerms: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export type QuoteRow = typeof quotes.$inferSelect;

/**
 * Offers on a mission, and the customer's acceptance of one.
 *
 * Acceptance **confirms the scope and price**; it does not create the assignment. "An
 * assignment is created only after your acceptance and a successful payment authorization"
 * (`kb-customer-quotes-expiry`), and payment is confirmed by the provider rather than by the
 * browser — so the assignment appears when a verified webhook says so (Phase 5), through the
 * assignments module's system entry point.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly transitions: MissionTransitionService,
    private readonly profiles: OwnInvestigatorProfileRepository,
  ) {}

  // ── The investigator's side ───────────────────────────────────────────────────

  /**
   * Submits an offer for a mission.
   *
   * Only an investigator the platform would show to this customer may quote: published,
   * VERIFIED and accepting work. The same conditions discovery applies — an investigator who
   * cannot be found should not be able to arrive through the back door of a quote.
   */
  async submit(
    actor: Actor,
    missionId: string,
    dto: SubmitQuoteDto,
    req: RequestContext,
  ): Promise<QuoteView> {
    const c = this.ctx('quote.submit', req, missionId);
    // The same gate browse applies (T-054): what an investigator is shown is what they may quote on.
    const profile = await requireQuotingProfile(this.authz, this.profiles, actor, c);

    const expiresAt = this.expiry(dto.expiresAt);

    return this.db.transaction(async (tx) => {
      const mission = await this.quotableMission(tx, missionId, actor, c);

      let row: QuoteRow | undefined;
      try {
        [row] = await tx
          .insert(quotes)
          .values({
            missionId: mission.id,
            investigatorProfileId: profile.id,
            priceMinor: dto.priceMinor,
            currency: dto.currency,
            estimatedDurationDays: dto.estimatedDurationDays,
            scope: dto.scope,
            deliverables: dto.deliverables,
            assumptions: dto.assumptions ?? null,
            exclusions: dto.exclusions ?? null,
            cancellationTerms: dto.cancellationTerms,
            expiresAt,
          })
          .returning();
      } catch (e) {
        // One live offer per investigator per mission, held by a partial unique index.
        // Replacing a quote means withdrawing it first, which is what the article tells them.
        if (uniqueViolation(e)) {
          throw AppError.validation([
            {
              field: 'scope',
              code: 'ALREADY_QUOTED',
              messageKey: 'error.validation.quote.already_quoted',
            },
          ]);
        }
        throw e;
      }
      if (!row) throw new AppError('INTERNAL_ERROR');

      await this.record(actor, req, 'quote.submitted', row.id, tx, 'INVESTIGATOR');
      return view(row);
    });
  }

  /** Withdraws a live offer. "Before acceptance, withdraw it and submit a replacement." */
  async withdraw(actor: Actor, quoteId: string, req: RequestContext): Promise<QuoteView> {
    const c = this.ctx('quote.withdraw', req, quoteId);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigations.update', c);
    const profile = await this.authz.visible(actor, await this.profiles.findMine(actor), c);

    return this.db.transaction(async (tx) => {
      // The profile id in the predicate is the ownership check: another investigator's quote
      // matches nothing, and the answer is the same 404 as an id that never existed.
      const [quote] = await tx
        .select()
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.investigatorProfileId, profile.id)))
        .for('update');
      const found = await this.authz.visible(actor, quote, c);
      // Not once accepted — that is the agreement.
      await this.authz.stateAllows(actor, found.status === 'SUBMITTED', c);

      const [updated] = await tx
        .update(quotes)
        .set({ status: 'WITHDRAWN', withdrawnAt: new Date(), updatedAt: new Date() })
        .where(and(eq(quotes.id, found.id), eq(quotes.status, 'SUBMITTED')))
        .returning();
      if (!updated) throw AppError.stateConflict();

      await this.record(actor, req, 'quote.withdrawn', found.id, tx, 'INVESTIGATOR');
      return view(updated);
    });
  }

  /** The caller's own offers, newest first. */
  async listMine(actor: Actor, req: RequestContext): Promise<QuoteView[]> {
    const c = this.ctx('quote.list_own', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigations.read', c);
    const profile = await this.authz.visible(actor, await this.profiles.findMine(actor), c);

    const rows = await this.db
      .select()
      .from(quotes)
      .where(eq(quotes.investigatorProfileId, profile.id))
      .orderBy(sql`${quotes.createdAt} DESC`);
    return rows.map(view);
  }

  // ── The customer's side ───────────────────────────────────────────────────────

  /** Every offer on the caller's own mission. "You can receive several quotes and compare them." */
  async listForMission(actor: Actor, missionId: string, req: RequestContext): Promise<QuoteView[]> {
    const c = this.ctx('quote.list_for_mission', req, missionId);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'CUSTOMER', c);
    await this.authz.requirePersonalWorkspace(actor, c);
    await this.ownMission(this.db, missionId, actor, c);

    const rows = await this.db
      .select()
      .from(quotes)
      .where(eq(quotes.missionId, missionId))
      .orderBy(sql`${quotes.createdAt} DESC`);
    return rows.map(view);
  }

  /**
   * Accepts an offer: the scope and price are now agreed.
   *
   * What this does **not** do is create the assignment. Payment is taken at this point and
   * confirmed by the provider, and "your assignment is created once confirmation arrives" —
   * so the assignment is created by the payments module calling the assignments module, not
   * here, and not on the strength of anything a client said.
   *
   * Idempotent by key: networks retry and users double-tap, and this is the request that
   * commits a customer to paying.
   */
  async accept(
    actor: Actor,
    quoteId: string,
    idempotencyKey: string,
    req: RequestContext,
  ): Promise<QuoteView> {
    const c = this.ctx('quote.accept', req, quoteId);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'CUSTOMER', c);
    await this.authz.requirePersonalWorkspace(actor, c);

    return this.db.transaction(async (tx) => {
      const claim = await this.idempotency.claim(tx, {
        actorId: actor.userId,
        endpoint: 'quote.accept',
        key: idempotencyKey,
        request: { quoteId },
      });
      // The first call already did this work. Return what it returned rather than doing it
      // again — a second acceptance would be a second agreement.
      if (claim.status === 'REPLAY') return claim.responseBody as QuoteView;

      const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for('update');
      const found = await this.authz.visible(actor, quote, c);

      // The mission is locked before its status is read, so a concurrent acceptance of a
      // sibling quote waits here and then finds the mission already confirmed.
      const mission = await this.ownMission(tx, found.missionId, actor, c, { lock: true });

      // Accepting an expired or withdrawn quote is rejected. Expiry is enforced here rather
      // than trusted from a status column, because time passes without anyone writing a row.
      await this.authz.stateAllows(
        actor,
        found.status === 'SUBMITTED' && !isExpired(found.expiresAt) && mission.status === 'QUOTED',
        c,
      );

      const now = new Date();
      const [accepted] = await tx
        .update(quotes)
        .set({ status: 'ACCEPTED', acceptedAt: now, updatedAt: now })
        .where(and(eq(quotes.id, found.id), eq(quotes.status, 'SUBMITTED')))
        .returning();
      if (!accepted) throw AppError.stateConflict();

      // "Once an assignment exists, the other quotes for that mission are closed."
      await tx
        .update(quotes)
        .set({ status: 'CLOSED', updatedAt: now })
        .where(
          and(
            eq(quotes.missionId, found.missionId),
            ne(quotes.id, found.id),
            eq(quotes.status, 'SUBMITTED'),
          ),
        );

      await this.transitions.apply(
        tx,
        { id: mission.id, status: mission.status, version: mission.version },
        'CUSTOMER_CONFIRMED',
        { kind: 'CUSTOMER', actor },
        {
          correlationId: req.correlationId,
          ipAddress: req.ip,
          userAgent: req.userAgent,
          reason: found.id,
        },
      );

      await this.record(actor, req, 'quote.accepted', found.id, tx, 'CUSTOMER');

      const response = view(accepted);
      await this.idempotency.complete(
        tx,
        { actorId: actor.userId, endpoint: 'quote.accept', key: idempotencyKey },
        { status: 200, body: response },
      );
      return response;
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** A mission an investigator may quote on: published for quoting, and not the actor's own. */
  private async quotableMission(tx: Tx, missionId: string, actor: Actor, c: AuthzContext) {
    const [mission] = await tx.select().from(missions).where(eq(missions.id, missionId));
    // A mission that is not published is not visible to investigators at all, so absence and
    // "not yet published" are answered the same way.
    const found = await this.authz.visible(
      actor,
      mission?.status === 'QUOTED' ? mission : undefined,
      c,
    );
    return found;
  }

  /** The caller's own mission, optionally locked for the rest of the transaction. */
  private async ownMission(
    db: Db | Tx,
    missionId: string,
    actor: Actor,
    c: AuthzContext,
    options: { lock?: boolean } = {},
  ) {
    const query = db
      .select()
      .from(missions)
      .where(and(eq(missions.id, missionId), eq(missions.customerId, actor.userId)));
    const [mission] = options.lock === true ? await query.for('update') : await query;
    return this.authz.visible(actor, mission, c);
  }

  /** Bounded so an offer cannot be already dead on arrival, or open for a year. */
  private expiry(raw: string): Date {
    const expiresAt = new Date(raw);
    const minutesOut = (expiresAt.getTime() - Date.now()) / 60_000;
    if (
      Number.isNaN(expiresAt.getTime()) ||
      minutesOut < MIN_EXPIRY_MINUTES ||
      minutesOut > MAX_EXPIRY_DAYS * 24 * 60
    ) {
      throw AppError.validation([
        {
          field: 'expiresAt',
          code: 'OUT_OF_RANGE',
          messageKey: 'error.validation.quote.expiry_range',
        },
      ]);
    }
    return expiresAt;
  }

  private async record(
    actor: Actor,
    req: RequestContext,
    action: string,
    resourceId: string,
    tx: Tx,
    role: string,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: actor.userId,
        actorRole: role,
        action,
        resourceType: 'quote',
        resourceId,
      },
      tx,
    );
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'quote',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

/** Postgres reports a unique-index violation as 23505; anything else is not ours to interpret. */
const uniqueViolation = (e: unknown): boolean =>
  (e as { cause?: { code?: string } }).cause?.code === '23505';

const view = (q: QuoteRow): QuoteView => ({
  id: q.id,
  missionId: q.missionId,
  investigatorProfileId: q.investigatorProfileId,
  status: q.status,
  priceMinor: q.priceMinor,
  currency: q.currency,
  estimatedDurationDays: q.estimatedDurationDays,
  scope: q.scope,
  deliverables: q.deliverables,
  assumptions: q.assumptions,
  exclusions: q.exclusions,
  cancellationTerms: q.cancellationTerms,
  expiresAt: q.expiresAt,
  acceptedAt: q.acceptedAt,
  createdAt: q.createdAt,
});
