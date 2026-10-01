import { opaqueCode } from '../../common/hash/opaque-code';
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
  /**
   * The legal name (`users.display_name`). The owner's view always; a public one only when the
   * investigator chose to be known by it (T-182).
   */
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
  /**
   * The name customers know them by, by the investigator's own choice (T-182): their pseudonym — the
   * default, and then the legal name never appears here (T-181) — or, if they chose it, their legal
   * name. Null when the chosen name is not set; `nameCode` stands in.
   */
  name: string | null;
  /** Stands in for the name until one is chosen ("Investigator K7Q2"): from the profile id alone. */
  nameCode: string;
  headline: string | null;
  bio: string | null;
  yearsExperience: number | null;
  pricingModel: InvestigatorRow['pricingModel'];
  hourlyRateMinor: number | null;
  currency: string | null;
  acceptingWork: boolean;
  /**
   * Whether staff verified this investigator (T-120). Only the yes or no is public: "under review"
   * and "not approved" both read as not verified, so an applicant's standing is never shown.
   */
  verified: boolean;
  languages: Array<{ languageCode: string; proficiency: LanguageRow['proficiency'] }>;
  specialtyNodeIds: string[];
  availability: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
}

/** The owner's view: the public fields plus the ones only they may see. */
export interface OwnInvestigatorProfile extends PublicInvestigatorProfile {
  userId: string;
  /** Their legal name, the one verification checks; customers see it only if chosen (T-182). */
  displayName: string | null;
  /** The pseudonym they chose (T-181), whether or not it is the name in use. */
  pseudonym: string | null;
  /** Which name customers see: the pseudonym (default) or the legal name (T-182). */
  publicName: InvestigatorRow['publicName'];
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

/** The code an investigator without a chosen name goes by (T-181). Nothing of theirs goes in. */
export function investigatorNameCode(profileId: string): string {
  return opaqueCode('investigator-name', profileId);
}

export function toPublicInvestigatorProfile(
  row: InvestigatorRow,
  rel: ProfileRelations,
): PublicInvestigatorProfile {
  return {
    id: row.id,
    name: row.publicName === 'LEGAL' ? rel.displayName : row.pseudonym,
    nameCode: investigatorNameCode(row.id),
    headline: row.headline,
    bio: row.bio,
    yearsExperience: row.yearsExperience,
    pricingModel: row.pricingModel,
    hourlyRateMinor: row.hourlyRateMinor,
    currency: row.currency,
    acceptingWork: row.acceptingWork,
    verified: row.verificationStatus === 'VERIFIED',
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
    displayName: rel.displayName,
    pseudonym: row.pseudonym,
    publicName: row.publicName,
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
