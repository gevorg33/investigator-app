import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import { requiredForRole } from '../legal/legal.policy';
import { LegalService } from '../legal/legal.service';
import type { Actor } from '../../common/authz/contract';
import { currentContext } from '../../common/context/execution-context';
import { AppError } from '../../common/errors/app-error';
import { DB, type Db } from '../../database/database.module';
import {
  assignments,
  customerProfiles,
  investigatorProfiles,
  userRoles,
} from '../../database/schema';
import {
  toOwnCustomerProfile,
  toOwnInvestigatorProfile,
  toPublicCustomerProfile,
  toPublicInvestigatorProfile,
  type OwnCustomerProfile,
  type OwnInvestigatorProfile,
  type PublicCustomerProfile,
  type PublicInvestigatorProfile,
} from './profile.projection';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';
import type { UpdateInvestigatorProfileDto, UpdateCustomerProfileDto } from './profiles.dto';
import { InvestigatorProfileStore } from './profile-store';

export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  correlationId?: string | undefined;
}

const ctxFor = (
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

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly ownInvestigator: OwnInvestigatorProfileRepository,
    private readonly ownCustomer: OwnCustomerProfileRepository,
    private readonly legal: LegalService,
    private readonly store: InvestigatorProfileStore,
  ) {}

  // ── Role activation ───────────────────────────────────────────────────────────

  /**
   * Activates a role on the existing account and creates its profile.
   *
   * No second account, ever (plan.md:12). Someone may hire an investigator for one thing and
   * take work as one on another, and making them register twice would mean two identities,
   * two verification histories and two reputations for one person.
   *
   * Idempotent: activating a role already held returns the existing profile rather than
   * failing, so a double-submitted form is not an error.
   */
  async activateRole(
    actor: Actor,
    role: 'CUSTOMER' | 'INVESTIGATOR',
    req: RequestContext,
    acceptedDocumentIds: readonly string[] = [],
  ): Promise<{ profileId: string }> {
    const activating = ctxFor('profile.activate_role', 'user', req, actor.userId);
    await this.authz.requireActive(actor, activating);
    // The profile it creates belongs to the workspace the request acts in (T-076). In an agency
    // that would be a profile the agency never decided to make (T-087): agencies make them with
    // `investigators.create`. A role is the person's own, so it is taken up in their Personal one.
    await this.authz.requirePersonalWorkspace(actor, activating);

    // A customer who later becomes an investigator was not an investigator when they signed up,
    // so what an investigator agrees to is accepted here (T-022, `legal-consent`). The role and
    // the consent rows commit together: a role that exists having agreed to nothing is exactly
    // what this gate is for.
    await this.db.transaction(async (tx) => {
      await this.legal.requireAcceptance(
        {
          userId: actor.userId,
          types: requiredForRole(role),
          acceptedDocumentIds,
          context: 'ROLE_ACTIVATION',
        },
        req,
        tx,
      );

      const existingRole = await tx.query.userRoles.findFirst({
        where: and(eq(userRoles.userId, actor.userId), eq(userRoles.role, role)),
      });
      if (!existingRole) {
        await tx.insert(userRoles).values({ userId: actor.userId, role });
      } else if (existingRole.revokedAt !== null) {
        await tx
          .update(userRoles)
          .set({ revokedAt: null })
          .where(eq(userRoles.id, existingRole.id));
      }
    });

    const profileId = await (role === 'INVESTIGATOR'
      ? this.ensureInvestigatorProfile(actor)
      : this.ensureCustomerProfile(actor));

    await this.audit.record({
      ...req,
      ipAddress: req.ip,
      actorId: actor.userId,
      action: 'profile.role_activated',
      resourceType: 'user',
      resourceId: actor.userId,
      reason: role,
    });

    return { profileId };
  }

  private async ensureInvestigatorProfile(actor: Actor): Promise<string> {
    const existing = await this.ownInvestigator.findMine(actor);
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(investigatorProfiles)
      .values({ userId: actor.userId })
      .returning();
    if (!created) throw new AppError('INTERNAL_ERROR');
    return created.id;
  }

  private async ensureCustomerProfile(actor: Actor): Promise<string> {
    const existing = await this.ownCustomer.findMine(actor);
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(customerProfiles)
      .values({ userId: actor.userId })
      .returning();
    if (!created) throw new AppError('INTERNAL_ERROR');
    return created.id;
  }

  // ── Reading ───────────────────────────────────────────────────────────────────

  /** The caller's own investigator profile, in full. */
  async getMyInvestigatorProfile(
    actor: Actor,
    req: RequestContext,
  ): Promise<OwnInvestigatorProfile> {
    const c = ctxFor('profile.read_own', 'investigator_profile', req);
    // requireActive on a read too, and not only on writes. Over HTTP a suspended account
    // never gets an Actor at all, but a service is also reachable from a job, an event
    // handler and an AI tool — none of which pass the guard, so the guard cannot be what
    // this relies on.
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigators.read', c);
    const row = await this.authz.visible(actor, await this.ownInvestigator.findMine(actor), c);
    return toOwnInvestigatorProfile(row, await this.store.relations(row));
  }

  /**
   * The caller's own profile exactly as a customer would see it once published (T-123): the same
   * projection function, whatever the profile's visibility — so a preview can never show a field
   * the public view does not, or miss one it does.
   */
  async previewMyInvestigatorProfile(
    actor: Actor,
    req: RequestContext,
  ): Promise<PublicInvestigatorProfile> {
    const c = ctxFor('profile.preview_own', 'investigator_profile', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigators.read', c);
    const row = await this.authz.visible(actor, await this.ownInvestigator.findMine(actor), c);
    return toPublicInvestigatorProfile(row, await this.store.relations(row));
  }

  /**
   * Somebody else's investigator profile.
   *
   * Only a PUBLISHED profile is visible, and a DRAFT is answered as absent rather than as
   * forbidden — a 403 would confirm that a given person has a profile here at all.
   */
  async getPublicInvestigatorProfile(
    actor: Actor,
    profileId: string,
    req: RequestContext,
  ): Promise<PublicInvestigatorProfile> {
    const c = ctxFor('profile.read_public', 'investigator_profile', req, profileId);
    const found = await this.db.query.investigatorProfiles.findFirst({
      where: and(
        eq(investigatorProfiles.id, profileId),
        eq(investigatorProfiles.visibility, 'PUBLISHED'),
      ),
    });
    const row = await this.authz.visible(actor, found, c);
    return toPublicInvestigatorProfile(row, await this.store.relations(row));
  }

  async getMyCustomerProfile(actor: Actor, req: RequestContext): Promise<OwnCustomerProfile> {
    const c = ctxFor('profile.read_own', 'customer_profile', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'CUSTOMER', c);
    await this.authz.requirePersonalWorkspace(actor, c);
    const row = await this.authz.visible(actor, await this.ownCustomer.findMine(actor), c);
    return toOwnCustomerProfile(row, await this.store.legalNameOf(row.userId));
  }

  async getPublicCustomerProfile(
    actor: Actor,
    profileId: string,
    req: RequestContext,
  ): Promise<PublicCustomerProfile> {
    const c = ctxFor('profile.read_public', 'customer_profile', req, profileId);
    const found = await this.db.query.customerProfiles.findFirst({
      where: eq(customerProfiles.id, profileId),
    });
    const row = await this.authz.visible(actor, found, c);
    // A customer's name is masked until hire (T-100): it reaches the customer themself and an
    // investigator they have hired, and nobody else — an investigator who has only seen or quoted on
    // their mission reads `null`.
    const named = row.userId === actor.userId || (await this.hiredBy(actor, row.userId));
    return toPublicCustomerProfile(row, named ? await this.store.legalNameOf(row.userId) : null);
  }

  /** Whether `actor` has been hired by this customer: an assignment between them, not cancelled. */
  private async hiredBy(actor: Actor, customerId: string): Promise<boolean> {
    const [hired] = await this.db
      .select({ id: assignments.id })
      .from(assignments)
      .innerJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(
        and(
          eq(assignments.customerId, customerId),
          eq(investigatorProfiles.userId, actor.userId),
          ne(assignments.status, 'CANCELLED'),
        ),
      )
      .limit(1);
    return hired !== undefined;
  }

  // ── Writing ───────────────────────────────────────────────────────────────────

  /**
   * Updates the caller's own investigator profile.
   *
   * There is no "update profile by id". The row is found by who the caller is, so there is
   * no id to get wrong and no ownership comparison to forget.
   */
  async updateMyInvestigatorProfile(
    actor: Actor,
    dto: UpdateInvestigatorProfileDto,
    req: RequestContext,
  ): Promise<OwnInvestigatorProfile> {
    const c = ctxFor('profile.update_own', 'investigator_profile', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigators.update', c);
    const row = await this.authz.visible(actor, await this.ownInvestigator.findMine(actor), c);

    const name = dto.displayName?.trim();
    const legalName = await this.store.legalNameOf(actor.userId);
    const renaming = name !== undefined && name !== legalName;
    // Outside the Personal workspace (T-087) the profile is an agency's: the legal name stays the
    // account's, changed where the person works for themself, and an agency profile shows it only
    // with the agent's consent, which T-183 adds — until then it is never chosen here.
    if (currentContext()?.tenantKind !== 'PERSONAL') {
      await this.authz.stateAllows(actor, !renaming && dto.publicName !== 'LEGAL', c);
    }
    // Verification checks documents against a name: under review or approved, it stays as checked.
    if (
      renaming &&
      (row.verificationStatus === 'VERIFIED' || row.verificationStatus === 'PENDING')
    ) {
      throw AppError.validation([
        {
          field: 'displayName',
          code: 'LOCKED',
          messageKey: 'error.validation.display_name.locked',
        },
      ]);
    }

    await this.store.save(row, dto, {
      userId: actor.userId,
      legalName,
      rename: renaming ? name : undefined,
    });

    await this.audit.record({
      ...req,
      ipAddress: req.ip,
      actorId: actor.userId,
      action: 'profile.updated',
      resourceType: 'investigator_profile',
      resourceId: row.id,
    });
    if (renaming) {
      // Its own event, so a rename can be found; the names themselves are not copied into the log.
      await this.audit.record({
        ...req,
        ipAddress: req.ip,
        actorId: actor.userId,
        action: 'profile.display_name_changed',
        resourceType: 'investigator_profile',
        resourceId: row.id,
      });
    }

    return this.getMyInvestigatorProfile(actor, req);
  }

  async updateMyCustomerProfile(
    actor: Actor,
    dto: UpdateCustomerProfileDto,
    req: RequestContext,
  ): Promise<OwnCustomerProfile> {
    const c = ctxFor('profile.update_own', 'customer_profile', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'CUSTOMER', c);
    await this.authz.requirePersonalWorkspace(actor, c);
    const row = await this.authz.visible(actor, await this.ownCustomer.findMine(actor), c);

    await this.db
      .update(customerProfiles)
      .set({
        ...(dto.organisationName !== undefined ? { organisationName: dto.organisationName } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        updatedAt: new Date(),
      })
      .where(eq(customerProfiles.id, row.id));

    await this.audit.record({
      ...req,
      ipAddress: req.ip,
      actorId: actor.userId,
      action: 'profile.updated',
      resourceType: 'customer_profile',
      resourceId: row.id,
    });

    return this.getMyCustomerProfile(actor, req);
  }
}
