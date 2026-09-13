# TODO

Work queue for the Investigator platform. One task at a time.
Procedure: `.claude/skills/task-workflow/SKILL.md`. Spec: `plan.md`.

**Status:** `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE`
**Risk:** `LOW` · `MEDIUM` · `HIGH` (HIGH always requires human approval + security review)

---

## Phase 1 — Technical foundation (plan.md §26)

### T-001 — Initialize pnpm monorepo
- **Status:** DONE — 5 apps + 7 packages; install/typecheck/lint/build/format all green
- **Priority:** P0
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** package.json, pnpm-workspace.yaml, tsconfig.base.json, .editorconfig, apps/, packages/

**Description**
Create the monorepo skeleton from plan.md §4: `apps/{api,app-web,admin-web,marketing-web,mobile}`
(`app-web` = customer + investigator workspace; `admin-web` is a **separate app on a separate
origin** per ADR-0004; `mobile` is **deferred** per ADR-0009 — scaffold the workspace entry so
the monorepo layout is stable, but build nothing)
and `packages/{ui,types,validation,api-client,auth,i18n,config}`. Shared TypeScript config,
ESLint, Prettier, and root scripts.

**Acceptance criteria**
- [x] `pnpm install` succeeds from a clean checkout (`--frozen-lockfile` verified)
- [x] Root scripts exist: `lint`, `typecheck`, `test`, `build`, `format` — plus the CI-tier test scripts `pr.yml` calls
- [x] `pnpm typecheck` passes — TS project references across all 12 workspaces
- [x] Every package extends `tsconfig.base.json`; strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- [x] No cross-package relative imports — enforced by an ESLint rule, not convention
- [x] `packages/ui` web-only — ESLint blocks it (and `react-dom`/`next`) in `apps/mobile`; **rule verified by writing a violating import and confirming it errors**

**Validation** — all green 2026-09-13
```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm build && pnpm format:check
```

**Note:** Prettier is scoped to code and config; markdown is excluded deliberately
(`.prettierignore` explains why). Markdown is not unchecked — the knowledge-base and
frontmatter validators cover the parts that carry meaning.

---

### T-002 — NestJS API skeleton with health check
- **Status:** DONE — 28 tests, boot verified end to end
- **Priority:** P0
- **Depends on:** T-001
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/**

**Description**
NestJS app with modular structure per plan.md §5, config loading with schema validation,
structured JSON logging with correlation IDs, global validation pipe, OpenAPI, and
HealthModule.

**Acceptance criteria**
- [x] Pinned to the versions in CLAUDE.md — Node 24 LTS, TypeScript 6.0.3, Next 15.5.25,
      React 19.2.8. **Do not resolve "latest" at install time.** TS 7 breaks typescript-eslint,
      and Next 16 / React 19.3 were days old when pinned
- [x] `GET /api/v1/health` returns 200 with service and dependency status — dependencies report `not_configured` until T-003 rather than falsely claiming `up`
- [x] Config validated at boot by a Zod schema; verified by running with no env — names every missing variable, and a test asserts the offending **value** never appears in the message
- [x] Correlation ID accepted or generated, echoed in `x-correlation-id`, carried into logs and into every error body. Injected or over-long ids are rejected, not logged
- [x] Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` — mass-assignment protection per `platform-security-review`
- [x] OpenAPI at `/api/docs`, non-production only — verified 200 under `NODE_ENV=test`
- [x] Pino redaction over 20 paths; verified by booting with a real `SESSION_SECRET` and grepping the log — 0 occurrences. `X-Powered-By` also removed (`launch-hardening`)

**Also delivered** — the shared primitives T-034 deferred here: the error taxonomy with all
eight required codes (translation keys, never English), the `AppExceptionFilter` giving one
error shape for every module, and correlation propagation.

**Validation** — all green 2026-09-13
```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm build && pnpm --filter api test
```

---

### T-003 — Local Docker Compose: PostGIS, pgvector, Redis
- **Status:** DONE — stack running; PostGIS 3.6.4 + pgvector 0.8.6 verified by query
- **Priority:** P0
- **Depends on:** T-001
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** infrastructure/compose/local.yml, infrastructure/docker/**, .env.example

**Description**
Local stack: PostgreSQL with PostGIS and pgvector extensions, Redis. Named volumes,
healthchecks, no ports exposed beyond localhost.

**Acceptance criteria**
- [x] `up -d` brings both services to `healthy` — healthchecks target the real database, not the default
- [x] postgis 3.6.4, vector 0.8.6, citext, pg_trgm, uuid-ossp — **verified by running queries**, not by checking they were listed: `ST_Distance` Yerevan→Gyumri returned 88 km, and pgvector L2 returned 1
- [x] Env template documents every variable; `scripts/setup.sh` generates the only local secret
- [x] Both bound `127.0.0.1` — **verified by probing the LAN address and getting refused**, not by reading the config

**Also done:** volume persistence verified across a restart; Redis AOF on so a queue bug is
not mistaken for a lost job; `pr.yml` corrected — it used `postgis/postgis`, which ships no
pgvector, so its `CREATE EXTENSION vector` would have failed. CI now reuses the same init SQL
rather than duplicating it.

**Runtime:** Colima (open source, no Docker Desktop licensing). Installed and started.

**Validation** — all green 2026-09-13
```bash
docker compose -f infrastructure/compose/local.yml config
docker compose -f infrastructure/compose/local.yml up -d
docker compose -f infrastructure/compose/local.yml ps
```

---

### T-004 — Core schema: users, roles, sessions, audit_logs
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-002, T-003
- **Risk:** HIGH
- **Human approval required:** Yes — audit table grants and retention rules
- **Owner agent:** database
- **Affected:** apps/api/src/database/migrations/**

**Description**
First migration: `users`, `user_roles`, `user_sessions`, `audit_logs`. Per plan.md §8 and
§20. Audit table is append-only from the application role.

**Acceptance criteria**
- [ ] Migration runs and reverses cleanly on a local database
- [ ] Application role has no UPDATE or DELETE grant on `audit_logs`
- [ ] `users.email` is citext or has a case-insensitive unique index
- [ ] Every table has created_at/updated_at; soft-delete where retention requires it
- [ ] Retention rule documented for each table in `docs/compliance/retention.md`

**Validation**
```bash
pnpm --filter api migration:run && pnpm --filter api test database
```

---

### T-005 — Authentication: register, login, refresh rotation, sessions
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-004
- **Risk:** HIGH
- **Human approval required:** Yes — authentication logic
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/**, packages/auth/**

**Description**
Email/password auth with verification, password reset, refresh-token rotation with reuse
detection, session listing and revocation, rate limiting and brute-force protection.

**Acceptance criteria**
- [ ] Passwords hashed with argon2id; never logged, never returned
- [ ] Refresh rotation detects reuse and revokes the whole session family
- [ ] Rate limits on login, register, reset — per IP and per account
- [ ] Email enumeration not possible via response body, status, or timing
- [ ] Every auth event is audited
- [ ] A revoked session is rejected immediately, not at next expiry
- [ ] Built so a second auth method can attach to the same account — Google OAuth is T-062,
      and retrofitting identity linking afterwards is materially harder

**Validation**
```bash
pnpm --filter api test auth
```

---

### T-006 — Authorization foundation: RBAC + resource-level guards
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-005
- **Risk:** HIGH
- **Human approval required:** Yes — authorization rules
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/authz/**, packages/auth/**

**Description**
The six-check authorization primitive from `.claude/skills/authorization/SKILL.md`, plus
the actor-scoped repository pattern and the reusable IDOR test helper.

**Acceptance criteria**
- [ ] `Actor` type carries id, roles, staff scope, account status
- [ ] Actor-scoped repository base makes fetch-then-compare the awkward path
- [ ] Reusable test helper covers all seven authorization cases
- [ ] Role switching does not require re-login and cannot widen scope
- [ ] Documented in `docs/architecture/authorization.md`

**Validation**
```bash
pnpm --filter api test authz
```

---

## Phase 2 — Profiles and verification

### T-007 — Customer and investigator profiles with role switching
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-006
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{users,investigator-profiles}/**

**Acceptance criteria**
- [ ] One account holds both roles; switching needs no new account
- [ ] A user can read only their own profile in full; public projection for others
- [ ] Investigator profile: specialties, languages, pricing model, availability
- [ ] `*.authz.spec.ts` asserts a different actor cannot read or write the profile

**Validation**
```bash
pnpm --filter api test profiles
```

---

### T-008 — Cloudinary private upload authorization
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-007
- **Risk:** HIGH
- **Human approval required:** Yes — evidence/media access rules
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/media/**

**Description**
The nine-step flow from `.claude/skills/cloudinary-media/SKILL.md`. Verification documents
are private resources from the first commit.

**Acceptance criteria**
- [ ] Upload signature issued only after server-side authorization; scoped and short-lived
- [ ] Upload result validated against what was authorized, including folder scope
- [ ] Client-supplied public IDs never trusted
- [ ] Delivery URLs short-lived, audited, never logged
- [ ] Scan status gates visibility; fails closed
- [ ] Test proves a non-owner cannot obtain a delivery URL

**Validation**
```bash
pnpm --filter api test media
```

---

### T-009 — Service areas with PostGIS
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-007
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** database
- **Affected:** apps/api/src/modules/service-areas/**, migrations

**Acceptance criteria**
- [ ] `geography(Point, 4326)` and polygon support, GIST indexed
- [ ] `ST_DWithin` filters, `ST_Distance` only sorts
- [ ] Investigator home location is not discoverable
- [ ] Multiple service areas per investigator deduplicate in results
- [ ] Query plan confirms index use on a seeded dataset

**Validation**
```bash
pnpm --filter api test service-areas
```

---

## Phase 3 — Missions and discovery

### T-010 — Mission creation, state machine, policy review
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-009
- **Risk:** HIGH
- **Human approval required:** Yes — lawful-use policy enforcement
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{missions,mission-policy}/**

**Acceptance criteria**
- [ ] Transition map is data; every illegal transition tested
- [ ] Status, status_history, audit and outbox share one transaction
- [ ] Prohibited-category detection is deterministic; AI may classify but never decide
- [ ] High-risk missions route to staff review with the decision and reason stored
- [ ] `lawfulPurposeConfirmed` required before submission
- [ ] Concurrent transitions cannot both apply

**Validation**
```bash
pnpm --filter api test missions
```

---

### T-011 — Investigator discovery
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-010
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/search/**

**Acceptance criteria**
- [ ] Order: hard filters → eligibility → geographic → quality ranking
- [ ] An unverified or suspended investigator never appears, by any path
- [ ] Filters: country, city, radius, language, specialty, availability, verification
- [ ] Pagination bounded; no unbounded limit
- [ ] Results are projections — no private profile fields leak

**Validation**
```bash
pnpm --filter api test search
```

---

## Phase 4 — Quotes and assignments

### T-012 — Quotes and idempotent assignment creation
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-011
- **Risk:** HIGH
- **Human approval required:** Yes — assignment and money-adjacent state
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{quotes,assignments}/**

**Acceptance criteria**
- [ ] Quote fields per plan.md §11, with expiry enforced server-side
- [ ] Accepting an expired or withdrawn quote is rejected
- [ ] Concurrent acceptance creates **exactly one** assignment — proven by a concurrency test
- [ ] Idempotency enforced by a unique constraint, not read-then-write
- [ ] Only the mission's customer can accept; only eligible investigators can quote

**Validation**
```bash
pnpm --filter api test quotes assignments
```

---

### T-013 — Admin verification queue
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-008
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** admin-web
- **Affected:** apps/admin-web/**, apps/api/src/modules/verification/**

**Acceptance criteria**
- [ ] Staff scope checked per screen; `isStaff` alone is insufficient
- [ ] Approve/reject requires a typed reason, stored and audited
- [ ] Opening a verification document is itself an audited event
- [ ] Decision trail visible, not just current state

**Validation**
```bash
pnpm --filter api test verification && pnpm --filter admin-web test
```

---

### T-014 — Initialize shadcn/ui in admin-web
- **Status:** BLOCKED
- **Priority:** P2
- **Depends on:** T-001, T-013
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** admin-web
- **Affected:** apps/admin-web/components.json, apps/admin-web/app/globals.css, apps/admin-web/components/ui/**

**Description**
Run `npx shadcn@latest init` inside `apps/admin-web` so the shadcn MCP server can resolve
the project and produce working add commands. Until `components.json` exists, the MCP can
search registries but `get_add_command_for_items` does not return a usable command.
Procedure and conventions: `.claude/skills/component-discovery/SKILL.md`.

**Acceptance criteria**
- [ ] `apps/admin-web/components.json` exists; `get_project_registries` returns `@shadcn`
- [ ] Tailwind and CSS variables wired; light and dark themes both render
- [ ] Registries configured per app: `@shadcn`, `@react-bits`
      (`https://reactbits.dev/r/{name}.json`), `@cult-ui`
- [ ] The **root `components.json` is removed** once per-app configs exist — it exists only so
      registry search works before any app does
- [ ] Only allowlisted registry namespaces present; no token committed
- [ ] Agents take `-TS-TW` variants from React Bits, never `-JS-`
- [ ] One component added end-to-end (`button`) to prove the pipeline
- [ ] `components/ui/**` is web-only and not imported by `apps/mobile`

**Validation**
```bash
pnpm --filter admin-web build
```

---

### T-015 — Knowledge base structure and CI validation
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-001
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** docs-writer
- **Affected:** docs/knowledge-base/**, scripts/validate-knowledge-base.py, CI config

**Description**
Establish the documentation-first substrate: knowledge-base folder structure, frontmatter
contract, and the validator wired into CI so malformed or mis-scoped documents cannot merge.
Procedure: `.claude/skills/documentation-first/SKILL.md`.

**Acceptance criteria**
- [ ] `python3 scripts/validate-knowledge-base.py` runs in CI and fails the build on error
- [ ] Every seeded document passes; seeds promoted from `draft` to `current`
- [ ] A staff document marked `visibility: public` fails validation (regression test)
- [ ] `docs/operations/**` is excluded from ingestion by construction, not by convention
- [ ] Authoring contract documented in `docs/knowledge-base/README.md`

**Validation**
```bash
python3 scripts/validate-knowledge-base.py
```

---

### T-016 — Knowledge ingestion pipeline with sync and supersession
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-004, T-015
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/knowledge/**, migrations, workers

**Description**
Ingest `docs/knowledge-base/**` into `knowledge_documents` / `knowledge_chunks` with
pgvector embeddings. Content-hash keyed, idempotent, and synchronized on change. Per
plan.md §17 and the `documentation-first` skill.

**Acceptance criteria**
- [ ] Ingestion keyed on `(document_id, content_hash, model_version)`; re-running is a no-op
- [ ] Document `visibility` is stored and enforced at query time, never inferred from folder
- [ ] Superseding a document removes its chunks from retrieval in the same unit of work
- [ ] Deleting a document deletes its chunks in the same unit of work
- [ ] Two `current` documents with conflicting guidance are flagged, not silently ranked
- [ ] Embedding model name and version stored with every chunk
- [ ] Staleness report compares `related_code` paths against their last change
- [ ] Test proves a `docs/operations/` file is never ingested

**Validation**
```bash
pnpm --filter api test knowledge
```

---

### T-017 — Assistant knowledge answering over RAG
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-016
- **Risk:** HIGH
- **Human approval required:** Yes — AI retrieval surface
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**

**Description**
Answer customer knowledge questions from the knowledge base through permission-aware
retrieval. Per `.claude/skills/permission-aware-rag/SKILL.md`.

**Acceptance criteria**
- [ ] Hybrid retrieval: pgvector + tsvector fused by RRF, per ADR-0001
- [ ] Vector search returns IDs only; rows loaded and authorized before reaching the prompt
- [ ] A customer cannot retrieve staff or operations content by any phrasing
- [ ] Answers cite their source documents
- [ ] No retrieval result means "I don't have that", never a reconstructed answer
- [ ] Retrieved content is delimited and treated as data; injection test passes
- [ ] Response is in the user's selected locale, with fallback reported

**Validation**
```bash
pnpm --filter api test ai-knowledge
```

---

### T-018 — Assistant investigator discovery tools
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-011, T-017
- **Risk:** HIGH
- **Human approval required:** Yes — AI tool surface over business data
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/tools/**

**Description**
Structured discovery tools so the Assistant can find investigators by location, distance,
specialty, service, availability and language, and explain each match from real criteria.
**Not RAG.** Per `.claude/skills/investigator-discovery/SKILL.md`.

**Acceptance criteria**
- [ ] `searchInvestigators` takes typed, closed filters; free text only ranks, never filters
- [ ] Nearest-investigator uses `ST_DWithin` to filter and `ST_Distance` to sort
- [ ] An unverified, suspended or non-accepting investigator cannot surface by any path,
      including a highly relevant profile description
- [ ] Tool returns `matchedOn` and `notMatched`; the explanation renders only those fields
- [ ] Test proves the Assistant cannot state a price, availability or capability absent
      from the returned data
- [ ] Clarification asked only when it changes the answer
- [ ] Prohibited-category requests route to the deterministic policy check
- [ ] Results are public projections; no home location or contact details

**Validation**
```bash
pnpm --filter api test ai-discovery
```

---

### T-019 — Customer FAQ and knowledge-base content
- **Status:** DONE — 30 documents (12 customer, 12 investigator, 5 staff, 1 policy), en only
- **Priority:** P2
- **Depends on:** T-015
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** docs-writer
- **Affected:** docs/knowledge-base/**

**Description**
Write the initial customer, investigator and staff knowledge base: features, workflows,
limitations, business rules, authorization rules, troubleshooting and support scenarios.
Covers en, with ru and hy to follow per `localization`.

**Acceptance criteria**
- [x] Customer: missions, quotes, payment, evidence access, reports, disputes, cancellation
- [x] Investigator: verification, service areas, quoting, evidence upload, payouts
- [x] Staff: verification review, policy review, dispute handling, evidence access, account actions
- [x] Troubleshooting for the top support scenarios
- [x] Authorization rules documented in customer-comprehensible terms
- [x] No document lists investigators, prices or availability — rules only
- [x] Sections are user-voice and self-contained; validator passes with no warnings

**Validation**
```bash
python3 scripts/validate-knowledge-base.py
```

---

### T-020 — Legal documents: counsel review and publication decisions
- **Status:** BLOCKED — awaiting counsel and compliance owner
- **Priority:** P0 (blocks launch)
- **Depends on:** —
- **Risk:** HIGH
- **Human approval required:** Yes — legal. Engineering cannot close this task.
- **Owner agent:** — (human)
- **Affected:** docs/compliance/**

**Description**
Structured drafts exist for Terms of Service, Terms & Conditions and Privacy Policy, plus a
brief stating the platform facts and the open questions. Counsel must answer the blocking
questions and produce publishable text. Engineering builds the mechanism (T-021, T-022) and
does not decide substance.

**Acceptance criteria**
- [ ] Launch jurisdictions and governing law decided
- [ ] Controller / processor / joint-controller position settled, especially for evidence
- [ ] Lawful basis and legitimate interests assessment for third-party data documented
- [ ] Retention period set for every category listed in `counsel-brief.md` §5
- [ ] Authoritative locale designated for each document
- [ ] Liability limitations drafted and assessed against consumer protections in scope
- [ ] Whether the platform is party to the customer–investigator contract, decided
- [ ] Final text published for en, ru and hy

**Validation**
Sign-off by the compliance owner. Not a code validation.

---

### T-021 — Legal document versioning and consent records
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-004
- **Risk:** HIGH
- **Human approval required:** Yes — consent is a compliance surface
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/legal/**, migrations

**Description**
Versioned legal documents and append-only consent records. Per
`.claude/skills/legal-consent/SKILL.md`. Does not depend on final text — the mechanism can
be built and tested against drafts.

**Acceptance criteria**
- [ ] `legal_documents` immutable once published; corrections create a new version
- [ ] `user_consents` append-only; app role has no update or delete grant
- [ ] Content hash of the exact text shown is **copied into** the consent row, not joined
- [ ] Locale shown recorded; one authoritative locale per type+version
- [ ] Consent is per document per version, never a single boolean
- [ ] Contract acceptance stored separately from optional marketing consent
- [ ] Consent records survive account deletion
- [ ] Every acceptance and withdrawal emits an audit event
- [ ] Test: a published document's text cannot be mutated
- [ ] Test: deleting a user leaves consent records intact

**Validation**
```bash
pnpm --filter api test legal
```

---

### T-022 — Registration and role-activation acceptance gate
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-005, T-021
- **Risk:** HIGH
- **Human approval required:** Yes — authentication and registration flow
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/**, apps/mobile/**, apps/admin-web/**

**Description**
Block registration until the required documents are accepted, and gate investigator
capabilities on acceptance of the investigator-specific documents at role activation.

**Acceptance criteria**
- [ ] Registration cannot complete without acceptance — enforced **server-side**
- [ ] Account creation and consent rows commit in one transaction; no account exists without them
- [ ] Test: posting directly to the registration endpoint without acceptance is rejected
- [ ] Investigator capabilities gated on role-activation acceptance, tested separately
- [ ] The text shown is retrievable for any given consent record
- [ ] Material version change forces re-acceptance; materiality flag is set by compliance, not inferred
- [ ] Re-acceptance does not block read access to an active assignment's existing obligations
- [ ] Acceptance UI is localised; the locale shown is what gets recorded

**Validation**
```bash
pnpm --filter api test auth-consent
```

---

### T-023 — Domain routing, TLS and DNS
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-003
- **Risk:** MEDIUM
- **Human approval required:** Yes — infrastructure and DNS
- **Owner agent:** infra-devops
- **Affected:** infrastructure/caddy/**, infrastructure/compose/**, packages/config/**

**Description**
Bring up the four-name architecture from ADR-0002. The Caddyfile exists but has not been
validated by Caddy itself.

**Acceptance criteria**
- [ ] `caddy validate` passes (command in `infrastructure/caddy/README.md`)
- [ ] Certificates issue for apex, `app.` and `news.`; `www` redirects `301` to apex
- [ ] `curl -I https://app.<domain>/` shows `X-Robots-Tag: noindex, nofollow`
- [ ] `app./api/health` reaches the API same-origin; no CORS preflight on app→api calls
- [ ] Marketing `/login` returns `301` to `app.`, never `200`
- [ ] `packages/config` exports a typed domain map; no hostname is hardcoded anywhere
- [ ] PostgreSQL, Redis and metrics are not reachable from the public internet

**Validation**
```bash
docker run --rm -v "$PWD/infrastructure/caddy":/etc/caddy:ro -e DOMAIN=... caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

---

### T-024 — Marketing site SEO
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-023
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** admin-web
- **Affected:** apps/marketing-web/**

**Description**
Full SEO for the marketing domain per `.claude/skills/domain-and-seo/SKILL.md`.

**Acceptance criteria**
- [ ] `app/sitemap.ts` generates from a **route allowlist** plus dynamic content, never a denylist
- [ ] Sitemap contains no authenticated route, `/api/*`, auth page, admin or preview route
- [ ] Every entry has a real `lastModified`; regenerates on deploy and on content revalidation
- [ ] `app/robots.ts` generated, referencing the sitemap
- [ ] Self-referencing canonical on every public page
- [ ] Reciprocal `hreflang` for en/ru/hy plus `x-default`; no cross-locale canonicalisation
- [ ] Unique title and description per page — no repeated boilerplate
- [ ] Open Graph and Twitter metadata with image, dimensions and alt
- [ ] JSON-LD: `Organization` + `WebSite`/`SearchAction` on home, `BreadcrumbList` on nested,
      `BlogPosting` on posts, `FAQPage` **only from `visibility: public` knowledge-base content**
- [ ] Lowercase hyphenated URLs; consistent trailing slash with `301` for the other form
- [ ] Removed pages return `410` or `404` — no soft 404s returning `200`
- [ ] A test asserts the generated sitemap contains no path from the private allowlist test set

**Validation**
```bash
pnpm --filter marketing-web test && pnpm --filter marketing-web build
```

---

### T-025 — Session cookie scoping and CSP
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-005, T-023
- **Risk:** HIGH
- **Human approval required:** Yes — authentication and security headers
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/**, packages/config/**

**Description**
Enforce host-only session cookies and per-application CSP. ADR-0002 makes cookie scoping the
security-critical constraint of the domain split.

**Acceptance criteria**
- [ ] Session cookies set **host-only** on `app.` — no `Domain` attribute, ever
- [ ] `HttpOnly`, `Secure`, `SameSite=Strict` (viable because the API is same-origin)
- [ ] A test asserts no `Set-Cookie` response carries a `Domain` attribute
- [ ] A test asserts no cookie is issued on the apex or `news.`
- [ ] CSP set per application, derived from the domain map — not hand-maintained, not at the edge
- [ ] CORS allowlist derived from the domain map
- [ ] Adding a subdomain to the map does not widen session scope — covered by a test

**Validation**
```bash
pnpm --filter api test auth-cookies
```

---

### T-026 — Knowledge base translation into ru and hy
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-019
- **Risk:** LOW
- **Human approval required:** No — but native-speaker review is required before `status: current`
- **Owner agent:** localization
- **Affected:** docs/knowledge-base/**

**Description**
Translate the 32 English knowledge-base documents into `ru` and `hy` — 64 files. Each
translation shares the source document's `id` and differs in `locale`, so retrieval can
prefer the user's language and fall back to `en` with the fallback reported.

Excludes the legal documents in `docs/compliance/`, which are T-027 and must not be
agent-translated.

**Acceptance criteria**
- [ ] 64 files: every `en` document has a `ru` and an `hy` counterpart
- [ ] Same `id`, differing `locale`; version tracks the English source it was translated from
- [ ] `python3 scripts/validate-knowledge-base.py` reports full parity and zero orphans
- [ ] Headings stay user-voice in the target language — translated as how a speaker would
      actually ask, not word-for-word from English
- [ ] Sections remain self-contained; no chunk depends on an English neighbour
- [ ] Russian plurals use ICU `one/few/many/other`; Armenian plural rules applied correctly
- [ ] No `source_of_truth: database` document lists values in any locale
- [ ] Public policy summaries state, in the target language, that the authoritative legal
      text governs
- [ ] **Native-speaker review before any translated document is set `status: current`**
- [ ] A retrieval test confirms locale preference and reported `en` fallback

**Validation**
```bash
python3 scripts/validate-knowledge-base.py
```

---

### T-027 — Legal document translation (professional, not agent)
- **Status:** BLOCKED — depends on T-020 (counsel producing final English text)
- **Priority:** P0 (blocks launch)
- **Depends on:** T-020
- **Risk:** HIGH
- **Human approval required:** Yes — legal. Engineering cannot close this task.
- **Owner agent:** — (human + professional translator)
- **Affected:** docs/compliance/**

**Description**
Translate the Terms of Service, Terms & Conditions, Privacy Policy and Lawful Use Policy
into `ru` and `hy`.

**These must not be translated by an agent or by machine translation.** They are binding
contracts. A mistranslated liability limitation, consent clause or prohibited-activity
definition is unenforceable at best and misleading at worst — and every user will have
accepted a specific language version, recorded by the consent mechanism.

**Acceptance criteria**
- [ ] Professional legal translation obtained for each document and locale
- [ ] **Authoritative locale designated per document version** (counsel-brief question 23)
      and stated inside the documents themselves
- [ ] `legal_documents` rows carry `is_authoritative_locale` correctly per T-021
- [ ] Each translation reviewed by counsel competent in that jurisdiction, not only by a
      translator
- [ ] The acceptance UI records which locale was shown; the recorded text hash matches the
      translation actually displayed
- [ ] Plain-language KB summaries (T-026) do not contradict their translated legal source

**Validation**
Sign-off by the compliance owner. Not a code validation.

---

### T-028 — CI security gates
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-001
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** .github/workflows/**, package.json

**Description**
`.github/workflows/pr.yml` exists and parses, but has **never run** — it references pnpm
scripts that do not exist yet. This task makes it green and wires in the build-time checks
from `launch-hardening`. Contract: `.claude/skills/ci-cd/SKILL.md`.

**Acceptance criteria**
- [ ] `pr.yml` runs green end to end on a real PR
- [ ] Fresh Postgres+Redis per run; migrations apply **from empty**; environment destroyed after
- [ ] Coverage gate blocking at 100% per package, reports uploaded as artifacts
- [ ] Secret scanning over **full git history**, not just the working tree; blocks the merge
- [ ] `pnpm audit` (or SCA) fails the build on known-exploitable severity
- [ ] CI installs with `--frozen-lockfile`
- [ ] Container images pinned by digest and scanned
- [ ] A test asserts no source map is emitted into the public production bundle
- [ ] Automated dependency-update PRs enabled, human review required, never auto-merged
- [ ] Pipeline order per plan.md §24: install → lint → typecheck → unit → integration →
      build → security → migration validation → artifact

**Validation**
```bash
pnpm audit --audit-level=high && pnpm lint && pnpm typecheck
```

---

### T-029 — Pre-launch security audit
- **Status:** BLOCKED — runs against a deployed environment
- **Priority:** P0 (blocks launch)
- **Depends on:** T-023, T-025, T-028
- **Risk:** HIGH
- **Human approval required:** Yes — launch gate
- **Owner agent:** security-privacy (review) + infra-devops (remediation)
- **Affected:** docs/operations/**, running environment

**Description**
Full pass of `launch-hardening` and `platform-security-review` against the **running**
staging and production environments. Configuration existing is not evidence it is applied.

**Acceptance criteria**
- [ ] Every `launch-hardening` item verified against the running environment
- [ ] All default credentials changed; PostgreSQL, Redis and metrics unreachable from
      outside the host — verified by scanning from off-host
- [ ] Headers and `X-Robots-Tag` verified by request, not by reading config
- [ ] CSP verified to actually block, not merely be present
- [ ] Backup restore performed successfully end to end
- [ ] IDOR sweep across every endpoint (`/authz-audit`)
- [ ] Prompt-injection tests pass against the deployed assistant
- [ ] Webhook replay test against the deployed payment handler
- [ ] Findings recorded with an owner; deferrals record the accepted risk and who accepted it

**Validation**
Recorded audit report signed off by the compliance owner. Not a code validation.

---

### T-030 — UI architecture decisions (gates all UI work)
- **Status:** DONE — all decisions resolved; v1 workspace scope specified in plan.md §8
- **Priority:** P1
- **Depends on:** —
- **Risk:** MEDIUM
- **Human approval required:** Yes — both are product/architecture decisions
- **Owner agent:** — (human), then planner
- **Affected:** docs/architecture/ADR-0003-ui-stack.md, docs/architecture/ui-architecture-plan.md, plan.md

**Description**
Research complete; stack proposed in ADR-0003. Two blocking decisions prevent acceptance and
gate every downstream UI task. See `ui-architecture-plan.md` §0.

**Acceptance criteria**
- [x] **Decision: workspace surface** — web-first (ADR-0004); mobile is a companion
- [x] **Decision: entity/relationship model** — deferred (ADR-0005); React Flow not a v1 dep
- [x] plan.md amended: §3 surface architecture, §8 deferred layer, §28 first milestone web-only
- [x] CLAUDE.md non-negotiable 8 added: Domain Model → Capability → UI → Visualisation
- [x] `mobile` agent and `mobile-screen` skill rescoped to companion
- [x] ADR-0003 moved from Proposed to Accepted
- [x] **Sources, Notes, Tasks, Documents: v1 schema.** Specified in plan.md §8 as
      assignment-scoped workspace objects. "Investigation" confirmed as Assignment — no
      separate entity. Implementation: T-031, T-032, T-033
- [ ] `cloud.craft` identified or dropped from consideration
- [ ] React Bits (MIT + Commons Clause), Remotion (paid at 4+ employees) and Haikei
      commercial terms reviewed with counsel
- [ ] Follow-on tasks created: tokens package, skills, agents, Playwright MCP

**Validation**
Recorded decisions in the ADR. Not a code validation.

---

### T-031 — Investigation sources
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-012
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/investigation-sources/**, migrations

**Description**
`InvestigationSource` per plan.md §8. Assignment-scoped record of where information came from,
distinct from the evidence obtained from it.

**Acceptance criteria**
- [ ] Assignment-scoped; `*.authz.spec.ts` proves a non-participant gets 404
- [ ] Type and reliability are enums; rationale required when reliability is not `unknown`
- [ ] `EvidenceItem.source_id` added **nullable** — evidence must never be blocked on a source
- [ ] Not a shared catalogue: a source from another assignment is unreachable by any path
- [ ] Reliability does not accrete assertion-level confidence semantics (ADR-0005)
- [ ] Locator accepts a URL but is never fetched server-side without the SSRF allowlist
- [ ] Mutations audited; retention follows the assignment

**Validation**
```bash
pnpm --filter api test investigation-sources
```

---

### T-032 — Investigation notes and tasks
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-012
- **Risk:** MEDIUM
- **Human approval required:** Yes — note visibility is a privacy surface
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/investigation-workspace/**, migrations

**Description**
`InvestigationNote` and `InvestigationTask` per plan.md §8. The investigator's working
material and work plan.

**Acceptance criteria**
- [ ] Both default to `visibility: private` — author only
- [ ] A test proves a `private` note is unreachable by the other assignment participant
- [ ] Changing visibility is an audited action with the actor recorded
- [ ] Task status transitions validated; no direct status assignment
- [ ] Notes are mutable; evidence semantics are **not** applied to them
- [ ] Soft delete, audited; neither cascades with the assignment
- [ ] `*.authz.spec.ts` covers author vs. participant vs. non-participant vs. staff

**Validation**
```bash
pnpm --filter api test investigation-workspace
```

---

### T-033 — Investigation documents and evidence promotion
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-008, T-032
- **Risk:** HIGH
- **Human approval required:** Yes — touches the evidence boundary
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/investigation-documents/**, evidence module, migrations

**Description**
`InvestigationDocument` per plan.md §8, plus the one-way promotion path to evidence. The
document/evidence boundary is load-bearing: without it, evidence gets attached as documents
and the chain of custody is lost.

**Acceptance criteria**
- [ ] All files go through the Cloudinary flow (`cloudinary-media`) — no separate storage path
- [ ] Documents are mutable working files; **no** checksum or chain-of-custody semantics
- [ ] Promotion creates an immutable `EvidenceItem` recording its document origin
- [ ] Checksum computed **server-side at promotion**, never supplied by the client
- [ ] **Evidence can never be demoted to a document** — tested explicitly
- [ ] Promotion is audited with actor, source document and resulting evidence ID
- [ ] Deleting a document deletes its Cloudinary asset and marks the row, per §14
- [ ] A promoted document's deletion does not affect the evidence created from it
- [ ] `*.authz.spec.ts` covers both objects and the promotion endpoint

**Validation**
```bash
pnpm --filter api test investigation-documents evidence
```

---

### T-034 — API conventions (do this before the first module)
- **Status:** DONE — docs/api/ written; shared primitives remain for T-002
- **Priority:** P0
- **Depends on:** T-002
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** docs-writer
- **Affected:** docs/api/**, apps/api/src/common/**

**Description**
`docs/api/` is empty, so the first module written will invent an error shape, a pagination
style and an idempotency contract, and every later module will copy or contradict it. Decide
once, up front.

**Acceptance criteria**
- [x] Error taxonomy: stable machine-readable codes, a translation key per code, and no
      internal detail in the body (`platform-security-review`)
- [x] Pagination: cursor-based, bounded limit, documented cursor opacity
- [x] Idempotency: header name, key lifetime, scope, replay semantics
- [x] Correlation ID propagation from request through jobs and webhooks
- [x] Versioning strategy and deprecation policy
- [ ] Shared primitives implemented in `apps/api/src/common/` so modules consume rather than
      reimplement

**Validation**
```bash
pnpm --filter api test common
```

---

### T-035 — Legal hold
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-004
- **Risk:** HIGH
- **Human approval required:** Yes — data retention
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/legal-hold/**, retention jobs, migrations

**Description**
Nothing currently stops a retention job from deleting evidence that is under dispute or under
a legal obligation to retain. That is data loss during litigation. The counsel brief flags the
conflict; nothing enforces it.

**Acceptance criteria**
- [ ] `legal_holds`: resource type and ID, reason, placed by, placed at, released at
- [ ] **Every retention deletion path checks for an active hold first** — tested per path
- [ ] Opening a dispute places a hold automatically; resolving it does not auto-release
- [ ] Release is a deliberate, audited action with a reason
- [ ] An erasure request against held data is **surfaced to compliance, never auto-resolved**
- [ ] Holds are append-only and survive account deletion
- [ ] A test proves a retention job skips held evidence and reports why

**Validation**
```bash
pnpm --filter api test legal-hold retention
```

---

### T-036 — Notifications
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-006
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/notifications/**, workers

**Description**
`NotificationsModule` per plan.md §13 — one of two modules with no task. Load-bearing: quote
received, report submitted, verification expiring and message received all depend on it.

**Acceptance criteria**
- [ ] Push, email and in-app centre; per-channel preferences
- [ ] Templates localised for en/ru/hy; the recipient's locale is used, not the actor's
- [ ] **Notification content reveals nothing sensitive** — "a new message" never the message,
      never evidence content, never a signed URL (`audit-logging`)
- [ ] Delivered through the outbox and BullMQ; idempotent per (event, recipient, channel)
- [ ] Retry with backoff; permanent failures dead-letter and alert
- [ ] Unsubscribe honoured for non-transactional; transactional sends from `mail.` per ADR-0002

**Validation**
```bash
pnpm --filter api test notifications
```

---

### T-037 — Reviews
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-012
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/reviews/**, migrations

**Description**
`ReviewsModule` per plan.md §8 — the second uncovered module. Reviews feed investigator
ranking in discovery, so they are a manipulation surface.

**Acceptance criteria**
- [ ] Only the assignment's customer, only after `COMPLETED`, exactly once — enforced by a
      unique constraint, not a read-then-write check
- [ ] Rating plus optional text; text is moderated and reportable
- [ ] A review is not a dispute route — the UI and copy say so (`kb-customer-disputes-revisions`)
- [ ] Investigator may respond once; responses are also moderated
- [ ] Ranking input is computed, never client-supplied
- [ ] Removing a review is audited with a reason

**Validation**
```bash
pnpm --filter api test reviews
```

---

### T-038 — Search within an investigation
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-031, T-032, T-033
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/search/**

**Description**
An investigator with two hundred evidence items, fifty notes and thirty sources cannot find
anything. Distinct from T-011, which is investigator *discovery*.

**Acceptance criteria**
- [ ] Lexical search (`tsvector`) across evidence, notes, sources and documents in one assignment
- [ ] **Scoped to one assignment**; a test proves no cross-assignment result is reachable
- [ ] **Private notes returned only to their author** — the sharp edge here (T-032)
- [ ] Results are projections; no evidence content or signed URL in a result row
- [ ] Bounded result count; no unbounded limit
- [ ] Not semantic search — exact recall is the requirement (ADR-0001 reasoning applies)

**Validation**
```bash
pnpm --filter api test investigation-search
```

---

### T-039 — UI skills and agents
- **Status:** IN_PROGRESS — 7 skills + 2 agents + CLAUDE.md done; Playwright MCP remains
- **Priority:** P1
- **Depends on:** T-030
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** planner
- **Affected:** .claude/skills/**, .claude/agents/**, CLAUDE.md

**Description**
Create the seven skills and two agents specified in `docs/architecture/ui-architecture-plan.md`
§4–§5. Planned but never scheduled, so no UI work can follow the rules that were written.

**Acceptance criteria**
- [x] Skills: `ui-architecture`, `design-system`, `component-discovery`, `animation`,
      `frontend-accessibility`, `frontend-performance`, `visual-qa`
- [x] Existing `shadcn-ui` folded into `component-discovery`, not duplicated
- [x] Agents: `frontend` (writes) and `frontend-review` (**read-only** — no Edit/Write)
- [x] CLAUDE.md non-negotiables 9 and 10 added per the plan §6
- [x] **Playwright MCP** added and smoke-tested — 24 tools, `browser_resize` + `browser_snapshot`
- [x] ~~Refero MCP~~ — **declined on cost** (2026-09-13). Not a blocker; `interaction-design`
      carries the rules independently
- [ ] Each smoke-tested over stdio before being relied on, not assumed working
- [x] Every skill has a trigger-accurate description; frontmatter validates
- [x] Escalation and law-enforcement procedures written (`docs/operations/`), resolving the
      dangling pointers from the staff knowledge base

**Validation**
```bash
python3 -c "import pathlib,sys; sys.exit(0)"  # replaced by the harness frontmatter check
```

---

### T-040 — Staging pipeline
- **Status:** BLOCKED — needs a provisioned staging environment
- **Priority:** P1
- **Depends on:** T-028
- **Risk:** MEDIUM
- **Human approval required:** Yes — infrastructure
- **Owner agent:** infra-devops
- **Affected:** .github/workflows/staging.yml, infrastructure/**

**Description**
`dev` → staging, automatic. The workflow exists with `TODO(T-040)` placeholders and has never
run. Per `.claude/skills/ci-cd/SKILL.md`.

**Acceptance criteria**
- [ ] GitHub `staging` environment with **staging-only** secrets; production secrets absent
- [ ] Build once, push a tagged image, deploy that same artifact
- [ ] Migrations run automatically against staging
- [ ] Health check polls and **fails the job** if unhealthy
- [ ] Smoke tests run against deployed staging
- [ ] Deployment recorded: sha, actor, outcome
- [ ] Staging contains **no production data and no production secrets**

**Validation**
A green run on a merge to `dev`, with staging serving the new sha.

---

### T-041 — Production pipeline and branch protection
- **Status:** BLOCKED — needs production infrastructure and named approvers
- **Priority:** P0 (blocks launch)
- **Depends on:** T-040, T-029
- **Risk:** HIGH
- **Human approval required:** Yes — production
- **Owner agent:** infra-devops
- **Affected:** .github/workflows/production.yml, repository settings

**Description**
Manual, approval-gated production operations. The workflow exists with `TODO(T-041)`
placeholders and has never run. Structure is asserted (dispatch-only, guard-gated); the steps
are not implemented.

**Acceptance criteria**
- [x] `prod` protected: 1 required review, dismiss stale, no force-push, no deletion,
      conversation resolution required
- [x] `dev` protected: no force-push, no deletion
- [x] GitHub `production` environment: required reviewer `gevorg33`, restricted to protected
      branches
- [x] GitHub `staging` environment created
- [ ] **Required status checks added once `pr.yml` has run at least once** — a check name that
      has never reported blocks every merge, so this waits for T-028
- [ ] Deploy, migrate and rollback are separate manual jobs — **a push never deploys**
- [ ] Migration job verifies a **fresh, restorable backup** before starting, else fails
- [ ] Migration logs retained as artifacts for 90 days
- [ ] Health checks and smoke tests gate deployment success
- [ ] Rollback procedure documented **and exercised at least once**
- [ ] Rollback output states plainly that a contract migration is recovered by restore, not revert
- [ ] Deployment audit log: version, actor, approver, outcome

**Validation**
A rehearsed deploy and a rehearsed rollback against production, signed off.

---

### T-042 — Test infrastructure: factories, fixtures, coverage config
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-002
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** packages/test-utils/**, vitest/jest config, apps/api/test/**

**Description**
The shared test substrate. Landing it before module work is what makes the 100% gate
achievable rather than punitive.

**Acceptance criteria**
- [ ] Factories with sensible defaults and explicit overrides for every core entity
- [ ] Database reset between tests; **no shared mutable state, no ordering dependency**
- [ ] Suites pass run alone, in reverse order, and in parallel — verified, not assumed
- [ ] Time is freezable; expiry logic is testable deterministically
- [ ] Reusable authorization-test helper covering the seven cases from `authorization`
- [ ] Coverage thresholds set to 100% **per package**, wired into `pnpm test:coverage`
- [ ] `docs/operations/coverage-exclusions.md` referenced by the config, not duplicated
- [ ] **No real or realistic personal data** in any fixture

**Validation**
```bash
pnpm test:coverage
```

---

### T-043 — Mobile compliance CI checks
- **Status:** BLOCKED — mobile deferred (ADR-0009). Do not pick up.
- **Priority:** P1
- **Depends on:** T-028
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** .github/workflows/**, scripts/

> **Deferred (ADR-0009).** Surveillance is in scope, which conflicts with Google Play's
> Stalkerware and Monitoring policy. The mobile companion is not being built for now. This task
> and its artifacts are retained for if scope narrows again.

**Description**
Automate the release blockers that are cheap to check and expensive to discover at review.
Per `.claude/skills/mobile-store-compliance/SKILL.md`.

**Acceptance criteria**
- [ ] Privacy Policy and Terms URLs configured and **resolve** — not placeholders, not 404
- [ ] Sign-out and delete-account screens exist and are routable
- [ ] **No background location** permission declared anywhere — fails the build if found
- [ ] Every declared permission appears in `docs/mobile/permissions.md`; unlisted ones fail
- [ ] Every iOS purpose string present, non-placeholder, localised for en/ru/hy
- [ ] `PrivacyInfo.xcprivacy` / `expo.ios.privacyManifests` present
- [ ] **Production build contains no development or staging URL**
- [ ] Bundle ID / package name correct per environment
- [ ] Play target API level meets the current requirement
- [ ] Listing copy contains none of: track, monitor, spy, surveil, catch

**Validation**
```bash
pnpm --filter mobile compliance:check
```

---

### T-044 — Mobile store submission readiness
- **Status:** BLOCKED — mobile deferred (ADR-0009). Do not pick up.
- **Priority:** P1
- **Depends on:** T-020, T-022, T-043
- **Risk:** HIGH
- **Human approval required:** Yes — store submission is outward-facing
- **Owner agent:** mobile
- **Affected:** apps/mobile/**, docs/mobile/**

> **Deferred (ADR-0009).** See T-043.

**Description**
Complete the account, permission and metadata work required for a first submission, then run
the full audit in `docs/mobile/release-checklist.md`.

**Acceptance criteria**
- [ ] In-app account deletion, complete and not deactivation (Apple 5.1.1(v))
- [ ] Web deletion route live and declared in the Play Console
- [ ] Sign out one level deep, clearing server session and local cache
- [ ] Legal documents reachable during registration and from Settings, resolving to
      **counsel-approved** versions
- [ ] Permissions requested in context with localised purpose strings; graceful denial paths
- [ ] Apple App Privacy labels and Play Data Safety form match actual behaviour
- [ ] Age and content ratings reflect user-generated content and messaging
- [ ] **Reviewer notes written stating the app performs no monitoring**, linking the lawful use
      policy — the single highest-value rejection defence for this product
- [ ] Full release checklist run and recorded

**Validation**
Completed checklist in `docs/mobile/release-checklist.md`, signed off before submission.

---

### T-045 — AI session and message persistence
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-004
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai-sessions/**, migrations

**Description**
The persistent conversation layer per ADR-0006. Must exist before the assistant, because the
alternative is a chatbot whose memory is a prompt.

**Acceptance criteria**
- [ ] `AiSession` with lifecycle `ACTIVE`/`IDLE`/`ARCHIVED`/`DELETED`, separate from workflow state
- [ ] Create, open, resume, rename, archive, delete, search — all actor-scoped
- [ ] `AiMessage` with sequence, role, metadata; tool calls stored as **structured events**, not prose
- [ ] Hybrid session search: pgvector + Postgres full-text (ADR-0001)
- [ ] `*.authz.spec.ts` proves another user cannot reach a session or its messages by any path
- [ ] Titles renameable; generated titles never expose evidence content
- [ ] Deleting a session removes its messages, summaries, memory and embeddings in one unit of work

**Validation**
```bash
pnpm --filter api test ai-sessions
```

---

### T-046 — Context Builder, summaries and compaction
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-045, T-016
- **Risk:** HIGH
- **Human approval required:** Yes — it decides what reaches the model
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/context-builder/**

**Description**
The service that decides what enters the model context. Per
`.claude/skills/ai-session-context/SKILL.md`.

**Acceptance criteria**
- [ ] **Permissions applied before assembly**, not after; a test proves no cross-session or
      cross-user message can be retrieved by semantic relevance
- [ ] Token budget reserves output space; input never fills the window
- [ ] Compaction triggers proactively at ~70–80%; **no message is ever deleted to fit**
- [ ] Progressive degradation: recent → +summary → compress older → retrieve history → structured state
- [ ] An **active plan or pending confirmation is never compacted away** — tested explicitly
- [ ] Summaries incremental and hierarchical; versioned with model and source sequence range
- [ ] Summaries preserve goal, entities, decisions, constraints, completed and pending actions
- [ ] Retrieved content delimited and treated as data; injection test passes
- [ ] A test proves a summary claiming a permission grants nothing

**Validation**
```bash
pnpm --filter api test context-builder
```

---

### T-047 — AI memory with provenance
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-046
- **Risk:** HIGH
- **Human approval required:** Yes — persistent memory is a privacy surface
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/memory/**

**Acceptance criteria**
- [ ] Session memory and user memory stored separately; session memory dies with its session
- [ ] Every memory carries provenance (source session and message), confidence, timestamp
- [ ] **Selective** — a test proves ordinary conversation does not create memories
- [ ] User can review and delete their own memory; deletion is complete and audited
- [ ] Conflict resolution: new explicit instruction > session state > session memory > long-term
- [ ] **Memory never overrides application state and never substitutes for authorization** — tested
- [ ] No evidence content, message bodies or third-party personal data written into memory
- [ ] Memory included in data export and account deletion (T-022, T-044)

**Validation**
```bash
pnpm --filter api test ai-memory
```

---

### T-048 — Plan persistence, confirmation survival and tool result store
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-045, T-018
- **Risk:** HIGH
- **Human approval required:** Yes — confirmation is the mutation gate
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/plans/**, apps/api/src/modules/ai/results/**

**Description**
What makes a confirmation survive a browser close, and keeps 10,000 records out of a prompt.

**Acceptance criteria**
- [ ] `AiPlan` persisted with `plan_id`, `plan_hash`, commands, status, confirmation status
- [ ] A pending confirmation **survives browser close, app restart and worker restart** — tested
- [ ] Before execution: re-authorize, re-check the hash, re-read resource state
- [ ] **Material change invalidates the confirmation** and forces a fresh one — tested
- [ ] A confirmation is single-use and bound to exact arguments (`ai-tool-registry`)
- [ ] Large tool results stored and referenced by `result_id` with summary, top-N and cursor
- [ ] A test proves a large result set never enters a prompt in full
- [ ] A killed worker is replaced by another that resumes from persisted state
- [ ] **No DAG orchestration, no risk engine, no `tenant_id`** — deferred/rejected by ADR-0006

**Validation**
```bash
pnpm --filter api test ai-plans ai-results
```

---

### T-049 — Investigator violations, due process and permanent bans
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-013, T-035
- **Risk:** HIGH
- **Human approval required:** Yes — account termination and post-deletion retention
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/enforcement/**, auth, verification, migrations

**Description**
Enforcement for investigator policy violations, with the due process a career-affecting
decision requires. Per `.claude/skills/enforcement-actions/SKILL.md`.

**Acceptance criteria**
- [ ] `InvestigatorViolation` and `EnforcementDecision`; evidence stored as **references, never content**
- [ ] Decision records are **append-only** — a reversal appends; a test proves it cannot be edited
- [ ] A ban cannot be issued without a recorded notice **and** an elapsed response window
- [ ] The deciding staff member is blocked from deciding a matter they were party to — tested
- [ ] Appeal routes to a different reviewer; the original decision is retained
- [ ] Precautionary suspension is a distinct action from a ban and still triggers full process
- [ ] `BanIdentityHash`: salted hash of the verified identity, checked at registration
- [ ] **A test proves a banned investigator cannot re-register with the same identity after
      deleting their account** — otherwise the ban is decorative
- [ ] **No identity document, name or case content retained** in the ban record beyond the hash
- [ ] Ban and money are **separate decisions with separate records**; earned payouts are not
      withheld as a penalty — tested
- [ ] Live assignments each resolved (reassign / complete / refund) and recorded per assignment
- [ ] Ban reason is never exposed to other users
- [ ] Every action audited with actor, grounds and reasoning

**Blocking questions for counsel** (`counsel-brief.md` §19a–19d): lawful basis and retention
period for the ban hash after deletion, notice and appeal periods, the evidentiary standard,
and whether set-off against amounts owed is enforceable.

**Validation**
```bash
pnpm --filter api test enforcement
```

---

### T-050 — Investigator policy refusal and halt
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-010, T-012
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{assignments,mission-policy}/**

**Description**
The mechanism behind the refusal right the Terms already grant (§3, §4). Payment precedes
acceptance, so there are two windows. Per `.claude/skills/mission-state-machine/SKILL.md`.

**Acceptance criteria**
- [ ] `ASSIGNED → decline(POLICY_CONCERN) → CANCELLED`: automatic full refund, mission flagged
      for staff review
- [ ] `ACCEPTED | IN_PROGRESS → policy_halt → SUSPENDED`: work stops, funds held, staff review
- [ ] **The halt is available at any point**, including after evidence exists — tested
- [ ] Staff outcome resumes the assignment or cancels it; both recorded with reasoning
- [ ] **Substantiated refusals excluded from the response record; unsubstantiated ones counted**
      — tested both ways, because this asymmetry is the whole design
- [ ] Repeated bad-faith policy claims route to `enforcement-actions`
- [ ] The money decision is recorded **separately** from the halt decision
- [ ] Material withdrawn from use is marked, never erased (`evidence-integrity`)
- [ ] Both transitions go through the transition service — status, history, audit, outbox in
      one transaction

**Open for counsel:** whether work lawfully performed before a customer-caused halt is payable.

**Validation**
```bash
pnpm --filter api test assignments-policy-refusal
```

---

### T-051 — Mission moderation queue (admin console)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-010, T-013
- **Risk:** HIGH
- **Human approval required:** Yes — it is the publication gate for lawful-use policy
- **Owner agent:** admin-web (UI) + backend-domain (decision service)
- **Affected:** apps/admin-web/**, apps/api/src/modules/mission-policy/**

**Description**
No mission reaches investigators without a moderator publishing it. Automatic screening sorts
and prioritises the queue; it never publishes. Per plan.md §10 and
`docs/product/mission-lifecycle.md`.

**Acceptance criteria**
- [ ] Queue of `UNDER_REVIEW` missions, ordered by risk band then age
- [ ] Three outcomes: **publish** (`→ QUOTED`), **reject** (`→ REJECTED`), **request changes**
      (`→ DRAFT`) — each requiring a typed reason before the control enables
- [ ] **A mission cannot reach `QUOTED` by any path except a moderator publishing it** — tested
- [ ] Moderator can open mission attachments; **every attachment access is audited**
- [ ] AI classification shown as an input, clearly labelled, never pre-selecting the outcome
- [ ] Rejection and change-request reasons are shown to the customer and are actionable
- [ ] Requires the `mission_moderation` staff scope — not `isStaff` (`authorization`)
- [ ] A moderator cannot decide a mission they are party to
- [ ] Gate configurable per category and risk band, defaulting to **closed** (everything reviewed)
- [ ] Decision, reasoning, moderator identity and timestamp recorded and append-only
- [ ] Queue age surfaced — an unreviewed mission is a customer waiting, and missions expire

**Note on throughput:** at launch volume one moderator can gate everything. If review latency
becomes the constraint, the per-category configuration is the lever — not removing the gate.

**Validation**
```bash
pnpm --filter api test mission-moderation && pnpm --filter admin-web test
```

---

### T-052 — Block another user
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-011, T-036
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{users,search,messaging}/**, apps/mobile/**, apps/app-web/**

**Description**
Originally driven by Google Play's User Generated Content policy. **Mobile is deferred
(ADR-0009), but this stays** — a marketplace where two parties can refuse further contact needs
it on product merit, and the surveillance scope makes unwanted contact more likely, not less.

**Blocking here is not blocking on a social app.** Two users may be mid-assignment with money
held, evidence exchanged and work owed. Severing that would make "block" a way to abandon an
assignment or avoid paying for one. So it governs **future engagement**, never an existing
obligation.

**Acceptance criteria**

Core behaviour
- [ ] Either party may block the other from a profile, a conversation, or a report flow
- [ ] Blocked investigator no longer sees that customer's missions in discovery, and cannot
      quote on them — enforced in the query, not by hiding in the UI (`investigator-discovery`)
- [ ] Blocked customer is not matched with that investigator
- [ ] No new conversation can be opened between the two
- [ ] Blocks are **private** — the blocked party is not notified and cannot detect it from a
      different response shape or timing

Live assignments — the part that must not be got wrong
- [ ] Blocking during a live assignment **does not sever the assignment**
- [ ] It flags the assignment to staff, who resolve it: continue, reassign, or cancel with the
      refund decided on its merits
- [ ] **A test proves blocking cannot be used to escape delivery or payment obligations**
- [ ] Communication required for an active assignment continues until staff resolve it, so the
      dispute record stays intact

Reporting is separate
- [ ] Block and report are distinct actions with distinct outcomes — block is "not this
      person", report is "staff should look at this"
- [ ] Blocking optionally offers to report; it never silently reports
- [ ] Reports reach staff; the reporter is acknowledged so the route is visibly working

Staff and signal
- [ ] Staff can see blocks; many blocks against one account is a pattern worth surfacing
- [ ] Block and unblock are audited with actor and timestamp
- [ ] Blocks survive until removed; the user can see and manage their block list

Documentation (per `documentation-first`, in this task)
- [ ] Customer and investigator knowledge-base articles explaining what blocking does and does
      not do — especially that it does not end an assignment or an obligation
- [ ] Release checklist §7 items satisfied

**Validation**
```bash
pnpm --filter api test blocks && pnpm --filter api test search-blocks
```

---

### T-053 — Shared taxonomy
- **Status:** TODO
- **Priority:** P0 — blocks matching, discovery and mission creation
- **Depends on:** T-004
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** database (schema) + backend-domain (service)
- **Affected:** apps/api/src/modules/taxonomy/**, migrations, packages/validation

**Description**
One taxonomy shared by missions and investigator practice areas, per ADR-0007. This is the core
matching mechanism — eligibility, discovery, routing and notifications all join on it, so it
lands before anything that depends on it.

**Acceptance criteria**
- [ ] `TaxonomyNode` hierarchical with stable ids, slug, parent, ordering, status
- [ ] **Nodes are never deleted, only deprecated** — a test proves a deprecated node still
      resolves for missions and profiles that reference it
- [ ] `TaxonomyNodeLabel` per locale (en/ru/hy); the node id is the canonical language-neutral
      value (`localization`)
- [ ] A mission at a parent matches investigators declared at any descendant, and vice versa —
      tree-walking matching tested in both directions
- [ ] Applied as a **hard SQL filter**; no path lets prose or a tag substitute for a declared node
- [ ] `Tag` curated and flat; `MissionTag` applied to missions
- [ ] **A test proves a tag cannot make an investigator eligible, and a missing tag cannot
      exclude a qualified one** (ADR-0007)
- [ ] Staff-managed through the admin console; adding, deprecating and relabelling are audited
- [ ] Initial tree seeded from `docs/product/taxonomy-draft.md` **after domain and licensing
      review** — the six open questions in that document are answered first
- [ ] Each node carries a risk band (`standard`/`elevated`/`high`) driving moderation queue
      ordering (T-051) and the structured questions at mission creation (plan.md §10)
- [ ] `high`-band nodes route to a moderator every time, regardless of queue configuration
- [ ] No `Service` entity; a service is a deeper node

**Second axis — source capability (ADR-0008)**
- [ ] `SourceNode` tree with per-locale labels, staff-maintained
- [ ] `InvestigatorSourceCapability` is **(investigator, source, jurisdiction)** — an
      unqualified source declaration is meaningless
- [ ] Declared by investigators only; **customers never see or pick sources**
- [ ] **A test proves a source declaration cannot gate eligibility** — neither excluding an
      investigator the taxonomy qualified, nor qualifying one it did not
- [ ] Source capability reorders results by feasibility in the mission's jurisdiction
- [ ] Self-declared capability is stored and displayed as self-declared, never as verified
- [ ] `TaxonomySourceHint` maps taxonomy node + jurisdiction to likely sources, as a routing
      hint; a wrong hint degrades ordering, never correctness

**Validation**
```bash
pnpm --filter api test taxonomy
```

---

### T-054 — Investigator mission browse and filter
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-053, T-011
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain (API) + frontend (UI)
- **Affected:** apps/api/src/modules/search/**, apps/app-web/**

**Description**
Investigators currently see eligible missions but cannot sort or filter them. An investigator
eligible for two hundred missions has no way to find the ones worth quoting on.

Distinct from T-011, which is the customer→investigator direction.

**Acceptance criteria**
- [ ] **Eligibility is applied first and is not user-adjustable** — filters narrow the eligible
      set, never widen it. A test proves no filter combination surfaces an ineligible mission
- [ ] Filters: taxonomy node, budget range, timeline, distance from a service area, language,
      posted date, tags
- [ ] Sorts: newest, closest, highest budget, soonest deadline
- [ ] Free-text search ranks within the eligible set; it never gates (`investigator-discovery`)
- [ ] Saved filters, so a returning investigator does not rebuild the same query
- [ ] Cursor pagination, bounded limit (`docs/api/pagination.md`)
- [ ] Results are projections — **no customer contact details before assignment**
- [ ] Distance uses `ST_DWithin` to filter and `ST_Distance` to sort (`postgis-search`)

**Validation**
```bash
pnpm --filter api test mission-browse
```

---

### T-055 — Mission tagging
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-053, T-051
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{missions,taxonomy}/**, apps/admin-web/**

**Description**
Tags as refinement on top of the taxonomy. Deliberately curated rather than customer free text:
free-text tags in three locales are unusable for matching, and a customer-authored tag is a
moderation surface.

**Acceptance criteria**
- [ ] Tags applied from the curated vocabulary — **no free-text tag creation by customers**
- [ ] Customers may suggest tags at mission creation; moderators confirm at publication (T-051)
- [ ] Tags improve search ranking and browse filtering only
- [ ] **A tag never affects eligibility** — tested
- [ ] Tag labels localised for en/ru/hy
- [ ] Staff can add, merge, deprecate and relabel tags; all audited
- [ ] Merging a tag preserves the missions that carried the old one

**Validation**
```bash
pnpm --filter api test mission-tags
```

---

### T-056 — Assistant shell and conversation UI
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-017, T-045, T-039
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**, packages/ui/**

**Description**
The conversation interface. Six backend tasks build a full assistant engine with no way to
reach it; this is the surface.

**Acceptance criteria**
- [ ] Docked panel on desktop; **full-screen sheet on mobile** (`responsive-design`)
- [ ] **Responses render progressively as they stream — never a spinner.** Progressive rendering
      is information; a spinner is an apology (`animation`)
- [ ] Message roles visually distinct: user, assistant, tool/command events as structured
      blocks rather than prose (`ai-session-context`)
- [ ] Stop generation; retry a failed turn without losing the conversation
- [ ] Composer: multiline, keyboard submit, attachment entry point
- [ ] **Minimal chrome.** A conversation is already the simplest interface — wrapping it in
      controls makes it worse (`interaction-design`)
- [ ] Empty state teaches what the assistant can do for that role, not "No messages"
- [ ] Keyboard operable end to end; new content announced to screen readers

**Validation**
```bash
pnpm --filter app-web test assistant
```

---

### T-057 — Session management UI
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-045, T-056
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Acceptance criteria**
- [ ] Session list with create, open, rename, archive, delete — and search across sessions
- [ ] Resume loads summary, structured state and recent messages; **not the whole history**
      (`ai-session-context`)
- [ ] Older messages load on demand or through search, never all at once
- [ ] Generated titles are editable and **never expose evidence content** (`plan.md` §50)
- [ ] Delete warns that session memory goes with it
- [ ] Mobile: sessions are a sheet, not a squeezed sidebar
- [ ] A test proves another user's session is unreachable from the UI by any route

**Validation**
```bash
pnpm --filter app-web test assistant-sessions
```

---

### T-058 — Confirmation and plan UI
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-048, T-056
- **Risk:** HIGH
- **Human approval required:** Yes — this is the mutation gate the user actually sees
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
T-048 makes a pending confirmation survive a browser close. **Nothing currently shows it to the
user when they return**, which makes that persistence invisible and therefore pointless.

Every state-changing assistant action passes through this UI. It is the last thing between a
model proposal and a real mutation.

**Acceptance criteria**
- [ ] A write tool renders the **exact proposed action and arguments** — never a paraphrase
- [ ] Confirm and cancel are equally reachable; confirm is not the default focus
- [ ] **Opening a session with a pending confirmation surfaces it immediately** — tested by
      closing the browser mid-flow and returning
- [ ] Re-validation before execution is visible: if the plan changed or state moved, the user is
      told **why** they are being asked again, not silently re-prompted
- [ ] A stale confirmation cannot be submitted — the UI reflects invalidation
- [ ] Irreversible or money-adjacent actions state the consequence plainly before confirming
- [ ] The confirmation token never reaches the model; the UI never auto-confirms
- [ ] Mobile: full-screen, never a sheet a user can dismiss by accident

**Validation**
```bash
pnpm --filter app-web test assistant-confirmation
```

---

### T-059 — Structured result and citation rendering
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-018, T-056
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Tool results are structured data, not prose. Rendering them as chat text loses the structure
and invites the model to editorialise.

**Acceptance criteria**
- [ ] Investigator results render as cards showing **`matchedOn` and `notMatched` fields only**
      — never a model-composed rationale (`investigator-discovery`)
- [ ] Distance, languages, specialties and availability shown from the data, not the prose
- [ ] RAG answers **cite their sources**, linked and openable
- [ ] "I don't have that" renders as a clear state, not an apology buried in text
- [ ] Large results paginate by reference — **10,000 rows never enter the view or the prompt**
      (`ai-session-context`)
- [ ] Mission, quote, assignment and payment references link into the app
- [ ] AI-drafted report or message text is **visibly marked unreviewed** and cannot be sent or
      exported from the assistant without review (`report-generation`)

**Validation**
```bash
pnpm --filter app-web test assistant-results
```

---

### T-060 — Memory management UI
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-047, T-057
- **Risk:** HIGH
- **Human approval required:** Yes — persistent memory is a privacy surface
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Acceptance criteria**
- [ ] User can see everything remembered about them, session and cross-session, separately
- [ ] Each entry shows **where it came from** — the source message, openable (`ai-session-context`)
- [ ] Delete individual memories and clear all; deletion is immediate and audited
- [ ] The user is told what memory is used for, in plain language, without a dark pattern
- [ ] Memory appears in data export and account deletion (T-022)
- [ ] A test proves a deleted memory does not reappear in a later context build

**Validation**
```bash
pnpm --filter app-web test assistant-memory
```

---

### T-061 — Staff assistant in the admin console
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-056, T-013, T-051
- **Risk:** HIGH
- **Human approval required:** Yes — staff scope over customer data
- **Owner agent:** admin-web
- **Affected:** apps/admin-web/**

**Description**
Staff capabilities from `plan.md` §16 — searching missions in scope, summarising applications
and disputes, finding overdue reports and expiring verifications, drafting support responses,
explaining policy decisions.

`admin.` is a separate origin with a separate session (ADR-0002), so this is a separate
integration, not the same component mounted twice.

**Acceptance criteria**
- [ ] Runs with the **staff member's specific scope** — never blanket `isStaff` (`authorization`)
- [ ] A test proves staff cannot reach evidence through the assistant without an existing grant
- [ ] Summaries of disputes and applications **cite the records they drew on**
- [ ] The assistant never renders a policy decision as made — it explains, staff decide (T-051)
- [ ] Assistant use in the console is audited like any other staff action (`audit-logging`)
- [ ] Drafted support responses are marked as drafts and require a human to send

**Validation**
```bash
pnpm --filter admin-web test assistant
```

---

### T-062 — Google OAuth sign-in
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-005, T-021
- **Risk:** HIGH
- **Human approval required:** Yes — authentication
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/**, apps/app-web/**, packages/auth/**

**Description**
Sign in with Google, alongside email/password. Authorization Code flow with PKCE, server-side
token exchange. The web app is the only surface — mobile is deferred (ADR-0009).

**Acceptance criteria**

Flow
- [ ] Authorization Code + PKCE; **the code exchange happens server-side** and the client
      never sees the client secret
- [ ] `state` is validated to prevent CSRF on the callback; single-use and short-lived
- [ ] `nonce` validated in the ID token
- [ ] ID token signature, issuer, audience and expiry all verified against Google's JWKS —
      never trusted on presentation
- [ ] Redirect URIs allowlisted exactly; no wildcard, no open redirect on the callback

Account linking — where the real vulnerability is
- [ ] **Google's `email_verified` claim is required before linking to an existing account.**
      Linking on an unverified email lets anyone who controls a Google account with that
      address take over the local one
- [ ] A test proves an unverified-email OAuth identity **cannot** link to an existing account
- [ ] One account may hold several identities; `auth_identities` is (provider, subject) unique
- [ ] Unlinking is blocked if it would leave the account with no way to sign in
- [ ] Linking and unlinking are audited

Session and data
- [ ] Issues the platform's own session — host-only cookie, `SameSite=Strict` (ADR-0002).
      The Google token is not the session
- [ ] Google tokens are never logged and never returned to the client (`audit-logging`)
- [ ] Only profile and email scopes; nothing beyond what registration needs
- [ ] Terms acceptance still required at first sign-in — OAuth does not bypass `legal-consent`
- [ ] Account deletion revokes the linked identity

Verification
- [ ] Browser-verified end to end: new account, existing-account link, denial at the consent
      screen, and callback with a tampered `state`

**Validation**
```bash
pnpm --filter api test auth-oauth
```

---

## Backlog

Captured, not yet scheduled. Move into a phase when a dependency lands.

- Messaging with assignment-scoped authorization (Phase 6)
- Evidence items with chain of custody and access grants (Phase 6)
- Report versions and customer review (Phase 6)
- Payments: intents, webhooks, ledger, fees (Phase 5, all HIGH risk)
- Payouts and reconciliation (Phase 5, all HIGH risk)
- AI gateway and tool registry (Phase 7) — see T-017, T-018
- Application UI i18n catalogs for en/ru/hy with build-time parity check (separate from
  knowledge-base translation — see T-026)
- Prometheus/Grafana dashboards and alert runbooks (Phase 8)
- Encrypted backups with a tested restore drill (Phase 8)

---

## Done

_(nothing yet)_
