import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { investigatorProfiles, tenantMemberships, userRoles } from '../../database/schema';
import { toOwnInvestigatorProfile, type OwnInvestigatorProfile } from './profile.projection';
import { InvestigatorProfileStore, type ProfileChanges } from './profile-store';
import type { UpdateAgencyInvestigatorDto } from './profiles.dto';
import type { InvestigatorProfileRow } from './profiles.repository';

type MembershipStatus = (typeof tenantMemberships.$inferSelect)['status'];

/** A profile with the membership that holds it. */
type HeldProfile = InvestigatorProfileRow & {
  membershipId: string;
  holderStatus: MembershipStatus;
};

/** A profile the agency holds, as its managers see it: the holder's own view, and who holds it. */
export interface AgencyInvestigatorView extends OwnInvestigatorProfile {
  /** The membership that holds the profile (tenancy.md §2). */
  membershipId: string;
  /** Where that membership stands. A suspended or removed holder's profile is not offered. */
  holderStatus: MembershipStatus;
}

/** The workspace the request acts in — from the context, never from code (tenancy.md §6). */
const THIS_WORKSPACE = sql`app_current_tenant()`;

/** The database's one-profile-per-person-per-workspace rule (T-076), said as what it means. */
const ONE_PER_PERSON = 'investigator_profiles_tenant_user_unique';

/**
 * The investigator profiles an agency runs (T-087, tenancy.md §2): it makes one for a member, who
 * holds it, and manages its storefront with `investigators.*`. An independent investigator's profile
 * stays in their Personal workspace and is theirs alone; nothing here reaches it.
 *
 * What the agency may write is the storefront. Who the person is — their legal name, and whether
 * customers see it — stays theirs: the legal name is the account's, and an agency choosing it for
 * an agent waits for that agent's consent (T-183).
 */
@Injectable()
export class AgencyInvestigatorsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly store: InvestigatorProfileStore,
  ) {}

  async list(actor: Actor, req: RequestContext): Promise<AgencyInvestigatorView[]> {
    await this.require(actor, 'investigators.read', this.ctx('agency_investigators.list', req));
    const rows = await this.held(eq(investigatorProfiles.tenantId, THIS_WORKSPACE));
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async get(actor: Actor, profileId: string, req: RequestContext): Promise<AgencyInvestigatorView> {
    const c = this.ctx('agency_investigators.read', req, profileId);
    await this.require(actor, 'investigators.read', c);
    return this.view(await this.find(actor, profileId, c));
  }

  /**
   * A profile for a member, who holds it from now on. They must be an ACTIVE member here and must
   * have taken up the INVESTIGATOR role themself — the role carries the terms an investigator agrees
   * to (T-022), and an agency cannot agree to them for someone. The profile starts as a draft,
   * unverified and not accepting work, as every profile does.
   */
  async create(
    actor: Actor,
    membershipId: string,
    req: RequestContext,
  ): Promise<AgencyInvestigatorView> {
    const c = this.ctx('agency_investigators.create', req, membershipId);
    await this.require(actor, 'investigators.create', c);

    const [found] = await this.db
      .select({ userId: tenantMemberships.userId, status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, THIS_WORKSPACE),
          ne(tenantMemberships.status, 'REMOVED'),
        ),
      );
    const holder = await this.authz.visible(actor, found, c);
    await this.authz.stateAllows(actor, holder.status === 'ACTIVE', c);

    const [investigator] = await this.db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, holder.userId),
          eq(userRoles.role, 'INVESTIGATOR'),
          isNull(userRoles.revokedAt),
        ),
      );
    if (investigator === undefined) {
      throw AppError.conflictOn(
        'membershipId',
        'NOT_AN_INVESTIGATOR',
        'error.validation.agency_investigators.not_an_investigator',
      );
    }

    const [created] = await this.db
      .insert(investigatorProfiles)
      .values({ userId: holder.userId })
      .returning({ id: investigatorProfiles.id })
      .catch((e: unknown) => {
        if (violates(e, ONE_PER_PERSON)) {
          throw AppError.conflictOn(
            'membershipId',
            'ALREADY_HELD',
            'error.validation.agency_investigators.already_held',
          );
        }
        throw e;
      });
    await this.record(actor, req, 'agency_investigators.created', created!.id, membershipId);
    return this.view(await this.find(actor, created!.id, c));
  }

  /**
   * The storefront of a profile the agency holds. Absent is left alone, as on the holder's own
   * route, and the same checks apply — the pseudonym against the holder's legal name, specialties
   * against the taxonomy. A profile whose holder is suspended or has left cannot be published or
   * set to take work: they cannot act for the agency, so nobody should be offered them.
   */
  async update(
    actor: Actor,
    profileId: string,
    dto: UpdateAgencyInvestigatorDto,
    req: RequestContext,
  ): Promise<AgencyInvestigatorView> {
    const c = this.ctx('agency_investigators.update', req, profileId);
    await this.require(actor, 'investigators.update', c);
    const row = await this.find(actor, profileId, c);

    if (
      row.holderStatus !== 'ACTIVE' &&
      (dto.visibility === 'PUBLISHED' || dto.acceptingWork === true)
    ) {
      throw AppError.conflictOn(
        dto.visibility === 'PUBLISHED' ? 'visibility' : 'acceptingWork',
        'HOLDER_INACTIVE',
        'error.validation.agency_investigators.holder_inactive',
      );
    }

    // The pipe refuses `publicName` over HTTP; a caller in-process is held to the same, since the
    // legal name reaches customers only with the agent's consent (T-183).
    const { publicName: _notTheAgencys, ...storefront } = dto as ProfileChanges;
    await this.store.save(row, storefront, {
      userId: row.userId,
      legalName: await this.store.legalNameOf(row.userId),
    });
    await this.record(actor, req, 'profile.updated', row.id, 'agency');
    return this.view(await this.find(actor, profileId, c));
  }

  /** A profile in this workspace, with its holder's membership — or the same 404 as no profile. */
  async find(actor: Actor, profileId: string, c: AuthzContext): Promise<HeldProfile> {
    const [found] = await this.held(
      and(
        eq(investigatorProfiles.id, profileId),
        eq(investigatorProfiles.tenantId, THIS_WORKSPACE),
      )!,
    );
    return this.authz.visible(actor, found, c);
  }

  /**
   * Profiles joined to the membership that holds each — the composite key that makes it one
   * (migration 0037), so the join always finds it — oldest first.
   */
  private async held(where: SQL): Promise<HeldProfile[]> {
    const rows = await this.db
      .select({
        profile: investigatorProfiles,
        membershipId: tenantMemberships.id,
        holderStatus: tenantMemberships.status,
      })
      .from(investigatorProfiles)
      .innerJoin(
        tenantMemberships,
        and(
          eq(tenantMemberships.tenantId, investigatorProfiles.tenantId),
          eq(tenantMemberships.userId, investigatorProfiles.userId),
        ),
      )
      .where(where)
      .orderBy(asc(investigatorProfiles.createdAt), asc(investigatorProfiles.id));
    return rows.map((r) => ({
      ...r.profile,
      membershipId: r.membershipId,
      holderStatus: r.holderStatus,
    }));
  }

  private async view(row: HeldProfile): Promise<AgencyInvestigatorView> {
    return {
      ...toOwnInvestigatorProfile(row, await this.store.relations(row)),
      membershipId: row.membershipId,
      holderStatus: row.holderStatus,
    };
  }

  private async require(
    actor: Actor,
    permission: 'investigators.read' | 'investigators.create' | 'investigators.update',
    c: AuthzContext,
  ): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireAgencyWorkspace(actor, c);
    await this.authz.requirePermission(actor, permission, c);
  }

  private async record(
    actor: Actor,
    req: RequestContext,
    action: string,
    profileId: string,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorId: actor.userId,
      action,
      resourceType: 'investigator_profile',
      resourceId: profileId,
      reason,
    });
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'investigator_profile',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

/** The database refused the write on this constraint, and on nothing else. */
const violates = (e: unknown, constraint: string): boolean => {
  const cause = (e as { cause?: { code?: string; constraint_name?: string } }).cause;
  return cause?.code === '23505' && cause.constraint_name === constraint;
};
