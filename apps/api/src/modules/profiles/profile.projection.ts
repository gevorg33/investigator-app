import type {
  customerProfiles,
  investigatorAvailability,
  investigatorLanguages,
  investigatorProfiles,
} from '../../database/schema';

type InvestigatorRow = typeof investigatorProfiles.$inferSelect;
type CustomerRow = typeof customerProfiles.$inferSelect;
type LanguageRow = typeof investigatorLanguages.$inferSelect;
type AvailabilityRow = typeof investigatorAvailability.$inferSelect;

export interface ProfileRelations {
  displayName: string | null;
  languages: LanguageRow[];
  availability: AvailabilityRow[];
  specialtyNodeIds: string[];
}

/**
 * What anyone may see.
 *
 * Built by naming every field that goes in, never by taking the row and deleting what is
 * private. The difference matters on the day somebody adds a column: with an allowlist the
 * new field is invisible until it is deliberately added here, and with a denylist it is
 * public the moment it exists. One of those fails safe.
 *
 * That is the same argument as the actor-scoped repository — the safe form is the one where
 * forgetting produces less access rather than more.
 */
export interface PublicInvestigatorProfile {
  id: string;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  yearsExperience: number | null;
  pricingModel: InvestigatorRow['pricingModel'];
  hourlyRateMinor: number | null;
  currency: string | null;
  acceptingWork: boolean;
  languages: Array<{ languageCode: string; proficiency: LanguageRow['proficiency'] }>;
  specialtyNodeIds: string[];
  availability: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
}

/** The owner's view: the public fields plus the ones only they may see. */
export interface OwnInvestigatorProfile extends PublicInvestigatorProfile {
  userId: string;
  contactPhone: string | null;
  visibility: InvestigatorRow['visibility'];
  /**
   * Where verification stands (T-013), so the owner can see what stands between them and being
   * listed (T-123). Their own state, not a decision: who decided, and why, is the application's.
   */
  verificationStatus: InvestigatorRow['verificationStatus'];
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicInvestigatorProfile(
  row: InvestigatorRow,
  rel: ProfileRelations,
): PublicInvestigatorProfile {
  return {
    id: row.id,
    displayName: rel.displayName,
    headline: row.headline,
    bio: row.bio,
    yearsExperience: row.yearsExperience,
    pricingModel: row.pricingModel,
    hourlyRateMinor: row.hourlyRateMinor,
    currency: row.currency,
    acceptingWork: row.acceptingWork,
    languages: rel.languages.map((l) => ({
      languageCode: l.languageCode,
      proficiency: l.proficiency,
    })),
    specialtyNodeIds: rel.specialtyNodeIds,
    availability: rel.availability.map((a) => ({
      dayOfWeek: a.dayOfWeek,
      startMinute: a.startMinute,
      endMinute: a.endMinute,
    })),
  };
}

export function toOwnInvestigatorProfile(
  row: InvestigatorRow,
  rel: ProfileRelations,
): OwnInvestigatorProfile {
  return {
    ...toPublicInvestigatorProfile(row, rel),
    userId: row.userId,
    contactPhone: row.contactPhone,
    visibility: row.visibility,
    verificationStatus: row.verificationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A customer's public face is deliberately almost nothing.
 *
 * Investigators are listed and compared, so their profiles are a storefront. Customers are
 * not browsable — someone hiring an investigator has not published anything, and on a
 * platform used for family and relationship matters, the fact that a named person is a
 * customer here is itself sensitive. What a working investigator sees about their customer
 * is assignment-scoped and belongs with assignments, not with a public profile.
 */
export interface PublicCustomerProfile {
  id: string;
  displayName: string | null;
}

export interface OwnCustomerProfile extends PublicCustomerProfile {
  userId: string;
  organisationName: string | null;
  contactPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicCustomerProfile(
  row: CustomerRow,
  displayName: string | null,
): PublicCustomerProfile {
  return { id: row.id, displayName };
}

export function toOwnCustomerProfile(
  row: CustomerRow,
  displayName: string | null,
): OwnCustomerProfile {
  return {
    ...toPublicCustomerProfile(row, displayName),
    userId: row.userId,
    organisationName: row.organisationName,
    contactPhone: row.contactPhone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
