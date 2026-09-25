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
