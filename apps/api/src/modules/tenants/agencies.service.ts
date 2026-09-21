import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DB, type Db, type Tx } from '../../database/database.module';
import {
  membershipRoles,
  OWNER_ROLE_KEY,
  roles,
  tenantMemberships,
  tenants,
  users,
} from '../../database/schema';
import { LegalService } from '../legal/legal.service';
import type { CreateAgencyDto } from './agencies.dto';

export interface AgencyView {
  id: string;
  name: string;
  status: 'CREATING' | 'ACTIVE';
  countryCode: string | null;
  businessEmail: string | null;
  timezone: string | null;
  currency: string | null;
  /** What is still missing before the workspace can be used. Empty once it is ACTIVE. */
  missing: string[];
}

/** The minimum an agency needs before it is usable, and the order it is reported in. */
const REQUIRED = ['name', 'countryCode', 'businessEmail', 'timezone', 'currency'] as const;

/**
 * Creating an agency (T-083, plan.md §29, tenancy.md §2).
 *
 * Three things happen together or not at all: the workspace exists, the creator is its OWNER, and
 * the agency terms they were shown are on the record. An agency that accepted nothing must never
 * exist, and neither must one nobody can administer.
 *
 * Onboarding is progressive. The workspace is real from the first step — `CREATING` — and becomes
 * `ACTIVE` when the minimum is complete, which the database checks as well
 * (`tenants_active_agency_is_complete`). Everything else in plan.md §29 is filled in later.
 *
 * The client says none of: status, verification, kind, or which workspace this is. The DTO has no
 * field for them, the service sets them, and row-level security refuses an agency created for
 * anybody but the caller.
 */
@Injectable()
export class AgenciesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly legal: LegalService,
  ) {}

  async create(
    actor: Actor,
    dto: CreateAgencyDto,
    idempotencyKey: string,
    req: RequestContext,
  ): Promise<AgencyView> {
    const c = this.ctx('agency.create', req);
    await this.authz.requireActive(actor, c);

    // The request stays in whatever workspace it arrived in — an agency may be created from any
    // of them, because the new one belongs to the person rather than to the current workspace.
    // What makes that safe is the policy: the row's `created_by` is the caller, and an agency
    // created for anyone else is refused by the database (T-083).
    return this.db.transaction(async (tx) => {
      const claim = await this.idempotency.claim(tx, {
        actorId: actor.userId,
        endpoint: 'agency.create',
        key: idempotencyKey,
        request: { name: dto.name, agreementDocumentId: dto.agreementDocumentId },
      });
      if (claim.status === 'REPLAY') return claim.responseBody as AgencyView;

      // The terms first: if the agreement they name is not the one in force, nothing else
      // should have happened. `accept` checks the document is published and copies its hash.
      const agreement = await this.legal.currentDocument('AGENCY_AGREEMENT');
      if (agreement.id !== dto.agreementDocumentId) {
        throw AppError.validation([
          {
            field: 'agreementDocumentId',
            code: 'NOT_CURRENT',
            messageKey: 'error.validation.legal.not_current',
          },
        ]);
      }

      const defaults = await this.defaultsFor(tx, actor.userId);
      const fields = {
        name: dto.name.trim(),
        countryCode: dto.countryCode ?? null,
        businessEmail: dto.businessEmail ?? null,
        timezone: dto.timezone ?? defaults.timezone,
        currency: dto.currency ?? defaults.currency,
      };

      // Three statements, not one: a row's policy reads rows written before it, and a single
      // chained statement cannot see its own inserts (T-076).
      const [created] = await tx
        .insert(tenants)
        .values({ kind: 'AGENCY', status: 'CREATING', createdBy: actor.userId, ...fields })
        .returning();
      const agency = created!;

      const [membership] = await tx
        .insert(tenantMemberships)
        .values({
          tenantId: agency.id,
          tenantKind: 'AGENCY',
          userId: actor.userId,
          status: 'ACTIVE',
        })
        .returning();

      const [owner] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.key, OWNER_ROLE_KEY), isNull(roles.tenantId)));
      await tx
        .insert(membershipRoles)
        .values({ membershipId: membership!.id, roleId: owner!.id });

      await this.legal.accept(
        {
          userId: actor.userId,
          documentId: agreement.id,
          context: 'AGENCY_CREATION',
        },
        req,
        tx,
      );

      const complete = missingFrom(fields).length === 0;
      const [final] = complete
        ? await tx
            .update(tenants)
            .set({ status: 'ACTIVE' })
            .where(eq(tenants.id, agency.id))
            .returning()
        : [agency];

      const response = view(final!);
      await this.idempotency.complete(
        tx,
        { actorId: actor.userId, endpoint: 'agency.create', key: idempotencyKey },
        { status: 201, body: response },
      );
      await this.audit.record(
        {
          correlationId: req.correlationId,
          ipAddress: req.ip,
          userAgent: req.userAgent,
          actorId: actor.userId,
          action: 'agency.created',
          resourceType: 'tenant',
          resourceId: agency.id,
          reason: response.status,
        },
        tx,
      );
      return response;
    });
  }

  /**
   * The creator's own settings stand in for the agency's until it says otherwise. A currency is
   * not among them: an account has a locale and a time zone, not a currency, so an agency that
   * does not name one is simply not complete yet — and says so rather than being given a guess.
   */
  private async defaultsFor(
    tx: Tx,
    userId: string,
  ): Promise<{ timezone: string; currency: string | null }> {
    const [row] = await tx
      .select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, userId));
    // The actor's row exists: the guard resolved this request from it.
    return { timezone: row!.timezone, currency: null };
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'tenant',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

const missingFrom = (fields: Record<string, unknown>): string[] =>
  REQUIRED.filter((field) => {
    const value = fields[field];
    return value === null || value === undefined || String(value).trim() === '';
  });

const view = (row: typeof tenants.$inferSelect): AgencyView => ({
  id: row.id,
  name: row.name!,
  status: row.status as AgencyView['status'],
  countryCode: row.countryCode,
  businessEmail: row.businessEmail,
  timezone: row.timezone,
  currency: row.currency,
  missing: missingFrom({
    name: row.name,
    countryCode: row.countryCode,
    businessEmail: row.businessEmail,
    timezone: row.timezone,
    currency: row.currency,
  }),
});
