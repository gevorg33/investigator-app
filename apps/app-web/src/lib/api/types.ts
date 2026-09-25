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
