import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { DB, type Db } from '../../database/database.module';
import {
  investigatorAvailability,
  investigatorLanguages,
  investigatorProfiles,
  investigatorSpecialties,
  taxonomyNodes,
  users,
} from '../../database/schema';
import { agenciesOf } from './profile-agency';
import type { ProfileRelations } from './profile.projection';
import type { InvestigatorStorefrontDto, UpdateInvestigatorProfileDto } from './profiles.dto';
import type { InvestigatorProfileRow } from './profiles.repository';
import { normalisePseudonym, pseudonymIssue } from './pseudonym';

/** The changes either writer may make: the storefront, and the holder's own name choice. */
export type ProfileChanges = InvestigatorStorefrontDto &
  Pick<UpdateInvestigatorProfileDto, 'publicName'>;

/** Whose profile it is: their legal name now, and the new one when this save renames them. */
export interface Holder {
  userId: string;
  legalName: string | null;
  rename?: string | undefined;
}

/**
 * Reading and writing an investigator profile, for whoever is allowed to (T-087): the holder
 * through their own routes, and the agency it belongs to through its own. Neither authorizes —
 * the caller has decided who may, and found the row in a way that already says so.
 */
@Injectable()
export class InvestigatorProfileStore {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Checks the changes, then writes them in one transaction. The pseudonym (T-181) is checked
   * against the legal name it must not reveal — the new one when this save renames — and whichever
   * of the two changes, the pair is checked again.
   */
  async save(row: InvestigatorProfileRow, dto: ProfileChanges, holder: Holder): Promise<void> {
    if (dto.specialtyNodeIds) await this.assertDeclarable(row.id, dto.specialtyNodeIds);

    const renaming = holder.rename !== undefined;
    const pseudonym =
      dto.pseudonym === undefined || dto.pseudonym === null
        ? dto.pseudonym
        : normalisePseudonym(dto.pseudonym);
    const known = pseudonym === undefined ? row.pseudonym : pseudonym;
    const legal = holder.rename ?? holder.legalName;
    const issue =
      known !== null && (pseudonym !== undefined || renaming) ? pseudonymIssue(known, legal) : null;
    if (issue !== null) {
      throw AppError.validation([
        issue === 'own_name'
          ? {
              field: 'pseudonym',
              code: 'OWN_NAME',
              messageKey: 'error.validation.pseudonym.own_name',
            }
          : {
              field: 'pseudonym',
              code: 'CONTACT',
              messageKey: 'error.validation.pseudonym.contact',
            },
      ]);
    }

    await this.db
      .transaction(async (tx) => {
        if (renaming) {
          await tx
            .update(users)
            .set({ displayName: holder.rename, updatedAt: new Date() })
            .where(eq(users.id, holder.userId));
        }
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
            ...(pseudonym !== undefined ? { pseudonym } : {}),
            ...(dto.publicName !== undefined ? { publicName: dto.publicName } : {}),
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
            await tx.insert(investigatorSpecialties).values(
              dto.specialtyNodeIds.map((taxonomyNodeId) => ({
                profileId: row.id,
                taxonomyNodeId,
              })),
            );
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
      })
      .catch((e: unknown) => {
        // Pseudonyms are unique without case (T-181): someone already goes by this name.
        if (pseudonymTaken(e)) {
          throw AppError.validation([
            { field: 'pseudonym', code: 'TAKEN', messageKey: 'error.validation.pseudonym.taken' },
          ]);
        }
        throw e;
      });
  }

  /** Everything the projections read besides the row itself. */
  async relations(row: InvestigatorProfileRow): Promise<ProfileRelations> {
    const [languages, availability, specialties, displayName, agencies] = await Promise.all([
      this.db
        .select()
        .from(investigatorLanguages)
        .where(eq(investigatorLanguages.profileId, row.id)),
      this.db
        .select()
        .from(investigatorAvailability)
        .where(eq(investigatorAvailability.profileId, row.id)),
      this.db
        .select()
        .from(investigatorSpecialties)
        .where(eq(investigatorSpecialties.profileId, row.id)),
      this.legalNameOf(row.userId),
      agenciesOf(this.db, [row.tenantId]),
    ]);
    return {
      displayName,
      languages,
      availability,
      specialtyNodeIds: specialties.map((s) => s.taxonomyNodeId),
      agency: agencies.get(row.tenantId) ?? null,
    };
  }

  /** The account's legal name (`users.display_name`) — the one verification checks. */
  async legalNameOf(userId: string): Promise<string | null> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    return user?.displayName ?? null;
  }

  /**
   * A specialty must name a real node — free text can never substitute for one — and a node
   * being added must be ACTIVE (ADR-0007, T-053).
   *
   * Retired means no new references, not that existing ones break: the client sends the whole
   * set on every save, so an investigator who declared a node before it was retired keeps it
   * and can go on editing the rest of their profile. Only adding a retired node is refused.
   */
  private async assertDeclarable(profileId: string, nodeIds: string[]): Promise<void> {
    if (nodeIds.length === 0) return;
    const found = await this.db
      .select({ id: taxonomyNodes.id, status: taxonomyNodes.status })
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

    const retired = found.filter((n) => n.status !== 'ACTIVE').map((n) => n.id);
    if (retired.length === 0) return;
    const held = await this.db
      .select({ id: investigatorSpecialties.taxonomyNodeId })
      .from(investigatorSpecialties)
      .where(
        and(
          eq(investigatorSpecialties.profileId, profileId),
          inArray(investigatorSpecialties.taxonomyNodeId, retired),
        ),
      );
    if (held.length !== retired.length) {
      throw AppError.validation([
        {
          field: 'specialtyNodeIds',
          code: 'DEPRECATED_TAXONOMY_NODE',
          messageKey: 'error.validation.taxonomy_node.deprecated',
        },
      ]);
    }
  }
}

/** The pseudonym index refused the write: Postgres 23505 on that constraint, and nothing else. */
const pseudonymTaken = (e: unknown): boolean => {
  const cause = (e as { cause?: { code?: string; constraint_name?: string } }).cause;
  return (
    cause?.code === '23505' && cause.constraint_name === 'investigator_profiles_pseudonym_unique'
  );
};
