import type { AiMessage, AiSession, DiscoveryAnswer, InvestigatorMatch } from '@/lib/api/assistant';
import type { Account } from '@/lib/api/server';
import type {
  LegalDocument,
  MissionListing,
  OwnInvestigatorProfile,
  OwnMission,
  OwnServiceArea,
  SessionSummary,
  VerificationApplication,
  WorkspaceView,
} from '@/lib/api/types';

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

/** A published mission as the browse lists it (T-054). */
/** One of the customer's own missions, as `GET /missions/me/:id` returns it: a complete draft. */
export const ownMission = (over: Partial<OwnMission> = {}): OwnMission => ({
  id: 'b7d3f0c2-5a61-4c1e-9f0a-3e2d1c4b5a69',
  status: 'DRAFT',
  version: 3,
  taxonomyNodeId: '5f51f336-5c7a-442a-909f-8d54d5abf81b',
  title: 'Check a supplier before we sign',
  description: 'Who owns it, and whether it has been in court.',
  countryCode: 'AM',
  locationLabel: 'Yerevan',
  startBy: null,
  deadline: '2026-10-16',
  budgetMinMinor: 20_000_000,
  budgetMaxMinor: 45_000_000,
  currency: 'AMD',
  languages: ['hy', 'en'],
  purpose: 'We are about to sign a distribution contract.',
  subjectRelationship: 'BUSINESS_RELATIONSHIP',
  protectiveOrderDeclared: null,
  submittedAt: null,
  createdAt: '2026-09-24T09:00:00.000Z',
  updatedAt: '2026-09-25T08:00:00.000Z',
  review: null,
  ...over,
});

export const listing = (over: Partial<MissionListing> = {}): MissionListing => ({
  id: 'm-1',
  title: 'Supplier background before a distribution deal',
  description: 'Ownership, registered directors, court cases and public filings.',
  taxonomyNodeId: '5f51f336-5c7a-442a-909f-8d54d5abf81b',
  countryCode: 'AM',
  locationLabel: 'Yerevan, Kentron',
  distanceKm: null,
  startBy: null,
  deadline: '2026-10-16',
  budgetMinMinor: 20_000_000,
  budgetMaxMinor: 45_000_000,
  currency: 'AMD',
  languages: ['hy', 'en'],
  publishedAt: '2026-09-25T08:00:00.000Z',
  ...over,
});

/** A conversation with the assistant, as `/ai/sessions` returns it (T-045, T-056). */
export const aiSession = (over: Partial<AiSession> = {}): AiSession => ({
  id: '00000000-0000-4000-8000-00000000a001',
  title: null,
  status: 'ACTIVE',
  lastActivityAt: '2026-09-25T10:00:00.000Z',
  createdAt: '2026-09-25T09:58:00.000Z',
  ...over,
});

/** One stored message; a question from the person unless told otherwise. */
export const aiMessage = (over: Partial<AiMessage> = {}): AiMessage => ({
  id: `msg-${over.sequence ?? 1}`,
  sequence: 1,
  role: 'USER',
  kind: 'TEXT',
  content: 'How long does a quote stay valid?',
  event: null,
  metadata: {},
  createdAt: '2026-09-25T10:00:00.000Z',
  ...over,
});

/** The assistant's reply from the knowledge base, with the source it used. */
export const aiReply = (over: Partial<AiMessage> = {}): AiMessage =>
  aiMessage({
    id: 'msg-2',
    sequence: 2,
    role: 'ASSISTANT',
    content: 'Until the validity period its investigator set.',
    metadata: {
      source: 'knowledge',
      status: 'answered',
      citations: [
        {
          docKey: 'kb-customer-quotes',
          version: 2,
          title: 'Quotes and expiry',
          section: 'How long does a quote stay valid?',
          locale: 'en',
        },
      ],
      locale: 'en',
      fallback: false,
    },
    ...over,
  });

/** An empty page, as every list route returns one. */
export const emptyPage = { items: [], pageInfo: { nextCursor: null, hasNextPage: false } };

/** The investigator's own profile, as `GET /profiles/investigator/me` returns it (T-123). */
export const ownProfile = (over: Partial<OwnInvestigatorProfile> = {}): OwnInvestigatorProfile => ({
  id: 'p-1',
  displayName: 'Ani Petrosyan',
  headline: 'Corporate due diligence in the Caucasus',
  bio: 'Ten years of company checks.\nCourt and registry work.',
  yearsExperience: 10,
  pricingModel: 'HOURLY',
  hourlyRateMinor: 2_500_000,
  currency: 'AMD',
  acceptingWork: true,
  languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
  specialtyNodeIds: ['5f51f336-5c7a-442a-909f-8d54d5abf81b'],
  availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1080 }],
  contactPhone: '+37410000000',
  visibility: 'PUBLISHED',
  verificationStatus: 'VERIFIED',
  ...over,
});

/** One of the investigator's areas, as `GET /service-areas/me` lists it (T-123). */
export const serviceArea = (over: Partial<OwnServiceArea> = {}): OwnServiceArea => ({
  id: 'a-1',
  label: 'Yerevan',
  kind: 'RADIUS',
  countryCode: 'AM',
  region: null,
  city: 'Yerevan',
  centre: { lon: 44.51, lat: 40.18 },
  radiusKm: 15,
  ...over,
});

/** A verification application, as `GET /verification/me/requests` lists it (T-013, T-123). */
export const application = (
  over: Partial<VerificationApplication> = {},
): VerificationApplication => ({
  id: 'v-1',
  status: 'SUBMITTED',
  submittedAt: '2026-09-20T08:00:00.000Z',
  decidedAt: null,
  documentIds: ['asset-1'],
  decision: null,
  ...over,
});

/** An investigator a search found, as discovery returns one (T-018): the public projection. */
export const investigatorMatch = (over: Partial<InvestigatorMatch> = {}): InvestigatorMatch => ({
  investigatorId: 'inv-1',
  displayName: 'Ani Hakobyan',
  headline: 'Corporate due diligence across the South Caucasus',
  yearsExperience: 9,
  verificationStatus: 'VERIFIED',
  languages: [
    { code: 'hy', proficiency: 'NATIVE' },
    { code: 'en', proficiency: 'FLUENT' },
  ],
  specialties: [
    { id: 'n-fraud', label: 'Fraud investigation' },
    { id: 'n-dd', label: 'Due diligence' },
  ],
  availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
  distanceKm: 4,
  explanation: [
    { code: 'matched.specialty', specialties: [{ id: 'n-dd', label: 'Due diligence' }] },
    { code: 'matched.languages', languages: ['hy'] },
    { code: 'matched.place', place: { city: 'Yerevan', countryCode: 'AM' } },
    { code: 'matched.distance', km: 4 },
    { code: 'matched.availability', window: { dayOfWeek: 0, startMinute: 540, endMinute: 1020 } },
    { code: 'not_matched.specialty', specialties: [{ id: 'n-surv', label: 'Surveillance' }] },
  ],
  ...over,
});

/** What discovery answered: results for the given matches unless told otherwise. */
export const discoveryAnswer = (over: Partial<DiscoveryAnswer> = {}): DiscoveryAnswer => ({
  status: 'results',
  searchedFor: {
    place: { city: 'Yerevan', countryCode: 'AM' },
    near: false,
    radiusKm: null,
    specialties: [{ id: 'n-dd', label: 'Due diligence' }],
    languages: ['hy'],
    availability: null,
  },
  assumptions: [],
  orderedBy: 'relevance',
  results: [
    investigatorMatch(),
    investigatorMatch({
      investigatorId: 'inv-2',
      displayName: null,
      headline: null,
      yearsExperience: null,
      explanation: [],
    }),
  ],
  hasMore: false,
  clarification: null,
  refusal: null,
  ...over,
});

/** The assistant's reply carrying a discovery answer, as it is stored (T-059). */
export const aiDiscoveryReply = (
  answer: DiscoveryAnswer,
  over: Partial<AiMessage> = {},
): AiMessage =>
  aiMessage({
    id: 'msg-d',
    sequence: 2,
    role: 'ASSISTANT',
    content: '',
    metadata: { source: 'discovery', answer },
    ...over,
  });

/** A workspace the reader can work in, as `GET /workspaces` lists it (T-092): Personal by default. */
export const workspace = (over: Partial<WorkspaceView> = {}): WorkspaceView => ({
  id: 'ws-personal',
  kind: 'PERSONAL',
  name: null,
  status: 'ACTIVE',
  roles: ['OWNER'],
  current: true,
  ...over,
});

/** An agency workspace the reader belongs to, not the current one unless told. */
export const agencyWorkspace = (over: Partial<WorkspaceView> = {}): WorkspaceView =>
  workspace({
    id: 'ws-ararat',
    kind: 'AGENCY',
    name: 'Ararat Investigations',
    current: false,
    ...over,
  });
