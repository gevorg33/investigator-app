/** A legal document as the API returns it (T-021, T-022). */
export interface LegalDocument {
  /** This exact version and locale — what an acceptance posts back. */
  id: string;
  type: string;
  version: number;
  locale: string;
  title: string;
  content: string;
  contentHash: string;
  effectiveFrom: string;
  authoritative: boolean;
}

/** One of the caller's own sessions (T-005). */
export interface SessionSummary {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

/** The sorts a browse takes. Relevance is implied by words to look for, never chosen alone. */
export type MissionSort = 'newest' | 'closest' | 'budget' | 'deadline' | 'relevance';

/** A browse's filters, in the API's own shape (`POST /search/missions`, T-054). */
export interface BrowseFilters {
  taxonomyNodeIds?: string[];
  languages?: string[];
  currency?: string;
  budgetMinMinor?: number;
  budgetMaxMinor?: number;
  deadlineTo?: string;
  serviceAreaId?: string;
  withinKm?: number;
  postedWithinDays?: number;
  q?: string;
  sort?: MissionSort;
}

/** Who the customer is to the person the work is about (T-010). */
export type SubjectRelationship =
  | 'SELF_OR_OWN_ORGANISATION'
  | 'EMPLOYER'
  | 'BUSINESS_RELATIONSHIP'
  | 'LEGAL_REPRESENTATIVE'
  | 'FAMILY_MEMBER'
  | 'PARTNER_OR_SPOUSE'
  | 'FORMER_PARTNER'
  | 'NO_PERSONAL_RELATIONSHIP'
  | 'OTHER';

export type MissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'QUOTED'
  | 'CUSTOMER_CONFIRMED'
  | 'PAID'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'REPORT_SUBMITTED'
  | 'CUSTOMER_REVIEW'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'DISPUTED'
  | 'SUSPENDED'
  | 'EXPIRED';

/** A moderator's rejection or request for changes, while it still describes the mission (T-119). */
export interface MissionReview {
  outcome: 'REJECTED' | 'CHANGES_REQUESTED';
  reason: string | null;
  decidedAt: string;
}

/** The fields a customer writes on a draft (`PATCH /missions/me/:id`), each nullable until submission. */
export interface MissionFields {
  taxonomyNodeId: string | null;
  title: string | null;
  description: string | null;
  countryCode: string | null;
  locationLabel: string | null;
  startBy: string | null;
  deadline: string | null;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  currency: string | null;
  languages: string[];
  purpose: string | null;
  subjectRelationship: SubjectRelationship | null;
  protectiveOrderDeclared: boolean | null;
}

/** A mission as its own customer sees it (`GET /missions/me/:id`). No screening detail, ever. */
export interface OwnMission extends MissionFields {
  id: string;
  status: MissionStatus;
  version: number;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  review: MissionReview | null;
}

/** A published mission as an investigator browsing sees it (T-054): nothing about the customer. */
export interface MissionListing {
  id: string;
  title: string;
  description: string;
  taxonomyNodeId: string;
  countryCode: string;
  locationLabel: string | null;
  distanceKm: number | null;
  startBy: string | null;
  deadline: string;
  budgetMinMinor: number;
  budgetMaxMinor: number;
  currency: string;
  languages: string[];
  publishedAt: string;
}

export interface MissionBrowsePage {
  items: MissionListing[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/** A browse an investigator saved (T-054). `filters` is the browse request, as the API took it. */
export interface SavedMissionSearch {
  id: string;
  name: string;
  filters: BrowseFilters;
  createdAt: string;
}

/** The shared taxonomy, labelled in the reader's language where translated (T-053). */
export interface TaxonomyNode {
  id: string;
  label: string | null;
  slug: string;
  children: TaxonomyNode[];
}

/** A point, longitude first, as PostGIS and the API take it. */
export interface LonLat {
  lon: number;
  lat: number;
}

/** One of the investigator's own service areas (T-008). */
export interface OwnServiceArea {
  id: string;
  label: string;
  kind: 'RADIUS' | 'POLYGON';
  countryCode: string | null;
  region: string | null;
  city: string | null;
  centre: LonLat | null;
  radiusKm: number | null;
}

export type PricingModel = 'HOURLY' | 'FIXED_FEE' | 'RETAINER' | 'MIXED';
export type Proficiency = 'BASIC' | 'CONVERSATIONAL' | 'FLUENT' | 'NATIVE';
export type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface AvailabilityWindow {
  /** 0 = Monday (ISO 8601) through 6 = Sunday. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/** An investigator profile as anyone may see it — the public projection (T-007). */
export interface PublicInvestigatorProfile {
  id: string;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  yearsExperience: number | null;
  pricingModel: PricingModel | null;
  hourlyRateMinor: number | null;
  currency: string | null;
  acceptingWork: boolean;
  /** Whether staff verified them — the yes or no only, never where an application stands (T-120). */
  verified: boolean;
  languages: Array<{ languageCode: string; proficiency: Proficiency }>;
  specialtyNodeIds: string[];
  availability: AvailabilityWindow[];
}

/** The investigator's own profile: the public fields and the ones only they see (T-123). */
export interface OwnInvestigatorProfile extends PublicInvestigatorProfile {
  contactPhone: string | null;
  visibility: 'DRAFT' | 'PUBLISHED';
  verificationStatus: VerificationStatus;
}

/** One of the investigator's own verification applications, with its decision's reason (T-013). */
export interface VerificationApplication {
  id: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  decidedAt: string | null;
  documentIds: string[];
  decision: { outcome: 'APPROVED' | 'REJECTED'; reason: string; decidedAt: string } | null;
}

/** A help article, as `GET /knowledge/documents/:docKey` gives it to a reader who may read it (T-059). */
export interface HelpArticle {
  docKey: string;
  version: number;
  title: string;
  /** The language it is in: English when the reader's has no version (`fallback`). */
  locale: string;
  fallback: boolean;
  sections: Array<{ heading: string; content: string }>;
}

/** A workspace the reader can work in, as `GET /workspaces` lists it (T-075, T-092). */
export interface WorkspaceView {
  id: string;
  kind: 'PERSONAL' | 'AGENCY';
  /** Null for a Personal workspace. */
  name: string | null;
  /** CREATING until an agency's required details are all present. */
  status: 'CREATING' | 'ACTIVE';
  roles: string[];
  /** The workspace this request ran in. */
  current: boolean;
}

/** A new agency, as `POST /agencies` returns it (T-083). */
export interface AgencyView {
  id: string;
  name: string;
  status: 'CREATING' | 'ACTIVE';
  countryCode: string | null;
  businessEmail: string | null;
  timezone: string | null;
  currency: string | null;
  /** What is still missing before it can be used; empty once ACTIVE. */
  missing: string[];
}

/** The agency the request acts in, as its members read it (T-150). */
export interface AgencyDetails extends AgencyView {
  version: number;
  /** Whether this reader may change the details — the owner. Shown only; the API checks again. */
  mayChange: boolean;
}

/** Why a search listed an investigator — only what was asked for (`discovery.md`, T-011). */
export interface MatchedOn {
  taxonomyNodeIds: string[];
  languages: string[];
  place: { countryCode?: string; region?: string; city?: string } | null;
  availability: boolean;
}

/** An investigator a search found: the public projection, a rounded distance, the match (T-120). */
export interface InvestigatorSearchResult extends PublicInvestigatorProfile {
  /** Whole kilometres, rounded up; 0 when the location is inside their area; null with no location. */
  distanceKm: number | null;
  matchedOn: MatchedOn;
  /** Requested specialties this investigator does not reach through the tree. */
  notMatched: { taxonomyNodeIds: string[] };
}

/** A published review, as anyone may read it — no reviewer is ever named (T-037). */
export interface PublicReview {
  id: string;
  rating: number;
  createdAt: string;
  text: string | null;
  response: string | null;
}

/** A profile's reviews: the rating summary over all standing reviews, and a page of them. */
export interface ProfileReviews {
  summary: { count: number; average: number | null };
  items: PublicReview[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/** A short-lived signed link to a file the API authorised (media.md). Never logged, never kept. */
export interface DeliveryUrl {
  signedUrl: string;
  expiresAt: string;
}

/** An agency's image, as its own members see it (T-084). */
export interface OwnImage {
  mediaId: string;
  /** Null until the file is ready and scanned clean — then this is what customers see too. */
  link: DeliveryUrl | null;
}

/** The agency's profile as its members see it, published or not (`GET /agencies/current/profile`). */
export interface OwnAgencyProfile {
  id: string;
  countryCode: string | null;
  /** The display name if set, the registered name otherwise. */
  name: string;
  displayName: string | null;
  headline: string | null;
  about: string | null;
  logo: OwnImage | null;
  cover: OwnImage | null;
  publishedAt: string | null;
  /** The version a change is made against; 0 for a profile never saved. */
  version: number;
  /** What stands between this profile and publishing it. Empty when it can be published. */
  missing: Array<'agency_setup' | 'headline'>;
}

/**
 * A published agency as anyone signed in sees it (`GET /agencies/:id/profile`): these fields and
 * nothing else — no settings, members, customers or money.
 */
export interface PublicAgencyProfile {
  id: string;
  name: string;
  headline: string;
  about: string | null;
  countryCode: string | null;
  logo: DeliveryUrl | null;
  cover: DeliveryUrl | null;
}

/** The branding section of an agency's settings (T-084): each colour `#rrggbb`, or the platform's. */
export interface BrandingSection {
  /** 0 for a section never saved: its defaults. */
  version: number;
  values: { accentColor: string | null; reportHeaderColor: string | null };
  /** The text colour each fill carries, chosen by the API for contrast. Null with no fill. */
  derived: { accentText: string | null; reportHeaderText: string | null };
}
