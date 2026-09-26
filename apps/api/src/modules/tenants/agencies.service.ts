import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import { currentContext } from '../../common/context/execution-context';
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
import type { CreateAgencyDto, UpdateAgencyDetailsDto } from './agencies.dto';

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

/** The agency's core details as its members read them, with the version a change must name. */
export interface AgencyDetails extends AgencyView {
  version: number;
  /**
   * Whether the reader holds `company.update_details` here — so a screen offers the change only to
   * whoever may make it. Shown, never trusted: the change checks the permission itself.
   */
  mayChange: boolean;
}

/** The workspace the request acts in — from the context, never from code (tenancy.md §6). */
const THIS_WORKSPACE = sql`app_current_tenant()`;

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
      await tx.insert(membershipRoles).values({ membershipId: membership!.id, roleId: owner!.id });

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

  /** This agency's core details, for any member with `company.read`. */
  async readCurrent(actor: Actor, req: RequestContext): Promise<AgencyDetails> {
    await this.requireInAgency(actor, 'company.read', this.ctx('agency.details.read', req));
    const [row] = await this.db.select().from(tenants).where(eq(tenants.id, THIS_WORKSPACE));
    // The agency workspace was required already; its own row is always visible to its members.
    return details(row!);
  }

  /**
   * Completes or changes this agency's core details (T-150) — the OWNER's alone
   * (`company.update_details`, tenancy.md §3). A CREATING agency becomes ACTIVE in the same write
   * that completes its minimum, which the database checks too (`tenants_active_agency_is_complete`).
   * Audited with the names of what changed, never the values: a business email is personal data.
   */
  async updateCurrent(
    actor: Actor,
    dto: UpdateAgencyDetailsDto,
    req: RequestContext,
  ): Promise<AgencyDetails> {
    const c = this.ctx('agency.details.update', req);
    await this.requireInAgency(actor, 'company.update_details', c);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, THIS_WORKSPACE))
        .for('update');
      const current = row!;
      if (current.version !== dto.version) throw AppError.stateConflict();

      const patch = {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.countryCode !== undefined && { countryCode: dto.countryCode }),
        ...(dto.businessEmail !== undefined && { businessEmail: dto.businessEmail }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
      };
      const changed = REQUIRED.filter(
        (field) => field in patch && patch[field as keyof typeof patch] !== current[field],
      );
      if (changed.length === 0) return details(current);

      const activates =
        current.status === 'CREATING' && missingFrom({ ...current, ...patch }).length === 0;
      const [updated] = await tx
        .update(tenants)
        .set({
          ...patch,
          ...(activates && { status: 'ACTIVE' as const }),
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tenants.id, current.id), eq(tenants.version, current.version)))
        .returning();

      const event = {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.userAgent,
        actorId: actor.userId,
        resourceType: 'tenant',
        resourceId: current.id,
      };
      await this.audit.record(
        { ...event, action: 'agency.details_updated', reason: changed.join(',') },
        tx,
      );
      if (activates) await this.audit.record({ ...event, action: 'agency.activated' }, tx);
      return details(updated!);
    });
  }

  private async requireInAgency(
    actor: Actor,
    permission: 'company.read' | 'company.update_details',
    c: AuthzContext,
  ): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireAgencyWorkspace(actor, c);
    await this.authz.requirePermission(actor, permission, c);
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

const details = (row: typeof tenants.$inferSelect): AgencyDetails => ({
  ...view(row),
  version: row.version,
  // Every caller has passed requireAgencyWorkspace, so there is a context to read.
  mayChange: currentContext()!.permissions.includes('company.update_details'),
});
