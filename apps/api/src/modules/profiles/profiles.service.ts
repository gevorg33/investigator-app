import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import { requiredForRole } from '../legal/legal.policy';
import { LegalService } from '../legal/legal.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import { DB, type Db } from '../../database/database.module';
import {
  customerProfiles,
  investigatorAvailability,
  investigatorLanguages,
  investigatorProfiles,
  investigatorSpecialties,
  taxonomyNodes,
  userRoles,
  users,
} from '../../database/schema';
import {
  toOwnCustomerProfile,
  toOwnInvestigatorProfile,
  toPublicCustomerProfile,
  toPublicInvestigatorProfile,
  type OwnCustomerProfile,
  type OwnInvestigatorProfile,
  type ProfileRelations,
  type PublicCustomerProfile,
  type PublicInvestigatorProfile,
} from './profile.projection';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';
import type { UpdateInvestigatorProfileDto, UpdateCustomerProfileDto } from './profiles.dto';

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
    await this.authz.requireActive(actor, ctxFor('profile.activate_role', 'user', req, actor.userId));

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
        await tx.update(userRoles).set({ revokedAt: null }).where(eq(userRoles.id, existingRole.id));
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
    return toOwnInvestigatorProfile(row, await this.relationsFor(row.id, actor.userId));
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
    return toPublicInvestigatorProfile(row, await this.relationsFor(row.id, row.userId));
  }

  async getMyCustomerProfile(actor: Actor, req: RequestContext): Promise<OwnCustomerProfile> {
    const c = ctxFor('profile.read_own', 'customer_profile', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'CUSTOMER', c);
    await this.authz.requirePersonalWorkspace(actor, c);
    const row = await this.authz.visible(actor, await this.ownCustomer.findMine(actor), c);
    return toOwnCustomerProfile(row, await this.displayNameOf(row.userId));
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
    return toPublicCustomerProfile(row, await this.displayNameOf(row.userId));
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

    if (dto.specialtyNodeIds) await this.assertNodesExist(dto.specialtyNodeIds);

    await this.db.transaction(async (tx) => {
      await tx
        .update(investigatorProfiles)
        .set({
          ...(dto.headline !== undefined ? { headline: dto.headline } : {}),
          ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
          ...(dto.yearsExperience !== undefined ? { yearsExperience: dto.yearsExperience } : {}),
          ...(dto.pricingModel !== undefined ? { pricingModel: dto.pricingModel } : {}),
          ...(dto.hourlyRateMinor !== undefined ? { hourlyRateMinor: dto.hourlyRateMinor } : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          ...(dto.acceptingWork !== undefined ? { acceptingWork: dto.acceptingWork } : {}),
          ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
          ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
          updatedAt: new Date(),
        })
        .where(eq(investigatorProfiles.id, row.id));

      // Replace rather than merge: the client sends the whole set, so removing a language
      // is expressed by sending the list without it.
      if (dto.languages) {
        await tx.delete(investigatorLanguages).where(eq(investigatorLanguages.profileId, row.id));
        if (dto.languages.length > 0) {
          await tx
            .insert(investigatorLanguages)
            .values(dto.languages.map((l) => ({ profileId: row.id, ...l })));
        }
      }
      if (dto.specialtyNodeIds) {
        await tx
          .delete(investigatorSpecialties)
          .where(eq(investigatorSpecialties.profileId, row.id));
        if (dto.specialtyNodeIds.length > 0) {
          await tx
            .insert(investigatorSpecialties)
            .values(dto.specialtyNodeIds.map((taxonomyNodeId) => ({ profileId: row.id, taxonomyNodeId })));
        }
      }
      if (dto.availability) {
        await tx
          .delete(investigatorAvailability)
          .where(eq(investigatorAvailability.profileId, row.id));
        if (dto.availability.length > 0) {
          await tx
            .insert(investigatorAvailability)
            .values(dto.availability.map((a) => ({ profileId: row.id, ...a })));
        }
      }
    });

    await this.audit.record({
      ...req,
      ipAddress: req.ip,
      actorId: actor.userId,
      action: 'profile.updated',
      resourceType: 'investigator_profile',
      resourceId: row.id,
    });

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

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** A specialty must name a real node. Free text can never substitute for one (ADR-0007). */
  private async assertNodesExist(nodeIds: string[]): Promise<void> {
    if (nodeIds.length === 0) return;
    const found = await this.db
      .select({ id: taxonomyNodes.id })
      .from(taxonomyNodes)
      .where(inArray(taxonomyNodes.id, nodeIds));
    if (found.length !== new Set(nodeIds).size) {
      throw AppError.validation([
        {
          field: 'specialtyNodeIds',
          code: 'UNKNOWN_TAXONOMY_NODE',
          messageKey: 'error.validation.taxonomy_node.unknown',
        },
      ]);
    }
  }

  private async displayNameOf(userId: string): Promise<string | null> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    return user?.displayName ?? null;
  }

  private async relationsFor(profileId: string, userId: string): Promise<ProfileRelations> {
    const [languages, availability, specialties, displayName] = await Promise.all([
      this.db.select().from(investigatorLanguages).where(eq(investigatorLanguages.profileId, profileId)),
      this.db.select().from(investigatorAvailability).where(eq(investigatorAvailability.profileId, profileId)),
      this.db.select().from(investigatorSpecialties).where(eq(investigatorSpecialties.profileId, profileId)),
      this.displayNameOf(userId),
    ]);
    return {
      displayName,
      languages,
      availability,
      specialtyNodeIds: specialties.map((s) => s.taxonomyNodeId),
    };
  }
}
