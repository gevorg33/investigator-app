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

/** One of the investigator's own service areas (T-008). */
export interface OwnServiceArea {
  id: string;
  label: string;
}

/** The parts of the investigator's own profile these screens read. */
export interface OwnInvestigatorProfile {
  languages: Array<{ languageCode: string }>;
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
