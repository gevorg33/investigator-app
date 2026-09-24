import type { Account } from '@/lib/api/server';
import type { LegalDocument, SessionSummary } from '@/lib/api/types';

/** A published legal document, as `GET /legal/...` returns it. */
export const legalDocument = (over: Partial<LegalDocument> = {}): LegalDocument => ({
  id: 'doc-privacy-3-en',
  type: 'PRIVACY_POLICY',
  version: 3,
  locale: 'en',
  title: 'Privacy policy',
  content: 'What we collect.\nWhy we collect it.',
  contentHash: 'h',
  effectiveFrom: '2026-09-01T00:00:00.000Z',
  authoritative: true,
  ...over,
});

/** The signed-in account, as `GET /me` returns it. */
export const account = (over: Partial<Account> = {}): Account => ({
  id: 'u-1',
  email: 'ana@example.test',
  displayName: null,
  emailVerified: true,
  roles: ['CUSTOMER'],
  activeRole: null,
  locale: 'en',
  timezone: 'UTC',
  ...over,
});

/** One of the account's sessions, as `GET /auth/sessions` lists it. */
export const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 's-1',
  ipAddress: '203.0.113.9',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  createdAt: '2026-09-20T08:30:00.000Z',
  lastUsedAt: '2026-09-25T00:00:00.000Z',
  expiresAt: '2026-10-25T00:00:00.000Z',
  current: false,
  ...over,
});
