# Global Private-Investigation Marketplace — Implementation Plan

## 1. Product Vision

Build a global, multilingual private-investigation marketplace where customers can discover verified investigators, create missions, receive quotes, pay securely, communicate privately, track progress, and receive evidence and final reports.

The platform supports two primary roles in one account:

- Customer
- Investigator

A user can switch roles without creating separate accounts. Staff and administrators use a separate web application with elevated permissions.

**Agencies (ADR-0011).** Investigation agencies register as organisations: a public profile, employees, teams, several investigator profiles, and work taken through the marketplace as the agency. Every user also has a **Personal workspace**, where individual customers and independent investigators work exactly as before. A person can belong to several workspaces and switches between them. Workspaces are isolated by the database, not only by application code — see §29 and `docs/architecture/tenancy.md`.

### Initial languages

- English: `en`
- Russian: `ru`
- Armenian: `hy`

The localization system must be extensible for future languages without changing the domain model.

### Core lifecycle

```text
Mission → Assignment → Evidence → Report → Payment/Payout
```

The platform must be designed around lawful, ethical, privacy-preserving investigations. It must not support hacking, spyware, unauthorized tracking, account takeover, illegal recording, harassment, stalking, unlawful entry, or other unlawful activity.

---

## 2. Product Principles

1. **Safety and legality first**
   - Every mission must pass policy and risk checks.
   - Prohibited activities must be rejected or escalated.
   - High-risk cases require human review.

2. **One source of truth**
   - PostgreSQL is the authoritative source for business data, permissions, payments, mission state, and audit records.
   - Search indexes, vector stores, caches, and AI context are derived data only.

3. **AI proposes; backend authorizes and executes**

   ```text
   AI → Plan → Validate → Authorize → Confirm if needed → Execute → Audit
   ```

   The AI assistant must never directly modify the database, bypass services, generate arbitrary SQL, or decide authorization.

4. **Private by default**
   - Evidence and reports are private.
   - No permanent public object URLs.
   - Access is granted through short-lived, authorized downloads or streaming responses.

5. **Modular monolith first**
   - Start with one NestJS API and clear modules.
   - Avoid premature microservices.
   - Keep boundaries strong enough to extract services later.

6. **Low-cost infrastructure**
   - Avoid AWS and expensive managed infrastructure for the MVP.
   - Use a Hetzner VPS or equivalent for API, web, workers, and PostgreSQL where appropriate.
   - Use Cloudinary for media storage, transformations, delivery, and controlled access.

7. **Human approval for irreversible or sensitive operations**
   - Payments, payouts, evidence access, account suspension, destructive migrations, production deployment, and legal/compliance decisions require explicit controls.

---

## 3. Recommended Technology Stack

### Surface architecture (ADR-0004)

```text
Next.js Web          →  Primary product workspace
Expo / React Native  →  Secondary mobile companion
```

**Web is the primary product surface.** Customer workspace, investigator workspace, admin
workspace, investigation dashboard, evidence management, AI assistant, reports and advanced
visualisation are all web. Responsive, so a phone browser serves anything the companion app
does not.

**Mobile is a companion**, scoped to what a phone is genuinely better at: evidence capture
(camera, files), notifications, messaging, quick status updates, location-aware actions, and
lightweight customer and investigator actions. It is not a reduced clone of the web app.

This supersedes the original framing in which mobile was primary. The UI component ecosystem
(shadcn/ui, Cult UI, React Bits, React Flow — see ADR-0003) is DOM-based and does not run in
React Native, and the investigator workflow is desk-bound. See ADR-0004.

### Mobile companion application

- React Native
- Expo
- TypeScript
- Expo Router
- TanStack Query
- Zustand or another small state store
- React Hook Form
- Zod
- Secure token storage using platform secure storage
- Expo Notifications
- Internationalization with a shared translation package

The companion app carries the mobile-appropriate subset of both roles, controlled by role and
permissions. The full customer and investigator workspaces are on the web.

Shared with web: design tokens, the API, Zod schemas in `packages/validation`, i18n catalogs,
auth model. **Not shared: components.** `packages/ui` is web-only — a shared component package
importing DOM libraries would break the mobile build.

### Web applications — the primary product surface

- Next.js **15.5.25** (React **19.2.8**) — not 16/19.3, which were days old
- TypeScript **6.0.3** — not 7; typescript-eslint caps at `<6.1.0`
- Node **24 LTS**, not 26 Current
- ESLint **9.39.5** — the `maintenance` line
- Tailwind CSS
- shadcn/ui foundation with a centralized design-token package (ADR-0003)
- Shared UI package — **web-only**; never importable from the mobile companion (ADR-0004)
- Marketing website (apex domain, SEO-optimised — ADR-0002)
- Main application at `app.` — customer and investigator workspaces
- Separate admin/staff web application at `admin.` — a distinct origin, not a route group
  inside the main app (ADR-0002, ADR-0004)

### Backend

- NestJS
- TypeScript
- REST API for MVP
- WebSocket gateway for messaging and real-time status updates where needed
- OpenAPI/Swagger documentation
- Modular domain architecture
- Background workers using BullMQ

### Database and search

- PostgreSQL
- PostGIS for geographic search and service areas
- pgvector for semantic search and RAG in the MVP
- Redis for queues, rate limiting, short-lived state, and caching

Use normal PostgreSQL queries for structured operations and pgvector for semantic retrieval. Do not introduce Pinecone unless scale, operational requirements, or independent vector-search needs justify it.

### Media and file management

- Cloudinary for investigator profile images, mission attachments, evidence previews, report attachments, and media delivery
- Use private/authenticated Cloudinary resources for sensitive files
- Use signed URLs or authenticated delivery for controlled access
- Store Cloudinary public IDs, asset IDs, resource types, versions, checksums, metadata, and ownership references in PostgreSQL
- Never use Cloudinary public IDs alone as an authorization mechanism
- Apply authorization in the backend before issuing any signed URL or delivery token
- Use separate Cloudinary folders or naming conventions by environment and resource type
- Configure retention, deletion, backups/export strategy, and access policies before production

Cloudinary is a media platform, not the business authorization layer. PostgreSQL remains the source of truth for who may access each file.

### Infrastructure

- Hetzner VPS or comparable low-cost provider
- Docker Compose for MVP
- Caddy as reverse proxy and TLS termination
- GitHub Actions or equivalent CI
- Sentry for application errors
- Uptime Kuma for uptime monitoring
- Prometheus and Grafana for metrics
- Loki or another centralized log solution, with Grafana integration
- Encrypted automated PostgreSQL backups stored separately from the primary server

### Payments

- Stripe Connect if legally and operationally available in the required countries
- Otherwise evaluate a regionally suitable marketplace payment provider
- Never store raw card data
- Keep payment state synchronized through verified webhooks

### AI

- OpenAI API behind an internal provider abstraction
- NestJS AI gateway and tool registry
- Structured tool calls with Zod schemas
- pgvector-based retrieval for MVP
- Embedding model abstraction so the provider can change later
- Optional LangGraph integration later for long-running, branching, human-in-the-loop workflows

---

## 4. Repository and Harness Structure

```text
private-investigation-platform/
├── TODO.md
├── PLAN.md
├── AGENTS.md
├── CLAUDE.md
├── CODEX.md
├── README.md
├── apps/
│   ├── mobile/
│   ├── marketing-web/
│   ├── admin-web/
│   └── api/
├── packages/
│   ├── ui/
│   ├── types/
│   ├── validation/
│   ├── api-client/
│   ├── auth/
│   ├── i18n/
│   └── config/
├── infrastructure/
│   ├── docker/
│   ├── compose/
│   ├── caddy/
│   ├── backups/
│   ├── monitoring/
│   └── scripts/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── compliance/
│   ├── operations/
│   └── product/
├── .harness/
│   ├── config/
│   ├── agents/
│   ├── workflows/
│   ├── prompts/
│   ├── policies/
│   ├── state/
│   └── logs/
└── scripts/
    ├── check.sh
    ├── test.sh
    ├── verify-task.sh
    └── update-task-status.sh
```

### Development harness

The development harness continuously reads `TODO.md`, selects the next eligible task, delegates work, validates changes, and updates task status.

```text
TODO.md
  ↓
Harness
  ↓
Planner
  ↓
Specialized implementation agent
  ↓
Code changes
  ↓
Tests + lint + typecheck + build
  ↓
Review agent
  ↓
Commit or pull request
  ↓
Update TODO.md
  ↓
Next task
```

Recommended agents:

- Planner/architect
- Backend/domain
- Database
- Mobile
- Admin/web
- AI/RAG
- Security/privacy
- QA/reviewer
- Infrastructure/DevOps

For the MVP, use one primary implementation agent at a time and specialized agents mainly for review or isolated tasks. Avoid multiple agents editing the same files concurrently.

### Task format

Every TODO task should include:

- Unique ID
- Status
- Priority
- Dependencies
- Description
- Acceptance criteria
- Validation commands
- Affected modules/files
- Risk level
- Human approval requirement, if applicable

### Harness safety rules

The harness may:

- Read and modify source code
- Run local tests and static checks
- Create branches and commits
- Update task status
- Generate documentation

The harness must not automatically:

- Access production secrets
- Read private production evidence
- Modify production data
- Deploy high-risk changes without approval
- Change payment logic without review
- Perform destructive database operations
- Disable security controls
- Make legal/compliance decisions

High-risk tasks requiring human approval:

- Authentication and authorization changes
- Evidence and report access rules
- Payment and payout logic
- Account suspension or deletion
- Destructive migrations
- Production deployment
- Infrastructure changes
- Data retention policies
- AI tools that mutate business state
- Compliance and legal policy changes

---

## 5. Application Modules

### API modules

```text
AuthModule
UsersModule
RolesModule
OrganizationsModule
InvestigatorProfilesModule
VerificationModule
ServiceAreasModule
SpecialtiesModule
AvailabilityModule
MissionsModule
MissionPolicyModule
QuotesModule
AssignmentsModule
PaymentsModule
PayoutsModule
MessagingModule
NotificationsModule
MediaModule
EvidenceModule
ReportsModule
ReviewsModule
DisputesModule
SearchModule
AiModule
AuditModule
AdminModule
LocalizationModule
HealthModule
```

### Domain boundaries

Each module should own:

- Domain entities and schemas
- Business rules
- Application services
- Controllers or message handlers
- Authorization checks relevant to the module
- Events emitted by the module
- Tests

Cross-module access must happen through application services, domain events, or explicitly defined interfaces rather than direct database manipulation from unrelated modules.

---

## 6. Roles and Permissions

### Customer

- Manage own profile
- Create and edit draft missions
- Submit missions
- View eligible investigator profiles
- Receive and compare quotes
- See matched investigators and message them before hiring, free (§13)
- Confirm a quote
- Pay for assignments
- Message assigned investigators
- Upload permitted documents
- View authorized evidence and reports
- Request revisions or raise disputes
- Review completed assignments

### Investigator

- Manage professional profile
- Define service areas, languages, specialties, pricing, and availability
- Upload verification documents
- Apply for verification
- Discover eligible missions
- Answer and ask pre-hire questions on a mission (§13)
- Submit quotes
- Accept assignments
- Update assignment progress
- Upload evidence and reports
- Message customers within assignment scope
- View earnings and payout status

### Staff/admin

- Review investigator verification
- Review flagged missions
- Manage disputes
- Moderate profiles and content
- Manage categories, translations, and policies
- Review payments and payouts
- Suspend accounts or assignments with audit trails
- Access only the data permitted by staff role

Use RBAC plus resource-level authorization. Role checks alone are insufficient.

### Inside an agency workspace (ADR-0011)

Platform roles above describe what a person may do on the platform. Inside an agency, a member's **tenant roles** — `OWNER`, `ADMIN`, `MANAGER`, `INVESTIGATOR`, `AGENCY_STAFF` (shown as "Staff"), `VIEWER` — grant explicit **permissions** (`employees.invite`, `investigations.assign`, …). Authorization checks permissions, never role names, and access to an individual assignment inside an agency still depends on being staffed on it or holding `investigations.read_all`. The full catalog and matrix: `docs/architecture/tenancy.md` §3. Custom roles are designed for, not built.

---

## 7. Authentication and Security

### Authentication

- Email/password or passwordless authentication
- Google OAuth (Sign in with Google) alongside email/password — see T-062
- Email verification
- Password reset
- Refresh-token rotation
- Device/session management
- Optional MFA for investigators and staff
- Secure mobile token storage
- Rate limiting and brute-force protection

### Authorization

Every protected resource must verify:

0. Active workspace — an ACTIVE membership in an ACTIVE workspace, read per request (ADR-0011)
1. User identity
2. Active account status
3. Role permissions — and, inside a workspace, tenant permissions
4. Resource ownership or assignment relationship
5. Mission/assignment state
6. Staff scope, if applicable — cross-workspace staff access only inside the audited `PlatformContext`

Underneath all six, **PostgreSQL row-level security enforces the workspace boundary** on every tenant-scoped table, keyed on transaction-local context the application sets at the request or job boundary. The application's checks decide what a member may do; the database guarantees that a forgotten filter returns nothing rather than another workspace's data. A client-supplied tenant id is never an authorization source.

### Security requirements

- Validate all input with Zod or class-validator
- Use parameterized queries/ORM protections
- CSRF protection where cookie authentication is used
- CORS allowlist
- Content Security Policy for web applications
- File type, size, and malware validation
- Audit security-sensitive actions
- Do not log passwords, tokens, private evidence, or sensitive personal data
- Encrypt secrets and use environment-specific configuration
- Implement account deletion and data export workflows
- Add privacy-preserving error messages

---

## 8. Core Data Model

Initial entities:

- User
- UserRole
- UserSession
- CustomerProfile
- InvestigatorProfile
- InvestigatorVerification
- VerificationDocument
- ServiceArea
- TaxonomyNode
- TaxonomyNodeLabel
- SourceNode
- SourceNodeLabel
- InvestigatorSourceCapability
- TaxonomySourceHint
- Tag
- Language
- InvestigatorLanguage
- InvestigatorAvailability
- Mission
- MissionTag
- MissionAttachment
- MissionParticipant
- MissionPolicyReview
- Quote
- Assignment
- AssignmentStatusHistory
- Payment
- PaymentEvent
- Payout
- Conversation
- ConversationParticipant
- Message
- MediaAsset
- InvestigationSource
- InvestigationNote
- InvestigationTask
- InvestigationDocument
- EvidenceItem
- EvidenceAccessGrant
- Report
- ReportVersion
- Review
- Dispute
- Notification
- AuditLog
- KnowledgeDocument
- KnowledgeChunk
- EmbeddingJob
- InvestigatorViolation
- EnforcementDecision
- BanIdentityHash
- AiSession
- AiMessage
- InvestigatorViolation
- EnforcementDecision
- BanIdentityHash
- AiSessionSummary
- InvestigatorViolation
- EnforcementDecision
- BanIdentityHash
- AiSessionState
- AiMemory
- AiPlan
- AiToolResult
- Tenant (workspace: `PERSONAL` | `AGENCY`) — ADR-0011
- TenantProfile (public) · TenantSettings (private)
- TenantMembership · TenantInvitation
- Role · Permission · RolePermission · MembershipRole
- Team · TeamMember
- AssignmentStaff (who inside the supplier works an assignment)
- Match (a mission's shortlisted investigator profile, §9) · Lead (an agency's inbox item, §30)
- Conversation kind: `PRE_HIRE` (one mission × one supplier) · `ASSIGNMENT` (§13)

### Taxonomy and tags (ADR-0007)

**One shared taxonomy.** A mission declares the node it falls under; an investigator declares
the nodes they practise in. Matching is an exact join over node IDs — there is no second
vocabulary and no mapping table.

- **TaxonomyNode** — id, parent, slug, status (`active`/`deprecated`), ordering. **Never
  deleted**, only deprecated, so historical missions and profiles stay valid
- **TaxonomyNodeLabel** — per-locale label and description; the node id is the canonical,
  language-neutral value (`localization`)
- **Tag** — curated, flat, staff-managed
- **MissionTag** — tags applied to a mission

Hierarchical: a mission at a parent node matches investigators declared at any descendant, and
an investigator at a parent covers its descendants. Matching walks the tree, so the two sides
need not choose at the same depth.

The taxonomy **gates eligibility** and is applied as a hard SQL filter. **Tags never do** —
they rank and refine search only, exactly like the free-text relevance hint. Staff maintain
both; adding a node is audited.

`Service` is not a separate dimension. A service is a deeper node.

### Source capability — the second axis (ADR-0008)

A separate vocabulary that **only investigators declare**: which sources they can reach, in
which jurisdictions.

- **SourceNode** — hierarchical; `public-registers`, `court-legal`, `open-source`,
  `financial-trails`, `authorised`, `human-consensual`, with children
- **SourceNodeLabel** — per-locale labels, as with the taxonomy
- **InvestigatorSourceCapability** — (investigator, source node, **jurisdiction**), self-declared
  and labelled as such
- **TaxonomySourceHint** — staff-maintained mapping of likely sources per taxonomy node and
  jurisdiction; a **routing hint**, never a determination

Customers never pick sources. **Sources rank and route; they never gate eligibility** — the
taxonomy does that. Jurisdiction scoping is what makes feasibility routable: a mission needing
Armenian land records reaches investigators who declared it, rather than failing after a quote.

### Enforcement

Investigator policy violations, due process and permanent bans. Procedure:
`.claude/skills/enforcement-actions/SKILL.md`.

- **InvestigatorViolation** — subject, reporter, grounds, evidence references (**IDs, never
  content**), status, timestamps
- **EnforcementDecision** — the violation, outcome (`warning` / `suspension` / `ban` /
  `dismissed`), reasoning, deciding staff member, notice sent, response received, appeal
  outcome. **Append-only** — a reversal appends, it never edits
- **BanIdentityHash** — a salted hash of the verified identity, checked at registration

The hash exists because a permanent ban that is defeated by deleting the account and
re-registering is not a ban. Storing the hash rather than the identity keeps the ban effective
while retaining nothing legible about a deleted person. Its lawful basis is a counsel question
— see `counsel-brief.md` §19a.

Money is decided **separately** from the ban. Amounts earned for delivered work remain payable;
a refund owed to a customer is its own determination.

### AI session and context (ADR-0006)

The assistant's conversation layer. **A session is a persistent workspace; the model's context
window is a temporary working set.** They are separate systems — see
`.claude/skills/ai-session-context/SKILL.md`.

- **AiSession** — id, user, title, status (`ACTIVE`/`IDLE`/`ARCHIVED`/`DELETED`), locale,
  timezone, message count, summary version, last activity, structured pointers to the current
  goal, active assignment, pending action and last plan
- **AiMessage** — session, sequence, role (`user`/`assistant`/`system`/`tool`), content,
  metadata (entities, tool calls, plan id), embedding for semantic history search
- **AiSessionSummary** — versioned, with model, source sequence range and timestamp, so a
  summary is reproducible and traceable
- **AiSessionState** — structured state that must never live only in prose: ids, statuses,
  confirmation and authorization status, job and workflow state
- **AiMemory** — session-scoped and user-scoped, each with provenance (source session and
  message), confidence and expiry; user-reviewable and user-deletable
- **AiPlan** — id, hash, commands, parameters, status, confirmation status, job ids, results;
  persisted server-side so a confirmation survives a browser close or a worker restart
- **AiToolResult** — large results stored and referenced by id with a summary and a cursor,
  never inlined into a prompt

Uses pgvector for message and memory embeddings, and Postgres full-text search for exact terms —
hybrid, per ADR-0001.

**Superseded in part (2026-09-19).** ADR-0006 deferred multi-tenancy and DAG orchestration.
ADR-0011 now makes workspaces real — every AI session, message, summary, memory, plan and tool
result is tenant-scoped, and a session belongs to one workspace for life. ADR-0012 brings
multi-command plans ordered as a DAG, over the same persisted plan rows. A learned risk engine
remains out of scope: risk is declared per command plus the mission policy screening in §10.

### Investigation workspace (v1)

**An Assignment is the investigation.** There is no separate Investigation entity — the
assignment already carries the customer, the investigator, the agreed scope, the state machine
and the audit trail. These four objects are the investigator's workspace inside it.

All four are **assignment-scoped**: authorization is the standard six-check with assignment
participation (see the `authorization` skill), every mutation is audited, and each has a
retention rule.

#### InvestigationSource

Where information came from — distinct from the evidence obtained from it.

- ID, assignment ID
- Type: `public_record` · `registry` · `website` · `witness` · `document` · `observation` · `other`
- Title, locator (URL or reference), accessed at
- Reliability: `high` · `medium` · `low` · `unknown`, with a required rationale when not `unknown`
- Added by, created/updated timestamps, soft delete

Assignment-scoped, not a shared catalogue. A source reused across assignments would reveal
what another customer had investigated. Deduplication, if it ever matters, is a separate
problem.

`EvidenceItem` gains a nullable `source_id`. Nullable, because evidence can predate a source
record and must never be blocked on one.

Reliability is a property of the **source**, assessed by the investigator. It is not the
assertion-level `Confidence` deferred by ADR-0005, and must not grow into it.

#### InvestigationNote

The investigator's working material. Mutable, unlike evidence.

- ID, assignment ID, author ID
- Body, visibility: `private` (author only) · `shared` (assignment participants)
- Created/updated timestamps, soft delete

**Default `private`.** Notes contain thinking in progress — speculation, discarded lines of
inquiry, hypotheses that never reached the report. A customer seeing "subject may be involved
in X" that was investigated and dismissed is precisely the FACT/INFERENCE failure the
`evidence-integrity` discipline exists to prevent.

Changing visibility is an audited action. Sharing is deliberate and one-directional in intent:
unsharing does not unsee.

#### InvestigationTask

The work plan inside an assignment. Backs the Planning stage of the workspace.

- ID, assignment ID, created by
- Title, description, status: `todo` · `in_progress` · `done` · `cancelled`
- Due date, order, visibility: `private` · `shared`
- Created/updated timestamps, soft delete

Default `private`. Some investigators will want to show progress; that is their choice, not
the default.

#### InvestigationDocument

Working files that are **not evidence**: case briefs, customer-supplied instructions,
reference material, templates.

- ID, assignment ID, uploaded by
- Title, description, `media_asset_id` (all files go through the Cloudinary flow in §14)
- Kind: `brief` · `instruction` · `reference` · `template` · `other`
- Created/updated timestamps, soft delete

**The distinction from evidence is load-bearing.** Evidence is immutable, checksummed,
chain-of-custody tracked and grant-gated. Documents are working files. Without an explicit
boundary, investigators will attach evidence as documents because it is easier, and the chain
of custody is lost.

Therefore: a document may be **promoted** to evidence, creating an immutable `EvidenceItem`
that records the promotion and its origin. **Evidence is never demoted to a document.** The
promotion is audited, and the checksum is computed at promotion, server-side.

### Retention

Sources, notes and tasks follow the assignment's retention rule. Documents follow media
retention (§14). None are cascade-deleted with the assignment — retention is a policy
decision enforced by a job, per the `db-migration` skill.

---

**Not in v1 — investigation intelligence layer (ADR-0005).** Entity, Relationship,
EvidenceEntity, Confidence, Contradiction, TimelineEvent and graph visualisation are
deliberately deferred. Do not create these tables to satisfy a UI component. Five constraints
in ADR-0005 keep them cheap to add later without abstracting for them now.

### Mission fields

- ID
- Customer ID
- Taxonomy node (shared with investigator practice areas — ADR-0007)
- Tags (refinement only; never gate eligibility)
- Title
- Description
- Country/region/city
- Coordinates when appropriate and lawful
- Service radius
- Preferred languages
- Budget range
- Desired timeline
- Risk classification
- Policy review status
- Current status
- Created/updated timestamps

### Mission statuses

```text
DRAFT
SUBMITTED
UNDER_REVIEW
QUOTED
CUSTOMER_CONFIRMED
PAID
ASSIGNED
ACCEPTED
IN_PROGRESS
REPORT_SUBMITTED
CUSTOMER_REVIEW
COMPLETED
CANCELLED
REJECTED
DISPUTED
SUSPENDED
EXPIRED
```

All state changes must be validated by a state machine or explicit transition service. Every transition should create a status-history record and audit event.

---

## 9. Investigator Discovery

Support filtering by:

- Country
- Region
- City
- Service radius
- PostGIS distance
- Verification status
- Specialty
- Languages
- Availability
- Rating and review count
- Experience
- Pricing model
- Mission category
- Response time

Use PostGIS for geographic queries. Use normal SQL filters for exact constraints. Use semantic search only as a relevance layer, never as a replacement for hard eligibility filters.

Example discovery strategy:

```text
Hard filters
  ↓
Eligibility and verification checks
  ↓
Geographic ranking
  ↓
Optional semantic relevance ranking
  ↓
Availability and response-quality ranking
```

### Matching (§30)

When a moderator publishes a mission, the platform builds a **shortlist**: the top eligible investigator profiles from the same ranking discovery uses, computed once and stored as `Match` rows. Nothing about it is paid placement. The customer sees the shortlist on the mission, can message any match before hiring (§13) and invite them to quote. Matched investigators, and matched agencies' lead inboxes, are notified. Customers can still browse discovery and receive quotes from anyone eligible; matching is a shortcut, not a gate.

---

## 10. Mission Creation and Policy Review

Mission creation should support:

- Category selection
- Structured questions per category
- Free-text description
- Location and service area
- Timeline
- Budget range
- Preferred languages
- Attachments
- Confidentiality expectations
- Consent and lawful-purpose confirmation

**Guided, plain-language intake (§30).** The customer answers a few plain questions — what they need, where, by when — and the platform turns them into a structured brief investigators can act on. No investigation vocabulary is required. The assistant may draft the brief; the customer confirms it, and the lawful-purpose confirmation is always the customer's own.

Before publication or quote requests:

1. Validate required fields.
2. Scan attachments.
3. Classify risk.
4. Detect prohibited or suspicious requests.
5. Request clarification when necessary.
6. Route the mission to the moderation queue.
7. Store policy decision and reason.

**No mission reaches investigators without a moderator publishing it.** Automatic screening
sorts and prioritises the queue — it never publishes. A moderator reviews the mission and its
attachments in the admin console and either publishes it, rejects it with a reason, or requests
changes from the customer.

The gate is configurable per category and risk band, so that low-risk categories can be
auto-published later if review volume makes that necessary. It starts closed: everything is
reviewed.

**Decided 2026-09-19: every mission is reviewed at launch.** Faster matching is not bought by
publishing unreviewed missions. Review latency is measured per category and risk band from the
first day (T-051), so a later decision to auto-publish a low-risk category — records checks, for
example — rests on data and on counsel's confirmation. Partner and relationship investigation is
**never** auto-published (ADR-0009).

AI may assist with classification and drafting, but final policy enforcement must be
deterministic and auditable. A classification is an input to the moderator's decision, never
the decision.

---

## 11. Quotes and Assignments

### Quote

A quote includes:

- Investigator ID
- Mission ID
- Price and currency
- Estimated duration
- Proposed scope
- Deliverables
- Assumptions
- Exclusions
- Expiration date
- Cancellation terms
- Taxes/fees where applicable

### Assignment

An assignment is created only after customer confirmation and successful payment authorization or another approved payment state.

Assignment must define:

- Customer
- Investigator
- Mission
- Accepted scope
- Price
- Currency
- Milestones, if applicable
- Due dates
- Evidence/report permissions
- Cancellation rules
- Dispute rules

Use transactions and idempotency keys for quote acceptance, assignment creation, payment confirmation, and state transitions.

---

## 12. Payments and Payouts

Use a marketplace payment provider such as Stripe Connect only after confirming availability, licensing, tax, and payout support for target countries.

**Decided 2026-09-19: build against Stripe Connect.** The owner chose Stripe as the working provider so payments are built now rather than blocked. **Provider acceptance becomes a go-live gate instead of a build gate:** no real money moves until Stripe confirms in writing that it will process this business, surveillance included, in the launch market (ACTIONS-FOR-ME #1, ADR-0009). Everything provider-specific stays behind the payments module's boundary, so a refusal means replacing an adapter, not the ledger or the assignment flow.

**Holding funds ("escrow").** A card authorization hold expires within days, and an investigation can take weeks. Funds are therefore **charged when the customer accepts, held in the platform balance, and transferred to the supplier's connected account on release**, with the platform fee kept at that point. "Escrow" in customer-facing copy means this mechanism, and the terms must describe it accurately (counsel brief §2). The connected account belongs to the supplier workspace — Personal or agency (ADR-0011).

Requirements:

- Payment intent creation on the backend
- Webhook signature verification
- Idempotent webhook processing
- Payment ledger
- Platform fee calculation
- Investigator payout calculation
- Refunds and partial refunds
- Cancellation handling
- Dispute and chargeback handling
- Payout status synchronization
- Currency and rounding rules
- No raw card data stored by the platform
- Receipts for customers and invoices for investigators and agencies, generated from the ledger — never computed separately from it (§30)

Do not mark an assignment as paid based only on a client-side callback. Trust verified provider webhooks and reconcile periodically.

---

## 13. Messaging and Notifications

### Messaging

Two kinds of conversation, one model (§30):

- **Pre-hire** — one mission × one supplier workspace, free, before any payment. The customer can open one with any matched or quoting investigator. An eligible investigator can ask a question on a published mission, which opens a thread; **until the customer replies, the investigator can send one message and no more** — pre-hire contact must never become unsolicited approaches.
- **Assignment** — the pre-hire thread with the hired supplier continues as the assignment conversation, history intact. Every other pre-hire thread on the mission closes, read-only and retained.

Rules for both:

- **The customer's identity is masked until hire.** Investigators see a first name and the mission — never a surname, email, phone or photo. After hire they see what the assignment requires; anything more is the customer's choice to disclose.
- **Contact details are blocked, not delivered.** Phone numbers, email addresses and messaging-app handles are detected server-side before delivery; the sender is told why. Repeated attempts are flagged to moderation. Work and payment stay on the platform.
- **Messages pass the same deterministic policy screening as missions.** A request for something prohibited (ADR-0009's standing prohibitions) is flagged to moderation and the investigator is shown the policy, not left to judge alone.
- **In-app voice calling is planned for later** (T-108): masked numbers, no recording by default, and recording consent confirmed by counsel first.
- Conversations are two-party rows under row-level security (ADR-0011); inside an agency, the member handling the lead or assignment sees the thread, as do holders of `leads.read`.
- Customer/investigator participants only unless staff is authorized
- Text messages initially
- Attachments through MediaModule
- Message moderation and abuse reporting
- Read status
- Delivery status where feasible
- Server-side authorization for every message and attachment

### Notifications

- Push notifications
- Email notifications
- In-app notification center
- Notification preferences
- Localized templates
- Retry and dead-letter handling

Events may include:

- Mission submitted
- Quote received
- Quote accepted
- Payment confirmed
- Assignment accepted
- New message
- Evidence uploaded
- Report submitted
- Revision requested
- Assignment completed
- Dispute opened
- Verification expiring

---

## 14. Cloudinary Media Architecture

Cloudinary is the selected media provider for the MVP.

### Media categories

- Profile images
- Verification documents
- Mission attachments
- Evidence images and videos
- Report attachments
- Message attachments
- Generated previews/thumbnails

### Required design

1. Client requests an upload authorization from the backend.
2. Backend verifies user, role, mission/assignment relationship, file category, and allowed size/type.
3. Backend returns a restricted upload signature or approved upload parameters.
4. Client uploads directly to Cloudinary where practical.
5. Cloudinary response is validated by the backend.
6. Backend stores the media asset and ownership metadata in PostgreSQL.
7. Access is granted only after backend authorization.
8. Backend generates short-lived signed delivery URLs or authenticated delivery responses.
9. Every sensitive access is auditable.
10. Storage paths are derived from the execution context (`tenant/{tenantId}/{category}/{uuid}`) by the storage layer, never built in business code — and folders are organisation, not authorization (ADR-0011).

### MediaAsset fields

- ID
- Owner/user ID
- Resource type
- Related entity type and ID
- Cloudinary asset ID
- Cloudinary public ID
- Resource type and delivery type
- Version
- Format
- MIME type
- Size
- Width/height/duration
- Checksum if available
- Upload status
- Virus scan status
- Visibility classification
- Retention date
- Deleted timestamp
- Created/updated timestamps

### Security and operations

- Use separate Cloudinary environments or folders for development, staging, and production.
- Never expose unrestricted delivery URLs for private evidence.
- Do not trust client-supplied public IDs.
- Validate Cloudinary webhook signatures if webhooks are used.
- Keep a deletion workflow that removes the Cloudinary asset and marks the database record deleted.
- Define retention rules for verification documents, evidence, reports, and deleted accounts.
- Add upload quotas and rate limits.
- Restrict allowed formats and maximum file sizes.
- Generate thumbnails/previews without exposing original files.
- Consider malware scanning before making uploads available to other users.
- Document Cloudinary data-region and compliance implications for target markets.

---

## 15. Evidence and Reports

### Evidence

Evidence items must be linked to an assignment and include:

- Title
- Description
- Capture date/time when known
- Location metadata only when lawful and necessary
- Media asset reference
- Chain-of-custody metadata
- Hash/checksum when feasible
- Visibility and access grants
- Uploading user
- Review status
- Audit history

### Reports

- Draft report
- Versioned report revisions
- Structured summary
- Findings
- Methodology
- Limitations
- Attachments
- Investigator signature/approval
- Customer review state
- Finalization timestamp

The system must distinguish between investigator-submitted evidence, AI-generated summaries, and human-approved final reports.

AI must not fabricate findings or claim that an unverified item is factual. AI-generated text must be clearly marked until reviewed.

---

## 16. AI Assistant Architecture

### Core principle

```text
User Request
  ↓
AI Gateway
  ↓
Intent Classification
  ↓
Context Resolution
  ↓
Role and Permission Scope
  ↓
Choose Strategy
  ├── Structured Tool
  ├── Semantic Retrieval
  ├── Hybrid Search
  └── General Explanation
  ↓
Plan
  ↓
Validate
  ↓
Confirm if Required
  ↓
Execute Backend Service
  ↓
Persist State
  ↓
Audit
  ↓
Localized Response
```

### AI pipeline

**The active workspace and actor come from the execution context before step 1 and hold to the last step.** No step produces, changes or infers them; the model never chooses a tenant, a user id or a membership (ADR-0011). Multi-command requests are planned as a DAG with one confirmation over the whole plan hash, and the pipeline asks rather than guesses when a request is ambiguous (ADR-0012):

```text
normalise → classify → model semantics → resolve context and entities → retrieve
  → select commands (registry) → plan → order as a DAG → validate → authorize
  → assess risk (declared) → confirm → execute → verify → audit → respond
```

1. Classify intent.
2. Resolve conversation and user context.
3. Identify entities such as mission, quote, assignment, investigator, report, or payment.
4. Determine role and permission scope.
5. Select structured tools, retrieval, hybrid search, or explanation mode.
6. Build a structured plan.
7. Validate arguments using schemas.
8. Request confirmation for impactful actions.
9. Execute through backend application services.
10. Persist state through normal domain logic.
11. Record tool calls and outcomes in the audit log.
12. Return a localized response with source references where appropriate.

### Surface

**Every capability below is reachable through the web application.** The assistant is not a
side feature: customer and investigator capabilities live in `app.`, staff capabilities in
`admin.` (a separate origin with a separate session, ADR-0002), so there are two integrations
rather than one component mounted twice.

Responses render progressively rather than behind a spinner; tool results render as structured
data rather than prose; and every state-changing action passes through the confirmation UI,
which surfaces a pending plan when a user returns to a session. Implementation: T-056 to T-061.

### AI capabilities

Customer:

- Find investigators
- Explain investigator profiles
- Draft missions
- Improve mission descriptions
- Explain quotes and payments
- Show mission status
- Find authorized reports/evidence
- Draft messages
- Explain platform policies

Investigator:

- Summarize mission requirements
- Draft quotes
- Explain assignment scope
- Update availability through confirmed tools
- Summarize conversations
- Organize evidence metadata
- Draft report sections for human review
- Explain earnings and payout status

Agency members (within their permissions):

- Invite, update, suspend or remove employees
- Create and manage teams
- Create and update investigator profiles
- Quote, staff and reassign assignments
- Search the agency's own knowledge base
- Status and workload questions across the agency's assignments

Staff:

- Search missions within staff scope
- Summarize applications
- Identify overdue reports
- Find expiring verifications
- Draft support responses
- Summarize disputes
- Explain policy decisions

### AI restrictions

The AI must not:

- Access arbitrary database tables
- Generate or execute arbitrary SQL
- Bypass authorization
- Expose private evidence outside assignment permissions
- Send messages without authorization and required confirmation
- Accept quotes or trigger payments without explicit workflow controls
- Change mission state directly
- Make legal determinations
- Invent investigation findings
- Decide whether an investigator is legally licensed without verified records
- Choose, infer or accept a workspace, tenant id or membership from conversation, retrieval or tool output
- Carry memory or context from one workspace into another

---

## 17. RAG, pgvector, and Pinecone Strategy

### MVP recommendation: PostgreSQL + pgvector

Use pgvector initially because it provides:

- One source of truth
- SQL joins with users, missions, roles, and permissions
- Transactional consistency
- Lower operational cost
- Easier local development and backups
- Simple deployment on the existing PostgreSQL infrastructure
- Support for HNSW or IVFFlat indexes
- A straightforward migration path to another vector provider later

### Use cases for semantic retrieval

- Platform policies
- FAQs
- Investigator profile descriptions
- Service descriptions
- Help center content
- Internal operational documentation
- Localized knowledge content
- Approved report context where access is explicitly authorized

### Use normal SQL for

- My missions
- Payment status
- Investigator verification status
- Investigators in a city
- Investigators speaking a language
- Assignments due soon
- Unread messages
- Reports accessible to the current user

### Hybrid search

```text
Structured filters
  +
Permission checks
  +
PostGIS/geographic constraints
  +
Semantic similarity
  ↓
Ranked authorized results
```

### Permission-aware RAG

**Tenant scope first.** Platform documents carry no tenant and are filtered by visibility; agency documents carry `tenant_id` and are visible only in that workspace, enforced by RLS on the knowledge tables and again in the query. Order: context → permission filter → tenant filter → semantic search → rerank → context build (ADR-0011).

1. Vector search returns source IDs and similarity scores.
2. Backend loads source records from PostgreSQL.
3. Backend applies ownership, assignment, role, visibility, and staff-scope checks.
4. Backend removes unauthorized sources.
5. Only authorized text is sent to the model.
6. The response includes source references when useful.

Vector metadata is not an authorization system.

### Suggested tables

`knowledge_documents`:

- ID
- Type
- Title
- Locale
- Source reference
- Visibility scope
- Version
- Content hash
- Status
- Created/updated timestamps

`knowledge_chunks`:

- ID
- Document ID
- Chunk index
- Content
- Token count
- Embedding
- Embedding model
- Embedding version
- Metadata JSON
- Created timestamp

`embedding_jobs`:

- ID
- Source type
- Source ID
- Operation
- Status
- Attempt count
- Error message
- Model/version
- Created/updated timestamps

### Provider abstraction

```ts
interface VectorSearchProvider {
  upsertChunks(input: UpsertChunksInput): Promise<void>;
  deleteChunks(input: DeleteChunksInput): Promise<void>;
  search(input: VectorSearchInput): Promise<VectorSearchResult[]>;
}
```

Start with `PgvectorSearchProvider`. A future `PineconeSearchProvider` can be added without changing the AI domain layer.

### When Pinecone becomes reasonable

Evaluate Pinecone only when one or more of these become true:

- Vector traffic is large enough to require independent scaling.
- Search workloads must be isolated from transactional PostgreSQL.
- Multiple applications need a shared managed vector platform.
- Operational requirements justify another managed dependency.
- Hybrid or advanced retrieval features materially improve the product.

Even then, PostgreSQL must remain authoritative for permissions and business state.

---

## 18. AI Tools and Commands

Define tools with strict schemas and explicit authorization metadata.

Example tool categories:

- `searchInvestigators`
- `getInvestigatorProfile`
- `createMissionDraft`
- `updateMissionDraft`
- `submitMission`
- `listMyMissions`
- `listMyQuotes`
- `acceptQuote`
- `getAssignmentStatus`
- `listAuthorizedEvidence`
- `getAuthorizedReport`
- `draftMessage`
- `sendMessage`
- `getPaymentStatus`
- `getPayoutStatus`
- `searchKnowledge`

**The command contract (ADR-0012)** supersedes the list below: name and version, intent examples and aliases, domain/entity/operation, input and output schemas, tenant permissions and platform roles, `tenantScope` (`workspace` or `platform` — never a parameter), confirmation, declared risk level, bulk support and maximum batch size, idempotency, side effects, audit, failure behaviour, timeout and retry. Bulk variants exist only where many targets are natural, authorize every record, and report partial failure as partial. The list below is the original minimum and remains true.

Each tool should declare:

- Required role(s)
- Required resource scope
- Read or write operation
- Confirmation requirement
- Input schema
- Output schema
- Audit event type
- Rate limit

Use a command pipeline such as:

```text
Classify → Resolve → Semantic Match → Self-Verify → Enrich → Validate → Confirm → Execute
```

Do not expose every backend service as an AI tool. Expose small, purpose-built, safe operations.

---

## 19. Background Jobs and Events

Use Redis + BullMQ for asynchronous work.

Initial queues:

- Email notifications
- Push notifications
- Media processing
- Cloudinary asset validation
- Malware scanning
- Report generation
- Embedding generation
- Knowledge reindexing
- Payment reconciliation
- Payout reconciliation
- Verification reminders
- Mission expiration
- Cleanup and retention
- Analytics aggregation

Use an outbox pattern for reliable event publication:

1. Write domain change and outbox event in one database transaction.
2. Worker publishes/processes the event.
3. Mark event as processed.
4. Retry with exponential backoff.
5. Send permanently failing events to a dead-letter queue.

All jobs must be idempotent.

**Jobs carry their workspace (ADR-0011).** A job stores `tenantId`, `userId` and `membershipId` — ids, never permissions. The worker re-reads the membership and workspace status, restores the execution context, and runs through the same transaction path as a request, so row-level security applies exactly as it does over HTTP. A job queued by a member who has since been removed does not run with their old authority.

---

## 20. Observability and Audit

### Application observability

- Structured JSON logs
- Correlation/request IDs
- Sentry error tracking
- Prometheus metrics
- Grafana dashboards
- Uptime Kuma checks
- Worker queue metrics
- Database health metrics
- API latency and error-rate metrics
- Cloudinary upload and delivery failure metrics
- Payment webhook monitoring

### Audit logging

Audit events should include:

- Actor ID or system actor
- Role and staff scope
- Action
- Resource type and ID
- Previous state where appropriate
- New state where appropriate
- IP/device metadata where lawful
- Timestamp
- Correlation ID
- Reason or policy reference
- Workspace (`tenant_id`), membership and session — filled from the execution context, never passed by callers (ADR-0011)
- For AI actions: normalised intent, classification, command and version, plan id and hash, confirmation, execution result and affected resources (ADR-0012)
- For platform staff acting across workspaces: the scope and the stated reason

Audit logs must be append-only from the application perspective and protected from ordinary user access.

---

## 21. Testing Strategy

### Unit tests

- Domain rules
- State transitions
- Pricing and fee calculations
- Permission policies
- Mission policy classification rules
- Localization utilities
- AI tool schemas

### Integration tests

- PostgreSQL repositories
- PostGIS queries
- Authentication flows
- Authorization boundaries
- Quote acceptance
- Payment webhook handling
- Cloudinary upload authorization
- Evidence access
- Report visibility
- Outbox and queue processing

### End-to-end tests

- Customer registration to mission submission
- Investigator verification flow
- Quote to paid assignment
- Assignment to report completion
- Dispute flow
- Role switching
- Mobile deep links and notifications
- Admin moderation flow

### Security tests

- IDOR/resource-access tests
- Broken role checks
- Unauthorized evidence access
- Signed URL misuse
- File upload bypasses
- Rate-limit tests
- Webhook replay tests
- Prompt injection tests for RAG
- Tool authorization tests
- Sensitive-data leakage tests
- **Tenant isolation matrix** — generated per table: cross-workspace SELECT/INSERT/UPDATE/DELETE refused as the runtime role; no context returns nothing; connection reuse across tenants leaks nothing (ADR-0011)
- Cross-workspace probes over every route, RAG query, memory read, command, confirmation, cache entry, file delivery and worker job

A task is not complete until relevant tests and validation commands pass.

---

## 22. Localization

- Store translation keys, not hardcoded UI strings.
- Keep translations in shared packages.
- Support locale-aware dates, numbers, currencies, and time zones.
- Store canonical data in a language-neutral format.
- Use localized content versions for knowledge documents and policy pages.
- AI responses must follow the user’s selected language.
- Add fallback behavior when a translation is missing.

---

## 23. Admin and Operations

Admin web capabilities:

- User search and account review
- Investigator verification queue
- Mission policy review queue
- Dispute management
- Payment and payout reconciliation
- Content/category management
- Translation management
- Audit-log viewer
- Media/evidence access review
- Abuse reports
- System health dashboard
- Feature flags
- Retention and deletion workflows

Every staff action must be permissioned, logged, and explainable.

Staff see across workspaces **only inside `PlatformContext`**: a platform staff scope plus a stated reason, audited with every access, for one unit of work. There is no ambient cross-tenant role and no `BYPASSRLS` database role. Agency owners and admins are never platform staff by virtue of their tenant role. Admin capabilities gain: agency verification review, agency suspension and lifecycle actions, and workspace-scoped audit review.

---

## 24. Deployment Plan

### MVP environment

Use Docker Compose with:

- API container
- Worker container
- Marketing web container
- Admin web container
- PostgreSQL/PostGIS container
- Redis container
- Caddy container
- Monitoring components as capacity permits

Cloudinary remains external for media storage and delivery.

### Environments

- Local
- Development
- Staging
- Production

Never share production secrets with local development or autonomous coding agents.

### CI pipeline

```text
Install
  ↓
Lint
  ↓
Typecheck
  ↓
Unit tests
  ↓
Integration tests
  ↓
Build
  ↓
Security checks
  ↓
Migration validation
  ↓
Artifact creation
```

### Deployment controls

- Protected main branch
- Required review for high-risk changes
- Database migration backup before production
- Rollback plan
- Health checks
- Zero-downtime strategy when practical
- Post-deployment smoke tests
- Monitoring alerts

---

## 25. Scaling Roadmap

### Stage 1: MVP

- One VPS
- Modular monolith
- PostgreSQL/PostGIS/pgvector
- Redis and BullMQ
- Cloudinary for media
- Docker Compose
- Basic monitoring and backups

### Stage 2: Growing traffic

- Separate PostgreSQL server
- Dedicated worker server
- Managed or replicated Redis if needed
- CDN and caching improvements
- Database indexes and query optimization
- Read replicas for read-heavy workloads
- Load balancer
- Horizontal API replicas
- Separate media-processing workers

### Stage 3: High traffic

- Multiple API instances
- Autoscaling infrastructure
- Queue partitioning
- Database read replicas
- Partitioning or sharding only when justified by measured workload
- Regional deployments and data residency strategy
- Service extraction for independently scaling domains
- Dedicated search infrastructure if PostgreSQL search is no longer sufficient
- Dedicated vector database such as Pinecone only if justified

Do not introduce sharding, microservices, or a graph database before metrics demonstrate the need.

Tenancy is designed so these stay open without being built: `tenant_id` (or a party column) leads every tenant-scoped index, and the tenant context is established in one place — so partitioning by tenant, moving one large agency to its own database, read replicas and regional residency are additive when metrics justify them (ADR-0011).

---

## 26. MVP Development Phases

### Phase 0 — Legal, product, and architecture foundation

- Define lawful-use policy and prohibited mission categories.
- Confirm target launch countries and investigator licensing requirements.
- Define terms, privacy policy, consent, retention, dispute, and refund rules.
- Finalize domain model and state machines.
- Create repository and harness rules.
- Configure CI, environment management, and secret handling.

### Phase 1 — Technical foundation

- Initialize monorepo.
- Configure TypeScript, linting, formatting, and testing.
- Create NestJS modular API.
- Configure PostgreSQL/PostGIS and Redis.
- Configure Docker Compose.
- Add authentication and session management.
- Add shared validation, types, API client, and localization.
- Add logging, health checks, and audit infrastructure.

### Phase 2 — Profiles and verification

- Customer profile.
- Investigator profile.
- Languages, specialties, service areas, and availability.
- Verification document workflow.
- Admin verification queue.
- Cloudinary upload authorization and private media handling.

### Phase 3 — Missions and discovery

- Mission categories and structured forms.
- Mission drafts and submission.
- Policy/risk review.
- Investigator discovery with PostGIS.
- Filters for language, specialty, verification, availability, and location.

### Phase 4 — Quotes and assignments

- Quote creation and comparison.
- Quote expiration.
- Customer confirmation.
- Assignment creation.
- Assignment state machine.
- Notifications.

### Phase 4b — Workspaces, agencies and tenant isolation (ADR-0011, §29)

Lands before any further feature work, so everything after it is born tenant-aware.

- Runtime connects as the non-bypass application role; tests move with it.
- Workspaces, memberships and a Personal workspace for every user.
- Execution context, workspace resolution, transaction-local database context.
- Tenant and party columns on existing tables; row-level security with a generated isolation matrix.
- Tenant permissions; `PlatformContext` for staff; tenant-aware audit, storage, cache and jobs.
- Agency registration, profile, settings and branding; employees; teams; investigator profiles under workspaces; agency verification; supplier-workspace quotes and assignment staffing; agency lifecycle.
- Workspace switcher and mobile-first agency console.
- Command registry contract and plan DAGs (ADR-0012) as Phase 7 is built.

### Delivery order (decided 2026-09-19)

Phases describe *what*; this is *when*. The goal is the core loop working end to end in **one launch market** before anything that market does not need:

1. **T-069**, then the **tenancy foundation** (T-073 to T-080) — everything after it is born tenant-aware.
2. **The core loop**, API and screens together (`TODO.md` "Core loop"): sign-up, guided mission intake, discovery and matching, identity masking, pre-hire conversations, quotes, Stripe payments with funds held, the investigation workspace, evidence, reports, disputes, payouts, receipts and invoices — in the market's languages.
3. **Agencies** (T-083 to T-094, T-104, T-105, T-107).
4. **The AI assistant** (Phase 7) continues on its own dependencies, tenant-aware throughout.

Liquidity — enough verified investigators in one place that a customer gets a good match fast — decides a marketplace. A thin presence in several countries loses to a dense one in one market, which is why the market is chosen first (ACTIONS-FOR-ME #18).

### Phase 5 — Payments and payouts

- Payment provider integration.
- Webhook processing.
- Payment ledger.
- Platform fees.
- Payout tracking.
- Refund and cancellation flows.

### Phase 6 — Messaging and delivery

- Assignment-scoped messaging.
- Push/email notifications.
- Evidence upload and access grants.
- Report versions and customer review.
- Completion and review flow.
- Disputes.

### Phase 7 — AI assistant and RAG

- AI gateway.
- Tool registry.
- Structured command pipeline.
- Permission-aware retrieval.
- Knowledge documents and chunks.
- pgvector extension and indexes.
- Embedding jobs and reindexing.
- Hybrid search.
- AI audit logs.
- Human confirmation for mutations.

### Phase 8 — Admin, observability, and launch readiness

- Admin dashboards.
- Abuse and dispute tooling.
- Prometheus/Grafana dashboards.
- Centralized logs.
- Backup restore test.
- Security testing.
- Load testing.
- Data-retention testing.
- Production runbooks.
- Beta launch with limited countries and investigator categories.

---

## 27. MVP Completion Criteria

The MVP is complete when:

- A customer can register, create a lawful mission, and submit it.
- An investigator can register, complete a profile, submit verification, and define service areas.
- Staff can approve or reject verification.
- Customers can discover eligible investigators.
- Investigators can submit quotes.
- Customers can accept a quote and complete payment.
- An assignment is created exactly once and follows a validated state machine.
- Customer and investigator can communicate within assignment scope.
- Investigators can upload private evidence through Cloudinary.
- Customers can access only authorized evidence and reports.
- Investigators can submit versioned reports.
- Customers can complete, review, or dispute an assignment.
- Payment and payout states are reconciled through verified webhooks.
- All sensitive actions are audited.
- The AI assistant can answer authorized questions and execute only approved, validated tools.
- pgvector retrieval is permission-aware.
- English, Russian, and Armenian are supported through translation keys.
- Automated tests, security checks, backups, monitoring, and deployment runbooks exist.
- An agency can register, complete a profile progressively, invite employees who accept, organise teams, run investigator profiles, quote and staff assignments — and suspend or remove a member with effect on their next request.
- Workspace isolation is enforced by PostgreSQL row-level security as the runtime role, proven by the generated isolation matrix, connection-reuse tests and cross-workspace probes over API, AI, RAG, cache, files and workers.
- Users belonging to several workspaces switch safely; nothing tenant-specific survives a switch.

---

## 28. Immediate First Milestone

Start with the smallest vertical slice that proves the architecture:

1. Monorepo and harness setup.
2. NestJS API with PostgreSQL/PostGIS and Redis.
3. Authentication and role switching.
4. Customer and investigator profiles.
5. Cloudinary private upload flow.
6. Mission creation and submission.
7. Investigator discovery by city, language, specialty, and verification status.
8. Quote submission and acceptance.
9. Assignment creation with an idempotent transaction.
10. Basic admin verification queue.
11. Tests for authorization, mission transitions, Cloudinary access, and quote acceptance.
12. Update `TODO.md` only after validation passes.

The first milestone is **web-only** (ADR-0004) — the mobile companion follows once the core web workflow is proven. It should not include advanced AI agents, the investigation intelligence layer or its graph (ADR-0005), live video, Pinecone, microservices, sharding, or autoscaling. Those should be added after the core marketplace flow is reliable and measurable.

---

## 29. Workspaces, Agencies and Tenant Isolation (ADR-0011, ADR-0012)

The platform becomes multi-tenant: agencies register as organisations and operate through the marketplace as organisations. This is an **architectural change, not a column**. Design reference: `docs/architecture/tenancy.md`. Work queue: `TODO.md` Phase 4b.

### The rule

> Tenant isolation is an infrastructure and database security boundary, not business-domain plumbing. The active workspace is resolved from trusted authentication context at the request or job boundary; the execution environment carries it; PostgreSQL enforces it. Services, domain methods, AI commands and repositories never take a `tenant_id` parameter. `tenant_id` lives in schemas, indexes, policies, cache keys, audit rows, jobs and infrastructure metadata — and isolation never depends on a developer remembering a filter.

(CLAUDE.md non-negotiable 16.)

### Model

`User` (identity) ≠ `Tenant` (workspace) ≠ `Membership` (employee) ≠ `InvestigatorProfile` (capability). Every user has a **Personal** workspace; agencies are `AGENCY` workspaces. Individual customers and independent investigators keep working exactly as before, from their Personal workspace.

### Marketplace across workspaces

A mission belongs to the customer's workspace; quotes and assignments carry `customer_tenant_id` and `supplier_tenant_id` and name a lead investigator. **The assignment remains the investigation** (§8) — agency staffing (team, members, lead) is recorded against it, and inside an agency a member reaches an assignment only by being staffed on it or holding `investigations.read_all`.

### Isolation

| Layer | Answers | Mechanism |
|---|---|---|
| Database | Which workspace's rows can this execution touch? | RLS as the non-bypass runtime role, `FORCE`d, keyed on `set_config(…, true)` set as the first statement of every transaction; no context → no rows |
| Application | What may this member do, to which record, in which state? | The six checks (§7) plus tenant permissions |

The client selects the workspace with `X-Workspace`; the server intersects it with ACTIVE memberships read per request. Body, query, URL, AI output and MCP input are never a tenant. Platform staff cross workspaces only inside `PlatformContext` (scope + reason + audit).

### Everything inherits the context

Jobs, cache keys, storage paths, audit rows, notifications, embeddings and retrieval, AI sessions (one workspace for life), memory (explicit scopes — `user_in_tenant` by default, `user_global` only for declared preferences), plans and confirmations. Commands declare `tenantScope`; it is never an input.

### Where the brief was adapted, not copied

| Brief | Adopted as | Why |
|---|---|---|
| §44 "reject surveillance; public information only" | **ADR-0009 stands** (owner decision, 2026-09-19): lawful surveillance with a stated basis, screening and licensing; every standing prohibition unchanged | The brief also requires preserving the existing safety policies, which are ADR-0009's. Agencies inherit every restriction and weaken none |
| `investigations`, `investigation_assignments` tables | Mission + Assignment, and `assignment_staff` | The assignment is the investigation (§8); a second entity would split its state machine and audit trail |
| Employee lifecycle `INVITED → ACCEPTED → ACTIVE → …` | Invitations (`PENDING/ACCEPTED/CANCELLED/EXPIRED`) + memberships (`ACTIVE/SUSPENDED/REMOVED`) | "Accepted" is an event, not a state anyone remains in |
| Agency role "Staff" | Key `AGENCY_STAFF`, labelled "Staff" | `STAFF` already means platform employee with scopes |
| Billing, subscriptions, usage records | Permissions and model reserved; **not built** until the payments provider and pricing are decided (ACTIONS-FOR-ME #17) | Owner decision, 2026-09-19 |
| Customers/Orders inside a tenant | The customers of the agency's assignments, derived. **Agencies' own off-platform clients: later, under their own ADR** (§30) | Marketplace first (owner decision, 2026-09-19); off-platform cases would still need lawful-use screening |
| Cache infrastructure | A tenant-deriving cache wrapper built with its first consumer | No cache exists; infrastructure is not added before it is needed |
| Mobile UX | The responsive web app (ADR-0009) — mobile-first, sheets not modals, card lists not tables | The native companion remains deferred |
| React Bits | Within the existing registry order: `@shadcn` → `@cult-ui` → `@react-bits` → custom (ADR-0003) | Already the project rule; React Bits' commercial terms are still with counsel (T-030) |
| Risk assessment | Declared per command + mission policy screening | A learned risk engine is not in scope (ADR-0012) |

### Compliance carries over

Investigator compliance and permanent bans (T-049) are unchanged and now reach the agency: an agency answers for its members' conduct on the platform, a banned person is banned in every workspace, and registering a new agency does not reset a banned identity. Decisions still follow a documented review with sufficient evidence.

### Definition of done

§27's tenancy criteria, plus: existing functionality passes unchanged under isolation, the documentation in `docs/architecture/` and the knowledge base describes what shipped, and no manual step remains in `ACTIONS-FOR-ME.md` that tooling could have done.

---

## 30. Hiring Experience — the Pursuut Benchmark

The owner's reference product is **Pursuut** (pursuut.com, reviewed 2026-09-19): a consumer marketplace for vetted, licensed investigators with surveillance as its headline service, case management for investigators, and "AgentOS" — an operating system for firm owners, announced but not yet released. It is the same three-sided shape as this platform: customers, investigators, agencies. What it adds is mostly about **how hiring feels**, and this section records how those ideas are adopted here.

### Mapping

| Pursuut | Here | Where |
|---|---|---|
| Vetted, licensed investigators | Verification, licensing gate for surveillance | T-013, T-071, ADR-0009 |
| Describe your case in plain language → a brief | Guided intake; the assistant may draft; the customer confirms | §10 |
| Get matched | A shortlist computed at publication, plus discovery | §9, T-103 |
| Talk before you pay; free | Pre-hire conversations | §13, T-101 |
| Investigators see your case, not your identity | Identity masked until hire | §13, T-100 |
| Payments protected in escrow against an agreement | The accepted quote is the agreement; charged at acceptance, held, released on completion | T-012, T-110 to T-113 |
| Case management: cases, evidence, timelines | The investigation workspace, evidence and reports | T-031 to T-033, T-116, T-117, T-125 |
| Track findings in one place | Evidence and report review for the customer | T-116, T-117, T-122 |
| Invoicing and payouts in-platform | Payouts to connected accounts; receipts and invoices from the ledger | T-112, T-114, T-126 |
| AgentOS: lead triage and routing | Agency lead inbox | T-104 |
| AgentOS: oversee cases across the team | Staffing and `investigations.read_all` | T-089, T-093 |
| AgentOS: billing, branding, reporting | Branding built; reporting planned; billing reserved | T-084, T-105, T-099 |
| Secure in-app calling | Planned for later | T-108 |

### Owner decisions, 2026-09-19

| Question | Decision |
|---|---|
| Pre-hire messaging and identity masking | **Adopted.** First name only until hire; contact details blocked; one unanswered message per investigator |
| In-app calling | **Later.** After messaging; masked numbers; no recording by default; counsel confirms recording consent (counsel brief Q32) |
| Agencies' own off-platform clients and cases | **Marketplace first.** The lead inbox and reporting ship with agencies; off-platform clients come later under their own ADR, and would still pass lawful-use screening |
| Matching within minutes vs moderation | **Every mission reviewed at launch.** Latency measured from day one; auto-publishing low-risk categories is a later, data-based decision confirmed by counsel; partner investigation never auto-published |

### Where this platform deliberately differs

- **Every mission is moderated before an investigator sees it.** Slower than "matched within minutes", and the main protection against unlawful requests.
- **Global and multilingual** (`en`, `ru`, `hy`), not a single-country directory.
- **An AI assistant** over the whole product, under the same authorization as the web app (§16).
- **Workspace isolation enforced by the database** (ADR-0011), because agencies' client data is exactly what a competitor would want.

### Agency lead inbox (AgentOS parity)

A `Lead` is an agency's inbox item for one mission: created by a match, a customer's invitation, an investigator's pre-hire question or a member choosing to pursue a mission from browse. States: `NEW → ROUTED → QUOTED → WON | LOST`, or `DECLINED`. A member with `leads.route` routes a lead to a member or team, who then handles the conversation and the quote; routing is audited. Response time is measured, because customers compare it. Leads are tenant-owned rows under row-level security.

### Agency reporting

Pipeline (leads → quotes → won), response times, active assignments by member and team, overdue work, and — once Phase 5 exists — earnings. Read-only, computed from PostgreSQL, behind `analytics.read`. No third-party analytics receives client data.
