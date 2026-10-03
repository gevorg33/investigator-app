/** One application waiting in the queue (`GET /verification/requests`, T-013). */
export interface QueueItem {
  id: string;
  profileId: string;
  submittedAt: string;
  documentCount: number;
}

export interface QueuePage {
  items: QueueItem[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

export type RequestStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** What was declared, as snapshotted onto the application when it was submitted. */
export interface DeclaredScope {
  specialtyNodeIds: string[];
  serviceAreas: Array<{
    id: string;
    label: string;
    countryCode: string | null;
    region: string | null;
    city: string | null;
  }>;
}

/** What a reviewer works from (`GET /verification/requests/:id`). */
export interface ReviewView {
  id: string;
  status: RequestStatus;
  submittedAt: string;
  declaredScope: DeclaredScope;
  profile: {
    id: string;
    userId: string;
    headline: string | null;
    verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
    verifiedAt: string | null;
  };
  documents: Array<{
    mediaAssetId: string;
    declaredMimeType: string;
    bytes: number | null;
    scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';
  }>;
  trail: Array<{
    requestId: string;
    status: RequestStatus;
    submittedAt: string;
    decision: {
      outcome: 'APPROVED' | 'REJECTED';
      reason: string;
      decidedBy: string;
      decidedAt: string;
    } | null;
  }>;
}

/** A node of the active taxonomy, as `GET /taxonomy` gives the tree. */
export interface TaxonomyNode {
  id: string;
  label: string | null;
  slug: string;
  children: TaxonomyNode[];
}

export type RiskBand = 'STANDARD' | 'ELEVATED' | 'HIGH' | 'RESTRICTED';
export type ScreeningOutcome = 'ROUTINE_REVIEW' | 'PRIORITY_REVIEW';
export type ModerationOutcome = 'PUBLISHED' | 'REJECTED' | 'CHANGES_REQUESTED';

/** One mission waiting for a moderator, as `GET /moderation/missions` lists it (T-051). */
export interface ModerationQueueItem {
  id: string;
  title: string | null;
  taxonomyNodeId: string | null;
  riskBand: RiskBand;
  screeningOutcome: ScreeningOutcome;
  flagCount: number;
  queuedAt: string;
  deadline: string | null;
}

export interface ModerationQueuePage {
  items: ModerationQueueItem[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/** A decision as staff read it, with the note the customer never sees. */
export interface ModerationDecision {
  outcome: ModerationOutcome;
  reason: string;
  internalNote: string | null;
  decidedBy: string;
  decidedAt: string;
  missionVersion: number;
}

/** One submitted mission, as `GET /moderation/missions/:id` gives it to a moderator (T-051). */
export interface ModerationReviewView {
  id: string;
  status: string;
  version: number;
  title: string | null;
  description: string | null;
  purpose: string | null;
  subjectRelationship: string | null;
  protectiveOrderDeclared: boolean | null;
  taxonomyNodeId: string | null;
  countryCode: string | null;
  locationLabel: string | null;
  languages: string[];
  startBy: string | null;
  deadline: string | null;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  currency: string | null;
  submittedAt: string | null;
  queuedAt: string | null;
  screening: {
    outcome: ScreeningOutcome;
    riskBand: RiskBand;
    flags: string[];
    rulesetVersion: string;
    screenedAt: string;
    /** A model's reading, when one exists: input to the moderator, never the decision. */
    aiClassification: unknown;
  } | null;
  decisions: ModerationDecision[];
  /** The moderator is the mission's customer, and cannot decide it. */
  party: boolean;
}

/** Review latency for one category and risk band, as `GET /moderation/missions/latency` gives it (T-193). */
export interface LatencyRow {
  taxonomyNodeId: string | null;
  riskBand: RiskBand;
  decided: number;
  medianMs: number;
  p90Ms: number;
  longestMs: number;
  outcomes: { published: number; changesRequested: number; rejected: number };
}

export interface LatencyReport {
  days: 30 | 90 | 365;
  rows: LatencyRow[];
}
