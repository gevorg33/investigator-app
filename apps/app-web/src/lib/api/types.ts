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
