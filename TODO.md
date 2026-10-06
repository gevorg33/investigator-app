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
- **Status:** DONE — 4 tables; append-only grant proven by test, not asserted
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
- [x] Migration applies, **down reverses to zero tables, up restores all four** — full round trip run, not assumed
- [x] `investigator_app` holds **SELECT + INSERT only**. Six tests connect **as that role** and prove UPDATE and DELETE are refused — issuing a GRANT is not the same as the grant working
- [x] `citext` with a unique index; a test proves `CaseProbe@Example.com` and `caseprobe@example.com` collide
- [x] Timestamps throughout; `users.deleted_at` soft delete with a partial index excluding deleted rows
- [x] `docs/compliance/retention.md` — periods marked **provisional**; counsel sets the real ones (brief §5, q12)

**ORM decision:** Drizzle `0.45.2` (ADR-0010) — pinned to the CVE-patched version.

**Also found:** a Homebrew `postgresql@16` and a host Redis already owned ports 5432/6379, so
the container mappings were silently shadowed — every connection reached the wrong server while
`docker ps` showed a correct mapping. Host ports moved to **5433 / 6380**.

**Validation** — all green 2026-09-13
```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm build && pnpm --filter api test
```

---

### T-005 — Authentication: register, login, refresh rotation, sessions
- **Status:** DONE — 2026-09-13
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
- [x] Passwords hashed with argon2id; never logged, never returned
- [x] Refresh rotation detects reuse and revokes the whole session family
- [x] Rate limits on login, register, reset — per IP and per account
- [x] Email enumeration not possible via response body, status, or timing
- [x] Every auth event is audited
- [x] A revoked session is rejected immediately, not at next expiry
- [x] Built so a second auth method can attach to the same account — Google OAuth is T-062,
      and retrofitting identity linking afterwards is materially harder

**How each was verified** — against a running API, not only in tests

| Criterion | Evidence |
|---|---|
| argon2id, never returned | Stored hashes start `$argon2id$`; no response body or audit row contains a password or a refresh token |
| Reuse revokes the family | Rotation issued a new token; replaying the old one returned 401; the descendant died with it, with `auth.refresh.reuse_detected` audited |
| Rate limits | `loginPerIp`, `loginPerAccount`, `registerPerIp`, `resetPerIp`, `resetPerAccount` |
| No enumeration | Wrong password and unknown account return byte-identical 401s; a decoy argon2 verify spends the same CPU when no account exists; reset and resend answer 202 either way |
| Everything audited | 16 distinct `auth.*` actions, none carrying a token or password |
| Revocation is immediate | A revoked session's next refresh returned 401 rather than surviving to expiry — the criterion that ruled out stateless JWTs |
| Second auth method | `user_identities` ships now (migration 0002): unique per `(provider, account)` and per `(user, provider)`, holding no credential. Linking is never automatic on a matching email |

**Design note — why the tokens are opaque**

"A revoked session is rejected immediately, not at next expiry" excludes a stateless JWT by
definition: a JWT stays valid until it expires. Refresh tokens are 256-bit random values
checked against `user_sessions` on every use, so revocation takes effect at once.

**Also delivered here**

Email verification, password reset, and session listing/revocation, all of which the task
description covers. Password reset revokes every session the user holds — someone resetting
a password is often doing it because an attacker has the old one, and an active session does
not need the password again. The mailer is a port with a development transport that refuses
to run under `NODE_ENV=production`; a real provider is ACTIONS-FOR-ME #5.

**Coverage:** `src/modules/auth` is at 100% statements, functions and lines, and 98.09%
branches. The gap is two `@Injectable()` lines where the transpiler's `__decorateClass`
helper produces a branch no test can reach — see T-063 and ACTIONS-FOR-ME #12.

**Validation** — all green 2026-09-13
```bash
pnpm --filter api test auth
```

---

### T-006 — Authorization foundation: RBAC + resource-level guards
- **Status:** DONE — 2026-09-13
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
- [x] `Actor` type carries id, roles, staff scope, account status
- [x] Actor-scoped repository base makes fetch-then-compare the awkward path
- [x] Reusable test helper covers all seven authorization cases
- [x] Role switching does not require re-login and cannot widen scope
- [x] Documented in `docs/architecture/authorization.md`

**How each was verified**

| Criterion | Evidence |
|---|---|
| `Actor` | `@investigator/auth` defines it, `ActorService` builds it, frozen so nothing downstream can widen it. Roles and staff scopes are read per request, so a revoked role applies on the next request rather than the next sign-in |
| Repository base | `ActorScopedRepository` has no `findById` — every read demands an Actor, so an unscoped fetch means leaving the repository. `SessionRepository` is the first real consumer, not a demo |
| Seven cases | `apps/api/test/authz-cases.ts`. The helper is itself tested by driving deliberately broken subjects past each case — a checklist that cannot fail is decoration |
| Role switching | `X-Active-Role` intersected with roles held: intersect, never union. Verified live that one session switches workspace without re-login, and that asking for a role not held narrows nothing rather than granting it |
| Documentation | `docs/architecture/authorization.md` |

**Verified live** — two real identities against a running API:

- Session lists are disjoint per user
- **IDOR:** revoking another user's session by id returns **404, byte-identical to a
  nonexistent id** — no oracle for confirming an id is real. The victim's session kept working
- Revoking one's own session returns 204 and takes effect immediately
- No identity returns 401

**A gap in T-005 found and closed here**

Suspension blocked only the *next login*. An existing session kept refreshing for up to
`REFRESH_TTL_DAYS` — confirmed by probe before the fix, where a suspended account refreshed
successfully. An enforcement action that leaves the offender working for thirty days is not
an enforcement action. Sessions are now ended at resolution *and* revoked in the database
(verified live: 0 live sessions remain after suspension). A soft-deleted account whose
`status` still read `ACTIVE` had the same hole; also closed.

**Scope note:** `PENDING_VERIFICATION` is deliberately not session-ending — login admits it,
so severing the session on first rotation would sign people out for no reason. What such an
account may *do* is `AuthzService.requireActive`, which demands `ACTIVE`.

**Coverage:** `src/common/authz` at 100% statements, functions and lines. Remaining branch
gap is the `@Injectable()` transpiler artifact (T-063, ACTIONS-FOR-ME #12).

**Validation** — all green 2026-09-13
```bash
pnpm --filter api test authz
```

---

## Phase 2 — Profiles and verification

### T-007 — Customer and investigator profiles with role switching
- **Status:** DONE — 2026-09-13
- **Priority:** P1
- **Depends on:** T-006
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{users,investigator-profiles}/**

**Acceptance criteria**
- [x] One account holds both roles; switching needs no new account
- [x] A user can read only their own profile in full; public projection for others
- [x] Investigator profile: specialties, languages, pricing model, availability
- [x] `*.authz.spec.ts` asserts a different actor cannot read or write the profile

**Verified live**

| | |
|---|---|
| One account, both roles | `CUSTOMER` and `INVESTIGATOR` activated on one account, 201 each. Self-activating `STAFF` is 400 — staff roles are granted by staff |
| Owner vs stranger | Owner sees 17 fields; a stranger sees 12. Withheld: `contactPhone`, `userId`, `visibility`, `createdAt`, `updatedAt`. Storefront intact |
| Customer projection | Owner sees 7 fields, everyone else sees `id` and `displayName`. Organisation and phone do not leak |
| Draft invisibility | A draft answers **404, byte-identical to a nonexistent id** — a response distinguishing them would confirm someone works here |
| Write protection | There is no write-by-id route (404); a customer writing `investigator/me` is 403 and the victim's profile is untouched |
| Role narrowing | Acting as `CUSTOMER` refuses the investigator profile (403) though the role is held |

**The public projection is an allowlist**, never the row with private fields deleted. On the
day a column is added, an allowlist keeps it invisible until deliberately exposed; a denylist
publishes it the moment it exists. Same argument as the actor-scoped repository — the safe
form is the one where forgetting produces less access.

**Writes take no profile id.** The row is found by who the caller is, so there is no id to
get wrong and no ownership comparison to forget.

**Taxonomy dependency, stated plainly:** specialties are taxonomy nodes (ADR-0007), and T-053
owns the taxonomy but is not built. This ships the **structural subset only** —
`taxonomy_nodes` with stable ids, slug, parent, status — because a specialty pointing at
nothing is not a specialty. T-053 still owns per-locale labels, risk bands, tags,
tree-walking matching, the admin surface, and seeding the tree (which waits on domain and
licensing review). A specialty naming an unknown node is rejected: free text can never
substitute for a declared node.

**Role activation requires a verified, active account.** A freshly registered account is
`PENDING_VERIFICATION` and is refused — confirmed live. Consistent with T-022.

**A grant that was silently doing nothing:** `GRANT SELECT ON taxonomy_nodes` did not make
taxonomy read-only for the application. Migration 0000's `ALTER DEFAULT PRIVILEGES` already
grants all four verbs on every future table, so the grant added nothing — verified by
inserting a node as `investigator_app` and watching it succeed. An explicit `REVOKE` was
needed, exactly as `audit_logs` does. **Any table meant to be narrower than the default has
to say so.**

Ten CHECK constraints are enforced in the database, not only in DTOs — each verified to
reject: rate without currency, negative rate, lower-case currency, 120 years of experience,
day 7, a window ending before it starts, a window past midnight, upper-case and three-letter
language codes, and a node that is its own parent.

**Coverage:** `src/modules/profiles` at 96.09% statements, 100% functions, 98.36% lines.

**Validation** — all green 2026-09-13
```bash
pnpm --filter api test profiles
```

---

### T-008 — Cloudinary private upload authorization
- **Status:** DONE — 2026-09-14
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
- [x] Upload signature issued only after server-side authorization; scoped and short-lived
- [x] Upload result validated against what was authorized, including folder scope
- [x] Client-supplied public IDs never trusted
- [x] Delivery URLs short-lived, audited, never logged
- [x] Scan status gates visibility; fails closed
- [x] Test proves a non-owner cannot obtain a delivery URL

**Verified live** — a running API with placeholder Cloudinary credentials (signing and link
generation are local computations, so these paths are real without an account):

| | |
|---|---|
| Upload authorization | 201; signature matches an **independent SHA-1** of the signed fields; public ID server-chosen; `type=authenticated`, `overwrite=false`, format allowlist; server window 600 s; secret never in the body |
| Refusals | wrong role 403 · SVG 422 · client-supplied `publicId` 400 · no session 401 |
| Fails closed | link while AUTHORIZED 403 · scan PENDING 403 · scan INFECTED 403 |
| Delivery | owner and VERIFICATION-scoped staff 200; `Cache-Control: no-store`; expires in **300 s**; private type |
| Non-owner | **404, byte-identical to a nonexistent id**; completing another user's upload 404 |
| Never logged | signed link and `signature=` absent from the API log; absent from every audit row |
| Completion | needs a real account (reads the asset back from the Admin API); with placeholder credentials it answers a generic 500 that leaks nothing |

**Negative controls** — each core rule broken on purpose, tests watched fail, files restored
byte-for-byte: owner scope removed → 7 failures; clean-scan gate removed → 4; real-size check
disabled → 1.

**Cloudinary constraints that shaped the design** (verified in its documentation):
- **Signed delivery URLs never expire**, so `sign_url` cannot deliver a short-lived link.
  Expiring tokens need the Advanced plan. Delivery uses `private_download_url` with
  `expires_at` — available on every plan.
- **An upload signature lasts one hour**, fixed by Cloudinary. The server's own 10-minute
  window is what actually limits an authorization; completion after it is refused and the
  asset destroyed.
- **File size cannot be signed.** Enforced at completion against what Cloudinary holds.

**Decisions to confirm (access rules — this task is approval-gated on them):**
1. **The uploader can open their own verification documents**, as well as VERIFICATION-scoped
   staff. The knowledge-base article previously said staff only; it now says both.
2. **Profile images are owner-only for now.** Showing them to others needs the published-profile
   check so a draft's photo stays invisible; that link belongs with discovery.
3. **Staff access honours role narrowing** — staff acting in their customer workspace get none.
4. **Nothing is served until a malware scanner exists (T-065).** Filed, because no task owned
   scanning. Failing closed means the feature is inert until then, which is the correct side to
   fail on.

**Also:** Cloudinary credentials are required at boot in staging and production, and the folder
must end in `/staging` or `/production` there. `media_assets` grants no `DELETE`, and its owner
key restricts. Retention recorded as provisional pending counsel. Docs:
`docs/architecture/media.md`; the investigator verification article updated.

**Not verifiable without the account** (ACTIONS-FOR-ME #4): an end-to-end upload to Cloudinary,
completion reading the asset back, and a link actually expiring at Cloudinary's edge.

**Validation** — all green 2026-09-14
```bash
pnpm --filter api test media
```

---

### T-009 — Service areas with PostGIS
- **Status:** DONE — 2026-09-14
- **Priority:** P1
- **Depends on:** T-007
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** database
- **Affected:** apps/api/src/modules/service-areas/**, migrations

**Acceptance criteria**
- [x] `geography(Point, 4326)` and polygon support, GIST indexed
- [x] `ST_DWithin` filters, `ST_Distance` only sorts
- [x] Investigator home location is not discoverable
- [x] Multiple service areas per investigator deduplicate in results
- [x] Query plan confirms index use on a seeded dataset

**How each was verified**

| Criterion | Evidence |
|---|---|
| Point + polygon, GIST | A radius is stored as its buffered polygon, so one `area` column serves both kinds; `ST_DWithin` can use the index only with a constant distance. Index confirmed `USING gist` on a database migrated from empty |
| `ST_DWithin` filters | The coverage query filters with `ST_DWithin` and uses `ST_Distance` only to order and to pick each investigator's nearest area |
| Home not discoverable | No home column in any table (asserted). Centres coarsened to 2 dp (≈1.1 km) and a 5 km minimum radius/area — both CHECK constraints, proven to refuse direct inserts. Coverage returns an id and a distance rounded **up** to whole km, nothing else. No route reads another investigator's areas. Live: a centre sent as `44.51523, 40.18724` was stored as `POINT(44.52 40.19)`; zero coordinates in the API log or audit rows |
| Dedup | An investigator with three overlapping areas appears once, at the nearest distance |
| Query plan | 5,000 areas seeded inside a rolled-back transaction; `EXPLAIN` of the **production** query shows `service_areas_area_gist`; the `WHERE ST_Distance(...) <=` form cannot use it even with sequential scans disabled |

**Negative controls** — each rule broken on purpose, tests watched fail, files restored byte-for-byte:
dedup (`min()` and `GROUP BY` removed, query still valid) → exactly the dedup test fails, 30 others
pass; index-usable filter swapped for `ST_Distance` → the index-use test fails; coarsening removed
→ 1; rounding removed → 2; published-only filter removed → 1.

A first dedup control removed `min()` but left `GROUP BY`, which made the query invalid — its 7
failures came from a broken query, not from duplicates, and proved nothing. Redone as above.

**Three bugs found and fixed — each with a regression test seen to fail first**

1. **Geography values could never be read back.** T-004's `geographyPoint` parsed `POINT(…)`
   text; postgres.js returns hex EWKB. Any geography row read through drizzle threw. Fixed with a
   minimal EWKB reader (both byte orders, optional SRID; refuses truncated, trailing, 3D and
   non-finite values) and a new `geographyPolygon` type, with real round trips through PostGIS.
2. **drizzle-kit generated invalid SQL for these types.** It quotes custom column types as
   identifiers, and a quoted `geography(Point, 4326)` names a type that does not exist. Migration
   0006 unquoted by hand; `migrations.spec.ts` now fails the build if a quoted geography type ever
   reaches a migration again.
3. **Genuine 5 km areas were refused in the tropics.** PostGIS buffers geography through a local
   projection chosen by longitude band; a 5 km buffer measures 77,948,988–78,097,887 m². The
   minimum-area constraint was first 78,000,000, calibrated from one point, and refused minimum
   areas on four of every sixteen grid longitudes between 35°S and 35°N. Now 77,500,000, from a
   global measurement. The regression test uses the measured coordinates — a first version picked
   random longitudes, mostly missed the affected bands, and passed against the broken constraint.
   Also fixed: a radius area with no centre passed validation and crashed the service (500).

**Privacy defaults to confirm** — engineering choices, not yet product decisions:
- Centre precision **≈1.1 km** (2 decimal places)
- Minimum radius **5 km**, and the same minimum area for drawn regions
- Distances reported **rounded up to whole kilometres**
- At most **10** areas; drawn regions **3–200 points**, one outline, no holes; radius up to **300 km**

**Scope note:** verification status is not yet in the coverage filter — it does not exist until
T-013. Coverage currently requires a published profile accepting work. Discovery (T-011) composes
the rest; there is deliberately no search route in this task.

**Validation** — all green 2026-09-14
```bash
pnpm --filter api test service-areas
```

---

## Phase 3 — Missions and discovery

### T-010 — Mission creation, state machine, policy review
- **Status:** DONE — 2026-09-17
- **Priority:** P1
- **Depends on:** T-009
- **Risk:** HIGH
- **Human approval required:** Yes — lawful-use policy enforcement. **The policy decisions are
  listed in `ACTIONS-FOR-ME.md` #13 and still need confirming.** Every one was built to the most
  conservative reading; each is reversible.
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{missions,mission-policy}/**, migrations

**Acceptance criteria**
- [x] Transition map is data; every illegal transition tested
- [x] Status, status_history, audit and outbox share one transaction
- [x] Prohibited-category detection is deterministic; AI may classify but never decide
- [x] High-risk missions route to staff review with the decision and reason stored
- [x] `lawfulPurposeConfirmed` required before submission
- [x] Concurrent transitions cannot both apply

**How each was verified**

| Criterion | Evidence |
|---|---|
| Map is data, illegal transitions tested | `MISSION_TRANSITIONS` is a table of `from → to → who`. The matrix is **generated** from it — 17 statuses × 17 destinations × 9 authorities = 2,601 triples, every one not listed asserted refused. Two properties are asserted about the whole map rather than one edge: `QUOTED` is reachable only from `UNDER_REVIEW` and only by `STAFF:MODERATION`, and the system can never publish or reject from any status |
| One transaction | `MissionTransitionService.apply` writes status, `mission_status_history`, the audit entry (through `AuditService`, which now takes the transaction) and the `outbox_events` row inside the caller's transaction. Asserted both ways: a unit test counts all four writes; an integration test asserts a failed submission leaves **no** screening row, no status change and no confirmation |
| Deterministic detection; AI never decides | The ruleset is versioned data (`RULESET_VERSION`), pure functions, no clock and no model. `screenMission` takes `ScreeningInput` and **nothing else** — there is nowhere to put a classification, so the guarantee is the signature, not a convention. Tested: the same mission screened with an alarming classification, a reassuring one and none produces three identical results, and a classification naming a real rule id does not set that flag |
| High-risk routes to review, decision stored | Every submission writes a `mission_screenings` row: outcome, band, flags, ruleset version, mission version. `PRIORITY_REVIEW` for a rule match, a high/restricted band, or an unbanded category. **An unbanded category screens as HIGH** — failing closed until T-053 bands the tree |
| Lawful purpose required | Enforced three times: the DTO accepts `true` and nothing else; the service writes the timestamp **in the same UPDATE as the transition**, so a failed submission is not left looking confirmed; and CHECK `missions_submission_complete` refuses any non-draft mission missing the confirmation or a required field, whatever wrote it |
| Concurrent transitions | Two guards. Callers read `FOR UPDATE`; the UPDATE also matches on the version and status that were read. Two simultaneous submissions, and a simultaneous submit and cancel, each leave exactly one winner and no second screening or history row |

**Negative controls** — each rule broken on purpose, tests watched fail, files restored byte-for-byte:

| Control | Result |
|---|---|
| Let the system publish (`SUBMITTED → QUOTED: [SYSTEM]`) | 3 of the publication-gate tests fail |
| Drop the outbox write from the transition | 1 fails — the four-write test |
| Let the AI classification set the outcome | 1 fails — "cannot raise the band, add a flag or change the outcome" |
| Remove **both** concurrency guards | 2 fail: both simultaneous submissions succeed (2 winners, expected 1) |
| Remove only the row lock | **Still passes** — the version+status match catches it alone. Defence in depth, confirmed rather than assumed |
| Skip the completeness check | 1 fails, and the DB CHECK caught the submission instead — the constraint is a real backstop, not decoration |
| Restore the unbounded `hack` stem | 1 fails — the "hackathon" false-positive regression |

**Four bugs found and fixed — each with a regression test seen to fail first**

1. **The append-only tables were fully writable.** Migration 0000 sets `ALTER DEFAULT PRIVILEGES`
   granting SELECT/INSERT/UPDATE/DELETE on every table created in this schema, so a new table
   arrives writable and a narrower `GRANT` adds nothing — withholding a privilege means
   `REVOKE`ing it. 0007 shipped its GRANTs without REVOKEs, and `mission_status_history` and
   `mission_screenings` could both be updated and deleted. `grants.spec.ts` failed against the
   applied schema, then passed; the privileges are now proven on all four tables from a database
   built only from the migration files.
2. **An impossible date reached the database.** `Date.parse('2026-02-31')` does not return NaN —
   it rolls forward to 3 March — so the validity check passed it through and the customer got a
   500 instead of a field error. Now built and read back; `missions.policy.spec.ts` covers the
   rollover cases.
3. **`hack\p{L}*` matched "hackathon".** Due diligence on a hackathon sponsor is not an
   account-access request. Bounded to real inflections.
4. **The rules missed "read my wife's messages".** The possessive pattern did not cover
   `my <person>'s`, which is how these requests are actually worded — found by a normalisation
   test, fixed, and the phrasing is now covered.

**Also found, filed not fixed:** the suite fails a different unrelated test on roughly one run in
three under its own parallelism (T-069). T-010 raised `testTimeout`/`hookTimeout` to 15s, which
fixes the timeout class; the timing-oracle ratio in `password.service.spec.ts` needs its own fix
and is a security test I will not quietly rewrite.

**Verification:** 747 tests across 62 files, green. Coverage **100%** on all four metrics
(1138 statements, 516 branches, 320 functions, 1041 lines) with the single registered exclusion.
Lint, typecheck and build clean. All migrations apply to an empty database and the grants are
correct when built from the files alone. Knowledge base validates 0 errors, 0 warnings.
`pnpm audit`: no high-severity advisories (1 moderate — esbuild via drizzle-kit, dev-only,
below the gate).

**Scope note — what this deliberately did not build:** the moderation queue and its three
outcomes (T-051, which the map already declares as moderator-only moves); mission attachments
(T-066), so screening reads text and structured answers only and a moderator has nothing to
open; native-speaker review of the ruleset, Armenian missing entirely (T-067); and the
jurisdiction gate ADR-0009 requires for restricted categories (T-068).

**Documentation:** `docs/architecture/missions.md` (new), the retention register, the customer
knowledge-base article — two of whose answers no longer matched reality and were corrected — and
the `mission-state-machine` skill, whose example map had the **system** publishing, contradicting
T-051.

**Validation**
```bash
pnpm --filter api test missions
```

---

### T-011 — Investigator discovery
- **Status:** DONE — 2026-09-17
- **Priority:** P1
- **Depends on:** T-010
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/search/**, apps/api/src/modules/service-areas/**, migrations

**Acceptance criteria**
- [x] Order: hard filters → eligibility → geographic → quality ranking
- [x] An unverified or suspended investigator never appears, by any path
- [x] Filters: country, city, radius, language, specialty, availability, verification
- [x] Pagination bounded; no unbounded limit
- [x] Results are projections — no private profile fields leak

**How each was verified**

| Criterion | Evidence |
|---|---|
| Pipeline order | One statement: hard filters and eligibility in the `WHERE`, `ST_DWithin` for geography, sort key last, projection in TypeScript. Eligibility cannot be separated from ranking because there is no second pass to forget. A test searches with every other filter matching perfectly and still gets nothing back for an unverified investigator |
| Never appears, by any path | Eight exclusions tested one at a time: unverified, pending, rejected, draft profile, not accepting work, suspended account, unverified account, soft-deleted account. **Enforced in the coverage query too**, not only in discovery — "any path" is only true if every path enforces it, and coverage is a path reachable directly by the assistant's tools (T-018) |
| Filters | Country, region, city (case-insensitive, matched on the **service area**, so they mean "works there"), radius, language (**all** requested, not any), specialty (taxonomy walked **both** directions per ADR-0007), availability (overlap, not containment), pricing model. **Verification is deliberately not a client filter** — it is an eligibility invariant whose only legal value is VERIFIED, and offering it would imply otherwise |
| Pagination bounded | Cursor-based keyset, default 25, maximum 100, **clamped not rejected** as `docs/api/pagination.md` requires. No offset, no unbounded limit. The cursor is bound to its filter set by a hash, so page two of one search cannot become page two of another |
| Projections only | Results reuse `toPublicInvestigatorProfile`, so there is one allowlist rather than a second place to leak. A test serialises a result and asserts it contains no contact phone, no `userId`, no coordinates, no geometry and no area centre — only a distance **rounded up to whole kilometres** |

**Negative controls** — each rule broken on purpose, tests watched fail, files restored byte-for-byte:

| Control | Result |
|---|---|
| Remove the verification filter | 4 fail: the three verification exclusions and "matches everything else perfectly" |
| Remove the account-status filter | 2 fail: suspended and pending accounts. The soft-delete test still passes — it is a separate condition |
| Filter with `ST_Distance` instead of `ST_DWithin` | 1 fails: the plan no longer uses `service_areas_area_gist` |
| Drop the ancestor half of the taxonomy walk | 1 fails: "declared a parent, asked for the child". The descendant cases still pass — the asymmetry ADR-0007 describes |
| Drop the cursor fingerprint check | 3 fail: two in the cursor spec, one in discovery — a cursor becomes portable between searches |

**Schema this task had to add**

Two gaps blocked the acceptance criteria and had to be filled structurally, as T-007 did for `taxonomy_nodes`:

1. **`investigator_profiles.verification_status`** (+ `verified_at`). Nothing existed — T-013 is an admin queue with no schema — so "an unverified investigator never appears" had nothing to read. Defaults to `UNVERIFIED`, so **until T-013 ships, discovery lists nobody**. That is the correct direction for an eligibility gate to fail. A CHECK keeps the status and the date consistent in both directions, so T-013 must set the date when it grants the status.
2. **`service_areas.country_code`, `region`, `city`.** Geography cannot answer "in Armenia" without a country table nobody has built. Nullable, because T-009 shipped areas before these existed; an area with no country does not match a country filter, because an unanswered question is not a match.

**Two bugs found, each with a regression test seen to fail first**

1. **Two different filter sets hashed to the same cursor fingerprint.** `JSON.stringify(undefined)` returns `undefined`, and the fallback substituted `'null'` — the same string `null` itself produces. A cursor from one search would have been accepted by another. The fallback is now distinct.
2. **An unreachable branch in the fingerprint's sort comparator.** `Object.entries` cannot yield the same key twice, so the "equal" arm was a branch no input could reach. Removed rather than covered with a contrived test.
3. **My own tests were not isolated from the shared database.** Verification had to be granted by the fixture — discovery refuses everyone else — which quietly made the **538** investigators other suites leave in the development database eligible results. A 50 km search found a foreign fixture and took the first place: one failure in a full run, three passes when run alone, which is the signature of shared state rather than of the code under test. Each test now tags its investigators with a unique city and filters every search on it, so a search answers with that test's data or nothing. Same class of problem as T-069, and worth watching for in any suite that queries globally.

**Not a T-011 bug, but it blocked the task:** 135 iCloud conflict copies (`missions 2.ts`, `media.spec 2.ts`, …) had appeared under `src/`, `test/` and `docs/`, breaking `tsc` and standing to be executed by vitest and counted by the coverage gate. All 135 plus 16 stray compiled artifacts were quarantined (moved, not deleted), and `.gitignore` now covers both shapes. **The real fix is moving the repository off iCloud Desktop** — it will happen again otherwise.

**Deliberately not built:** quality ranking has **no inputs** — rating, review count and response time do not exist (T-037 owns reviews), so results order by distance when a location is given and by declared experience otherwise, rather than by an invented proxy. Free-text relevance ranking waits for the AI gateway (T-018) and may only reorder an already-eligible set. Verification decisions are T-013.

**Verification:** 844 tests across 67 files, green. Coverage **100%** on all four metrics (1255 statements, 619 branches, 353 functions, 1142 lines). Lint, typecheck and build clean. All migrations apply to an empty database, with 0008's three CHECK constraints and both indexes confirmed there. Knowledge base validates 0 errors, 0 warnings.

**Validation**
```bash
pnpm --filter api test search
```

---

## Phase 4 — Quotes and assignments

### T-012 — Quotes and idempotent assignment creation
- **Status:** DONE — 2026-09-18
- **Priority:** P1
- **Depends on:** T-011
- **Risk:** HIGH
- **Human approval required:** Yes — assignment and money-adjacent state. **Two decisions were
  confirmed during the task** (payment sequencing, assignment state vocabulary); the provisional
  constants and the payments boundary are recorded in `ACTIONS-FOR-ME.md` #15 and #16.
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{quotes,assignments}/**, apps/api/src/common/{idempotency,hash}/**, migrations

**Acceptance criteria**
- [x] Quote fields per plan.md §11, with expiry enforced server-side
- [x] Accepting an expired or withdrawn quote is rejected
- [x] Concurrent acceptance creates **exactly one** assignment — proven by a concurrency test
- [x] Idempotency enforced by a unique constraint, not read-then-write
- [x] Only the mission's customer can accept; only eligible investigators can quote

**How each was verified**

| Criterion | Evidence |
|---|---|
| Quote fields, expiry server-side | Every field plan.md §11 lists except taxes and fees, which belong to payments — "your quote is what your work is worth", and fees are shown to the customer separately. Expiry is checked against the clock at acceptance rather than trusted from a status column, because time passes without anyone writing a row. Bounded 1 hour to 90 days at submission |
| Expired or withdrawn rejected | Both refused with 403. `quotes_expiry_after_creation` additionally refuses a quote born past its own expiry — an offer nobody could ever accept |
| Exactly one assignment | **Two layers, tested separately.** The service locks the mission `FOR UPDATE`, so a second acceptance waits and finds it already confirmed; `quotes_one_accepted_per_mission`, `assignments_mission_unique` and `assignments_quote_unique` hold the same rule against every other writer. Two acceptances and two authorizations fired simultaneously each leave exactly one survivor |
| Idempotency by unique constraint | `idempotency_keys (actor_id, endpoint, key)`. Replay returns the stored response; a different body is `IDEMPOTENCY_KEY_REUSED`; an in-flight replay is a retryable conflict; a rolled-back first call frees the key, because the key row and the effect share a transaction. A concurrent claim test proves exactly one caller does the work |
| Only the customer accepts; only eligible investigators quote | Acceptance is scoped to the mission's customer (404 otherwise, 403 for an investigator). Quoting requires published **and** `VERIFIED` **and** accepting work — the same conditions discovery applies, so someone who cannot be found cannot arrive through the back door of a quote |

**Negative controls** — each rule broken on purpose, tests watched fail, files restored byte-for-byte:

| Control | Result |
|---|---|
| Drop `quotes_one_accepted_per_mission` | **First run: nothing failed.** See the finding below. After the gap was closed: 1 fails |
| Remove the expiry check from acceptance | 1 fails — "refuses an expired offer" |
| Stop matching the authorization against the quote | 2 fail — the amount and currency mismatches |
| Unbind the idempotency key from its request | 1 fails — "refuses a key reused for a different request" |
| Write an assignment status outside the transition service | 1 fails — the static guard names the offending file |

**The finding that mattered:** dropping the unique index left the concurrency test **passing**,
because the mission row lock was carrying it alone. The constraint was real defence in depth,
but nothing proved it load-bearing — a test can pass for a reason you did not intend. Direct-write
tests now bypass the service and assert the database itself refuses the second accepted quote and
the second assignment, and the control then fails precisely. Without the control I would have
shipped a documented guarantee that no test actually checked.

**Two decisions taken during the task**

1. **Where the chain stops.** Acceptance confirms scope and price; the assignment is created only
   when a payment authorization exists, by a system entry point the payments module (Phase 5)
   calls after verifying a webhook. There is deliberately **no payment port with a stub
   implementation** — a stub returning a fake authorization would commit investigators to work
   nobody paid for. With no code path that manufactures an authorization, that cannot happen.
2. **The assignment state machine.** No document enumerated these states, though the skill insists
   it is a separate machine from the mission's. The map is the smallest set covering what the
   knowledge base already promises, declared as data, with a generated matrix over 441 triples and
   properties asserted over the whole map: only the investigator accepts, only the customer
   completes, a policy halt is available from both windows after acceptance and never before, only
   a moderator lifts a suspension, and the system's only move is closing an assignment nobody
   accepted in time.

**Also fixed on the way:** an iCloud sync silently reverted six T-011 files in the working tree —
including the `service_areas` columns — which made drizzle-kit generate a migration that would
have **dropped three live columns**. Caught before it ran, restored from HEAD, and the migration
regenerated clean. The database was never touched.

**Verification:** 996 tests across 82 files, green. Coverage **100%** on all four metrics
(1511 statements, 707 branches, 411 functions, 1380 lines). Lint, typecheck and build clean. All
migrations apply to an empty database, with 0009's CHECK constraints, grants and REVOKEs confirmed
there — `assignment_status_history` is INSERT/SELECT only, and nothing carries DELETE.

**Documentation:** `docs/architecture/quotes-and-assignments.md` (new), retention rows for all four
tables, and `ACTIONS-FOR-ME.md` #15 (provisional constants) and #16 (where T-012 stops, and what
Stripe still needs).

**Validation**
```bash
pnpm --filter api test quotes assignments
```

---

### T-013 — Admin verification queue
- **Status:** DONE — 2026-09-18 (API). The console is T-070
- **Priority:** P2
- **Depends on:** T-008
- **Risk:** MEDIUM
- **Human approval required:** No. **Two decisions were confirmed during the task:** API now, with
  the UI as its own task (T-070); and whole-application decisions, with scope-level verification
  filed as T-071
- **Owner agent:** backend-domain (API); admin-web for T-070
- **Affected:** apps/api/src/modules/verification/**, apps/api/src/modules/media/media.module.ts, migration 0010

**Acceptance criteria**
- [x] Staff scope checked per screen; `isStaff` alone is insufficient
- [x] Approve/reject requires a typed reason, stored and audited
- [x] Opening a verification document is itself an audited event
- [x] Decision trail visible, not just current state

**How each was verified**

| Criterion | Evidence |
|---|---|
| Staff scope per screen | Every reviewer route (queue, detail, decide, open document) calls `requireActive`, `requireRole(STAFF)` **and** `requireStaffScope(VERIFICATION)`. Tested on all four routes: an investigator, staff with only MODERATION, and staff narrowed to their investigator role are each refused 403 everywhere. A reviewer cannot decide their own application |
| Typed reason, stored and audited | Required for **both** outcomes — an approval nobody can explain is not a review. DTO requires a non-blank reason ≤ 2000; CHECK `verification_decisions_reason_present` holds it against every writer. The decision row, the request status and the audit row commit in one transaction; `verification_decisions` is INSERT/SELECT only for the application role |
| Opening a document audited | `GET /verification/requests/:id/documents/:assetId/delivery-url` checks the document belongs to *that* application, then delegates to the media module's delivery path — which re-checks READY + CLEAN and writes `media.delivered` — and records `verification.document_opened` against the application. A file not yet scanned clean is refused and no opening is recorded |
| Decision trail | The review view returns every application the profile has made, newest first, each with outcome, reason, reviewer and time. The applicant sees their own history with reasons but not reviewer identity. Decided requests are never reopened — a resubmission is a new request, so the trail keeps both |

**Negative controls** — each rule broken on purpose, tests watched fail, files restored byte-for-byte:

| Control | Result |
|---|---|
| Allow a reviewer to decide their own application | 1 fails — "refuses a reviewer deciding their own application" |
| Drop `requireRole(STAFF)`, leaving the scope check alone | 1 fails — staff working as an investigator was let through |
| Skip the "document belongs to this application" check | 1 fails — a document from another application became openable |
| Add a second writer of `verification_status` | 1 fails — the static guard names the file |

**Three bugs found on the way, each with a test seen to fail first:**

1. **A CHECK that passed on absence.** `jsonb_typeof(x -> 'serviceAreas') = 'array'` is NULL when
   the key is missing, and a CHECK that evaluates to NULL passes — so a declaration missing a list
   was accepted. Now `IS NOT DISTINCT FROM`. Caught by the schema spec; the dev database's
   constraint was replaced to match.
2. **A subquery that counted the wrong table.** Inside a `sql` fragment drizzle writes columns
   unqualified, so the queue's correlated `count(*)` bound `"id"` to the documents table and
   reported 0 documents. Now a join with GROUP BY.
3. **Decisions timed before their submission.** First with the Node clock (behind the database's),
   then — in the full suite, with both times from the database — because the Docker VM's clock
   stepped back 74 ms under load. Wall clocks are not monotonic. `decided_at` is now
   `greatest(now(), submitted_at)`, with the CHECK kept as the backstop; the regression test times a
   submission an hour ahead.

**Verification:** 1107 tests across 88 files, green. Coverage **100%** on all four metrics (1662
statements, 757 branches, 455 functions, 1521 lines). Lint and typecheck clean. All 11 migrations
apply to an empty database (with the extensions CI loads first), with 0010's five CHECKs and the
grants confirmed there; `drizzle-kit generate` reports no drift. **No browser surface** — this is
API only; the HTTP layer is covered by a supertest controller spec (routing, validation, `no-store`
on the link, closed request bodies) and the service by integration tests against PostgreSQL.

**Documentation:** `docs/architecture/verification.md` (new); `kb-staff-verification-review` v2 —
**partial approval corrected to "not yet"**, reasons required for approvals, expiry not yet tracked,
no reviewer assignment yet; `kb-investigator-verification` v2 — how to apply, one open application,
no required-document list, no notifications, no expiry tracking, additions not reviewed
individually. Retention rows for the three tables.

**Found, and filed rather than fixed:** a verified investigator's **later additions are live
without review**, because verification is profile-wide — the KB promised otherwise. The KB now says
so plainly; the fix is T-071.

**Validation**
```bash
pnpm --filter api test verification
```

---

### T-014 — Initialize shadcn/ui in admin-web
- **Status:** DONE — 2026-09-25
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

**Tenancy (ADR-0011).** Admin-web is the **platform staff** console. Agency owners and admins use `app-web` (T-091 to T-094), never admin-web — their authority is tenant permissions, not a platform staff scope.

**Acceptance criteria**
- [x] `apps/admin-web/components.json` exists; `get_project_registries` returns `@shadcn` — called over JSON-RPC against `shadcn@4.21.0 mcp` run in the app: `@shadcn`, `@cult-ui`, `@react-bits`
- [x] Tailwind and CSS variables wired; light and dark themes both render — measured in the browser: every colour resolves to its token in each theme
- [x] Registries configured per app: `@shadcn`, `@react-bits`
      (`https://reactbits.dev/r/{name}.json`), `@cult-ui`
- [x] The **root `components.json` is removed** once per-app configs exist — `.mcp.json` now starts the MCP inside `apps/app-web`, since `--cwd` is ignored
- [x] Only allowlisted registry namespaces present; no token committed
- [x] Agents take `-TS-TW` variants from React Bits, never `-JS-` — the rule stands in `component-discovery`; nothing from React Bits was added here
- [x] One component added end-to-end (`button`) to prove the pipeline
- [x] `components/ui/**` is web-only and not imported by `apps/mobile` — now lint-enforced (it was not; see below)
- [x] Follows the pattern T-091 set (`docs/architecture/app-web.md`): tokens from `@investigator/ui-tokens/tokens.css`, the raw-value lint rule extended to `apps/admin-web/src/**`, the bundle budget script, and the per-app `components.json` with `@cult-ui` — then the root `components.json` goes

**Validation**
```bash
pnpm --filter admin-web build
```

**DONE — 2026-09-25**

*What exists.* admin-web is a Next.js 15.5.25 app on port 3002 (`docs/architecture/admin-web.md`):
Tailwind 4 on `@investigator/ui-tokens`, `components.json` with the three registries, `@shadcn/button`
adopted and re-tokenised, one landing route with a **disabled** Sign in (staff sign-in arrives with
T-070), never indexed. 26 tests, 100% coverage; `/` is 102.7 kB initial JS against the 250 kB budget,
which CI now checks for admin-web too.

*Pattern shared, not copied.* The bundle-budget script moved to `scripts/check-bundle-budget.mjs` and
reads the app from its working directory; both apps' `budget` scripts call it. The raw-value and
Next.js lint block covers both apps. admin-web left the root `tsc --build` graph, as app-web did.

*Found along the way.* (1) **`shadcn mcp --cwd` is ignored** — the tools read the process's own
directory. With the root `components.json` gone, `get_project_registries` from the root returned
nothing; `.mcp.json` now starts the MCP inside `apps/app-web` (`sh -c 'cd … && exec npx -y
shadcn@4.21.0 mcp'`, pinned), verified from the root. (2) The CLI again installed the third-party
`cn` package, and the `radix-ui` umbrella unpinned (73 packages) for one `Slot`; replaced by our `cn`
and `@radix-ui/react-slot` 1.3.3 (2 packages). (3) **`apps/mobile` had lost T-001's deep-import rule**:
its `no-restricted-imports` block replaced the generic one, so `../../../packages/validation/src` and
any web app's `components/ui` were importable. The pattern is now shared and repeated in the mobile
block, which also names both web apps; probed — four violations fail, the tokens import passes.
(4) Upstream's button drew no app focus outline (`outline-none`), drew dark on dark with `dark:`
overrides the tokens already handle, and had sizes under 44px; all changed (component inventory).

*Browser* (production build): 375 light and dark, 768, 1280 — no horizontal scroll; button 44px;
keyboard focus shows the focus-ring token at 2px offset; hover applies only where the device can
hover; theme-color metas for both schemes; `X-Robots-Tag`, robots meta, no `X-Powered-By`; no console
output. *Negative controls* (broken, seen to fail, restored byte-for-byte): `h-9`, `outline-none`,
`text-white`, sign-in enabled, caller class dropped.

*Not run locally.* The API suite needs PostgreSQL and this machine has no container runtime; nothing
in `apps/api` changed, and CI runs it.

---

### T-015 — Knowledge base structure and CI validation
- **Status:** DONE — 2026-09-23
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
- [x] `python3 scripts/validate-knowledge-base.py` runs in CI and fails the build on error — a
      `Knowledge base` step straight after install; a spec asserts the workflow runs it
- [x] Every seeded document passes; seeds promoted from `draft` to `current` — all 35 were
      already current; 0 errors, 0 warnings
- [x] A staff document marked `visibility: public` fails validation (regression test) — run
      against the real script, and seen to pass when the folder check is removed
- [x] `docs/operations/**` is excluded from ingestion by construction, not by convention — a
      `<!-- not-for-ingestion -->` marker on every operations document that the validator
      refuses in the knowledge base, no frontmatter on any of them, and no symlinks allowed
- [x] Authoring contract documented in `docs/knowledge-base/README.md` — rewritten: every field,
      the folder/visibility table including `agency/`, what is never ingested and why, headings,
      locales

**Validation**
```bash
python3 scripts/validate-knowledge-base.py
```


**DONE — 2026-09-23**

The validator existed and passed; nothing ran it, and nothing tested it. Now CI runs it on every
pull request, before anything that needs a database, and `test/knowledge-base-validator.spec.ts`
exercises the real script against built-up trees: a well-formed article passes; a staff article
marked public, a missing frontmatter block, an out-of-range value, an operations document copied
in with frontmatter added, a symlink, a missing knowledge base, and an orphan translation each
fail. It also checks the repository's own documents and that every operations file is marked.

*Changed in the validator:* the not-for-ingestion marker and symlinks are refused;
`implementation_status` is held to `specified | partial | implemented` when present (a typo read
as neither); and a missing `docs/knowledge-base/` exits 1 rather than 0 — a knowledge base that has
gone missing is not one that validates.

*Negative controls:* the folder/visibility check, the marker check and the symlink check each
removed, the matching test watched to fail, the script restored byte for byte.

*Documentation:* the README is now the contract; the `documentation-first` skill's example gained
the `agency` audience T-083 added and points to it.

*Evidence.* 1653 tests, 100% coverage per package, lint, typecheck and build clean, validator 0
errors and 0 warnings.
---

### T-016 — Knowledge ingestion pipeline with sync and supersession
- **Status:** DONE — 2026-09-24
- **Priority:** P1
- **Depends on:** T-004, T-015, T-077
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/knowledge/**, migrations, workers (none — a command, see below)

**Description**
Ingest `docs/knowledge-base/**` into `knowledge_documents` / `knowledge_chunks` with
pgvector embeddings. Content-hash keyed, idempotent, and synchronized on change. Per
plan.md §17 and the `documentation-first` skill.

**Tenancy (ADR-0011).** `knowledge_documents` and `knowledge_chunks` carry `tenant_id`, which is NULL for the platform knowledge base, under RLS from the first migration. Agency documents are T-097.

**Acceptance criteria**
- [x] Ingestion keyed on `(document_id, content_hash, model_version)`; re-running is a no-op
- [x] Document `visibility` is stored and enforced at query time, never inferred from folder
- [x] Superseding a document removes its chunks from retrieval in the same unit of work
- [x] Deleting a document deletes its chunks in the same unit of work
- [x] Two `current` documents with conflicting guidance are flagged, not silently ranked
- [x] Embedding model name and version stored with every chunk
- [x] Staleness report compares `related_code` paths against their last change
- [x] Test proves a `docs/operations/` file is never ingested

**Validation**
```bash
pnpm --filter api test knowledge
```


**DONE — 2026-09-24**

*What exists.* Migration `0021_add_knowledge`: `knowledge_documents`, `knowledge_chunks`
(`vector(1536)`, HNSW cosine, `simple` tsvector) and `knowledge_conflicts`, all `tenant_owned`,
with NULL tenant for the platform. The command `pnpm --filter api knowledge:sync [--fail-on-conflict]
[--staleness]` runs as the system under `PlatformContext` (`knowledge.sync`). It is a command rather
than a BullMQ worker: a few hundred chunks, once per deploy, with its result printed where the deploy
can fail on it. Details: `docs/architecture/knowledge.md`.

*Visibility, criterion 2.* Stored on every document and copied onto every chunk by trigger, whatever
the insert claims. Never inferred from the folder: the frontmatter decides, and the folder can only
refuse a mismatch. *Enforcement at query time is T-017's*: RLS admits platform rows to every context
by design (approved 2026-09-23), so the retrieval query is the filter. That is now an explicit T-017
criterion, together with filtering on the embedding model.

*Conflicts.* Flagged when two current documents ask the same question or give near-identical answers
(cosine ≥ 0.95) for overlapping readers, never ranked. Real knowledge base: 3 found, all
customer-privacy vs the public privacy summary. Read both, found consistent, and recorded in
`docs/knowledge-base/overlaps-reviewed.yml` **by the agent, for the owner's confirmation** (ACTIONS #21).
A review names versions, so a new version brings the conflict back. Three staff documents
had generic headings ("What am I deciding?") that collided with each other. Renamed per subject and
versions bumped.

*Found by the tests, not by the dev run.* (1) The chunk trigger refused every embedding: a BEFORE
trigger sees a stored generated column as NULL in NEW, so `search` looked changed. The dev run never
embedded (no key), so only the HashingEmbedder test caught it. Fixed in the migration, and in the
local databases with `CREATE OR REPLACE FUNCTION`. (2) Conflict output was in random order (by
uuid); now sorted by path and printed with `id@version`, which is what a review records. (3) The
report label `kb-x@1.en` read as an email domain to the no-personal-data fixture rule, so it is now
`en/kb-x@1` and the rule is unchanged. (4) Staleness reported 20 missing paths for `specified`
documents pointing at modules still to be built. Now a missing path is reported only for `partial` /
`implemented` documents. Real report: 30 references, 0 missing.

*Negative controls* (each seen to fail, then restored byte-for-byte or to the migration's
definition): chunk deletion on retirement removed, which fails 5 tests; embedding reuse removed;
reviewed overlap not version-bound; staleness `specified` exemption removed; chunk fill trigger
without `visibility`/`locale` (in the worker databases), which fails the audience test. Removing
visibility from the service's insert does **not** fail. The trigger overwrites it, so the rule
lives in the database and is tested there.

*Other files.* `related_code` corrected in 6 documents (`users`→`auth`, `audit`→`common/audit`,
`investigator-profiles`→`profiles`). A document with no answer in it is now refused.
CI runs the sync twice after Build, and the second run must change nothing. Staging has a
`TODO(T-040)` step; T-040 and T-041 have the criterion. Embeddings wait for an OpenAI key
(ACTIONS #6): 360 chunks pending, searchable by text.

*Verified.* Dev database: 36 documents, 360 chunks, 0 open conflicts, 3 reviewed, second run
36 unchanged. `pnpm lint`, `typecheck`, `build`, knowledge-base validator 0/0, and API tests 1940 at 100% coverage.

---

### T-017 — Assistant knowledge answering over RAG
- **Status:** DONE — 2026-09-24
- **Priority:** P1
- **Depends on:** T-016, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — AI retrieval surface. **Approved 2026-09-24:** retrieval + answering; audience by role; stateless endpoint
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**, apps/api/src/modules/knowledge/**

**Description**
Answer customer knowledge questions from the knowledge base through permission-aware
retrieval. Per `.claude/skills/permission-aware-rag/SKILL.md`.

**Tenancy (ADR-0011).** Retrieval runs as context → permission filter → tenant filter → search. The cross-workspace retrieval test ships with this task (`tenant-isolation`).

**Acceptance criteria**
- [x] Hybrid retrieval: pgvector + tsvector fused by RRF, per ADR-0001
- [x] Filters on chunk `visibility` in every query (RLS admits every platform row to every context,
      by design — T-016), and on `embedding_model` / `embedding_model_version` equal to the
      embedder's own, so a model change never compares vectors across models
- [x] Vector search returns IDs only; rows loaded and authorized before reaching the prompt
- [x] A customer cannot retrieve staff or operations content by any phrasing
- [x] Answers cite their source documents
- [x] No retrieval result means "I don't have that", never a reconstructed answer
- [x] Retrieved content is delimited and treated as data; injection test passes
- [x] Response is in the user's selected locale, with fallback reported

**Validation**
```bash
pnpm --filter api test knowledge ai/
```


**DONE — 2026-09-24**

*What exists.* `KnowledgeRetrievalService` (knowledge module) and `POST /api/v1/ai/knowledge/answer`
(new `ai` module, under the existing `ai/` prefix beside `ai/sessions`). `docs/architecture/knowledge.md`
has the whole path. Approved scope: retrieval and answering, audience by role, stateless.

*Who reads what.* Public guidance for everyone, and each role's own audience for that role, with the
active role respected. An agency workspace adds `agency`, which extends "audience by role" to the
workspace kind. Staff visibility goes to STAFF only, and `participant` to nobody (no real document
uses it today). Staff do **not** read customer guidance. The staff assistant (T-061) will decide
whether they should.

*Criteria.* Hybrid retrieval: an IDF-weighted lexical leg, with heading words counted double,
plus a model-matched vector leg, fused by RRF. Visibility and embedding model are filtered in every
query. Rows are loaded by id and gated by `mayRead`. The staff exclusion is tested across 7
phrasings, with and without vectors, and end to end through the prompt. Citations are checked
against the sources the model was given. No retrieval means no model call. Sources and the question
are escaped inside their delimiters, and an injected document cannot close its delimiter or lend a
fake citation. Locale comes from the request, then the user's saved locale, then English, and a
fallback is reported. Cross-workspace: an agency's own document is served in that agency and in no
other workspace.

*Found along the way.* (1) The tenant-plumbing guard refused `mayRead(reader, tenantId, row)`; the
gate now reads the workspace from the execution context. (2) Postgres ranking has no IDF, so "how
do I" outweighed "refund"; an IDF is computed over the reader's own scope, so hidden documents
never shape a ranking. (3) On the real knowledge base, "Can I cancel a mission after I have paid?"
missed "Can I cancel a mission?" because longer sections matched more words; heading words now
count double. (4) The first locale test could not fail: its question shared no words with the
English text. A test now asks in English for `ru` and must not get the English version. (5) Removing
the query's audience or visibility filter went unnoticed, because the gate holds. Two 41-section
crowding tests now show the scope's real job: without it, hidden sections take every candidate slot.

*Negative controls* (each seen to fail, then restored byte-for-byte): gate always true;
`participant` readable; active role ignored; vector compared across models; no locale preference;
no similarity floor; no rarity rule; no heading weight; SQL audience filter removed; SQL visibility
filter removed; invented citation tolerated; no escaping; model called with no sources. Only
removing the SQL **tenant** clause survives, by design: RLS enforces the same rule, and the RAG skill
asks for both.

*Verified.* No OpenAI key, so no real answer yet (ACTIONS #6, which now also asks for
`OPENAI_CHAT_MODEL` and, before production, a privacy-policy processor entry from counsel). Ran
retrieval on the real knowledge base in the dev database as the runtime role. Customer, investigator
and staff questions landed on the right sections, and a customer's verification-review question
never reached the staff procedure. The request logger records no bodies, so the help article's
claim that the question is not kept holds. `pnpm lint`, `typecheck`, `build`, knowledge-base
validator 0/0, and API tests at 100% coverage.

*Filed:* T-135 (error-message catalogs; none of the codes, including the new
`SERVICE_UNAVAILABLE`, has a translation anywhere yet).

---

### T-018 — Assistant investigator discovery tools
- **Status:** DONE — 2026-09-24
- **Priority:** P1
- **Depends on:** T-011, T-017, T-078
- **Risk:** HIGH
- **Human approval required:** Yes — AI tool surface over business data. **Approved 2026-09-24** by the owner in the task request: read-only discovery tools over public projections
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/tools/**, apps/api/src/modules/ai/discovery/**, apps/api/src/modules/search (`notMatched`), taxonomy (`labels`), mission-policy (`matchingTextRules`)

**Description**
Structured discovery tools so the Assistant can find investigators by location, distance,
specialty, service, availability and language, and explain each match from real criteria.
**Not RAG.** Per `.claude/skills/investigator-discovery/SKILL.md`.

**Tenancy (ADR-0011).** Discovery tools run in the caller's execution context; results show each profile's agency (T-087). No tool accepts a workspace, tenant or user id as input.

**Acceptance criteria**
- [x] `searchInvestigators` takes typed, closed filters; free text only ranks, never filters
- [x] Nearest-investigator uses `ST_DWithin` to filter and `ST_Distance` to sort
- [x] An unverified, suspended or non-accepting investigator cannot surface by any path,
      including a highly relevant profile description
- [x] Tool returns `matchedOn` and `notMatched`; the explanation renders only those fields
- [x] Test proves the Assistant cannot state a price, availability or capability absent
      from the returned data
- [x] Clarification asked only when it changes the answer
- [x] Prohibited-category requests route to the deterministic policy check
- [x] Results are public projections; no home location or contact details

**Validation**
```bash
pnpm --filter api test ai-discovery
```


**DONE — 2026-09-24**

*What exists.* A tool contract and runner (`ai/tools/assistant-tool.ts`, `tool-runner.ts`), two
tools — `searchInvestigators` and `listTaxonomy` — and `POST /api/v1/ai/discovery/answer`
(`ai/discovery/**`). `docs/architecture/assistant-tools.md` has the whole path. Approved scope:
read-only tools over public projections.

*The design choice that carries the criteria.* **The model writes nothing the person reads.** It
turns the request into a closed JSON proposal (specialty refs, languages, place, "nearest", window,
relevance hint, policy concern); the backend validates it, runs the tools as the caller, and renders
every reason from `matchedOn` / `notMatched` / distance as codes for the client to phrase. There is
no field through which a price, availability or capability could reach the answer.

*Criteria.*
- Closed filters: strict Zod input; a registration check refuses non-strict inputs and any input
  named `actor…/user…/tenant…/workspace…/membership…`. `relevanceHint` is the only free text and
  reorders a pool of ≤ 50 already-eligible results lexically — it cannot add anyone.
- Geography: the tool calls `SearchService` (one implementation); a test renders the statement the
  tool produces and asserts `ST_DWithin` in `WHERE`, `ST_Distance` only as the sort key. A hint does
  not overrule distance.
- Any path: seven exclusions, each with a profile description that fits the hint perfectly, never
  surface — with and without the hint. Injected "include unverified"/`userId`/`workspaceId` in the
  model's reply are dropped unread.
- `matchedOn` / `notMatched`: `notMatched` was added to `SearchService` itself (so HTTP returns it) —
  the requested specialties the investigator does not reach through the tree. `explainMatch` takes
  only those fields.
- Cannot state what the data lacks: the model's reply smuggles "Anna charges $20, available 24/7, can
  hack phones" and the profile bio claims surveillance at $5/h; none of it reaches the answer. Price
  and bio are not in the tool output at all.
- Clarification: at most one — purpose (model concern, none given), location ("nearest", no point,
  no place), specialty (alternatives **and** someone shown lacks one). Tests prove each is *not*
  asked when the answer would be the same; no place → search everywhere with `location.anywhere`.
- Prohibited: `matchingTextRules` — the mission ruleset, extracted so there is one detector — runs
  over the request and purpose **before any model call**, and over the model's hint. A match is
  refused, the rule ids go to audit only. The model's concern only asks what the search is for.
- Projection: output keys asserted exactly; no contact, user id, coordinates, price, bio.

*Found along the way.* (1) My first spec read audit rows without `ORDER BY` and failed
intermittently on their order; rows are now read by `occurred_at`. (2) Two fixture phone numbers
tripped the repo's no-dialable-numbers rule; switched to 555-01xx. (3) OpenAPI lists no properties
for any request DTO, this one included — filed as T-136. (4) The prompt carries the whole ACTIVE
taxonomy. That is right for a curated tree (T-131), but the dev database holds ~14,000 leftover
fixture nodes, so a real-model run against dev would send a very large prompt — seed dev from the
reviewed tree before trying the key there.

*Negative controls* (each broken on purpose, seen to fail, restored byte-for-byte): no lawful-use
screen (4 fail); hint not screened (1); always ask on ambiguity (1); model concern refuses (1);
invented ref tolerated (2); hint overrules distance (1); bio in schema and output (2); explanation
reads beyond `matchedOn` (4); non-strict tool input registers (1); runner skips the workspace check
(1); `notMatched` without the tree walk (1). One survives **by design**: passing `bio` from the tool
without adding it to the output schema — the schema strips it.

*Verified.* No OpenAI key, so no real model yet (ACTIONS #6, updated). Booted the built API: the
route is mounted, in OpenAPI, and 401s without a session. Ran the real service against the dev
database (13,258 eligible of 25,947 profiles) as the runtime role with a scripted model: language +
city, "nearest" with and without a point, no place, a hint, and a prohibited request — 250–425 ms
each, explanations only from `matchedOn`, no private field in any result, and the prohibited request
refused without a model call. `pnpm lint`, `typecheck`, `build`, KB validator 0/0, 2136 tests at 100%
on all four metrics.

*Not built, and where it went.* `getInvestigatorProfile` / `checkAvailability` have no caller yet
(T-095). Knowledge ↔ discovery routing in one conversation (T-095). Agency on each result (T-087).
Reason-code catalogs (T-135).

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
- **Status:** DONE (2026-09-21)
- **Priority:** P0
- **Depends on:** T-004
- **Risk:** HIGH
- **Human approval required:** Yes — consent is a compliance surface; design approved 2026-09-21
- **Owner agent:** backend-domain
- **Affected:** migration 0015, apps/api/src/modules/legal/**, apps/api/src/database/schema/legal.ts

**What shipped**

A consent record has to answer, years later and to a hostile reader: *which exact text did this
person agree to, in which language, and when?* So:

- **`legal_documents` holds the rendered text**, and the database computes `content_hash` from it
  on write. A hash the writer chooses is a hash that can disagree with the text it claims to
  describe, so no writer chooses one — a supplied hash is simply replaced (tested).
- **Published text never changes.** A trigger refuses any edit to a published version except
  moving its status on to SUPERSEDED. A draft stays editable, because nobody can have agreed to
  it — and agreeing to a draft is refused outright.
- **`user_consents` is one append-only sequence.** Acceptance and withdrawal are rows with an
  `action`, so "what is true now" is the latest row for a person and a document rather than a
  reconciliation of two tables. The app role holds `SELECT` and `INSERT` and nothing else.
- **The copy is checked against the document as it is written.** Type, version, hash and locale
  must be the document's own — a wrong copy is a forged record, whether by malice or by a caller
  assembling a row by hand.
- **Consent outlives the account.** `user_id` is deliberately not a foreign key: deleting a user
  leaves the proof standing (tested). The document it names cannot be deleted either.
- **Where it was given is recorded**: nullable `tenant_id`, filled by DEFAULT from the context
  (T-080's pattern), so T-083's agency terms need no ALTER on an append-only table.

`LegalService` reads the version in force — in the reader's locale where that translation exists,
falling back to the authoritative one rather than showing nothing — records acceptances and
withdrawals, and answers whether the product may proceed. Re-acceptance asks **every** version
since the one they accepted, not just the newest: a material change does not stop being material
because a typo was fixed after it. Materiality is a flag on the document, set by compliance and
read by code.

`GET /api/v1/legal/documents/:type` serves the text **unauthenticated** — registration cannot
complete without accepting it, so it has to be readable before an account exists.

**Publishing is not an application capability.** The app role holds `SELECT` on
`legal_documents`; versions are data a compliance owner puts in. Nothing is published yet, so the
endpoint answers 404 per type — which is correct: "no terms exist" must never read as "these
terms were accepted" (ACTIONS-FOR-ME #20, blocked on counsel).

**Tests** — 1498 passing, 100% coverage.
- `schema/legal.spec.ts` (18): the hash is the database's; published text immutable but still
  superseding; drafts editable; one current version per type and locale; one authoritative locale
  per version; a published version must be dated; the copied type, version, hash and locale must
  match; no agreeing to a draft; consent outlives the user; the document cannot be deleted under
  it; the grants.
- `legal.service.spec.ts` (23): locale fallback, the copy, the workspace, the audit row as a
  separate store, withdrawal appending, and the re-acceptance rules including a material version
  sitting between theirs and the current one.
- `legal.controller.spec.ts` (5): the text and hash, the locale, no session needed, 404 for an
  unknown type without asking the service, 404 when nothing is published.
- **Consent commits with the work it belongs to**: `accept(…, tx)` inside a rolled-back
  transaction leaves no row, which is what T-022 needs to make "no account without consent" true.

**Negative controls** — each broken on purpose, the failure watched, restored:

| Control | Result |
|---|---|
| Published documents become editable | "refuses to change once published" fails |
| The consent row is no longer checked against the document | 5 fail |
| The service supplies its own hash instead of copying | 15 fail |
| The app is granted UPDATE on consents | "appends and can never rewrite one" fails |

Migration verified from scratch on a probe database and reversed cleanly.

**Validation**
```bash
pnpm --filter api test legal
```

---

### T-022 — Registration and role-activation acceptance gate
- **Status:** DONE (2026-09-21)
- **Priority:** P0
- **Depends on:** T-005, T-021
- **Risk:** HIGH
- **Human approval required:** Yes — authentication and registration flow; approved 2026-09-21
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{auth,profiles,legal}/**

**What shipped**

`legal.requireAcceptance({ userId, types, acceptedDocumentIds, context }, req, tx)` — the gate,
called **inside** the transaction that creates the account or activates the role. An account that
agreed to nothing, or a role whose obligations were never accepted, cannot exist: refusing takes
the account with it, which is the point of one transaction.

- **Registration** requires the privacy policy and the terms of service; **role activation**
  requires what that role is bound by — an investigator agreement and the lawful-use policy for
  an investigator, the terms and conditions for a customer. A customer who later becomes an
  investigator was not one when they signed up, which is why it is a second gate rather than a
  longer first one.
- **Which documents bind whom is data** (`legal.policy.ts`), not a list at the call site — a
  compliance decision with counsel still to confirm it (ACTIONS-FOR-ME #20).
- **What is required is what is in force** (owner decision, 2026-09-21): a type with nothing
  published requires nothing, so registration works exactly as before until counsel's text lands,
  and becomes gated the moment it does. A superseded version never satisfies the gate.
- **Re-acceptance**: a material new version makes a document outstanding again;
  `GET /api/v1/legal/outstanding` and `POST /api/v1/legal/acceptances` let a client see and clear
  it. Deliberately **not** enforced on every request — that would block read access to an active
  assignment's existing obligations, which `legal-consent` forbids. Gating specific later actions
  belongs with the screens that prompt for it (T-127, criterion added).

**What the work turned up**

**The gate is global, and the test database is shared.** Once a document is published, every
suite's registration and role activation must satisfy it — so suites that publish documents were
silently deciding other suites' outcomes, in both directions. Rather than soften the gate for
tests, the suites take a **PostgreSQL advisory lock**: a publisher holds it exclusively and
clears what it published before releasing, while suites that merely have to get past the gate
hold it shared and still run together (`test/legal-fixtures.ts`). Two consequences worth
knowing: the lock is held on a reserved connection, so those pools need more than one; and a
suite that leaves a document published is a bug in that suite, not in the gate.

**Tests** — 1551 passing, 100% coverage.
- `auth-consent.spec.ts` (13): registration refused with nothing accepted and **no account left
  behind**; the refusal names every document still missing; acceptance recorded with the hash of
  the exact text; registration unchanged while nothing is published; only published types
  required; a superseded version refused. Role activation refused without acceptance and **no
  role written**; activation recorded as `ROLE_ACTIVATION`; no double acceptance; a customer
  asked only for a customer's documents. Re-acceptance: outstanding again on a material version,
  not on a non-material one, cleared by accepting, with both acceptances standing on the record.
- `legal.policy.spec.ts`: which documents each role requires, including that a staff role
  requires none.
- `legal.controller.spec.ts`: the outstanding list asks for the caller's roles; re-acceptance
  records itself; an empty acceptance is refused.

**Negative controls** — each broken on purpose, the failure watched, restored:

| Control | Result |
|---|---|
| Registration stops checking acceptance | 8 fail |
| Role activation stops checking | 3 fail |
| Any accepted id satisfies the gate | 2 fail, including the superseded-version case |
| A material version no longer forces re-acceptance | 4 fail |

**Still to come:** the documents themselves (ACTIONS-FOR-ME #20). Until then the gate requires
nothing and registration behaves as it always has.

**Validation**
```bash
pnpm --filter api test auth-consent
```

---

### T-023 — Domain routing, TLS and DNS
- **Status:** DONE — 2026-10-04, everything a repository can hold; public certificate issuance and the live `curl` wait for a registered domain (ACTIONS-FOR-ME #8, checked by T-040's smoke test). `packages/config` exports the domain map (`domains()`, `appUrl()`) from the Caddyfile's own variables; the API builds every emailed link from it and refuses a malformed host, or two sites on one host, at boot; `APP_BASE_URL` is gone. `infrastructure/compose/server.yml` is the server stack. Verification found and fixed: dynamic containers taking the proxies' fixed addresses (`ip_range`), `app.`/`admin.` assets never cached (`no-store` beat `@static`), marketing redirecting to `/login` and `/register`, which app-web does not serve, and Caddy trusting a client's `X-Forwarded-For` when Docker relayed it (Caddy's log only; the API was not fooled). Filed T-201, T-202
- **Priority:** P1
- **Depends on:** T-003
- **Risk:** MEDIUM
- **Human approval required:** Yes — infrastructure and DNS (given in conversation, 2026-10-04)
- **Owner agent:** infra-devops
- **Affected:** infrastructure/caddy/**, infrastructure/compose/**, packages/config/**

**Description**
Bring up the four-name architecture from ADR-0002. The Caddyfile exists but has not been
validated by Caddy itself.

**Acceptance criteria**
- [x] `caddy validate` passes (command in `infrastructure/caddy/README.md`)
      — `caddy:2.11.4-alpine` pinned by digest (2.11.6 and 2.11.7 were days old), and `caddy fmt --diff` clean
- [ ] Certificates issue for apex, `app.` and `news.`; `www` redirects `301` to apex
      — needs the domain. Verified with Caddy's own CA on `investigator.localhost`: a certificate
      verified for all five names, `www.` → apex `301` keeping path and query, `http` → `https` `308`
- [ ] `curl -I https://app.<domain>/` shows `X-Robots-Tag: noindex, nofollow`
      — needs the domain. Seen on `app.` and `admin.` of the stand-in, and held by `edge.spec.ts`
- [x] `app./api/health` reaches the API same-origin; no CORS preflight on app→api calls
      — `/api/*` reached the API from `app.` and `admin.`, with a client-written `X-Forwarded-For` replaced
- [x] Marketing `/login` returns `301` to `app.`, never `200`
      — to `/sign-in`, which app-web serves; `/register`, `/sign-in`, `/sign-up`, `/dashboard` too
- [x] `packages/config` exports a typed domain map; no hostname is hardcoded anywhere
      — the four `APP_BASE_URL ?? 'http://localhost:3000'` call sites in the API now `appUrl()`;
      `edge.spec.ts` fails a public dev port or the example apex in any app's source.
      `API_INTERNAL_URL`'s `localhost:3001` fallback is the API's internal address, not a public name
- [x] PostgreSQL, Redis and metrics are not reachable from the public internet
      — on a network with no route out, unpublished; unreachable from the edge network, probed.
      No metrics service exists yet
- [x] Caddy, app-web and admin-web have fixed addresses on the internal network, the API's `TRUSTED_PROXIES` lists exactly those, and the API's port is not published (T-138, `docs/operations/client-address.md`)
      — `10.20.0.2/.3/.4`, others allocated from `10.20.0.128/25` only

**Validation**
```bash
cd infrastructure/caddy && docker run --rm -v "$PWD":/etc/caddy:ro \
  -e DOMAIN=example.test -e APP_HOST=app.example.test -e ADMIN_HOST=admin.example.test \
  -e NEWS_HOST=news.example.test -e ACME_EMAIL=ops@example.test \
  caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b \
  caddy validate --config /etc/caddy/Caddyfile
pnpm --filter @investigator/config test && pnpm --filter api test edge supply-chain env.schema
```
The command first written here passed only `DOMAIN`; the Caddyfile has always needed every name.

*Validated.* `caddy validate`: Valid configuration; `caddy fmt --diff` clean. Format, lint,
typecheck, build. `pnpm test:coverage`: every package at 100% — config 15, API 3336 (100% of
6177 statements), app-web 865, and the rest; app-web browser flows 54/54.

*Verified.* `server.yml` run on this machine with request-echoing stand-ins for the platform's
images and `DOMAIN=investigator.localhost` (the README has the recipe): every probe above, plus
egress — none from the web apps, PostgreSQL or Redis, the API's through `egress` only. The old
Caddyfile against the same probe kept a client's `X-Forwarded-For: 6.6.6.6` ahead of the gateway;
the new one replaced it. `edge.spec.ts` was mutated back to each defect (old Caddyfile, no
`ip_range`, the subnet trusted, the API published, a web app on `egress`) and failed the matching
test each time. The browser flows read the mailed links: verification, reset and invitation
links all went to the run's app-web through the domain map. No hostname-facing UI changed.
---

### T-024 — Marketing site SEO
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-023, T-203 — there is no site to optimise yet (found 2026-10-04)
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
- [ ] Every link into the app carries the page's locale as `?lang=<locale>` (ADR-0013), so a reader of `/ru/…` arrives in a Russian app whatever their browser asks for
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
- **Status:** DONE — 2026-10-04. The session cookie is `__Host-investigator_session` (named once in `@investigator/config`), `Secure` in every environment, so the browser refuses it a `Domain` and no sibling can plant one. A global `OriginGuard` refuses writes whose `Sec-Fetch-Site` is not `same-origin` (else `Origin` against the domain map) — `SameSite=Strict` does not separate sibling subdomains, which are one site. No CORS. app-web and admin-web set a per-request nonce CSP in middleware from `contentSecurityPolicy()`; admin's root layout renders per request. Caddy strips `Set-Cookie` on the apex and `news.`. The browser flows fail on any CSP violation (`e2e/support/test.ts`)
- **Priority:** P0
- **Depends on:** T-005, T-023
- **Risk:** HIGH
- **Human approval required:** Yes — authentication and security headers (given in conversation, 2026-10-04)
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/**, packages/config/**
      — also `apps/api/src/common/http/origin.guard.ts` and `bootstrap.ts` (the guard), both web apps'
      middleware and `lib/csp.ts`, admin's root layout, the Caddyfile, and the session cookie's name in
      specs: each one a criterion needed

**Description**
Enforce host-only session cookies and per-application CSP. ADR-0002 makes cookie scoping the
security-critical constraint of the domain split.

**Acceptance criteria**
- [x] Session cookies set **host-only** on `app.` — no `Domain` attribute, ever
      — `__Host-` makes the browser hold it; `auth-cookies.spec.ts` drives every route that sets or clears one
- [x] `HttpOnly`, `Secure`, `SameSite=Strict` (viable because the API is same-origin)
      — and `Path=/`, in development, test and production; clears carry them too, or a `__Host-` clear is refused
- [x] A test asserts no `Set-Cookie` response carries a `Domain` attribute
      — every cookie from nine routes, three environments; plus a source scan of all three apps
- [x] A test asserts no cookie is issued on the apex or `news.`
      — `edge.spec.ts` (`no_cookies` on both, the API reached only from `app.`/`admin.`); seen live:
      upstreams setting `Domain=` cookies, stripped on both, kept on `app.` and `admin.`
- [x] CSP set per application, derived from the domain map — not hand-maintained, not at the edge
      — keyed by the map's site; names no other site of it (each is `'self'` to itself), so the map
      cannot widen it. The two outside origins are providers (Cloudinary, Google's `form-action`)
- [x] CORS allowlist derived from the domain map
      — no CORS at all (no response carries `Access-Control-Allow-*`); the allowlist the map does
      drive is the origin guard's: a write must be same-origin, else from `app.`/`admin.` *to itself*
- [x] Adding a subdomain to the map does not widen session scope — covered by a test
      — the session's attributes are identical under three different maps; the CSP spec checks no
      site of a map appears in either policy

**Validation**
```bash
pnpm --filter api test auth-cookies
```

*Validated.* `pnpm test:coverage`: every package at 100% — API 3368 (6194 statements), app-web 868,
admin-web 136, config 23; format, lint, typecheck, build; browser flows 54/54 with the CSP guard on.

*Verified.* In the browser pane against the built apps and the real API: `/sign-in` on app-web
and admin-web hydrate with every script carrying the response's nonce (22/22, 13/13), admin's 404
carries the policy, no violation logged; "Continue with Google" reached accounts.google.com through
`form-action`. A real same-site, cross-origin `POST` from `localhost:3001` to the app's `/api` got
403; the app's own `POST /auth/logout`, 204. The app's CSP alone already refused a fetch to the
console's origin. Mutations, each failing its test: `Secure` back to development-off (caught only
after the spec re-imported the modules per environment — module-level options had been evaluated
once, under the runner's `test`), a `Domain` added, the guard unregistered, `style-src` without
`'unsafe-inline'` (the e2e guard named every refusal). The first e2e guard listened to the console
and passed with scripts refused: Playwright hears only the page's own logs; it now listens to
`securitypolicyviolation`. Security checklist: no findings; WebSocket handshakes are outside
Nest's guards — `docs/api/README.md` says the first gateway checks `Origin` the same way.
---

### T-026 — Knowledge base translation into ru and hy
- **Status:** DONE — 2026-09-25. 72 translations, all `draft` until native-speaker review (ACTIONS-FOR-ME #22)
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
- [x] 64 files: every `en` document has a `ru` and an `hy` counterpart — 72: the knowledge base had grown to 36
- [x] Same `id`, differing `locale`; version tracks the English source it was translated from — now enforced (newer is an error; a lagging current translation warns)
- [x] `python3 scripts/validate-knowledge-base.py` reports full parity and zero orphans — `ru 36/36 (36 draft)  hy 36/36 (36 draft)`, 0 errors, 0 warnings
- [x] Headings stay user-voice in the target language — translated as how a speaker would
      actually ask, not word-for-word from English — the validator now recognises Armenian `՞` and ru/hy first-person symptoms
- [x] Sections remain self-contained; no chunk depends on an English neighbour — the real parser, run over all 72 as if current, gives each the same chunk count as its source
- [x] Russian plurals use ICU `one/few/many/other`; Armenian plural rules applied correctly — N/A to prose: the knowledge base has no count templates; forms are written grammatically
- [x] No `source_of_truth: database` document lists values in any locale — the three are rule-only, as in English
- [x] Public policy summaries state, in the target language, that the authoritative legal
      text governs — all three `policies/` translations keep the notice
- [x] **Native-speaker review before any translated document is set `status: current`** — held: every translation is `draft`; the review is ACTIONS-FOR-ME #22
- [x] A retrieval test confirms locale preference and reported `en` fallback — exists since T-017 (`knowledge-retrieval.service.spec.ts`, `describe('language')`); needs PostgreSQL, so it ran in CI, not locally

**Validation**
```bash
python3 scripts/validate-knowledge-base.py
```

**DONE — 2026-09-25**

*What exists.* A Russian and an Armenian version of every knowledge-base document, `status: draft`,
same `id`, `version` and `tags` as the English. One glossary throughout (mission задание/առաջադրանք,
quote предложение/գնառաջարկ, assignment заказ/պատվեր, investigator детектив/խուզարկու). Identifiers,
paths and audit event names left untranslated.

*The validator, extended* (`scripts/validate-knowledge-base.py`, 7 new cases in
`apps/api/test/knowledge-base-validator.spec.ts`). (1) A translation draft is counted in the coverage
line, not warned per file: the repository test demands zero warnings, and the task requires drafts,
so without this the task could not pass CI honestly. An English draft still warns. (2) A translation
newer than its source is an error; a current one that lags is a warning; a lagging draft is counted.
(3) Armenian `՞` and ru/hy first-person headings count as user voice — without it all 31 Armenian
files that phrase questions the Armenian way warned.

*Verified.* No browser surface — documentation and a CI script. Validator: 0 errors, 0 warnings.
Structural parity script: every translation has the same frontmatter fields, `##` sections, table
rows, code spans and legal notice as its source. The real parser (`parseDocument`), run over all 72
with `status` swapped to current, chunked each exactly as its English. `knowledge-source.spec.ts`,
which reads the real knowledge base, passes (drafts skipped). *Negative controls* (validator broken,
seen to fail, restored byte-for-byte): Armenian mark unrecognised (2 tests, 31 real warnings); drafts
warned again; newer-than-source allowed; lagging draft warned.

*Found along the way.* Reviewed overlaps are matched by question text, and conflicts are detected per
locale, so the three reviewed English privacy overlaps will be flagged again in each language when the
translations are promoted. Documented in the README's promotion procedure and ACTIONS-FOR-ME #22 —
not a defect today, since drafts are not ingested.

*Not done.* Native-speaker review — a person's job (ACTIONS-FOR-ME #22). The API suite, which needs
PostgreSQL, was not run locally; only the knowledge-base validator and source specs were.

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
- **Status:** DONE — 2026-09-23
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
- [x] `pr.yml` runs green end to end on a real PR — has since T-042
- [x] Fresh Postgres+Redis per run; migrations apply **from empty**; environment destroyed after
      — service containers are per job; each test worker's database is built from empty (T-042)
- [x] Coverage gate blocking at 100% per package, reports uploaded as artifacts — and now
      actually blocking: `verify` was not a required check on any branch
- [x] Secret scanning over **full git history**, not just the working tree; blocks the merge —
      the scan existed; blocking the merge needed the required check (owner-approved)
- [x] `pnpm audit` (or SCA) fails the build on known-exploitable severity
- [x] CI installs with `--frozen-lockfile`
- [x] Container images pinned by digest and scanned — CI, compose and the Dockerfile; Trivy
      blocks on CRITICAL/HIGH with a fix; one expiring, register-backed exception for gosu
- [x] A test asserts no source map is emitted into the public production bundle — a script on
      the build output, tested against built trees, run in CI after the build
- [x] Automated dependency-update PRs enabled, human review required, never auto-merged —
      Dependabot for four ecosystems with a 7-day cooldown; security updates enabled
- [x] Pipeline order — install → knowledge base → lint → typecheck → database → tests → build →
      source maps → audit → image scan → secret scan. Migration validation cannot come after the
      tests, which run against the migrated database

**Validation**
```bash
pnpm audit --audit-level=high && pnpm lint && pnpm typecheck
```


**DONE — 2026-09-23**

Most of the pipeline existed and had run green since T-042. What this task found:

*Nothing was required.* Neither `dev` nor `prod` had a required status check, so the coverage
gate, the audit and the secret scan blocked only because nobody merged a red PR. `verify` is now
required on both, with branches kept up to date (owner-approved; reversible in Settings →
Branches). T-041 still owns the rest of branch protection.

*CI and local ran different Redis majors* — 7 in CI, 8 on every laptop. Both now run the same
digest.

*Every public web app shipped source maps.* `tsconfig.base.json` turns on `sourceMap` for every
package, and the three web apps' `dist/` had `.map` files. Turned off for those three; the API
keeps its maps, which is what an error tracker needs.

*The newest postgres image fails a fixable-only scan.* pgvector's newest pg17 build (bookworm)
carries fixable Debian findings and 22 in gosu; the trixie variant is worse. The Dockerfile now
runs `apt-get upgrade`, which clears every Debian finding. gosu 1.19 is the newest release, built
with Go 1.24.6, so no fixed build exists, and none of the vulnerable paths run in gosu — accepted
by CVE id, on that one path, until 2026-12-22, in `.trivyignore.yaml` and the register
`docs/operations/image-scan-exceptions.md` (owner-approved). A new gosu CVE still fails.

*Pinned:* five actions to commit SHAs within the majors already in use — moving majors is
Dependabot's to propose, one reviewable PR at a time — and every image to its multi-arch index
digest, resolved from the registry. Trivy 0.74.0 (five weeks old at pinning) runs from its own
image rather than a third-party action.

*Guarded by `test/supply-chain.spec.ts`*: SHA pins with version comments; digests everywhere; the
same digests in CI, compose and the Dockerfile; the scan's flags; exceptions limited to CVEs on
one path with an expiry that the register records; four Dependabot ecosystems with a cooldown of
at least seven days; no workflow that auto-merges; public tsconfigs without maps; and the source-map
script against built trees. Seven negative controls, each watched to fail its test.

*Evidence.* 1666 tests, 100% coverage per package; lint, typecheck, build, audit (one moderate,
below the threshold), knowledge base and source-map check clean; every workflow parses. The image
scan was run locally with the exact command CI uses: clean with the exception, 22 gosu findings
without it.
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
- **Status:** DONE — 2026-09-23
- **Priority:** P1
- **Depends on:** T-012, T-077
- **Risk:** MEDIUM
- **Human approval required:** Yes, as it turned out — a two-party table with its own RLS,
  resource authorization and a retention rule. **Approved 2026-09-23** as designed
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/investigation-sources/**, migrations

**Description**
`InvestigationSource` per plan.md §8. Assignment-scoped record of where information came from,
distinct from the evidence obtained from it.

**Tenancy (ADR-0011).** Workspace objects belong to the supplier workspace. Inside an agency, access follows assignment staffing once T-089 lands, and T-089 extends these objects; `shared` items are visible to the customer's workspace through the two-party policy.

**Acceptance criteria**
- [x] Assignment-scoped; `*.authz.spec.ts` proves a non-participant gets 404 — for reads and all
      three writes, including a customer who also holds the investigator role
- [x] Type and reliability are enums; rationale required when reliability is not `unknown` — in
      the service (422) and by check constraint, across edits as well as creation
- [→] `EvidenceItem.source_id` added **nullable** — **moved to T-116**: there is no evidence
      table yet to add it to
- [x] Not a shared catalogue: a source from another assignment is unreachable by any path — even
      for the same investigator, through list, update and withdraw; RLS and the isolation matrix
      hold it underneath
- [x] Reliability does not accrete assertion-level confidence semantics (ADR-0005) — a spec
      refuses confidence-like columns
- [x] Locator accepts a URL but is never fetched server-side without the SSRF allowlist — the
      module holds no HTTP client, and a spec keeps it that way
- [x] Mutations audited; retention follows the assignment — type and changed field names, never
      a title or locator; withdrawn rather than deleted, DELETE not granted, restricted FKs

**Validation**
```bash
pnpm --filter api test investigation-sources
```


**DONE — 2026-09-23**

Three owner decisions: approval of the design; sources **private by default**, shared per source by
the investigator (a source can name a witness); writable while `ACCEPTED`, `IN_PROGRESS` or
`REPORT_SUBMITTED`, read-only otherwise.

*Built.* Migration 0018: `investigation_sources`, two-party, with an **asymmetric** policy —
`supplier_works` for the investigator's workspace, `customer_reads_shared` (SELECT only, shared and
unwithdrawn) for the customer's. Triggers copy and freeze both workspaces, keep a source on its
assignment and its recorder, and make a withdrawal final. SELECT, INSERT and UPDATE granted, after
REVOKE ALL. `GET/POST /assignments/:id/sources`, `PATCH .../:sourceId`,
`POST .../:sourceId/withdraw`. Writes share-lock the assignment against a concurrent completion.

*Found in my own work.* The service filtered the customer's view **and** the policy did, so a test
could never see the service filter do anything — removing it left every test green. It is gone:
the policy is the one tested place that decides, and loosening it now fails three tests across
both layers. Separately, the `asApp` helper in T-053's taxonomy spec returned drizzle's lazy query
from inside the workspace context, so it ran after the context ended — with no workspace at all.
Its refusals held for the wrong reason; fixed there and here, and both specs still pass with a real
context in place.

*Negative controls:* the customer policy loosened to ignore `shared`; the record-keeping trigger
disabled; the wrong-state check removed from all three writes — each watched to fail its tests.

*Evidence.* 1718 tests, 100% coverage (2229/2229 statements, 1044/1044 branches); the isolation
matrix generated read, write and no-context cases for the new table on its own; lint, typecheck and
knowledge base clean. Docs: `docs/architecture/investigation.md`, a new investigator article, and a
customer answer on seeing sources.
---

### T-032 — Investigation notes and tasks
- **Status:** DONE — 2026-09-26, approved by the owner in chat. Migration 0027 (`investigation_notes`, `investigation_tasks`: author/creator-only RLS, customer reads shared; no DELETE grant; restrict FKs; task-edge trigger); module `investigation-workspace` (`/assignments/:id/notes`, `/assignments/:id/tasks`, `…/tasks/:taskId/transition`); docs `investigation.md`, KB `kb-investigator-notes-and-tasks` (en; ru/hy drafts), `kb-customer-evidence-reports` v3. Privacy specs seen failing (10) with the policies loosened. No browser surface: verified by booting the API on the migrated dev database and probing the routes (401 / 404 / 400 / 403)
- **Priority:** P1
- **Depends on:** T-012, T-077
- **Risk:** MEDIUM
- **Human approval required:** Yes — note visibility is a privacy surface
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/investigation-workspace/**, migrations

**Description**
`InvestigationNote` and `InvestigationTask` per plan.md §8. The investigator's working
material and work plan.

**Tenancy (ADR-0011).** As T-031: supplier-workspace rows, reachable inside an agency only by staffed members or `investigations.read_all` once T-089 lands. `private` notes stay private to their author, even from agency admins.

**Acceptance criteria**
- [x] Both default to `visibility: private` — author only
- [x] A test proves a `private` note is unreachable by the other assignment participant
- [x] Changing visibility is an audited action with the actor recorded
- [x] Task status transitions validated; no direct status assignment
- [x] Notes are mutable; evidence semantics are **not** applied to them
- [x] Soft delete, audited; neither cascades with the assignment
- [x] `*.authz.spec.ts` covers author vs. participant vs. non-participant vs. staff

**Validation**
```bash
pnpm --filter api test investigation-workspace
```

---

### T-033 — Investigation documents and evidence promotion
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-008, T-032, T-077, T-116
- **Risk:** HIGH
- **Human approval required:** Yes — touches the evidence boundary
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/investigation-documents/**, evidence module, migrations

**Description**
`InvestigationDocument` per plan.md §8, plus the one-way promotion path to evidence. The
document/evidence boundary is load-bearing: without it, evidence gets attached as documents
and the chain of custody is lost.

**Tenancy (ADR-0011).** As T-031. Evidence promotion keeps chain of custody inside the supplier workspace; storage paths come from the context (T-080).

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
- **Status:** DONE — 2026-10-05; `legal_holds` (migrations 0040–0041), `modules/legal-hold` (service, routes, `RetentionGuard`), the oauth purge through the guard; retention.md, authorization.md, law-enforcement runbook, staff KB `kb-staff-legal-holds`, customer KB `kb-customer-privacy-data@5`
- **Priority:** P1
- **Depends on:** T-004
- **Risk:** HIGH
- **Human approval required:** Yes — data retention; approved 2026-10-05, scoped to the primitive (below), with a new `COMPLIANCE` staff scope rather than `DISPUTES`
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/legal-hold/**, retention jobs, migrations

**Description**
Nothing currently stops a retention job from deleting evidence that is under dispute or under
a legal obligation to retain. That is data loss during litigation. The counsel brief flags the
conflict; nothing enforces it.

**What shipped**

Found at selection: three of the seven criteria need what does not exist — disputes (T-118),
evidence items (T-116) and any erasure workflow — and the only retention deletion in the API was the
Google sign-in's purge of lapsed `oauth_attempts`. Scoped (2026-10-05) to the primitive, with those
three criteria moved to the tasks that bring their producers, as T-081's gate was handled.

- **`legal_holds`** (migration 0041): resource type and id, reason, placed by and at, released at,
  by and why. A trigger allows one change — the release, once, complete — and refuses DELETE even to
  the owner. No foreign keys to the resource or the people, so it survives both accounts. `system`
  class; platform access only, so no workspace learns its data is held.
- **`COMPLIANCE` staff scope** (migration 0040; `packages/auth`, `scopes.ts`, the enum).
- **`/api/v1/legal-holds`**: list (in force by default, by resource, cursor-paged), place (refused
  for a resource that does not exist), release (409 the second time). Each its own audited crossing.
  Audit rows carry the reference, never the reason.
- **`RetentionGuard.sweep()`** — the one way retention deletes. Enters `asSystem` itself (holds are
  invisible outside platform access, so a caller-side check would fail open), deletes only what no
  hold in force covers, audits `retention.kept` per hold and `retention.deleted`, one transaction.
  `retention.static.spec.ts` lists every other delete in the API with why it is not retention.
- **The oauth purge** goes through it: a LINK attempt whose account is held is kept. It is asked
  for only when something has lapsed, so a start with nothing to purge writes no crossing.

**Acceptance criteria**
- [x] `legal_holds`: resource type and ID, reason, placed by, placed at, released at
- [x] **Every retention deletion path checks for an active hold first** — tested per path: the one path that exists (oauth attempts), and a static spec that fails on any new delete outside the guard
- [ ] Opening a dispute places a hold automatically; resolving it does not auto-release — **moved to T-118**, which brings disputes
- [x] Release is a deliberate, audited action with a reason
- [ ] An erasure request against held data is **surfaced to compliance, never auto-resolved** — **moved to T-206**, which brings the erasure workflow
- [x] Holds are append-only and survive account deletion — by trigger and by test, deleting both the held and the placing account
- [x] A test proves a retention job skips held data and reports why (`retention-guard.spec.ts`, `auth-oauth.service.spec.ts`); for held **evidence**, T-116

**Validation**
```bash
pnpm --filter api test legal-hold retention
```
---

### T-036 — Notifications
- **Status:** DONE — 2026-09-30 (core; see the scope split). Approved by the owner 2026-09-30: the RLS policies, the unsubscribe link's authority, the provisional retention periods
- **Priority:** P1
- **Depends on:** T-006, T-082
- **Risk:** MEDIUM
- **Human approval required:** Yes, on three AGENTS.md gates the core reached — two new RLS policies (`own_notifications`, `own_preferences`); a signed unsubscribe link that acts as its person without a session; retention periods for the two tables (`retention.md`, provisional). Approved 2026-09-30
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/notifications/**, common/mail/**, common/jobs (queue, envelopes), migration 0033, table registry, isolation tests, packages/i18n (`email`), docs

**Description**
`NotificationsModule` per plan.md §13 — one of two modules with no task. Load-bearing: quote
received, report submitted, verification expiring and message received all depend on it.

**Tenancy (ADR-0011).** Notifications are tenant-scoped rows, delivered by jobs that restore their workspace context (T-082). They route to teams (T-086) and carry agency branding (T-084). A notification never names data from a workspace the recipient is not in.

**Scope split (owner, 2026-09-29): core now.** Built: the two tables, per-recipient delivery jobs in
the recipient's workspace, the centre's API, email through Resend, en/ru/hy templates, idempotency
per (event, recipient, channel), unsubscribe, wired to today's mission and assignment status
changes. Mail settings (owner): `RESEND_API_KEY`, `MAIL_FROM_ADDRESS` as the one sender,
`REVIEW_REQUEST_EMAIL_OVERRIDE` for the sandbox only. Follow-ups: T-169 (centre screen and email
settings), T-170 (browser push), T-171 (more events). Team routing (T-086) and agency branding
(T-084) arrive with T-171's events, which are the first to need them. Design: `docs/architecture/notifications.md`.

**Acceptance criteria**
- [ ] Push, email and in-app centre; per-channel preferences — email and the centre's API built;
      push is T-170, the centre's screen T-169
- [x] Templates localised for en/ru/hy; the recipient's locale is used, not the actor's (account
      mail too — invitations use the invitee's, else the inviter's)
- [x] **Notification content reveals nothing sensitive** — a kind and a relative link, never
      content; the email says no more than the row
- [x] Delivered through the outbox and BullMQ; idempotent per (event, recipient, channel)
- [ ] Retry with backoff; permanent failures dead-letter and alert — retry and dead letters by
      T-082's runner; the alert is T-168
- [x] Unsubscribe honoured for non-transactional (RFC 8058 one-click); transactional sends from
      `mail.` per ADR-0002 — one sender, `MAIL_FROM_ADDRESS` (owner's choice); the domain's DNS is
      ACTIONS-FOR-ME #5

**Found in the work**
- A job's key is unique per workspace, **not per command**: the fan-out, first keyed on the bare
  event id, was silently a duplicate of the `outbox.deliver` that queued it. Keyed `<event>-fan-out`;
  the rule is now in `jobs.md`, and the end-to-end spec through Redis failed on it first.

**Validation**
```bash
pnpm --filter api test notifications
```

---

### T-037 — Reviews
- **Status:** DONE — 2026-09-25. Approved by the owner 2026-09-25 (design, pre-moderation, discovery ordering unchanged)
- **Priority:** P2
- **Depends on:** T-012
- **Risk:** MEDIUM
- **Human approval required:** No on the task — but it adds RLS policies, a PlatformContext route and authorization rules, each an AGENTS.md gate; approved 2026-09-25
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/reviews/**, migrations (0022), table registry, isolation tests, docs

**Description**
`ReviewsModule` per plan.md §8 — the second uncovered module. Reviews feed investigator
ranking in discovery, so they are a manipulation surface.

**Acceptance criteria**
- [x] Only the assignment's customer, only after `COMPLETED`, exactly once — enforced by a
      unique constraint, not a read-then-write check — plus RLS `customer_writes` and trigger `review_after_completion`; a concurrent second submission gets 409
- [x] Rating plus optional text; text is moderated and reportable — pre-moderated (`PENDING` until staff publish); the other party reports published words back to `PENDING`
- [x] A review is not a dispute route — the UI and copy say so (`kb-customer-disputes-revisions`) — the create route's description and `kb-customer-reviews`; there is no UI yet (T-120, T-122)
- [x] Investigator may respond once; responses are also moderated
- [x] Ranking input is computed, never client-supplied — count and average computed in SQL per read; the DTOs refuse `average`, `count` and every server-set field. Not used by discovery ordering yet: T-140
- [x] Removing a review is audited with a reason — `review.removed` carries it; removal is once, staff-only, under PlatformContext

**Validation**
```bash
pnpm --filter api test reviews
```


**DONE — 2026-09-25**

*What exists.* `ReviewsModule` (`docs/architecture/reviews.md`): migration 0022 with `reviews` (the
rating) and `review_texts` (the review's words and the one response), both two-party tables with a
public projection. Rating and words are separate so that row-level security, not a SELECT list, keeps
unmoderated words from other workspaces. Every rule is held by the database — triggers, constraints,
policies — and the service refuses early and shapes the views. Routes for the customer, the
investigator, anyone reading a published profile, and moderation staff.

*Tests.* `test/isolation/reviews.spec.ts` (27) drives every rule with direct writes as the runtime
role; the isolation matrix picks both tables up from the registry; `reviews.service.spec.ts` (18),
`reviews.authz.spec.ts` (6, the seven cases) and `reviews.controller.spec.ts` (20). API suite: 2,230
tests, 100% coverage. *Negative controls*, each broken on the live test databases or in the source,
seen to fail and restored: the text policy opened to every workspace (5 tests, including the matrix);
the completion check disabled (6); the public list's "published only" filter removed, for the words
and for the response (1 each — this control first **passed**, exposing a gap: a party reading the
public list sees its own unmoderated words through its own policy; the test was added and now fails
without the filter); removed reviews shown (1). The service's staff-scope check is backed by
`PlatformContext.asStaff`, which refuses the same actor — removing either alone still refuses.

*No browser surface.* API only; verified through the service against a real database, the HTTP
layer through the routes, and the knowledge base synced like CI — no conflicts, idempotent.

*Found along the way.* (1) `SELECT … FOR UPDATE` is subject to UPDATE policies, so a party's locked
read of a row only staff may update finds nothing — the first draft 404'd every response; party
paths read without a lock and let the unique index or a conditional UPDATE decide. (2) Drizzle's 0021
snapshot was stale — 0021 hand-wrote four knowledge-table objects the snapshot never recorded —
so `drizzle-kit generate` proposed recreating them; they were removed from 0022, whose snapshot is now
accurate. (3) An edited migration is never re-applied to existing test databases (Drizzle records it
as applied), so a negative control on a migration must alter the live databases. (4) The project's
`settings.json` sets `NODE_ENV=development`, which breaks `next build` — T-141.
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
- **Status:** DONE — 2026-09-24
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
- [x] Each smoke-tested over stdio before being relied on, not assumed working — 2026-09-24:
      shadcn MCP read the root `components.json` (`@shadcn`, `@react-bits`) and searched the
      registries; Playwright MCP navigated, snapshotted and closed. Two things seen: the shadcn
      server prints its add command as `[object Promise]` in search results (use
      `get_add_command_for_items` instead), and Playwright writes snapshots to `.playwright-mcp/`,
      now gitignored
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
- [ ] `pnpm --filter api knowledge:sync --fail-on-conflict` runs after migrating and before serving
  (T-016)
- [ ] Health check polls and **fails the job** if unhealthy
- [ ] Smoke tests run against deployed staging
- [ ] Deployment recorded: sha, actor, outcome
- [ ] Staging contains **no production data and no production secrets**
- [ ] The API image runs both `server.yml` commands from its working directory — its default (the
  API) and `node dist/worker.main.js` (the `worker` service, T-208)
- [ ] The worker runs beside the API: its log says `worker: retention scheduled — …` then
  `worker: working …; dispatching the outbox`; no unpublished outbox row is older than a few seconds;
  `job_dead_letters` stays empty (formerly `ACTIONS-FOR-ME.md` #25)
- [ ] Unblocked before the assistant's Release 1 (`AI-EXECUTION-PLAN.md` §9): writes ship through staging (review 2026-10-06)

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
- [ ] Migrations run with `MIGRATION_DATABASE_URL` (the owner); the API's environment holds **only** `DATABASE_URL` (`investigator_app`) and never the owner's credentials. The deploy runs `scripts/set-app-role-password.sh` with `APP_DB_PASSWORD` from the environment's secrets after migrating (T-073)
- [ ] Deployment audit log: version, actor, approver, outcome
- [ ] The deploy job runs `pnpm --filter api knowledge:sync --fail-on-conflict` after migrations
  are current and before traffic moves (T-016)

**Validation**
A rehearsed deploy and a rehearsed rollback against production, signed off.

---

### T-042 — Test infrastructure: factories, fixtures, coverage config
- **Status:** DONE — 2026-09-21
- **Priority:** P0
- **Depends on:** T-002, T-073
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/test/**, apps/api/vitest.config.mts, packages/auth/**, package.json,
  .github/workflows/pr.yml, .claude/skills/testing/SKILL.md, .claude/skills/ci-cd/SKILL.md

**Description**
The shared test substrate. Landing it before module work is what makes the 100% gate
achievable rather than punitive.

**Tenancy (ADR-0011).** Factories create workspaces and memberships. Integration tests use **two pools**: owner fixtures, and the code under test on `investigator_app` inside a context helper (`withContext`), per the `tenant-isolation` skill.

**Acceptance criteria**
- [x] Factories with sensible defaults and explicit overrides for every core entity —
      `test/fixtures.spec.ts` reads the `table-classes.ts` registry and fails when a
      `tenant_owned` or `two_party` table has neither a factory nor a written reason why the
      thing that owns it is what writes it. Added `assignment`, `customerProfile`; gave
      `acceptCurrent` the override it lacked
- [x] Database reset between tests; **no shared mutable state, no ordering dependency** —
      one database per worker, cloned from a migrated template, emptied and re-seeded before
      every spec file. The file is the unit of isolation
- [x] Suites pass run alone, in reverse order, and in parallel — verified, not assumed:
      **123 of 123 files alone**, `VITEST_SEQUENCE=reverse` green, `--no-file-parallelism`
      green, and **six full `--sequence.shuffle` seeds** green (files *and* tests shuffled)
- [x] Time is freezable; expiry logic is testable deterministically — `test/time.ts`
      (`atTime`, faking `Date` only) and a spec that refuses a `*.policy.ts` reading the clock
      anywhere but a default parameter
- [x] Reusable authorization-test helper covering the seven cases from `authorization` —
      existed (`test/authz-cases.ts`); `testActor` split into `test/actor.ts` so a fixture no
      longer drags vitest into a plain Node process
- [x] Coverage thresholds set to 100% **per package**, wired into `pnpm test:coverage` —
      `packages/auth` now carries the gate; the ten T-001 `PACKAGE_NAME` placeholders were
      deleted, so every other package has no runtime code to measure and a spec fails the
      moment one gains some
- [x] `docs/operations/coverage-exclusions.md` referenced by the config, not duplicated
- [x] **No real or realistic personal data** in any fixture — reserved domains (RFC 2606) and
      `555-01xx` numbers, enforced across `test/**` and every spec; five Armenian-format
      numbers replaced
- [x] `fixtures:load` actually exists and the CI step runs it — `pnpm fixtures:load` builds a
      customer, profile, mission, investigator, quote, assignment and a two-person agency out
      of the same factories the tests use, against the database CI migrated from empty
- [x] `test:integration`, `test:api` and `test:e2e` — **deleted**, with their CI steps. They
      named a split the suite does not make. `--if-present` is now banned in the workflow and
      in root scripts, and `test/workspace-scripts.spec.ts` refuses a step naming a script
      nothing defines

**Validation**
```bash
pnpm test:coverage
```

**DONE — 2026-09-21**

Four design decisions, all taken by the owner: a database per worker; delete the three fake
test steps rather than invent a split for them; `fixtures:load` builds a demo world from the
factories; formalise the existing injected-`now` convention rather than add a Clock provider.

*One database per worker.* `test/global-setup.ts` migrates a template and clones it into
`<base>_w1..4`, matching `MAX_WORKERS`; `test/setup-database.ts` points `DATABASE_URL` at this
worker's copy before the spec file and everything it imports loads, and empties it. Emptying
means truncating every table in `public` and restoring what a migration seeded — found by
looking at the pristine template, not by a list, so a later taxonomy seed is picked up without
being told. `roles.tenant_id` references `tenants`, so truncating tenants cascades into roles:
the restore is exact or every membership in the next file points at a role id that is gone.
A spec asserts the truncation list equals the live catalogue, and that the hook *ran* — "the
database was empty" can be true by luck.

*What it retired.* T-022's advisory lock is gone from `legal-fixtures.ts` and eight specs, and
the probe-database pattern of T-077/T-080/T-083 has no reason to return. Tests also stopped
writing into `investigator_dev`.

*What it exposed.* Both query-plan suites had been asserting on a plan chosen with **no
statistics at all**: `ANALYZE` run by a role that does not own the table is skipped with a
warning, and `testPool` silences notices. They passed because autovacuum had long since
analysed the shared development database with thousands of rows in it. Given a database of its
own the planner had `reltuples = -1` and chose differently about one run in three — never in
isolation. Fixed by analysing as the owner, committing the seed rather than rolling it back,
seeding coordinates deterministically instead of with `random()`, and asserting the statistics
exist. Two more: a polygon round-trip read the first row of a shared probe table rather than
its own, and the log-redaction test read an empty buffer because `nestjs-pino` keeps one root
logger per process — it passed only while it was the first test in its file.

*Negative controls* — each break watched to fail the intended test, then restored byte for
byte: reset hook removed → `was emptied before this file ran`; `ANALYZE` back on the app role →
`was taken with statistics the planner could actually use`; `--if-present` back in the workflow
→ `never uses --if-present`; a `@gmail.com` fixture → `address every email to a domain that
cannot exist`; a `+374` number → `use no number that could be dialled`; a domain table's
factory removed → `cover every table a test would need to create`; `packages/auth` loses
`test:coverage` → `gates coverage in every package that ships code that runs`; a policy reading
the clock → `read the clock only as a default parameter`.

*Evidence.* 1589 tests, 123 files, 100% coverage per package (api 2026/2026 statements,
918/918 branches, 577/577 functions, 1854/1854 lines; auth 1/1). Lint, typecheck and build
clean. Suite wall-clock 19s on four workers, 58s on one.

*Filed, not fixed:* T-130 — `pnpm format:check` has been red on 21 files for some time and CI
never runs it, which is the same shape of problem one layer out. `tsx` 4.23.13 added to
`apps/api` to run `fixtures:load`, per the pinning policy's "newest usable, not newest
published": 4.23.15 was a day old.

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
- **Status:** DONE — 2026-09-23
- **Priority:** P1
- **Depends on:** T-004, T-077
- **Risk:** MEDIUM
- **Human approval required:** Yes, as it turned out — RLS, resource authorization and a
  deletion rule. **Approved 2026-09-23** as designed
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai-sessions/**, migrations

**Description**
The persistent conversation layer per ADR-0006. Must exist before the assistant, because the
alternative is a chatbot whose memory is a prompt.

**Tenancy (ADR-0011).** `ai_sessions`, `ai_messages` and their state carry `tenant_id` under RLS. **A session belongs to one workspace for life**; switching workspace opens that workspace's sessions.

**Acceptance criteria**
- [x] `AiSession` with lifecycle `ACTIVE`/`IDLE`/`ARCHIVED`/`DELETED`, separate from workflow state
      — derived from timestamps, not stored, so it cannot go stale
- [x] Create, open, resume, rename, archive, delete, search — all actor-scoped, and narrower than
      the workspace: its own user only, even inside an agency
- [x] `AiMessage` with sequence, role, metadata; tool calls stored as **structured events**, not
      prose — shape checked by the database; append-only; numbered under a lock
- [~] Hybrid session search: pgvector + Postgres full-text (ADR-0001) — **full-text built**;
      the vector half is **T-133**, since no embedding provider exists yet (owner decision)
- [x] `*.authz.spec.ts` proves another user cannot reach a session or its messages by any path —
      all seven paths, list and search, a colleague and the agency's owner, and the policy alone
- [x] Titles renameable; generated titles never expose evidence content — renameable; nothing
      generates a title yet, and the rule moves to **T-056**, which will
- [x] Deleting a session removes its messages, summaries, memory and embeddings in one unit of work
      — messages erased with a tombstone left (owner decision); summaries, memory and embeddings do
      not exist yet, and a spec makes each one join the erasure the day its table references
      `ai_sessions`

**Validation**
```bash
pnpm --filter api test ai-sessions
```


**DONE — 2026-09-23**

Three owner decisions: approval of the design; **erase now, keep a tombstone** on delete; **full-text
now**, the vector half as its own task.

*Built.* Migration 0019: `ai_sessions` and `ai_messages`, a policy admitting only the session's user
in its workspace (not even an agency owner), owners copied and bound by composite key, append-only
messages, structured tool events, a tombstone that stays empty, DELETE granted on messages only.
`/api/v1/ai/sessions` with create, list (paged, current or archived), search, open, resume,
messages (paged), rename, archive, delete. `append` is a service method for the assistant (T-056).

*Found by the spec.* `ai_messages_shape` let a tool call with no event through: a CHECK passes on
NULL, and `jsonb_typeof(NULL -> 'tool') = 'string'` is NULL. Every JSON test is now coalesced to
false, and a test inserts an empty event to hold it. Local harness databases were patched by
renaming the old constraint aside rather than dropping it; CI builds from empty with the corrected
one.

*Guards from earlier tasks that caught this one:* T-064's spec type-check (a loosely typed helper),
T-042's factory registry (a factory for sessions; messages written only by the service), and T-077's
isolation matrix, which generated cases for both tables once seeded. The trigger naming convention
(`*_tenant_immutable`) needed the rename too.

*Negative controls:* the policy loosened to the whole workspace; deletion erasing nothing; appends
without the row lock; the append-only trigger disabled — each watched to fail its tests.

*Evidence.* 1778 tests, 100% coverage (2378/2378 statements, 1105/1105 branches). Retention register
rows for both tables; `docs/architecture/ai-sessions.md`; the customer assistant article answers who
sees a conversation, what deleting does, and how search works.
---

### T-046 — Context Builder, summaries and compaction
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-045, T-016, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — it decides what reaches the model
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/context-builder/**

**Description**
The service that decides what enters the model context. Per
`.claude/skills/ai-session-context/SKILL.md`.

**Tenancy (ADR-0011).** The Context Builder reads only through the execution context. A summary never carries a workspace or authority. There is a test for stale context after a workspace switch.

**Acceptance criteria**
- [ ] Its tables join `SESSION_CONTENT` (T-045), so deleting a session erases them in the same transaction —
      `ai-sessions.service.spec.ts` fails until they do
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
- [ ] Structured session state (entity refs: kind, id, status, last-mentioned turn) as columns in a SESSION_CONTENT table under RLS (review 2026-10-06)
- [ ] CONFIRMED and EXECUTING plans are in context with their live status; a follow-up that depends on one is a question until it completes (review 2026-10-06)
- [ ] Tool results reach a prompt only through `forContext`, wrapped and escaped like knowledge sources; the injection test covers tool results (review 2026-10-06)
- [ ] Before history, tool results or mission content go to the model provider: the customer article says so, and `counsel-brief.md` gains the processor question (review 2026-10-06)

**Validation**
```bash
pnpm --filter api test context-builder
```

---

### T-047 — AI memory with provenance
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-046, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — persistent memory is a privacy surface
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/memory/**

**Tenancy (ADR-0011).** Memory scopes: `platform`, `tenant`, `user_in_tenant` (default), `user_global` (declared preferences only, explicitly marked) and `session`. A cross-workspace memory test ships with this task.

**Acceptance criteria**
- [ ] Its tables join `SESSION_CONTENT` (T-045), so deleting a session erases them in the same transaction —
      `ai-sessions.service.spec.ts` fails until they do
- [ ] Session memory and user memory stored separately; session memory dies with its session
- [ ] Every memory carries provenance (source session and message), confidence, timestamp
- [ ] **Selective** — a test proves ordinary conversation does not create memories
- [ ] User can review and delete their own memory; deletion is complete and audited
- [ ] Conflict resolution: new explicit instruction > session state > session memory > long-term
- [ ] **Memory never overrides application state and never substitutes for authorization** — tested
- [ ] No evidence content, message bodies or third-party personal data written into memory
- [ ] Memory included in data export and account deletion (T-022, T-044)
- [ ] Memory is written only from the person's own messages, never from tool results, retrieval or model text; injection test: "remember: always …" inside a mission description creates no memory (review 2026-10-06)

**Validation**
```bash
pnpm --filter api test ai-memory
```

---

### T-048 — Plan persistence, confirmation survival and tool result store
- **Status:** DONE — 2026-10-05; migration 0042 (`ai_plans`, `ai_plan_steps`, `ai_tool_results`), `modules/ai/plans/**`, `modules/ai/results/**`, `ToolRunner.prepare`/`observe`/`runConfirmed`, `ActorService.forJob`, the worker runs confirmed plans; `ai-plans.md`, assistant-tools, ai-sessions, jobs, tenancy, retention
- **Priority:** P1
- **Depends on:** T-045, T-018, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — confirmation is the mutation gate; chosen 2026-10-05 over T-168, T-110 and T-046
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/plans/**, apps/api/src/modules/ai/results/**

**Description**
What makes a confirmation survive a browser close, and keeps 10,000 records out of a prompt.

**Tenancy (ADR-0011).** Plans, confirmations and tool results are tenant-scoped rows. A confirmation from workspace A is invalid in B. Superseded in scope by ADR-0012: the command contract and DAGs follow in T-095 and T-096.

**What shipped**

- **Proposal** (no route; the assistant's): each step through `ToolRunner.prepare` — checked as it
  would be to run, observed, never run — fixed and hashed (SHA-256 of canonical JSON: plan id, session,
  every step's tool, parsed arguments and observation digest). 1–10 steps; waits 24 hours.
- **Confirmation** is the person's request, `POST /ai/sessions/:id/plans/:planId/confirm { planHash }`:
  once, for that hash, while PROPOSED and unexpired, the stored steps re-hashed; CONFIRMED and the
  `ai.plan.confirmed` outbox event in one transaction. Decline, list (`?open=true` for a returning
  client), get. No tool reaches confirmation.
- **Execution** in the worker as the person (`PlanConfirmedTrigger` → `ai.plan.execute`): hash, the
  actor read now (`ActorService.forJob`), the confirmed role or nothing, every step observed again
  before the first runs, each step re-authorized and run with key `ai-plan:<plan>:<ordinal>`. Refused
  before any step: CANCELLED/INVALIDATED. After: FAILED, rest SKIPPED.
- **Resume**: step progress persists outside the job's transaction, so "started" is read from the
  steps. **Found in testing:** reading it from the plan's status — which a dead worker's lost
  transaction resets to CONFIRMED — re-checked a resumed plan and voided it on its own first step's
  effect, and misfiled a mid-plan refusal as "never started". Both fixed, both now tested.
- **Departure**: `archive_departed_member_sessions` also voids that person's PROPOSED/CONFIRMED plans
  in the workspace (`member_left`).
- **Result store**: whole result kept, referenced by id; summary + 20 + cursor (bound to its result);
  paged in SQL; `forContext` the one renderer, and a spec holds nothing else reads the table.
- **Write tools** register only with `confirmation: 'required'` and `observe`; `invoke` refuses them.
  `WRITE_TOOLS` is empty — the first commands are T-095's — and is registered by both processes.
- Verified against the real API and worker: a seeded plan listed, a stranger 404 on every route, a
  wrong hash 409 `CHANGED`, confirmed 200, again 409 `NOT_PENDING`; the worker took the outbox event,
  ran `ai.plan.execute` as the person and — no `addToTally` in its registry — CANCELLED/INVALIDATED it
  `tool_unavailable` with the step SKIPPED, audited; SIGTERM, exit 0.

**Acceptance criteria**
- [x] `AiPlan` persisted with `plan_id`, `plan_hash`, commands, status, confirmation status
- [x] A pending confirmation **survives browser close, app restart and worker restart** — tested
- [x] Before execution: re-authorize, re-check the hash, re-read resource state
- [x] **Material change invalidates the confirmation** and forces a fresh one — tested
- [x] A confirmation is single-use and bound to exact arguments (`ai-tool-registry`)
- [x] Large tool results stored and referenced by `result_id` with summary, top-N and cursor
- [x] A test proves a large result set never enters a prompt in full — 10,000 records render as 20 through `forContext`, the only renderer; no prompt consumes stored results yet (T-046, T-095)
- [x] A killed worker is replaced by another that resumes from persisted state
- [x] A member who leaves (suspended or removed, T-085) has their pending confirmations in that workspace voided — their sessions are already archived by a trigger then; the confirmations must follow
- [x] Plan rows are workspace-scoped (`tenant_id` under RLS, ADR-0011). **No DAG orchestration here**: it lands in T-096 over these rows (ADR-0012). No learned risk engine

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

**Tenancy (ADR-0011).** Enforcement reaches agencies (ADR-0011, plan.md §29). A permanently banned person is banned in every workspace they belong to. An agency answers for its members' conduct. Registering a new agency does not reset a banned identity (`BanIdentityHash`; principals checked in T-088).

**Acceptance criteria**
- [ ] Repeated bad-faith policy refusals (`policy_reviews.bad_faith`, counted in the response record)
      route to enforcement — moved here from T-050
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
- **Status:** DONE — 2026-09-23
- **Priority:** P1
- **Depends on:** T-010, T-012
- **Risk:** MEDIUM
- **Human approval required:** Yes, as it turned out — a staff decision route, money decisions,
  and the edge of enforcement. **Approved 2026-09-23** as designed
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{assignments,mission-policy}/**

**Description**
The mechanism behind the refusal right the Terms already grant (§3, §4). Payment precedes
acceptance, so there are two windows. Per `.claude/skills/mission-state-machine/SKILL.md`.

**Acceptance criteria**
- [x] `ASSIGNED → decline(POLICY_CONCERN) → CANCELLED`: automatic full refund, mission flagged
      for staff review — the refund is a recorded `FULL_REFUND` decision on **every** investigator
      decline (no work was done either way); the review names the mission for T-051's queue
- [x] `ACCEPTED | IN_PROGRESS → policy_halt → SUSPENDED`: work stops, funds held, staff review
- [x] **The halt is available at any point**, including after evidence exists — tested with
      recorded sources, which stay intact; refused from every other state
- [x] Staff outcome resumes the assignment or cancels it; both recorded with reasoning — decided
      once, by MODERATION staff, inside PlatformContext
- [x] **Substantiated refusals excluded from the response record; unsubstantiated ones counted**
      — tested both ways, in both windows, and seen to fail when the exclusion is removed
- [~] Repeated bad-faith policy claims route to `enforcement-actions` — staff mark bad faith and the
      record counts it; the **routing moves to T-049**, which builds enforcement
- [x] The money decision is recorded **separately** from the halt decision — its own table, row and
      audit entry; recorded for payments to execute (owner decision)
- [→] Material withdrawn from use is marked, never erased — **moved to T-116 and T-066**: evidence
      and attachments do not exist yet. The halt erases nothing that does exist
- [x] Both transitions go through the transition service — status, history, audit, outbox in
      one transaction

**Open for counsel:** whether work lawfully performed before a customer-caused halt is payable.

**Validation**
```bash
pnpm --filter api test assignments-policy-refusal
```


**DONE — 2026-09-23**

Three owner decisions: approval of the design; money **recorded, executed later** by payments;
the response record built here, with enforcement routing and material marking moved.

*Built.* Migration 0020: `policy_reviews` and `money_decisions`, two-party, asymmetric RLS — the
investigator's workspace raises reviews and records only a refund or a hold; only staff in
PlatformContext decide or record anything else; the customer reads money decisions but never a
review. Triggers copy parties, mission and currency from the assignment, keep what was raised,
decide a review once, and allow a money decision only to be marked executed once. `decline` moved
from `AssignmentsService` to `PolicyRefusalService` and gained a structured `reasonCode`; `POST
/assignments/:id/halt`; `GET /policy-reviews`, `POST /policy-reviews/:id/resolve`,
`GET /policy-reviews/response-record/me`.

*Found.* A policy ground typed as a decline reason went into the assignment's history, which the
customer reads — a leak waiting for T-050 to make the reason load-bearing. Only the code goes there
now. And the queue's cursor repeated its last row on every page: PostgreSQL keeps microseconds, a
JavaScript Date milliseconds, so the cursor read back earlier than the row it came from. Ordered and
compared at millisecond precision now; the paging test caught it. **The verification queue has the
same bug in production** — filed as T-134, since real submissions take the database default while
its tests set JavaScript dates, which is why they never saw it.

*Negative controls:* substantiated refusals counted; the ground written into the history; a halt
recording no hold; the customer's workspace able to read reviews — each watched to fail its tests.

*Also fixed:* a shuffled run (seed 50) found `verification.service.spec`'s queue test passing only
when an earlier test in the file had left an application open. It now creates the two it needs.

*Evidence.* 1839 tests, 100% coverage (2509/2509 statements, 1191/1191 branches). Counsel question 34
added (work done before a customer-caused halt). Docs: the architecture section, the
`mission-state-machine` skill, and the investigator, customer and staff articles.
---

### T-051 — Mission moderation queue (admin console)
- **Status:** DONE — 2026-10-03; `mission_moderation_decisions` (migration 0038), `/moderation/missions` routes in `MissionModerationService` through `PlatformContext`, admin-web `/moderation` queue, mission page and decision drawer; staff KB `kb-staff-mission-policy-review` en/ru/hy; `missions.md`, `admin-web.md`, `tenancy.md`
- **Priority:** P1
- **Depends on:** T-010, T-013, T-079
- **Risk:** HIGH
- **Human approval required:** Yes — it is the publication gate for lawful-use policy
- **Owner agent:** admin-web (UI) + backend-domain (decision service)
- **Affected:** apps/admin-web/**, apps/api/src/modules/mission-policy/**

**Description**
No mission reaches investigators without a moderator publishing it. Automatic screening sorts
and prioritises the queue; it never publishes. Per plan.md §10 and
`docs/product/mission-lifecycle.md`.

**Tenancy (ADR-0011).** The moderation queue reads across workspaces **only inside `PlatformContext`** (T-079).

> **From T-079:** there was nothing to move — the transition map allows `STAFF:MODERATION`, but no
> moderation endpoint exists yet, so this is where mission moderation first crosses a workspace.
> `PlatformContext.asStaff(actor, { scope: 'MODERATION', purpose: … }, req, fn)` from the first
> line, with a `RoutePurpose` added for each route. Every entry is audited on its own; the
> attachment-access criterion below is about what the moderator then opens.

**Acceptance criteria**
- [x] **Every queue read and decision enters through `PlatformContext`** (deferred from T-079), with its purpose added to `RoutePurpose` — not written cross-workspace and retrofitted
- [x] Queue of `UNDER_REVIEW` missions, ordered by risk band then age
- [x] Three outcomes: **publish** (`→ QUOTED`), **reject** (`→ REJECTED`), **request changes**
      (`→ DRAFT`) — each requiring a typed reason before the control enables
- [x] **A mission cannot reach `QUOTED` by any path except a moderator publishing it** — tested
- [ ] Moderator can open mission attachments; **every attachment access is audited** — **moved to T-066** (owner decision 2026-10-03): attachments do not exist yet, so there is nothing to open
- [x] AI classification shown as an input, clearly labelled, never pre-selecting the outcome
- [x] Rejection and change-request reasons are shown to the customer and are actionable
      — **the customer side exists (T-119)**: `review.reason` on the customer's mission is
      `mission_status_history.reason` of the moderator's move, shown **as written**. Label the field as
      customer-facing in the console, and keep any internal note elsewhere (`missions.md`)
- [x] Requires the `mission_moderation` staff scope (the `MODERATION` scope) — not `isStaff` (`authorization`)
- [x] A moderator cannot decide a mission they are party to
- [ ] Gate configurable per category and risk band, defaulting to **closed** (everything reviewed) — closed, with review latency per category and band recorded from day one; the configuration itself is **T-191** (owner decision 2026-10-03), since any open setting would be a second path to QUOTED
- [x] Decision, reasoning, moderator identity and timestamp recorded and append-only
- [x] Queue age surfaced — an unreviewed mission is a customer waiting, and missions expire

**Note on throughput:** at launch volume one moderator can gate everything. If review latency
becomes the constraint, the per-category configuration is the lever — not removing the gate.

**Hiring experience (plan.md §10, §30).** Every mission is reviewed at launch. Record review
latency per category and risk band from day one, so that any later decision to auto-publish a
low-risk category rests on data and counsel's confirmation. Partner investigation is never
auto-published.

**Validation**
```bash
pnpm --filter api test mission-moderation && pnpm --filter admin-web test
```

---

### T-052 — Block another user
- **Status:** DONE — 2026-09-30. Owner decisions 2026-09-30: enforced in the database through one narrow SECURITY DEFINER function, `app_blocked_users()` (the blocked set, never who blocked whom); this task covers the API, enforcement, the staff read routes and the app UI; reports, messaging and the staff console are follow-ups (T-173–T-175). Design: `docs/architecture/blocks.md`
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
- [x] Either party may block the other from a profile, a conversation, or a report flow — from a profile, a mission and an assignment; conversations and reports do not exist yet (T-174, T-173)
- [x] Blocked investigator no longer sees that customer's missions in discovery, and cannot
      quote on them — enforced in the query, not by hiding in the UI (`investigator-discovery`) —
      by the `quoted_read` policy and a restrictive quote INSERT policy
- [x] Blocked customer is not matched with that investigator — either way, in discovery's eligibility
- [ ] No new conversation can be opened between the two — messaging does not exist yet (T-174)
- [x] Blocks are **private** — the blocked party is not notified and cannot detect it from a
      different response shape or timing — the row is unreadable to them; what they lose looks like
      a mission they cannot see, and their withdrawn quotes like their own withdrawal

Live assignments — the part that must not be got wrong
- [x] Blocking during a live assignment **does not sever the assignment**
- [ ] It flags the assignment to staff, who resolve it: continue, reassign, or cancel with the
      refund decided on its merits — flagged (`GET /block-review/live-assignments`, audited);
      resolving it is T-175
- [x] **A test proves blocking cannot be used to escape delivery or payment obligations** —
      `assignments.service.spec.ts`, either side
- [x] Communication required for an active assignment continues until staff resolve it, so the
      dispute record stays intact — nothing on the assignment changes; messaging itself is T-174

Reporting is separate
- [ ] Block and report are distinct actions with distinct outcomes — block is "not this
      person", report is "staff should look at this" — reporting is T-173
- [ ] Blocking optionally offers to report; it never silently reports — never reports; the offer
      comes with T-173
- [ ] Reports reach staff; the reporter is acknowledged so the route is visibly working — T-173

Staff and signal
- [x] Staff can see blocks; many blocks against one account is a pattern worth surfacing —
      `GET /block-review/signals` (3 or more, provisional); the console screen is T-175
- [x] Block and unblock are audited with actor and timestamp
- [x] Blocks survive until removed; the user can see and manage their block list

Documentation (per `documentation-first`, in this task)
- [x] Customer and investigator knowledge-base articles explaining what blocking does and does
      not do — especially that it does not end an assignment or an obligation
- [ ] Release checklist §7 items satisfied — blocking is; in-app reporting is T-173

**Validation**
```bash
pnpm --filter api test blocks && pnpm --filter api test search && pnpm --filter @investigator/app-web test:e2e
```

---

### T-053 — Shared taxonomy
- **Status:** DONE — 2026-09-23
- **Priority:** P0 — blocks matching, discovery and mission creation
- **Depends on:** T-004
- **Risk:** MEDIUM
- **Human approval required:** Yes, as it turned out — the staff write path crosses three AGENTS.md
  gates (staff authorization, grants and RLS, PlatformContext). **Approved 2026-09-23** as designed
- **Owner agent:** database (schema) + backend-domain (service)
- **Affected:** apps/api/src/modules/{taxonomy,profiles}/**, migration 0017, table-classes.ts,
  rls.spec.ts, docs/architecture/taxonomy.md, docs/knowledge-base/{staff,investigator}/**

**Description**
One taxonomy shared by missions and investigator practice areas, per ADR-0007. This is the core
matching mechanism — eligibility, discovery, routing and notifications all join on it, so it
lands before anything that depends on it.

**Scope, as decided 2026-09-23.** Three parts of the original text moved, none dropped:
the **seed** to T-131 (blocked on the six review questions — slugs are permanent, so nothing is
seeded before them); the **source axis** (ADR-0008) to T-132; **tags** to T-055, which already
specified every tag criterion here, including the eligibility test, and is where search first
consumes tags.

**Acceptance criteria**
- [x] `TaxonomyNode` hierarchical with stable ids, slug, parent, ordering, status — existed
      (T-007); slug and parent now permanent by trigger, slug shape by check
- [x] **Nodes are never deleted, only deprecated** — DELETE is not granted; tests prove a retired
      node still resolves by id, still labels a mission filed under it, still matches in
      discovery from either side, and stays on a profile that declared it
- [x] `TaxonomyNodeLabel` per locale (en/ru/hy); the node id is the canonical value — English
      required at creation, fallback reported as `labelLocale`
- [x] A mission at a parent matches investigators declared at any descendant, and vice versa —
      existed (T-011, six tests); T-053 adds the retired-node case
- [x] Applied as a **hard SQL filter**; no path lets prose or a tag substitute for a declared
      node — the filter existed (T-011), and T-011's "the filter set is closed" already refuses
      `q` and `relevanceHint` with 400. Seen to fail when either field is added to the DTO
- [→] `Tag` curated and flat; `MissionTag` applied to missions — **moved to T-055**
- [→] **A test proves a tag cannot make an investigator eligible…** — **moved to T-055**
- [x] Staff-managed; adding, deprecating and relabelling are audited — API only, since admin-web
      does not exist (T-014). Every write carries a reason, recorded with what changed
- [→] Initial tree seeded from `docs/product/taxonomy-draft.md` — **moved to T-131**
- [x] Each node carries a risk band driving moderation queue ordering — existed (T-010); required
      when staff add a node, audited when it changes. Four bands, not three: ADR-0009 added
      RESTRICTED. The per-node structured questions (plan.md §10) go with the seed, T-131
- [x] `high`-band nodes route to a moderator every time — true already: every mission is
      moderated, and HIGH and above go to priority review (T-010)
- [x] No `Service` entity; a service is a deeper node — asserted against the table registry; the
      investigator KB article that described services as a second filter is corrected

**Second axis — source capability (ADR-0008)** — **moved to T-132**, all seven criteria.

**Validation**
```bash
pnpm --filter api test taxonomy
```

**DONE — 2026-09-23**

*Staff write path, approved.* `TaxonomyService` checks active → STAFF → TAXONOMY scope, then runs
inside `PlatformContext.asStaff` under three new route purposes (`taxonomy.create_node`,
`taxonomy.update_node`, `taxonomy.set_label`). Each write is serialised by a transaction-scoped
advisory lock and audited as `<what changed> — <why>`, e.g. `riskBand STANDARD → HIGH — …`.
A change that changes nothing writes nothing and records nothing.

*The database holds the rules on its own* (migration 0017). The runtime role gets SELECT, INSERT
and UPDATE on the two taxonomy tables and never DELETE; RLS is enabled and forced, reading is open,
and writes are admitted only under `app_platform_access()`. Triggers keep slugs and parents
permanent and every ACTIVE node under an ACTIVE parent, from both directions. `table-classes.ts`
gained `staffMaintained`, and `rls.spec.ts` now asserts both halves: those two tables have exactly
that grant and policy shape, and every other platform table is still read-only. The old assertion
("the application cannot write the tables every workspace reads") was replaced, not deleted.

*Found and fixed.* A profile could **newly** declare a retired specialty — missions already
refused one, profiles did not. Profiles save the whole set each time, so the fix refuses only a
retired node being *added*: an investigator who held one before it was retired keeps it and can go
on editing. And the investigator KB article described specialties and services as two things
customers filter on, which ADR-0007 had already folded into one tree.

*Seen to fail first.* The grant assertion failed on its first run: migration 0000's default
privileges gave the new labels table DELETE, and a GRANT alone would have left it there. The
migration now REVOKEs first.

*Negative controls* — each broken, watched to fail, restored: the service's scope check removed
→ `refuses staff holding another scope` (which asserts the **audited** denial: PlatformContext
also refuses, but silently, so a test that only checked the 403 passed with the check gone); the
children check removed → `retires a branch leaf first`; retired nodes newly declarable → two
profile tests; discovery dropping retired nodes → `still matches through a node that has since
been retired`; `q`/`relevanceHint` added to the search DTO → T-011's closed-filter tests; the
identity trigger disabled → `keeps a slug and a parent for good`.

*Evidence.* 1640 tests, 100% coverage (2154/2154 statements, 1003/1003 branches, 616/616
functions, 1964/1964 lines). Two branches were reached by adding tests, two were impossible and
were made non-null with the reason stated, and one early return was removed because drizzle writes
an empty `IN` as `false`.

*Also.* drizzle-kit's stored snapshots had not known about migrations 0015 and 0016, which were
written by hand; the 0017 snapshot is the first accurate one since, so the next `generate` will
not re-emit them.

---

### T-054 — Investigator mission browse and filter
- **Status:** DONE — 2026-09-25
- **Priority:** P1
- **Depends on:** T-053, T-011, T-091
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain (API) + frontend (UI)
- **Affected:** apps/api/src/modules/search/**, apps/app-web/**

**Description**
Investigators currently see eligible missions but cannot sort or filter them. An investigator
eligible for two hundred missions has no way to find the ones worth quoting on.

Distinct from T-011, which is the customer→investigator direction.

**Acceptance criteria**
- [x] **Eligibility is applied first and is not user-adjustable** — filters narrow the eligible
      set, never widen it. A test proves no filter combination surfaces an ineligible mission
      — eligibility is the quote gate, one function for both (`requireQuotingProfile`): a caller
      who may quote, a QUOTED mission, not their own (owner decision, 2026-09-25; narrowing to
      declared specialties is T-143). Fifteen filter/sort combinations walked page by page never
      show a draft, submitted, under-review, rejected, cancelled, confirmed or own mission
- [ ] Filters: taxonomy node, budget range, timeline, distance from a service area, language,
      posted date, tags
      — all but **tags**, which do not exist until T-055 (criterion added there). Budget needs a
      currency; language means every required language is among those chosen
- [x] Sorts: newest, closest, highest budget, soonest deadline
- [x] Free-text search ranks within the eligible set; it never gates (`investigator-discovery`)
      — `q` implies relevance order; with any other sort it is refused rather than silently ignored
- [x] Saved filters, so a returning investigator does not rebuild the same query
      — `saved_mission_searches`, own user in own workspace under RLS, at most 20, unique names
- [x] Cursor pagination, bounded limit (`docs/api/pagination.md`)
- [x] Results are projections — **no customer contact details before assignment**
      — nothing about the customer at all, nor their purpose or relationship to the subject; the
      key set is asserted
- [x] Distance uses `ST_DWithin` to filter and `ST_Distance` to sort (`postgis-search`)

**Validation**
```bash
pnpm --filter api test mission-browse
```

**DONE — 2026-09-25**

*API.* `POST /api/v1/search/missions` and `GET/POST/DELETE /search/missions/saved`, in the search
module (`MissionBrowseService`). Migration 0023: `missions.published_at`, set only by a trigger on
entry into QUOTED (backfilled), two partial indexes, and `saved_mission_searches` with an own-user
policy. `requireQuotingProfile` extracted so quoting and browse share the gate; the taxonomy walk
extracted so discovery and browse share it. Row-level security already hid unpublished missions
from other workspaces — a mutation removing the status condition from the query changes nothing,
which the doc records.

*App.* `/missions` for investigators, built from the registries after a first hand-built version
was rightly rejected as looking like a form: shadcn `card`, `badge`, `drawer` (filter sheet: bottom on
phones, right from `md`), `command` (searchable categories), `input-group`, `native-select`,
`toggle-group` chips and `skeleton`, all re-tokenised; active filters as removable chips; budgets
without whole-number decimals (`formatMoneyRange`, `formatBudget`); a `scrim` token for the sheet's
backdrop. The URL stays the one description of a browse. A customer keeps the empty state. `formatMoneyRange` added to `@investigator/i18n`. Two bugs found in the browser and
fixed with tests seen failing first: the language filter used `?lang=`, which the middleware takes
as the app's language (renamed `language`); and client strings under `missions` were not sent to
the browser, so a delete button read "Delete {name}". `Button` moved to `@radix-ui/react-slot`:
the `radix-ui` barrel had become a 78 kB client boundary. `/missions` is 165 kB with the sheet and
the category list (budget 250).

*Verified* in the browser against the real API and database, at 375, 768 and 1280px: not-eligible
state, tree walk, closest-first with distances, language + currency + budget via the form, text
ordering, a budget without a currency refused with the field named, paging over 3,000+ missions,
saving, running, duplicate-name refusal and deleting a saved search. No horizontal scroll; every
target ≥ 44px; inputs 16px.

*Tests.* API 2332 (100%), `mission-browse` 50; app-web 228 (100%); i18n 29 (100%); ui-tokens 15. Docs:
`discovery.md`, `missions.md`, `tenancy.md`, `app-web.md`, component inventory; KB
`finding-work` and `privacy-and-data` in en/ru/hy. Filed T-142 (self-quoting), T-143 (narrower
eligibility after the taxonomy seed).
---

### T-055 — Mission tagging
- **Status:** DONE — 2026-10-03; curated `tags` with en/ru/hy labels, customer suggestions on drafts, confirmation on a PUBLISHED decision, browse filter over the merge closure; browser-verified after merge (#105); re-verified 2026-10-04, fallback-language tag chips now carry `lang`
- **Priority:** P2
- **Depends on:** T-053, T-051
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{missions,taxonomy}/**, apps/admin-web/**

**Description**
**Owns tags entirely** — the `Tag` and `MissionTag` tables and the eligibility test that T-053
originally listed moved here on 2026-09-23, since this task already specified all of them and is
where search first consumes tags.

Tags as refinement on top of the taxonomy. Deliberately curated rather than customer free text:
free-text tags in three locales are unusable for matching, and a customer-authored tag is a
moderation surface.

**Acceptance criteria**
- [x] Tags applied from the curated vocabulary — **no free-text tag creation by customers**
      — `tagIds` are UUIDs of ACTIVE tags (422 otherwise); RLS admits a customer write only to an
      unconfirmed row on their own DRAFT
- [x] Customers may suggest tags at mission creation; moderators confirm at publication (T-051)
      — intake chips on the kind-of-help question; the admin decision drawer's checklist on Publish.
      `tagIds` with any other outcome is refused
- [x] Tags improve search ranking and browse filtering only — confirmed labels at ts weight A
- [x] Mission browse (`POST /search/missions`, T-054) takes a tag filter that only narrows, and the app-web filters offer it — T-054 left it out because tags did not exist
      — all-of over confirmed tags; `tag` URL parameter; chips in the sheet and as active filters
- [x] **A tag never affects eligibility** — tested (`mission-tags.spec.ts`: hired, own and
      under-review missions stay hidden whatever tags; the unfiltered set is unchanged; screening too)
- [x] Tag labels localised for en/ru/hy — `tag_labels`, English fallback reported as `labelLocale`
- [x] Staff can add, merge, deprecate and relabel tags; all audited — API only (TAXONOMY scope,
      PlatformContext, reason required), as the taxonomy is; no console screen yet
- [x] Merging a tag preserves the missions that carried the old one — no mission rewritten;
      browse matches the merge closure

**Validation**
```bash
pnpm --filter api test mission-tags
```

*Built.* Migration 0039: `tags`, `tag_labels` (platform, staff-maintained — SELECT/INSERT/UPDATE,
never DELETE) and `mission_tags` (two-party, filled from the mission). Trigger `keep_tag_identity`
keeps slugs, merges once and only into an ACTIVE tag. `TagsService` and `/tags` routes in the
taxonomy module under four new route purposes (`tag.create|set_label|deprecate|merge`). Missions
carry `tagIds` (suggested); the moderation review view carries `tags`; a PUBLISHED decision
confirms `tagIds`. Browse: `tagIds` filter (merge closure, `search/tag-closure.ts`) and tag labels in
the relevance vector. app-web: intake tag picker, brief line, browse sheet chips and active-filter
chips. admin-web: tags in the brief, publish checklist in the decision drawer.

*Docs.* `taxonomy.md` "Tags", `missions.md`, `discovery.md`, `app-web.md`, `admin-web.md`,
`retention.md`; KB `kb-customer-creating-a-mission` v4, `kb-investigator-finding-work` v5,
`kb-staff-mission-policy-review` v7, `kb-staff-taxonomy-management` v3, each en/ru/hy (translations
stay draft).

*Validated.* `pnpm --filter api test mission-tags` 15/15; lint, typecheck, format, build; coverage
100% in every package (api 3311 tests, app-web 853, admin-web 131).

*Verified.* In the browser against the built stack and the real API, as a customer, a moderator
(MODERATION + TAXONOMY) and a verified investigator, at 375 (all three surfaces), 768 and 1280
(browse). Intake: chips on the kind-of-help question, `aria-pressed`, 44px, saved as `tagIds`, shown
on the brief and the submitted mission; after submission a tag change is 403, an unknown id 422,
free text 400. Console: brief marks suggested/confirmed; the checklist appears only on Publish,
suggestions pre-ticked; unticking one and adding another publishes exactly the ticked set; a
suggestion retired while under review is left out of the checklist, so publishing does not 422.
Browse: the filter narrows to confirmed tags only (a suggestion-only tag is the empty state), all-of
across two tags, `?tag=` in the URL and as an active-filter chip, Russian labels with English
fallback; after merging a tag, filtering by the target finds the old tag's missions and an old
`?tag=` link still matches as "A tag no longer offered"; retired tags leave every picker. Staff
writes 403 for a customer, a second merge 409, every write in `audit_logs`. axe (WCAG 2.1 AA):
no violations on the intake step, the filter sheet or the decision drawer. No horizontal scroll.

*Re-verified 2026-10-04* after the close above sat unmerged: customer → moderator → investigator end
to end at 375, then 768 and 1280, on the built stack. Found: a tag shown in English for want of a
translation was unmarked on a Russian page, so a screen reader read it with Russian rules (WCAG
3.1.2). Fixed: the intake and browse-sheet chips carry `lang` from `labelLocale` — regression tests
in `intake.spec.tsx` and `mission-browse.spec.tsx`, seen to fail first; `app-web.md`. Composed text
(the active-filter chip's name, the brief line) is T-197.

---

### T-194 — Show the customer the tags their mission was published with
- **Status:** DONE — 2026-10-04; `confirmedTagIds` (merges followed) beside `tagIds` on the customer's own mission; the brief says "Tags you suggested" until publication, then "Investigators find it under"
- **Priority:** P3
- **Depends on:** T-055
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/missions/**, apps/app-web/src/components/missions/**

**Description**
Found verifying T-055. After publication the customer's mission page still lists their own
suggestions under "Tags" — `tagIds` on `GET /missions/me/:id` is the suggested set. A moderator who
drops a suggestion and adds another leaves the customer reading tags the mission does not carry,
and never seeing the one it does (seen: "Corporate records, Supplier vetting" while investigators
browse it as Corporate records + Court records). Behaviour matches `taxonomy.md`; the page wording
does not.

**Acceptance criteria**
- [x] Once published, the customer sees the confirmed tags, labelled as what investigators see
      — a tag merged since is shown as the tag it became, once; published with none, no line
- [x] Before publication, the line says the tags are suggestions
- [x] KB `kb-customer-creating-a-mission` says which the customer sees when, en/ru/hy (v5; ru/hy stay draft)

**Validation**
```bash
pnpm --filter api test missions && pnpm --filter app-web test
```


*Built.* API: `OwnMissionRepository.tagsOf` reads both sets in one query and walks merges to the tag
each confirmed one became (recursive over `merged_into_id`); `OwnMission.confirmedTagIds`. No policy
change — `mission_tags` `reads` already admits the customer's tenant. app-web: `shownTags`
(`lib/tags.ts`, an exhaustive map of which statuses come only after publication; a cancelled
mission counts if it carries confirmed tags), brief messages `tags_suggested` / `tags_published` in
en/ru/hy. Docs: `taxonomy.md`, `missions.md`, `app-web.md`, KB v5.

*Validated.* `pnpm --filter api test missions` 204/204 (tag suite 17/17, repeated); app-web 861;
coverage 100% in every package (api 3314); lint, typecheck, format, build, KB validator.

*Verified.* In the browser as the customer at 375, 768 and 1280 against the local API: under review
"Tags you suggested: Supplier vetting"; published with one suggestion dropped "Investigators find
it under: Litigation"; a mission whose confirmed tag was merged since shows the merge target, as
investigators' Litigation filter finds it. No horizontal scroll. Found and fixed while verifying:
merged confirmed tags first showed no line at all.
---

### T-056 — Assistant shell and conversation UI
- **Status:** DONE — 2026-09-25
- **Priority:** P1
- **Depends on:** T-017, T-045, T-039, T-091
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**, packages/ui/**; apps/api/src/modules/ai/**, apps/api/src/modules/ai-sessions/** (owner decision 2026-09-25)
- **Owner decisions (2026-09-25):** (1) the turn route is built here — `POST /ai/sessions/:id/turns`
  appends the user's message, answers it through T-017's knowledge answering, and appends the
  reply; this extends T-017's stateless approval to questions stored in the caller's own session.
  No intent routing, discovery or write tools. (2) "Progressive" means **streamed steps**
  (server-sent events) with a validated answer delivered whole — never unvalidated tokens.
  (3) Titles come from the first user message, trimmed, no model. (4) `@shadcn` primitives.

**Description**
The conversation interface. Six backend tasks build a full assistant engine with no way to
reach it; this is the surface.

**Tenancy (ADR-0011).** Needs the app-web foundation (T-091). The assistant shows the active workspace and opens that workspace's sessions.

**Acceptance criteria**
- [x] Generated session titles never expose evidence content — moved here from T-045, since this is
      where titles are first generated; `AiSessionsService.rename` is the only title writer today
- [x] Docked panel on desktop; **full-screen sheet on mobile** (`responsive-design`)
- [x] **Responses render progressively as they stream — never a spinner.** Progressive rendering
      is information; a spinner is an apology (`animation`)
- [x] Message roles visually distinct: user, assistant, tool/command events as structured
      blocks rather than prose (`ai-session-context`)
- [x] Stop generation; retry a failed turn without losing the conversation
- [~] Composer: multiline, keyboard submit — **attachment entry point not built** (T-144: there is
      nowhere for a session attachment to go yet, and a control that does nothing fails the
      subtraction test)
- [x] **Minimal chrome.** A conversation is already the simplest interface — wrapping it in
      controls makes it worse (`interaction-design`)
- [x] Empty state teaches what the assistant can do for that role, not "No messages"
- [x] Keyboard operable end to end; new content announced to screen readers

**Validation**
```bash
pnpm --filter app-web test assistant
```

**DONE — 2026-09-25**

*What exists.* API: `POST /ai/sessions/:id/turns` and `…/turns/retry` (`AssistantTurnController`,
`AssistantTurnService`) — refusals store nothing; once stored the question stays; the response is
server-sent events (`message`, `session`, `step`, `message`, `done` | `error`); Stop is the client
closing the stream, which aborts retrieval and the model call and stores no reply. T-017's service
is split into `admit` (checks + allowance) and `respond` (reports `searching` / `writing from N`),
and `ChatModel.complete` takes an abort signal. `append` names an untitled session from its user's
first message (`titleFrom`, 60 chars at a word boundary) — only a `USER` message, so never evidence.
app-web: the assistant is a nav toggle, docked from `lg`, a full-screen handle-less sheet below,
loaded on first open (+4 kB per route, not +30); `/assistant` removed. Adopted and re-tokenised
`@shadcn/message`, `bubble`, `marker`, `textarea`; `message-scroller` declined (its package is 0.x
and 25 days old). Owner decisions in the header.

*Found along the way.* (1) A newly registered account has **no role**, so the API reads it only
the public policies; the empty state had offered it customer questions it could not answer — seen
in the owner's browser check (a mission question cited the prohibited-requests policy). Role-less
accounts now get three public-policy questions and a link to add a role; all nine suggestions were
checked to retrieve their own section first on the dev database. (2) A retry that hit a 409 and
then failed to read the conversation back left the turn running forever; now it fails visibly.
(3) The shell's Node is 20 while `.nvmrc` pins 24, and two API specs fail on it (T-146).

*Negative controls* (each seen to fail, then restored): reply stored after Stop; any role names a
session; allowance spent before the session check; no abort on disconnect; retry after an answer;
stale events from a left conversation believed; retry re-sends a stored question; read-back after
every Stop; a spinner instead of steps; the docked panel ignoring Escape; role-less treated as a
customer.

*Verified.* Lint, typecheck, build, bundle budget (all routes under 250 kB); API 2371 tests and
app-web 292 at 100% coverage (API on Node 24); knowledge-base validator 0/0 and the sync twice with
no change and 0 conflicts. In the browser, by the owner (their own browser, signed in — the agent
may not enter a password), against the real API and database with a scratchpad stand-in for OpenAI:
suggestions, streamed steps, the answer with sources, titles, and the role-less fix. **Not run by
the agent:** the Playwright pass at 375/768/1440 and reduced motion — covered by specs (sheet vs
dock, focus, Escape, `motion-safe` pulse, roles) but not seen at those widths.

*Filed:* T-144 (attachment entry point), T-145 (browser calls do not send the chosen role),
T-146 (agent shells on Node 20).

---

### T-057 — Session management UI
- **Status:** DONE — 2026-09-25
- **Priority:** P1
- **Depends on:** T-045, T-056
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**; apps/api/src/modules/ai-sessions/** — `GET …/messages?order=newest`,
  read-only and scoped as before, so a conversation opens at its end and reaches back on demand

**Tenancy (ADR-0011).** Session lists are per workspace; switching workspace switches the list.

**Acceptance criteria**
- [x] Session list with create, open, rename, archive, delete — and search across sessions
- [~] Resume loads summary, structured state and recent messages; **not the whole history**
      (`ai-session-context`) — **recent messages only, never the whole history**; summaries and
      structured state do not exist until T-046, which should load them here
- [x] Older messages load on demand or through search, never all at once
- [x] Generated titles are editable and **never expose evidence content** (`plan.md` §50)
- [x] Delete warns that session memory goes with it
- [x] Mobile: sessions are a sheet, not a squeezed sidebar
- [x] A test proves another user's session is unreachable from the UI by any route

**Validation**
```bash
pnpm --filter app-web test assistant-sessions
```

**DONE — 2026-09-25**

*What exists.* API: `GET …/messages?order=newest` — the same route and scoping, paging from the end
backwards; the cursor carries its direction and is refused the other way; added (with T-056's
`last`) to the authz spec's every-path list. app-web: **Your conversations** swaps into the panel —
the phone's full-screen sheet, the desktop dock — with search (two characters, 250 ms pause),
Current/Archived, pages of 20, "Open now" marked in words and `aria-current`. A conversation opens at
its newest 30 messages; "Show earlier messages" keeps the reader's place; a search result reaches
back (at most ten pages) to its first match and marks it. The header's options
(`@shadcn/dropdown-menu`) rename in place, archive, bring back and delete — after
`@shadcn/alert-dialog` asks (a bottom sheet on a phone, Cancel first). Any 404 — deleted elsewhere, or
someone else's — replaces the conversation with a fresh one saying it is no longer available.

*Found by the tests.* (1) Escape while renaming closed the whole sheet: Radix hears Escape on the
document as it travels down, before the field; the rename now catches it on the window. (2) After a
confirmed delete, focus fell to the sheet's container or not, by timing: the dialog handed it to the
options just before the fresh conversation removed them. (3) While a chosen conversation loaded, the
list still called the previous one open, and choosing it did nothing — the one chosen is now open
from the moment it is chosen. (4) Two `if`s after an `await` reported negative v8 branch counts;
rewritten as early returns.

*Negative controls* (each seen to fail, then restored): pages not reversed into reading order; a
match not reached back to; no limit on reaching back; the chosen one not open while it loads; Escape
reaching the sheet; delete without asking; a vanished conversation shown as an error. API: cursor
direction ignored (policy spec).

*Verified.* Lint, typecheck (specs too), build, budget (all routes < 250 kB), source maps, audit
(one moderate, pre-existing: esbuild under drizzle-kit); app-web 332 tests, API 2373, both 100%
(API on Node 24, T-146); `pnpm --filter app-web test assistant-sessions` 39; knowledge base 0/0.
In the owner's browser against the real API and database: the list, search, opening, rename,
archive/bring back and delete. The agent did not run the 375/768/1440 Playwright pass (it cannot
sign in); the specs cover sheet vs dock and focus.

*Docs.* Customer assistant article v6 (ru/hy drafts in step), investigator article v2,
`ai-sessions.md` (newest-first paging), `app-web.md` (conversations), component inventory, ACTIONS #23.

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

**Tenancy (ADR-0011).** The confirmation UI shows the workspace a plan will run in. From T-096 it shows the whole DAG under one confirmation.

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
- [ ] `kb-customer-ai-assistant` (en/ru/hy) explains confirming: what is shown, that a plan waits 24 hours, that a change to what it acts on asks again, and that the fact of a confirmed action — its kind, never its content — stays in the audit trail after the conversation is deleted (from T-048, `ai-plans.md`); and how a plan ends — the conversation says what was done step by step, what failed and what never ran, nothing done is undone automatically, and a plan that fails or is voided after confirming also notifies (from T-226, `ai-plans.md`)
- [ ] T-225's preview lines beside the exact arguments; ids shown with labels, never bare; values from content the model read marked with their source (review 2026-10-06)
- [ ] Act-mode clarifying questions as option chips of at least 44px; each step's T-210 outcome shown; plans over three steps collapse below `md` (review 2026-10-06)
- [ ] States read from step rows: EXECUTING, COMPLETED, partial, FAILED, EXPIRED, VOIDED, superseded; confirm disabled after the first tap; progress by polling (review 2026-10-06)
- [ ] Visual QA at 375 / 768 / 1440 against a seeded account, not waived (review 2026-10-06)

**Validation**
```bash
pnpm --filter app-web test assistant-confirmation
```

---

### T-059 — Structured result and citation rendering
- **Status:** DONE — 2026-09-25
- **Priority:** P1
- **Depends on:** T-018, T-056, T-048, and a task that routes discovery through assistant turns
  (not yet filed — it needs an owner decision: T-056 kept turns to knowledge answers)
- **Blocked (2026-09-25, owner decision):** only two of the seven criteria have data behind them.
  Discovery results never reach a conversation — turns answer knowledge questions only, and a stored
  `TOOL_RESULT` points at the result store T-048 builds; nothing yet produces mission, quote,
  assignment or payment references, or AI-drafted text. Building the renderers first would be UI
  against data that does not exist (CLAUDE.md #8). Linked, openable citations and the "not covered"
  state are buildable now and can go first when this resumes.
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**; apps/api/src/modules/ai/** (turn routing), apps/api/src/modules/knowledge/** (document read)
- **Owner decisions (2026-09-25):** (1) scope — discovery cards and openable citations are built here;
  paging by reference (T-048), links into the app (T-119/T-121) and unreviewed drafts (T-117) stay
  unticked. (2) **Discovery first, knowledge as the fallback**: each turn runs T-018's discovery step,
  and a request it calls `not_discovery` is answered from the knowledge base — extending T-018's
  stateless approval to requests and results stored in the caller's own session. (3) A read-only
  `GET /knowledge/documents/:docKey` behind the retrieval gate (`mayRead`), and a help page in the app.

**Description**
Tool results are structured data, not prose. Rendering them as chat text loses the structure
and invites the model to editorialise.

**Acceptance criteria**
- [x] Investigator results render as cards showing **`matchedOn` and `notMatched` fields only**
      — never a model-composed rationale (`investigator-discovery`)
- [x] Distance, languages, specialties and availability shown from the data, not the prose
- [x] RAG answers **cite their sources**, linked and openable
- [x] "I don't have that" renders as a clear state, not an apology buried in text
- [~] Large results paginate by reference — **10,000 rows never enter the view or the prompt**
      (`ai-session-context`) — capped: at most 10 results reach the view, with "more match — narrow
      it"; paging **by reference** needs the result store (T-048)
- [ ] Mission, quote, assignment and payment references link into the app — nothing produces
      them yet, and their screens do not exist (T-119, T-121)
- [ ] AI-drafted report or message text is **visibly marked unreviewed** and cannot be sent or
      exported from the assistant without review (`report-generation`) — nothing drafts text yet
      (T-117)

**Validation**
```bash
pnpm --filter app-web test assistant-results
```

**DONE — 2026-09-25**

*What exists.* API: each turn runs **discovery first** (`DiscoveryAnswerService.respond`, steps
`understanding` → `finding`, abortable); its results, "nobody", question back or refusal are the
reply, stored whole (`source: 'discovery'`); `not_discovery` / `not_understood` fall back to the
knowledge base. An answer to discovery's question (`clarifies`) is paired with the question it
answers — a specialty only from those offered, a point used once and stored nowhere, a place read
with the question — and a retry pairs it again. The allowance is taken once per turn.
`GET /knowledge/documents/:docKey` opens a help article behind the retrieval gate (`mayRead`,
another audience's article a 404 like a missing one). app-web: `InvestigatorCard` and
`DiscoveryReply` (searched-for, cards, nobody, more, refusal with the policy, the question answered
in place: one tap, Use my location rounded to ≈1 km, or words); sources are links to
`/help/[docKey]#section`, which close the phone's sheet and leave the dock; the help page renders
the knowledge base's markdown subset (`ArticleBody`), nothing interpreted.

*Found along the way.* (1) Two buttons named "Send" — the composer's and the purpose answer's —
indistinguishable to a screen reader: the second is now "Send the reason". (2) Drafts are never
ingested, so "a draft is not served" is guaranteed a step earlier than first assumed. (3) Discovery
first means a question *about* the lawful-use rules that matches them is shown the policy, not
answered — documented in the article.

*Negative controls* (each seen to fail, then restored): knowledge never asked after discovery; the
point stored with the message; any specialty accepted; articles served past the gate; English
preferred over the reader's language; a gap left unsaid on a card; a clarification answerable after
the conversation moved on; the exact location sent; the docked panel closed by a citation.

*Verified.* Lint, typecheck, build, budget (all 12 routes < 250 kB; `/help/[docKey]` 140 kB),
source maps; API 2405 tests, app-web 356, both 100%; `pnpm --filter app-web test assistant-results`
13; knowledge base 0/0, sync 0 conflicts. In the owner's browser against the real API and database,
with a local model stand-in and two made-up investigators seeded in dev: cards, nobody, the
location question, refusal and the policy page, linked sources. The agent did not run the
375/768/1440 Playwright pass (it cannot sign in).

*Docs.* Customer assistant article v7 (ru/hy drafts in step), investigator v3, `ai-sessions.md`,
`knowledge.md`, `assistant-tools.md`, `app-web.md`, retention, component inventory, ACTIONS #6, #23.

---

### T-060 — Memory management UI
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-047, T-057
- **Risk:** HIGH
- **Human approval required:** Yes — persistent memory is a privacy surface
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Tenancy (ADR-0011).** The memory UI shows each memory's scope. `user_global` memories are marked as visible in every workspace.

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
- **Depends on:** T-056, T-013, T-051, T-079
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

**Tenancy (ADR-0011).** The staff assistant acts across workspaces only inside `PlatformContext`, with the staff scope and a stated reason.

**Acceptance criteria**
- [ ] Runs with the **staff member's specific scope** — never blanket `isStaff` (`authorization`)
- [ ] A test proves staff cannot reach evidence through the assistant without an existing grant
- [ ] Summaries of disputes and applications **cite the records they drew on**
- [ ] The assistant never renders a policy decision as made — it explains, staff decide (T-051)
- [ ] Assistant use in the console is audited like any other staff action (`audit-logging`)
- [ ] Drafted support responses are marked as drafts and require a human to send
- [ ] Read and draft only: no platform-scoped write registers until an ADR fixes the platform plan's shape (scope, purpose and reason hashed; `PlatformContext.asStaff` re-entered at execution) (review 2026-10-06)
- [ ] Ships with a staff injection set: dispute, application and mission content aiming at cross-workspace reads (review 2026-10-06)

**Validation**
```bash
pnpm --filter admin-web test assistant
```

---

### T-062 — Google OAuth sign-in
- **Status:** DONE — 2026-09-29. Google sign-in (Authorization Code + PKCE, server-side exchange, JWKS-verified ID token) with account linking only on verified addresses on both sides, first sign-in gated on the registration documents, sign-in methods and a findable sign-out (PR #92). Real Google round trip — new account and connecting to an existing one — done by the owner 2026-09-29
- **Priority:** P1
- **Depends on:** T-005, T-021
- **Risk:** HIGH
- **Human approval required:** Yes — authentication
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/**, apps/app-web/**, packages/auth/**

**Description**
Sign in with Google, alongside email/password. Authorization Code flow with PKCE, server-side
token exchange. The web app is the only surface — mobile is deferred (ADR-0009).

**Tenancy (ADR-0011).** The Personal workspace comes with the user, created by the database trigger (T-074). A first OAuth sign-in that creates a user gets one without any code here.

**Acceptance criteria**

Flow
- [x] Authorization Code + PKCE; **the code exchange happens server-side** and the client
      never sees the client secret
- [x] `state` is validated to prevent CSRF on the callback; single-use and short-lived
- [x] `nonce` validated in the ID token
- [x] ID token signature, issuer, audience and expiry all verified against Google's JWKS —
      never trusted on presentation
- [x] Redirect URIs allowlisted exactly; no wildcard, no open redirect on the callback

Account linking — where the real vulnerability is
- [x] **Google's `email_verified` claim is required before linking to an existing account.**
      Linking on an unverified email lets anyone who controls a Google account with that
      address take over the local one
- [x] A test proves an unverified-email OAuth identity **cannot** link to an existing account
- [x] One account may hold several identities; `auth_identities` is (provider, subject) unique
- [x] Unlinking is blocked if it would leave the account with no way to sign in
- [x] Linking and unlinking are audited

Session and data
- [x] Issues the platform's own session — host-only cookie, `SameSite=Strict` (ADR-0002).
      The Google token is not the session
- [x] Google tokens are never logged and never returned to the client (`audit-logging`)
- [x] Only profile and email scopes; nothing beyond what registration needs
- [x] Terms acceptance still required at first sign-in — OAuth does not bypass `legal-consent`
- [x] Account deletion revokes the linked identity

Verification
- [x] Browser-verified end to end: new account, existing-account link, denial at the consent
      screen, and callback with a tampered `state`

**Validation**
```bash
pnpm --filter api test auth-oauth
```

---

### T-063 — Close the coverage gap the repaired gate exposed
- **Status:** DONE — 2026-09-14
- **Priority:** P0
- **Depends on:** —
- **Risk:** MEDIUM
- **Human approval required:** No — but the exclusions register needs a maintainer (see below)
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/**

**Description**
The coverage gate never ran. CI called `pnpm test:coverage`, which expands to
`pnpm -r --if-present test:coverage`; no package defined that script, so `--if-present`
skipped every package and the step exited 0. `@vitest/coverage-v8` was not installed and no
thresholds existed. The step was labelled "Blocking" in `pr.yml` and blocked nothing.

Wired for real during T-005: provider, `all: true`, 100% thresholds on all four metrics, and
a `test:coverage` script in `apps/api`. With it measuring, the package sits at **76.61%
statements / 68.75% branches / 72.3% functions / 76.59% lines** — not the documented 100%.

`src/modules/auth` was brought to 100/98.24/100/100 as part of T-005. The remainder is
pre-existing debt from T-002/T-003/T-004 and is this task:

| Area | Stmts | Note |
|---|---|---|
| `main.ts`, `app.module.ts` | 0% | Bootstrap. Candidate for the exclusions register, not for an agent to decide |
| `common/logging/logger.options.ts` | 14% | Redaction paths — these carry personal data and must be tested, not excluded |
| `database/database.module.ts` | 25% | Factory throws without DATABASE_URL; that branch is untested |
| `common/errors/http-exception.filter.ts` | 50% | Error mapping a user can actually reach |
| `database/schema/*` | 65% | Partial-index and soft-delete helpers |
| `modules/health` | branch 50% | |

**Decided 2026-09-14 (ACTIONS-FOR-ME #12, option 1).** One class of branch is unreachable by any test: the `typeof X === "undefined" ? Object : X` parameter-type guard that `emitDecoratorMetadata` emits for every typed constructor and method parameter. Its `Object` side runs only on a circular import. (Earlier wording blamed a `__decorateClass` helper ternary — inspecting oxc's output showed that was wrong.) It is excluded by the one registered exclusion, implemented in `apps/api/vitest.config.mts`; every threshold stays at 100%.

**Acceptance criteria**
- [x] `pnpm test:coverage` passes at the declared thresholds, or every shortfall has a
      register entry approved by a maintainer
- [x] Redaction paths in `logger.options.ts` are tested against a payload containing an
      email, a password and a refresh token
- [x] `database.module.ts` missing-`DATABASE_URL` branch is tested
- [x] The decorator-metadata guard is resolved by decision, never by lowering a number silently
- [ ] `pr.yml` coverage step is proven to fail on a deliberately uncovered line — the gate was
      shown failing locally on real gaps throughout this task and on CI for PR #1; a dedicated
      deliberately-uncovered-line run on CI is still outstanding

**Result — `apps/api` on the T-005 branch:** 100% statements (368/368), 100% branches
(176/176), 100% functions (106/106), 100% lines (351/351). 234 tests. Every threshold at 100%;
one registered exclusion, applied narrowly (below). Up from 83% / 77% / 80% / 83%.

**Three real bugs the gap was hiding** — each with a regression test seen to fail first:

| Bug | Consequence | Found by |
|---|---|---|
| **The database pool leaked on shutdown.** `PoolHolder` built a second pool (`max: 1`) and closed *that*; the ten-connection pool drizzle used was never closed | Connections outlive the process on every deploy | Closing the app, then querying through the drizzle client — it still succeeded |
| **Email addresses were written to logs in the clear.** `REDACT_PATHS` covered credentials but not `email` | Personal data in log storage, outside redaction | Logging a real payload through the configured logger instead of checking the path list for strings |
| **Malformed geography points parsed as `NaN`.** The pattern admits `1.2.3`, `-`, `.` | A location that silently matches nothing | Four malformed inputs, all returned instead of rejected |

**Two stale behaviours corrected:**
- The health endpoint hard-coded `database: not_configured` — left from before T-003 — while
  the app used the database. It now does a real round trip with a 2-second bound; Redis stays
  `not_configured` because nothing uses it yet. Contract: `docs/api/health.md`.
- A `split(' ')[0] ?? ''` fallback in the error filter could never run. Replaced with an
  equivalent expression that has no unreachable branch.

**Structural changes made to test honestly rather than exclude:** process startup moved from
`main.ts` into `bootstrap.ts` (`configureApp` + `bootstrap`), so the security properties it
applies — no `X-Powered-By`, strict validation, OpenAPI absent in production — are asserted
against a real Nest application instead of being bootstrap code nobody checks.

**The exclusion, as applied.** A test-only transform in `apps/api/vitest.config.mts` marks the
`typeof X === "undefined" ? Object : X` guard `emitDecoratorMetadata` emits — same identifier
both sides, nothing else. Verified: branch paths 184 → 180, uncovered 41 → 39, lines and
functions unchanged, only the two affected files changed. Negative controls confirmed it does
**not** hide an uncovered user ternary, a look-alike guard with different identifiers, or a
ternary inside a decorator argument — the last of which Vitest's own broader SWC rule would
hide. SWC was considered and rejected: `unplugin-swc` and `@swc/core` were days old against the
pinning policy, and switching would have swapped the transformer under 169 passing tests.

**Also documented:** `docs/architecture/logging.md` — what is never written to logs and why.

**Validation** — all green 2026-09-14
```bash
pnpm --filter api test:coverage
```

---

### T-064 — Type-check and lint the test suite
- **Status:** DONE — 2026-09-23
- **Priority:** P1
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/tsconfig.json, apps/api/vitest.config.mts

**Description**
`apps/api/tsconfig.json` excludes `**/*.spec.ts`, so `pnpm typecheck` never sees the test
suite. This already cost real time during T-005: adding two constructor parameters to
`AuthService` left an existing spec calling it with the old signature, which the compiler
would have caught instantly but which instead surfaced as a runtime `TypeError` deep in a
test run. Test code is the thing asserting the production code is correct and is currently the
only unchecked code in the package — a spec can assert against a property that does not
exist and still pass.

The same exclusion means the transformer does not apply `experimentalDecorators` to spec
files, so Nest decorator syntax fails to parse inside a test. `auth.boot.spec.ts` works
around it by applying `Module(...)(cls)` and `Global()(cls)` as plain function calls; that
workaround should disappear once this is fixed.

Needs a separate `tsconfig.spec.json` so specs are checked without being emitted into `dist`.

**Acceptance criteria**
- [x] `pnpm typecheck` covers `**/*.spec.ts` — and `test/**`, and the vitest configs, in both
      packages that have specs; a spec guards that every such package keeps doing so
- [x] `dist/` still contains no spec output — none in any package's `dist`
- [x] A deliberate type error in a spec fails `pnpm typecheck` — and so does the T-005 case, a
      constructor called with the wrong number of arguments
- [x] Decorator syntax works in a spec; the `auth.boot.spec.ts` workaround is removed — and the
      three copies of it in `bootstrap.spec.ts`, `health.controller.spec.ts` and
      `legal.controller.spec.ts`

**Validation**
```bash
pnpm typecheck && pnpm --filter api build && test ! -e apps/api/dist/modules/auth/auth.boot.spec.js
```


**DONE — 2026-09-23**

`tsconfig.spec.json` beside each package's `tsconfig.json`: extends it, `noEmit`, includes specs,
helpers and the vitest config. **Bundler** module resolution, because Vite runs specs, not Node —
under Node16 the deliberate environment-first `await import('./app.module')` reads as an error and
drizzle's types load twice (five errors of the first 54 were that alone). Root `typecheck` is now
`tsc --build --verbose && pnpm -r typecheck:specs`. ESLint already covered specs; nothing ignored
them.

*54 errors on first run*, all in code that passed at runtime. Most were strictness — possibly
undefined reads, `exactOptionalPropertyTypes` meeting a deliberate `undefined`. The ones worth
knowing: `MediaService` constructed with 7 of its 8 arguments (the T-005 bug class; it passed only
because the missing one is not reached on that path); five execution contexts missing the
`sessionId` T-080 added; `platform-context.spec`'s "holds another scope" using `'SUPPORT'`, which
is not a scope, so it proved only that an unknown string is not `VERIFICATION` — now `MODERATION`;
and `authz.plumbing.spec` typing against a `schema.Db` that never existed.

*Checking the configs found `coverage.all`* in both, which Vitest 4 removed and had been ignoring.
The gate stayed honest — in Vitest 4, `include` counts untested files, verified by adding one and
watching the total fall below threshold — but the comment explaining the gate named the wrong
option. Removed, and the comment corrected. It also found a missing `override` on the T-042
reverse sequencer.

*Found by shuffling*: `scoped-client.spec` asserted "no context" on the raw
`current_setting()`, which is NULL on a fresh connection and '' on a used one, so it passed or
failed on pool history. It now asserts what policies read, `app_current_tenant()`, after giving the
connection that history on purpose — the old assertion fails 3 of 3 that way.

*Negative controls*: a type error in a spec, and the 7-of-8-arguments constructor, each fail
`pnpm typecheck`; removing `typecheck:specs` from a package with specs fails the guard.

*Evidence.* Validation command passes. 1641 tests, 100% coverage per package, lint and build
clean, shuffled order green.
---

### T-065 — Malware scanning for uploaded media
- **Status:** TODO
- **Priority:** P1 — **blocks any uploaded file being served to anyone**
- **Depends on:** T-008, T-082
- **Risk:** HIGH
- **Human approval required:** Yes — scanner choice and data handling
- **Owner agent:** backend-domain + infra-devops
- **Affected:** apps/api/src/modules/media/**, infrastructure/**

**Description**
T-008 gates every delivery link on `scan_status = 'CLEAN'` and fails closed. Nothing sets it:
no task owned scanning, so every upload stays `PENDING` and **no file is served — to its owner,
to staff, to anyone**. That is correct behaviour without a scanner, not a bug to work around.

Needs a decision first: a scanner (self-hosted ClamAV, a Cloudinary add-on, or a scanning
API), where file bytes go to be scanned — which is a data-transfer question for counsel when
the files are identity documents — and the job infrastructure to run it (BullMQ, not yet
wired).

**Tenancy (ADR-0011).** Scan jobs restore the uploading workspace's context (T-082).

**Acceptance criteria**
- [ ] Scanner chosen, with where the bytes are processed recorded for counsel
- [ ] A scan runs for every `READY` asset and moves it to `CLEAN`, `INFECTED` or `FAILED`
- [ ] `INFECTED` destroys the Cloudinary asset and marks the row, audited
- [ ] A scanner outage leaves assets `PENDING` — never defaulted to `CLEAN`
- [ ] Retries are idempotent; a re-scan cannot move `INFECTED` back to `CLEAN` without a recorded decision

**Validation**
```bash
pnpm --filter api test media
```

---

### T-066 — Mission attachments
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-010, T-008, T-065, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — staff access to customer material
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{media,missions,mission-policy}/**

**Description**
`plan.md` §10 lists attachments among a mission's fields, and the staff article instructs
moderators to **open them** — "a mission's text can read cleanly while an attached document is
the problem". T-010 shipped without them: screening reads text and structured answers only, and
there is nothing for a moderator to open. A mission cannot be properly reviewed until this
lands.

**Tenancy (ADR-0011).** Attachments are tenant-owned media of the customer's workspace, visible to suppliers only through the two-party mission policy.

**Acceptance criteria**
- [ ] Attachments withdrawn from use after a policy halt are marked, never erased — moved here from T-050
- [ ] A `MISSION_ATTACHMENT` media category with its own size, formats, visibility and retention
- [ ] Attachments belong to a mission and are authorised through the existing media flow
- [ ] **A mission with an unscanned or infected attachment cannot be published** — fails closed
- [ ] A moderator may open a mission's attachments; **every access is audited** — and the console's moderation page (`/moderation/[id]`, T-051) gains the section that opens them: moved here from T-051, which shipped before attachments existed
- [ ] Attachments are editable while the mission is a draft, frozen once submitted
- [ ] The "lawful but excessive" path is request-changes, not rejection — the more common case
- [ ] Retention rule recorded in `docs/compliance/retention.md`

**Validation**
```bash
pnpm --filter api test missions
```

---

### T-067 — Native-speaker review of the mission policy ruleset
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-010
- **Risk:** MEDIUM
- **Human approval required:** Yes — it is lawful-use policy detection
- **Owner agent:** backend-domain + a native speaker per locale
- **Affected:** apps/api/src/modules/mission-policy/mission-policy.rules.ts

**Description**
The deterministic ruleset covers English and Russian, written by me without domain or native
review. **Armenian is not covered at all** — an Armenian mission is still reviewed by a
moderator, it is simply not prioritised by its text, which is a queue-ordering gap rather than a
safety hole (the gate is closed either way).

**Acceptance criteria**
- [ ] Armenian patterns added for every rule id, by a native speaker
- [ ] Existing English and Russian patterns reviewed by someone with investigation-domain
      knowledge — both for wording that is missed and for wording that is over-caught
- [ ] A corpus of realistic missions that must NOT flag, tested — victims describing what
      happened to them use the same vocabulary as people requesting it
- [ ] `RULESET_VERSION` bumped; the version is what makes an old decision explainable
- [ ] False-positive and false-negative examples recorded alongside the rules

**Validation**
```bash
pnpm --filter api test mission-policy
```

---

### T-068 — Jurisdiction gate for restricted categories
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-010, T-053
- **Risk:** HIGH
- **Human approval required:** Yes — it is an ADR-0009 control
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{mission-policy,missions}/**

**Description**
ADR-0009 offers partner and relationship investigation under controls, and the first is a
**jurisdiction gate**: "available only where the work is lawful. The platform does not offer it
everywhere it has users." That gate does not exist. T-010 screens such missions as `RESTRICTED`
and routes them to a moderator every time, so nothing unlawful publishes automatically — but
the moderator is currently the whole control, which ADR-0009 did not intend.

**Acceptance criteria**
- [ ] Per-country configuration of which risk bands and categories are offered at all
- [ ] A mission in a country where the category is not offered is refused at submission, with a
      reason the customer can act on — not silently queued
- [ ] Configuration is staff-managed and audited, never a code constant
- [ ] The other ADR-0009 controls are checked against the implementation and any further gaps
      filed: licensed-for-surveillance verification (T-013), defined scope and duration
- [ ] A test proves a restricted mission cannot publish in a country where it is not offered

**Validation**
```bash
pnpm --filter api test mission-policy
```

---

### T-069 — The suite is flaky under its own parallelism
- **Status:** DONE — 2026-09-19
- **Priority:** P0 — gates Phase 4b (tenancy adds many database-heavy tests to a suite that is already flaky); it was P1 because it makes CI untrustworthy
- **Depends on:** —
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain + infra-devops
- **Affected:** apps/api/vitest.config.mts, apps/api/test/{db,db-budget,http,setup-http}.ts, 28 database specs, 13 HTTP specs, apps/api/src/modules/auth/password.service.spec.ts

**Description**
Three consecutive full-suite runs during T-010 failed three **different, unrelated** tests, each
passing on its own: `app.module.spec.ts` and two mission tests timed out at the 5s default, and
`password.service.spec.ts`'s timing-oracle ratio came out at 5.58 against a `< 5` assertion.
Sixty-odd spec files run in parallel against one PostgreSQL, and the machine is the variable.

T-010 raised `testTimeout`/`hookTimeout` to 15s, which addresses the timeout class. It does
**not** address the timing-ratio assertion, which measures relative duration and so gets worse
the busier the box is.

A suite that fails a different test each run teaches people to re-run rather than to read the
failure, and that habit is what lets a real regression through.

**Acceptance criteria**
- [x] The timing-oracle test is made robust without weakening what it asserts — it exists to
      prove the decoy hash closes an account-enumeration oracle, and that property must still
      be tested. Median of several samples, or a comparison that is not a raw wall-clock ratio
- [x] Database-backed specs do not exhaust connections or serialise unpredictably — decide
      deliberately between a connection cap, a shared pool, and limited file parallelism
- [x] Ten consecutive full-suite runs, green, recorded as the evidence
- [x] CI runs the same configuration as a developer machine, so a flake is reproducible

**How each was verified**

| Criterion | Evidence |
|---|---|
| Timing oracle, not weakened | The old test timed the decoy's **first** call, which also computes the decoy hash, so it sat at ~2x before any noise: measured median 2.01x, **worst 4.55x under load** (5.58x once in T-010). It now warms the decoy up and compares medians of 7 interleaved pairs: median 1.01x, worst 2.16x under the same load. The `< 5` bound is unchanged. **A structural test was added**, with no clock: the decoy is verified against a hash with the same argon2 algorithm and cost parameters as a real one |
| Connections, decided | **Fixed at 4 workers** (CI's runner has 4 vCPUs), taken from `test/db-budget.ts`. Every spec opens pools through `testPool()`, capped at 4. The worst case is 4 × 18 = 72 against 77 usable (100 minus 3 reserved minus 20 headroom). `connection-budget.spec.ts` checks it against the live server, statically forbids a spec opening its own pool, and checks each file stays within budget. Before: machine-derived workers (10 on a laptop), pools of up to 8, worst case 92 of 97 — and T-073's second pool would have exceeded it |
| Ten consecutive runs | **10/10** with coverage on the final code, 1,118 tests at 100% on all four metrics, 25–26 s each (up from ~16 s on 10 workers: the price of reproducibility). Plus **8/8** full runs under 12 CPU burners |
| Same configuration as CI | CI runs `pnpm test:coverage`, the same config: the worker count and the HTTP setup file live in `vitest.config.mts`, not the command line |

**A bug the task did not know about.** Under load, a test's HTTP request could be **answered by the previous test's app**. Supertest, handed an app that is not listening, listens and closes a server around every request. Node's global agent keeps sockets alive, so a socket to a closing server can survive and be reused when the next test's server gets the same ephemeral port. Measured before and after, with 60 loaded runs of the controller specs each:

| | Failures | What failed |
|---|---|---|
| Before | **4 / 60** | Four different specs: three got another app's **404**, one hung for 15 s |
| After | **0 / 60** | — (if the rate were unchanged, 60 clean runs would have a 1.6% chance) |

Reproduced deterministically first, 20/20 with plain Node servers. `http-harness.spec.ts` carries it as a regression test, **seen to fail** ("expected 'old' to be 'next'") before the fix. The fix has two parts:

- every HTTP spec uses `listenOnce` and `closeApp` (`test/http.ts`)
- test clients run with keep-alive off (`test/setup-http.ts`)

A static spec keeps both in place.

**Negative controls** — each rule broken on purpose, tests watched fail, files restored byte-for-byte:

| Control | Result |
|---|---|
| A no-op decoy | 2 fail — the structural and the timing test |
| A decoy at about a fifth of the memory cost | **1 fails — only the structural test.** The timing bound let a cheaper decoy through; this is why the structural test exists |
| `MAX_WORKERS = 10` | 1 fails — "expected 180 to be less than or equal to 77" |
| A spec opening its own pool of 20 | 1 fails — the file is named |

**Found and filed, not fixed:** the decoy's first call per process costs about twice a real verification (T-129). Fixing it changes authentication code, which needs approval.

**Documentation:** the `testing` skill gains "Databases, HTTP and timing". Every helper explains the failure it exists to prevent.

**Validation**
```bash
cd apps/api && for i in $(seq 1 10); do pnpm exec vitest run || break; done
```

---

### T-070 — Staff verification console (admin-web)
- **Status:** DONE — 2026-09-26
- **Priority:** P2
- **Depends on:** T-013, T-014, T-079
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** admin-web
- **Affected:** apps/admin-web/**

**Description**
The screens for the API T-013 built: the queue (oldest first, cursor-paginated), one application
with its recorded declaration, documents and full decision trail, opening a document through the
audited per-application link, and the decision form (outcome + required reason). Mobile-first per
`responsive-design`: the queue is a card list on a phone, the decision form a sheet.
Endpoints and rules: `docs/architecture/verification.md`.

**Tenancy (ADR-0011).** Reviewer routes run inside `PlatformContext` (T-079) once it lands.

**Acceptance criteria**
- [x] Every screen reachable only with the VERIFICATION scope; the API refuses regardless
- [x] Documents open only through `/verification/requests/:id/documents/:assetId/delivery-url`;
      the link is never cached, stored or shown as text
- [x] The declaration shown is the one recorded on the application, not the live profile
- [x] The decision form cannot submit without a reason; the refusal of one's own application is
      shown as such
- [x] admin-web has a `test` script, and it runs in CI

**Validation**
```bash
pnpm --filter admin-web test && pnpm --filter admin-web build
```

**DONE — 2026-09-26**

*What exists.* admin-web gains staff sign-in (the API's own login, same-origin at `/api`, so the
session cookie is this host's — no auth code changed), a console layout (no session → sign-in with
`next`; not STAFF → "staff only"), a one-bar shell, the queue (cards, oldest first, cursor pages,
403 shown as the missing scope) and one application: the declaration **as recorded**, specialties
named from the taxonomy (a retired one shown as such), documents (only CLEAN ones openable; PENDING,
INFECTED and FAILED say why), the full trail, and the decision in a sheet (bottom on a phone, right
from `md`). Documents open through the audited route into a tab opened on the click and cut off from
the console; the link is never rendered, kept or cached; a blocked tab asks for no link. Your own
application shows a notice instead of the form. No API changes. Components copied from app-web,
already re-tokenised.

*Found along the way.* (1) `pattern` does nothing on a `<textarea>`, so a reason of spaces would
have reached the API; the form refuses it itself. (2) A blocked tab would still have fetched a link —
an audited opening of a document nobody saw. (3) Nothing grants STAFF or a staff scope except SQL:
filed as T-152 (approval — authorization); the dev-only SQL is in `admin-web.md`.

*Negative controls* (each seen to fail, then restored): the opened tab able to reach back; a link
asked for when the tab was blocked; a reason of spaces sent; a decision offered on one's own
application; non-staff let into the console; any `next` followed after sign-in; a document opened
whatever its scan.

*Verified.* Lint, typecheck, `pnpm --filter admin-web test && build` (88 tests, 100%), budget (all
5 routes < 250 kB; the application page 147.6 kB). CI runs it (`pnpm test:coverage`). In the browser:
the signed-out path only (`/` → `/sign-in?next=/verification`, no console errors) — **the signed-in
screens were not seen in a browser**: the agent cannot sign in, and the owner closed the task before
trying them. Dev data for trying them is seeded (see the handoff). Specs cover sheet direction,
focus, and every state.

*Docs.* `admin-web.md` (sign-in, shell, verification, dev cookie note, granting access), 
`verification.md` (the console), staff article `kb-staff-verification-review` v4 (ru/hy drafts in
step), component inventory, T-152.

---

### T-071 — Scope-level verification
- **Status:** TODO
- **Priority:** P1 — a verified investigator's later additions are currently live without review
- **Depends on:** T-013, T-087
- **Risk:** HIGH
- **Human approval required:** Yes — changes who discovery lists and who may quote
- **Owner agent:** backend-domain + database
- **Affected:** apps/api/src/modules/{verification,search,quotes,service-areas,profiles}/**, migrations

**Description**
Verification is profile-wide (T-013). `kb-staff-verification-review` specified approving part of
a declaration, and `kb-investigator-verification` that additions are reviewed while existing scope
stands. Neither can be honest until verification is tracked per specialty and per service area,
and discovery and quoting filter on it. Until then, an area or specialty added after verification
is immediately discoverable under the existing verification.

**Tenancy (ADR-0011).** Profiles belong to workspaces from T-087. Scope-level verification attaches to the profile, and an agency's added areas follow the same rule.

**From T-087:** applying for verification goes through the holder's own route, which needs
`investigators.update` — in an agency only OWNER and ADMIN hold it, so an agent cannot apply for the
profile the agency holds for them, and the agency has no route to apply on their behalf. Decide who
applies for an agency-held profile, and whether any part of the person's own verification carries
over (today none does).

**Acceptance criteria**
- [ ] Verification recorded per specialty and per area, each traceable to the decision that granted it
- [ ] A decision can approve part of a declaration and reject the rest, with reasons
- [ ] Discovery and quoting consider only verified scope; an unverified addition is not listed
- [ ] Both KB articles updated from "not yet" to the real behaviour

**Validation**
```bash
pnpm --filter api test verification search quotes
```

---

### T-072 — Verification documents: expiry, lapse and required sets
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-013, notifications, T-036
- **Risk:** MEDIUM
- **Human approval required:** Yes — which documents each jurisdiction requires is a compliance decision
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/verification/**, background jobs

**Description**
Specified in the KB, not built: expiry dates on verification documents, reminders before expiry,
the automatic lapse of verified status when a required document lapses (assignments in progress
continue), and the list of required documents per jurisdiction and specialty shown to applicants.
Also decision notifications, once a notification channel exists.

**Tenancy (ADR-0011).** Expiry reminders are tenant-aware notifications (T-036); lapse jobs restore context (T-082).

**Acceptance criteria**
- [ ] Expiry recorded per document; a lapse moves the profile out of VERIFIED through the
      verification service, audited, with the reason
- [ ] Reminders sent before expiry, idempotently
- [ ] Required documents per jurisdiction/specialty are data, not code
- [ ] Both KB articles updated

**Validation**
```bash
pnpm --filter api test verification
```

---

## Phase 4b — Workspaces, agencies and tenant isolation (ADR-0011, ADR-0012, plan.md §29)

Agencies become organisations on the platform, and workspaces are isolated by PostgreSQL rather
than by application filters alone. Design: `docs/architecture/tenancy.md`. Procedure:
`.claude/skills/tenant-isolation/SKILL.md`. Owner decisions taken on 2026-09-19:

- ADR-0009 stands
- every workspace is a tenant
- this phase goes **next, before new features**
- billing is planned but not decided

**Order (revised 2026-09-19, plan.md §26 "Delivery order").** T-069 first, because this phase
adds many database-heavy tests to a suite that is already flaky. Then:

- **Foundation, now:** T-073 → T-074 → T-075 → T-076 → T-077 → T-078 → T-079 → T-080
- **Then the Core loop section.** T-091 (app-web foundation) moves there. The foundation is
  enough for it: T-076 already makes profiles, quotes and assignments workspace-owned, so a
  Personal workspace behaves exactly as today.
- **Then agencies:** T-083 → T-084 → T-085 → T-086 → T-087 → T-088 → T-089 → T-090, then UI
  T-092 → T-093 → T-094. T-087 and T-089 add the agency parts (profiles for members, staffing)
  to what the core loop already built
- **Validation:** T-098 after the foundation, and again when agencies land

T-081 and T-082 land with their first consumer. T-095 to T-097 land as Phase 7 is built. The
foundation (T-073 to T-080) changes no behaviour for anyone who never creates an agency: every
existing test must pass unchanged at every step.

---

### T-073 — Runtime connects as the non-bypass application role
- **Status:** DONE — 2026-09-19
- **Priority:** P0 — until this lands, every row-level security policy is decorative
- **Depends on:** T-069
- **Risk:** HIGH
- **Human approval required:** Yes — security control and infrastructure change. **Approved 2026-09-19** as designed: boot refusal everywhere including local, and `setup.sh` migrates existing `.env.local` files
- **Owner agent:** infra-devops + database
- **Affected:** apps/api/src/database/**, apps/api/test/**, .env.example, .github/workflows/pr.yml, infrastructure/compose/**, scripts/setup.sh

**Description**
The API, the tests and CI all connect as `postgres`, a superuser. Superusers and table owners
bypass row-level security, so a policy would pass its own tests while protecting nothing. The
split is:

- `DATABASE_URL` is the runtime role `investigator_app`: `NOBYPASSRLS`, owns nothing.
- `MIGRATION_DATABASE_URL` is the owner.

Integration tests use two pools. Fixtures are written by the owner; the code under test runs
as the application role. The role's password stops being a literal in migration 0000 for
non-local environments. `scripts/setup.sh` and CI set it from the environment, which is
automated rather than a manual step.

**Acceptance criteria**
- [x] The API refuses to boot if its role is a superuser, owns any table, or has `BYPASSRLS`, and a test proves it
- [x] Every existing spec passes with the code under test on `investigator_app`; any missing grant surfaces here, not later under RLS
- [x] CI runs the same split; coverage stays at 100%
- [x] No non-local credential committed; setup is scripted, not an `ACTIONS-FOR-ME` item
- [x] `docs/architecture/tenancy.md` §7 "Roles" marked built

**How each was verified**

| Criterion | Evidence |
|---|---|
| Refuses to boot as a privileged role | `RuntimeRoleCheck` runs at application bootstrap. It refuses a superuser, `BYPASSRLS`, a role owning any table, and a role that can `SET ROLE` into either. It is tested against **real roles**, each built in a rolled-back owner transaction and entered with `SET LOCAL ROLE`. A Nest app wired with the owner's credentials fails `init()` |
| Every spec passes as `investigator_app` | 1,127 tests at 100% on all four metrics. **Measured first:** with everything as the app role, no grant was missing from any real application path. The 94 failures were 93 fixture taxonomy inserts (platform data the app may not write) and one schema test that the revoked privilege reached before the foreign key it tests. The split: 231 fixture calls in 9 specs, and 13 schema specs, move to the owner. A spec asserts each pool's `current_user` |
| CI runs the same split | `MIGRATION_DATABASE_URL` is the owner. After migrating, a step generates a per-run password, masks it, sets it with the script, and only then defines `DATABASE_URL` as `investigator_app`. Replayed locally on a fresh database: 11 migrations from empty, the app role connected, `superuser=false`, `bypassrls=false`, and DDL was refused |
| No non-local credential committed | The password comes from `APP_DB_PASSWORD`, through psql's `\getenv` (never the command line) and psql's literal quoting. A 55-character password containing `'; ALTER ROLE investigator_app SUPERUSER; --` was stored literally and logged in, with superuser still false. Passwords under 24 characters are refused. `setup.sh` migrates an existing `.env.local` idempotently and prints no values; tested twice on a copy |
| Documentation | `tenancy.md` §7 marked built. T-041 gains the deploy criterion (the API environment never holds the owner's credentials). `.env.example`, the `testing` skill |

**Negative controls** — each rule broken on purpose, tests watched fail, files restored byte-for-byte:

| Control | Result |
|---|---|
| Remove `RuntimeRoleCheck` from the module | 1 fails — the owner boots |
| `testPool()` silently uses the owner | 2 fail — the role check and the pool-identity spec |
| Ignore role membership, direct ownership only | 2 fail — both "can SET ROLE into" cases |

**Worth knowing:** roles are cluster-wide. On a shared Postgres server, every database shares one
`investigator_app` password; CI's is its own server.

**Validation**
```bash
pnpm --filter api test:coverage
```

---

### T-074 — Workspaces and memberships, and a Personal workspace for every user
- **Status:** DONE — 2026-09-19
- **Priority:** P0
- **Depends on:** T-073
- **Risk:** HIGH
- **Human approval required:** Yes — the authorization model. **Approved 2026-09-19:** a database trigger creates the Personal workspace (the repo's first triggers), and the owner rules are enforced by the database now, with T-085's service adding friendly errors later
- **Owner agent:** database + backend-domain
- **Affected:** apps/api/src/database/**, apps/api/src/modules/{auth,tenants}/**, migrations

**Description**
This task adds the following tables:

- `tenants`: kind `PERSONAL | AGENCY`, lifecycle `CREATING/ACTIVE/SUSPENDED/ARCHIVED/DELETED`
- `tenant_memberships`: `ACTIVE/SUSPENDED/REMOVED`
- the permission catalog: `permissions`, `roles`, `role_permissions`, `membership_roles`,
  seeded as data from `tenancy.md` §3
- `user_sessions.default_tenant_id`

Every existing user gets a Personal workspace and an OWNER membership. Registration, and
first OAuth sign-in (T-062), create them in the same transaction as the user. RLS does not
start here.

**Acceptance criteria**
- [x] Exactly one PERSONAL workspace per user, held by a constraint, and a Personal workspace can never gain a second member
- [x] System roles and permissions seeded by migration and immutable; the matrix in `tenancy.md` §3 is asserted against the seed
- [x] The last OWNER of a workspace cannot be removed or demoted
- [x] Backfill proven on a copy of the dev data (zero users without a Personal workspace), and the migration is reversible
- [x] Retention rows for every new table

**How each was verified**

| Criterion | Evidence |
|---|---|
| Exactly one Personal workspace, one member | A trigger creates it in the same statement as the user, **tested as `investigator_app`**, so registration works with the runtime role's own privileges and never elevated ones. A unique index refuses a second. A trigger refuses any member but the owner, and a partial unique index refuses a second member even with that trigger disabled |
| Catalog seeded and immutable; matrix asserted | 40 permissions, 6 roles and 134 grants, generated from `tenancy.md` §3. The spec parses that table and compares it with the database role by role. The application role can only `SELECT` the catalog |
| Last OWNER protected | A deferred constraint trigger refuses, at commit, removing the OWNER role, suspending, removing or deleting the last owner, of an agency or a Personal workspace. Ownership can move within one transaction |
| Backfill on a copy of dev data | **40,815 users** in the copy: 40,815 Personal workspaces, **0 users without one**, 40,815 OWNER memberships, 0 sessions without a default workspace. Reversible (`0011_add_workspaces.down.sql`; not executed, because the guard hook blocks `DROP` through a client) |
| Retention rows | `tenants`, `tenant_memberships`, `membership_roles`, and the catalog |

**Found on the way, each caught by a test:**

1. **Race: concurrent owner removals left a workspace ownerless.** Two transactions each removing a different owner each saw the other still there, uncommitted, and both committed. The check now locks the workspace row first. The first version of the test **passed without the lock**, because the checks rarely overlapped. It now forces them to (both check, then both commit): **5/5 fail without the lock, 5/5 pass with it.**
2. **A CHECK that passed on NULL again.** `name ~ '\S'` is NULL for a NULL name, and a NULL CHECK passes, so an agency with no name was accepted. That is the same class as T-013's. `name IS NOT NULL` is now explicit.
3. **A foreign key checked too early.** A per-statement `NO ACTION` check on memberships ran before the user → Personal workspace → membership cascade, refusing to delete even a user with nothing else. It is now deferred to commit, and an agency membership still blocks the delete (tested).
4. **A five-minute migration.** Row-level owner checks fired once per backfilled workspace: over 5 minutes on the 40,815-user copy, holding locks. The backfill now runs before those triggers exist and asserts the invariant once, set-based: **1 second**.

**Negative controls** — each rule broken on purpose, tests watched fail, restored:

| Control | Result |
|---|---|
| Owner check without its lock | the race test fails 5/5 (two commits, nobody left) |
| Personal-workspace trigger disabled | 19 fail across the schema and auth specs; sign-in itself breaks |
| `tenancy.md` §3 drifts from the seed (VIEWER loses `teams.read`) | 1 fails, naming VIEWER. (Deleting the grant from the database instead was blocked by the guard hook, correctly) |

**For T-077, now a criterion there:** registration runs the trigger before any workspace context exists, so RLS on these tables must let exactly that through.

**Open, noted in `tenancy.md` §3:** as the matrix stands, "Staff" and "Viewer" grant identical permissions.

**Verification:** 1,163 tests, 100% on all four metrics. Lint and typecheck clean. `drizzle-kit generate` reports no drift.

**Validation**
```bash
pnpm --filter api test tenants auth
```

---

### T-075 — Execution context and workspace resolution
- **Status:** DONE — 2026-09-19
- **Priority:** P0
- **Depends on:** T-074
- **Risk:** HIGH
- **Human approval required:** Yes — authorization plumbing. **Approved 2026-09-19** as designed, with the fallback to Personal when a request names no workspace and the session default is no longer usable
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/{context,authz}/**, apps/api/src/database/**, apps/api/src/modules/tenants/**

**Description**
The context and its resolution:

- `ExecutionContext` lives in `AsyncLocalStorage` and is frozen.
- `WorkspaceResolver` runs after `ActorGuard`. It takes `X-Workspace` intersected with the
  ACTIVE memberships read now, falls back to the session's `default_tenant_id`, and refuses a
  suspended or archived workspace.
- A **driver-level wrapper** makes every transaction and every bare query begin with
  `set_config('app.tenant_id' | 'app.user_id' | 'app.membership_id', …, true)`.
- The unscoped path has an allowlisted set of callers: pre-authentication identity lookups
  and system workers.
- `GET /workspaces` lists the caller's workspaces, and `POST /workspaces/:id/activate` sets
  the default.

**Not** a request-wide transaction: it would roll back `AuthzService`'s denial audit rows
(ADR-0011 §4).

**Acceptance criteria**
- [x] A header naming a foreign workspace → 403, audited; a removed or suspended member is refused on their next request
- [x] Pooling: on one reserved connection, tenant A then tenant B — the settings read empty after commit and nothing carries over; concurrent A/B requests on a pool of two never cross
- [x] Regression: a denied request that then fails still leaves its denial audit row
- [x] Static specs: no service, repository or domain method takes `tenantId`; only allowlisted callers use the unscoped path
- [x] `authorization.md` documents check 0

**How each was verified**

| Criterion | Evidence |
|---|---|
| Foreign workspace refused; removed or suspended member refused next request | `WorkspaceResolver` intersects `X-Workspace` with ACTIVE memberships in usable workspaces, read on the request. Tests: someone else's Personal workspace, a missing id and a malformed header each get 403 with an audit row (`workspace_not_available`); SUSPENDED and REMOVED members are refused on their next request; SUSPENDED and ARCHIVED workspaces are refused to everyone; CREATING admits its owner. **End to end** through AppModule: a foreign header is refused before the handler runs |
| Pooling | On **one connection**: tenant A's query commits, the next query outside any context reads `''`, then tenant B's reads B. **60 interleaved queries** across two contexts on a two-connection pool, a third of them in transactions: zero crossings |
| Denial audit survives a failed request | End to end: a request denied *inside a transaction that rolls back* still leaves its `authz.denied` row — the reason there is no request-wide transaction |
| Static specs | `tenant-plumbing.spec.ts` parses the source with the TypeScript compiler: no `tenantId` / `workspaceId` parameter or DTO field anywhere, and the raw pool is reachable only from `database.module.ts`. **It caught my own first draft**: two methods taking a client-named workspace, now named `requested` so a candidate is never mistaken for the context |
| `authorization.md` | Check 0 documented; `tenancy.md` §6 marked built |

**End to end** (`context.e2e.spec.ts`): cookie → ActorGuard → WorkspaceResolver → ContextInterceptor
→ scoped client → PostgreSQL, through the real AppModule, with a probe controller asking the database
what context it sees: Personal by default, the agency when `X-Workspace` names it — tenant, user and
membership all correct.

**Measured cost:** **+0.73 ms per bare query** locally (0.19 → 0.93 ms), for the `BEGIN; set_config; …;
COMMIT` each needs. Pipelining the settings with the query saved only 0.02 ms locally, so it was not
taken; it is the first optimisation to try if latency shows up (ADR-0011 "revisit when").

**Found on the way:**
- **Lazy queries.** A drizzle query built inside a context but awaited outside it runs with *no*
  context. The first draft of a test did exactly that. Services await inside, so it cannot happen on
  the request path; a test pins the behaviour (no context → no rows under RLS, the safe direction),
  and the `tenant-isolation` skill says to await inside.
- **Spec files were compiled without legacy decorators** — `tsconfig.json` excludes them — so a spec
  declaring its own controller could not parse parameter decorators. Vitest's transformer now uses
  the same decorator settings as the build, for every file.

**Negative controls** — each rule broken on purpose, tests watched fail, files restored byte-for-byte:

| Control | Result |
|---|---|
| `set_config(…, false)` — session-level, the pooled-connection bug | 4 fail, including "never carries a context over on a reused connection" |
| The resolver ignores who the member is | 5 fail, including the end-to-end refusal |
| The context interceptor unregistered | 3 end-to-end tests fail |
| A service method taking `tenantId` | the static spec names the file and line |

**Verification:** 1,216 tests, 100% on all four metrics. Lint and typecheck clean.

**Validation**
```bash
pnpm --filter api test context tenants authz
```

---

### T-076 — Tenant and party columns on existing tables (expand and backfill)
- **Status:** DONE — 2026-09-19
- **Priority:** P0
- **Depends on:** T-075
- **Risk:** HIGH — touches quotes and assignments
- **Human approval required:** Yes. **Approved 2026-09-19:** values from the context, else from the row's own data (party columns always from the parent); consistency by composite foreign keys, and no row ever changes workspace
- **Owner agent:** database
- **Affected:** apps/api/src/database/**, migrations, docs/compliance/retention.md

**Description**
Columns for every existing table per the classification in `tenancy.md` §7:

- `tenant_id` on tenant-owned rows
- `customer_tenant_id` and `supplier_tenant_id` on marketplace rows

The party ids are denormalised so that no policy has to join. Backfill per `tenancy.md` §5:

- investigator profiles → the owner's Personal workspace
- missions → the customer's Personal workspace
- quotes and assignments → supplier = the lead investigator's Personal workspace

Then set `NOT NULL` and `DEFAULT app_current_tenant()`, and lead the indexes with the tenant
or party column. Two constraints change:

- `investigator_profiles` becomes `UNIQUE (tenant_id, user_id)`
- `idempotency_keys` includes the tenant in its unique key

**Acceptance criteria**
- [x] Zero NULLs after backfill, asserted by the migration itself
- [x] The classification registry covers every table; a spec fails on an unclassified table
- [x] Every existing test passes unchanged; the migration is reversible; applies from empty
- [x] Discovery's `EXPLAIN` spec (T-011) still uses its indexes

**How each was verified**

| Criterion | Evidence |
|---|---|
| Zero NULLs, asserted by the migration | The migration ends its backfill with a `DO` block that raises on any row without a workspace. **On a copy of the dev data it caught a real bug** (below). After the fix, on that copy: 15,847 profiles all in their user's Personal workspace; 8,205 missions all with the customer's; 2,760 quotes all with their lead profile's supplier; 779 assignments all with their quote's parties. Adding the 19 composite keys validated every backfilled row against its parent. 1 second |
| Registry covers every table | `table-classes.ts` classifies all 33 tables. The spec fails on an unclassified or vanished table, a missing or wrongly nullable column, a table without the move-guard, or a missing leading index |
| Tests pass; reversible; from empty | 1,236 tests pass. **Two tests changed, deliberately:** the two query-plan specs seeded users, profiles and service areas in *one* chained statement, and a statement cannot see the rows it inserted itself, from which each row's workspace is derived. They now seed in three statements, as the application does. Four schema-shape specs updated to the new keys. Down path written. Applies from empty on a fresh database (13 migrations, 35 triggers); `drizzle-kit generate` reports no drift |
| Discovery `EXPLAIN` | Both plan specs pass against the new schema |

**Found by the migration's own assertion.** Assignment creation (the payment-confirmation path)
claims its idempotency key as a **system actor that is not a user**. Under the fill rule, that key
would have had no workspace and violated `NOT NULL`, so creating an assignment would have failed
once payments are live. A system action now belongs to **no** workspace: `tenant_id` is NULL,
`NULLS NOT DISTINCT` keeps duplicate system claims colliding, and the migration asserts that NULL
occurs only for actors who are not users. The replay lookup and the completion also match actor,
endpoint and key only, which would reach the same key claimed in another workspace. Both now match
the workspace through the same database function the insert uses. **Negative control: without
that, one workspace replayed the other's stored response.**

**Behaviour tests** (`tenancy-columns.spec.ts`, as the owner, rolled back):
- owner columns take the context, else Personal
- copied parties come from the parent even when a *different* context is set
- a quote gets its mission's customer and its profile's supplier
- an assignment created with **no context**, as a payment would, gets exactly its quote's parties
- the composite key refuses a mismatch with the fill trigger disabled
- rows cannot move between workspaces
- idempotency keys are separated per workspace, and `null` for the system

**Negative controls** — each rule broken on purpose, tests watched fail, restored:

| Control | Result |
|---|---|
| Idempotency lookups without the workspace match | 1 fails: a workspace replays another's response |
| The quote's copy-from-mission trigger disabled | the schema test and 3 quote service tests fail |
| A table removed from the registry | "classifies every table" names it |
| A profile's move-guard disabled | "refuses to move a profile" fails |

**For later tasks, now criteria there.**
- **T-077:** the fill triggers read parent rows with the writer's privileges, so each copy path must still work under RLS.
- **T-078:** owner columns take the active workspace, so customer actions must be refused outside a Personal workspace.

**Validation**
```bash
pnpm --filter api test && pnpm --filter api migration:run
```

---

### T-077 — Row-level security policies and the isolation matrix
- **Status:** DONE (2026-09-20)
- **Priority:** P0
- **Depends on:** T-076
- **Risk:** HIGH
- **Human approval required:** Yes, plus a `security-privacy` review before merge — design approved 2026-09-19/20
- **Owner agent:** database; review by security-privacy
- **Affected:** migration 0013, apps/api/src/database/**, apps/api/src/common/context/**, apps/api/test/isolation/**

**What shipped**

Migration `0013_add_row_level_security`: **34 policies over 20 tables**, every one `ENABLE`d and
`FORCE`d, plus `app_current_user()` and `app_platform_access()`.

| Class | Policy |
|---|---|
| Tenant-owned (11 tables) | `tenant_rw` — the workspace, or platform access |
| Public projections | `investigator_profiles` when PUBLISHED; its languages, specialties, availability and service areas through an `EXISTS` on the published profile; `customer_profiles` to any workspace (today's behaviour, kept — owner decision) |
| Two-party (6 tables) | `parties` — either side, or platform access. `missions` adds `quoted_read` (any workspace while QUOTED) and `supplier_read` (a workspace that quoted on it) |
| Tenancy (3 tables) | a user's own memberships and the workspaces they are in; a Personal workspace, its owner membership and that membership's OWNER role may be created by the person themselves and by no one else |

**Three things have no workspace of their own, and each got exactly one way through**
- **Choosing one.** `runAsUser(userId, fn)` sets `app.user_id` and no workspace: the resolver and
  login read the caller's own memberships and nothing else. It sets aside any workspace it is
  called inside, so the read is the same wherever it is made.
- **Registration.** `create_personal_workspace` acts as the person it is creating for its own
  three inserts and restores what was there.
- **Crossing on purpose.** `PlatformContext.asStaff` / `.asSystem` — the only setters of
  `app.platform_access`. Verification queue, review, decision and document delivery, and
  assignment creation from a payment, now run inside it.

**Two real defects the work surfaced**
- **Login read the Personal workspace with no context at all** — it would have returned nothing
  the moment policies existed. Now inside `runAsUser`.
- **The tenancy owner check failed *open*.** `assert_tenant_has_owner` returns early when it
  cannot see the workspace row, so under the writer's own visibility it would skip itself. It and
  `assert_personal_member_is_owner` now read with platform access, declared as a `SET` clause on
  the function; `rls.spec.ts` asserts those two functions and no others raise it.

**Discovery lost its GIST index, and got it back** (owner decision, 2026-09-20). A table with
policies evaluates its security quals before any user qual that is not `LEAKPROOF`, and PostGIS
does not mark `ST_DWithin` leakproof — so `service_areas_area_gist` stopped being reachable.
Measured on 10,000 published profiles: **392 ms**, against 5 ms before. The migration marks four
PostGIS predicates leakproof (3 ms), warns instead of failing where it is not superuser, and
`rls.spec.ts` fails rather than let a database serve discovery 80× slower unnoticed
(ACTIONS-FOR-ME #19). Accepted residual: an error or timing inside those functions could say
something about an **unpublished** profile's coordinates.

**Tests** — 1397 passing, 100% coverage.
- `test/isolation/isolation-matrix.spec.ts`: **127 cases generated from the registry**. Per scoped
  table, from another workspace and from no context: read, change, delete and write-into are all
  refused, and a write that names another workspace is checked not to have landed there. Plus the
  recursion check, the projections' positive cases, platform access, pre-workspace reads and
  registration.
- `test/isolation/fill-triggers.spec.ts`: every copy path as `investigator_app` — a supplier
  quoting a QUOTED mission, the system creating an assignment, a child from its profile, a
  reviewer's decision, an owner column from the context — and the two refusals: a mission the
  supplier cannot see, and a child written onto someone else's published profile.
- `src/database/rls.spec.ts`: RLS state per class, the deferrals with their reasons, the platform
  tables read-only, `NULLIF` semantics, the leakproof marking, the two elevated functions.
- `platform-context.spec.ts`, `tenant-plumbing.spec.ts` (only PlatformContext raises access; the
  callers of it and of `runAsUser` are listed), `execution-context.spec.ts`, `scoped-client.spec.ts`.
- The existing suite runs the way a request runs: `scopedDb()` plus `asRequests(service, ownerSql)`
  (`test/workspace-context.ts`). 21 spec files migrated.

**Negative controls** — each opened on purpose, the matrix watched fail, restored and diffed:

| Control | Result |
|---|---|
| `tenant_rw` on `investigator_profiles` → `USING (true)` | 4 fail, all on that table |
| `parties` on `quotes` → `USING (true)` | 4 fail, including "each party its own side" |
| `own_or_workspace_read` on `tenant_memberships` → `USING (true)` | 5 fail — `membership_roles` too, which proves it delegates |
| `st_dwithin` marked `NOT LEAKPROOF` | `rls.spec.ts` and the discovery plan test fail |

Migration verified from scratch on a probe database and reversed: down leaves 0 policies, 0
functions and the original trigger body; re-applying gives back 34.

**Deviations recorded in `tenancy.md` §7**
- `audit_logs` has no policies until **T-080** adds its workspace column; `outbox_events` until **T-082**.
- Identity tables stay without policies pending **T-098**.
- `customer_profiles` is readable from any workspace, as it was before.

**For later tasks, now criteria there.** T-079 (audit every entry, typed reasons, moderation),
T-080 (`audit_logs` policies), T-082 (`outbox_events` policies), T-098 (identity tables,
narrowing the customer card).

**Validation**
```bash
pnpm --filter api test isolation && pnpm --filter api test:coverage
```

---

### T-078 — Tenant permissions in authorization
- **Status:** DONE (2026-09-20)
- **Priority:** P0
- **Depends on:** T-077
- **Risk:** HIGH
- **Human approval required:** Yes — authorization logic; design approved 2026-09-20
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/authz/**, apps/api/src/modules/{missions,quotes,assignments,profiles,service-areas,verification}/**, docs/architecture/authorization.md

**What shipped**

`AuthzService.requirePermission(actor, permission, ctx)` — **check 3b**, beside the platform-role
check rather than instead of it. The platform role says what someone *is*; the tenant permission
says what their membership lets them do *here*. It reads the list the resolver already filled for
this request, so a revoked permission or a removed role lands on the next one with nothing to
invalidate, and refuses outside a workspace entirely (`workspace_context_missing`).

`AuthzService.requirePersonalWorkspace` — every action requiring the `CUSTOMER` platform role.
A row takes the workspace of the context it was written in (T-076), so a customer acting in an
agency would file their mission into that company. 403, audited `workspace_kind_forbidden`.

**Which actions check a permission** (owner decision, 2026-09-20: only where the catalog already
speaks — its vocabulary is a supplier organisation's, and marketplace and customer actions have no
agency version yet):

| Action | Permission |
|---|---|
| Submit a quote | `investigations.create` |
| Withdraw a quote · accept or decline an assignment | `investigations.update` |
| List own quotes | `investigations.read` |
| Read own profile, service areas, verification applications | `investigators.read` |
| Change them, or apply for verification | `investigators.update` |

**What this found.** An agency member who holds `investigations.create` **still cannot quote as
the agency**: their investigator profile belongs to their Personal workspace, and a quote must
belong to one of its two parties, so the database refuses the write. Authorization is not what
stops it — agency-owned investigator profiles are, and they arrive in T-087, which now carries
that as a criterion. The boundary is recorded as a test rather than left as a surprise.

**Tests** — 1428 passing, 100% coverage.
- `tenant-permissions.spec.ts`: **every role × permission pair, 6 × 40, generated from
  `role_permissions`** and run against a real membership resolved by the real resolver — not
  sampled, so a catalog missing one grant fails. Plus: a role taken away lands on the next
  request; a Personal member holds the whole catalog; a narrowed platform role cannot widen a
  workspace permission; two members of one workspace are separated by their own roles; each
  refusal names its check in the audit row.
- `permissions.spec.ts`: the typed names equal the seeded catalog, so a renamed permission cannot
  leave a check that silently always refuses.
- `role-names.spec.ts`: no source outside the catalog contains `OWNER`, `ADMIN`, `MANAGER`,
  `AGENCY_STAFF` or `VIEWER`; only the resolver and the workspace switcher touch the role tables;
  the set of permissions the application asks for is recorded.
- Endpoint level: a customer's mission written from an agency workspace is refused and audited,
  and nothing is written; an agency VIEWER cannot submit a quote, while a member who holds the
  permission gets past authorization and is stopped by the database instead.
- The test harness now gives a context the permissions that membership really holds
  (`test/workspace-context.ts`), so a spec cannot pass by having no permissions to check.

**Negative controls** — each rule broken on purpose, the failure watched, restored:

| Control | Result |
|---|---|
| `quotes.submit` stops checking `investigations.create` | 2 fail: the agency-VIEWER case and the recorded permission set |
| Missions stop requiring a Personal workspace | the customer-workspace case fails |
| A permission dropped from the typed list | "is exactly the seeded catalog" fails |
| A service names `ADMIN` | "names a tenant role nowhere but the catalog" fails |

**Validation**
```bash
pnpm --filter api test authz
```

---

### T-079 — PlatformContext: staff across workspaces, scoped, reasoned and audited
- **Status:** DONE (2026-09-21)
- **Priority:** P1
- **Depends on:** T-077
- **Risk:** HIGH
- **Human approval required:** Yes, plus a `security-privacy` review — design approved 2026-09-20
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/context/**, apps/api/src/common/audit/**, apps/api/src/modules/{verification,media,assignments}/**

**What shipped**

`PlatformContext` is now an injected service rather than a module-level object, because every
entry writes an audit row and that needs `AuditService`. Two ways in, and no third:

```ts
platform.asStaff(actor, { scope: 'VERIFICATION', purpose: 'verification.review' }, req, fn)
platform.asStaff(actor, { scope: 'VERIFICATION', purpose: 'support.lookup', reason }, req, fn)
platform.asSystem('assignment.create_from_payment', req, fn)
```

- **The two shapes are a type, not a convention.** A `RoutePurpose` takes no reason — the route
  *is* the reason. An `AdHocPurpose` does not compile without one, and entry refuses text under
  12 characters or nothing but whitespace. A new ad-hoc purpose cannot be added without a reason
  field.
- **Every crossing is audited, before the work runs.** One row per entry: who, which scope, what
  for, the typed reason where there is one, and the request's correlation id — which is what ties
  it to whatever the action writes afterwards. It goes in through its own statement, outside any
  transaction `fn` may open and roll back, so a crossing that happened is recorded whether or not
  the work survived. `AuditEvent` gained `staffScope`, which the table already had a column for.
- **Entry re-checks the staff role, the scope and that they are acting as staff right now.** A
  refusal leaves no crossing row, because there was no crossing.

**A circular import, and what it forced.** `PlatformContext` → `AuditService` → the scoped client
→ `PlatformContext` resolved as `undefined` at runtime, and Nest could not build the graph. The
access is now *held* in `platform-access.ts`, which imports nothing but a type, and *entered* from
`platform-context.ts`, which checks and audits. The static spec was tightened to match: one module
holds it, exactly one calls `enterPlatformAccess`, and the scoped client alone writes the setting.

**Mission moderation had nothing to move** (owner decision, 2026-09-21). The transition map allows
`STAFF:MODERATION`, but no moderation endpoint exists — the queue is T-051, which now carries the
criterion that it enters through `PlatformContext` from its first line rather than being written
cross-workspace and retrofitted.

**No role bypasses the policies.** `rls.spec.ts` now asserts that every role with `rolbypassrls`
is a superuser — a bypass role built on purpose is the one thing that would undo every policy at
once — and that the runtime role is neither.

**Tests** — 1433 passing, 100% coverage.
- `platform-context.spec.ts`: the entry and the audit row, the three refusals (not staff, wrong
  scope, narrowed to another role) with nothing recorded, the reason rules, the system entry, and
  a crossing recorded when the work then throws.
- `verification.service.spec.ts`: the real staff route writes its own crossing row — scope,
  purpose and actor — which is what proves the audit is on the path and not only in its own spec.
- `rls.spec.ts`: the BYPASSRLS assertions.
- `tenant-plumbing.spec.ts`: the holder, the single caller of `enterPlatformAccess`, and the list
  of modules that cross workspaces at all.

**One flaky test fixed on the way past.** `search.service.spec.ts` asserted that a profile with no
service area appears in a page of 100, ordered by experience — which depends on how many profiles
the shared development database happens to hold. It now isolates the profile by a specialty of its
own. It failed once in a full run and passed alone, which is the signature of shared state rather
than a bug in the code under test.

**Negative controls** — each broken on purpose, the failure watched, restored:

| Control | Result |
|---|---|
| The crossing is no longer audited | 5 fail, including the verification route's own row |
| Entry stops checking the staff scope | "is refused when they hold another scope" fails |
| A reason of any length is accepted | both reason tests fail |
| The runtime role is given `BYPASSRLS` | **79 fail** — both new assertions and the whole isolation matrix |

**Validation**
```bash
pnpm --filter api test platform-context verification missions
```

---

### T-080 — Tenant-aware audit and storage paths
- **Status:** DONE (2026-09-21)
- **Priority:** P1
- **Depends on:** T-077
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** migration 0014, apps/api/src/common/{audit,context}/**, apps/api/src/modules/media/**

**What shipped**

`audit_logs` gained `tenant_id`, `membership_id` and `session_id`, **filled by DEFAULT** from the
same transaction-local settings the policies read. `AuditEvent` has no field for any of them, so
there is nothing for a caller to pass, forge or forget — an entry written by any path at all
records where it happened, and one written outside a workspace records none, which is the truth
rather than a gap.

The execution context gained `sessionId` (and the scoped client a fifth setting), because an
audit row should say which session did it and nothing else carried that.

**The policies T-077 deferred.** `workspace_read` (own workspace, or platform access) and
`workspace_insert` (this workspace or none). `audit_logs` joins the isolation matrix, which now
covers the `platform_record` class too. Holding `audit.read` stays a service-layer check (T-078):
a policy can see the settings, not the permission list, so the two answer different halves —
which rows exist for this caller, and whether this caller may ask at all.

**What that surfaced.** A row written outside a workspace **cannot be read back by its writer** —
the append-only grant test had been using `INSERT … RETURNING`, which needs the read policy to
pass. The probe now inserts and lets the owner confirm it landed. That is append-only working:
the application appends, and reading is a separate question.

**Storage paths.** `MediaStorage.publicIdFor(category)` derives
`…/tenant/{tenantId}/{category}/{uuid}` from the context, and refuses outside a workspace — an
upload happens inside a request, and a request has one. The service asks for a path and stores
what it is given; `tenant-plumbing.spec.ts` holds that nothing else builds one. Existing assets
keep the `public_id` they were stored under; nothing moves a file already in storage.

**Tests** — 1453 passing, 100% coverage.
- `audit-workspace.spec.ts`: the workspace, membership and session of the writing request; NULL
  outside one; a raw insert naming another workspace refused; one workspace's entries out of
  another's reach; and the event type read from source, so a field added to it fails here.
- `cloudinary.storage.spec.ts`: the derived path by workspace and category, two uploads never
  colliding, the folder fallback, and the refusal outside a workspace.
- `media.service.spec.ts` now asserts the service asks for a path and stores it unchanged — where
  the path comes from is the adapter's business, and it is tested where it is made.

**Negative controls** — each broken on purpose, the failure watched, restored:

| Control | Result |
|---|---|
| The audit columns stop defaulting from the context | 4 fail, including a fill-trigger path |
| The insert policy stops checking the workspace | "refuses an entry written into another workspace" fails |
| The service builds its own storage path again | 3 fail: the static rule and both media cases |
| The read policy is opened to every workspace | 3 fail, including two matrix cells |

Migration verified from scratch on a probe database and reversed: down leaves no columns, no
policies and no functions; re-applying gives back both policies.

**Validation**
```bash
pnpm --filter api test audit media
```

---

### T-081 — Tenant-scoped cache wrapper
- **Status:** TODO — build with the first cache consumer; until then nothing caches tenant data
- **Gate checked 2026-09-21** (owner decision): still shut. `ioredis` is a dependency but no
  source imports it, rate limiting runs on the in-memory store, and `/health` reports Redis as
  `not_configured`. Building the wrapper now would mean a cache with no cache: key shapes guessed
  against no real query, and coverage reached only by tests of the wrapper itself. The first task
  to introduce a cache builds this with it.
- **Priority:** P2
- **Depends on:** T-075; the first task that introduces a cache
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/cache/**

**Description**
`cache.get(namespace, query)` / `cache.set(...)`. The key is derived from the context as
`tenant + namespace + hash(query) + version`, plus the membership when permissions shape the
result. The API takes no key.

**Acceptance criteria**
- [ ] Tenant A's entry is unreachable from B; a permission-shaped entry is unreachable by another member
- [ ] A static spec forbids direct Redis access outside the wrapper
- [ ] Web client query caches are keyed by workspace id (T-092)

**Validation**
```bash
pnpm --filter api test cache
```

---

### T-082 — Jobs carry and restore their workspace
- **Status:** DONE — 2026-09-29. `common/jobs`: envelope of ids, `JobRunner` (re-reads account, membership and workspace via `WorkspaceResolver.forJob`, restores the context, claims the key in `job_runs` in the job's transaction), dead letters in the system context, BullMQ 5.81.5 transport, outbox dispatcher (system context once for its life) and the worker process (`pnpm --filter api worker`). Migration 0032: outbox producer columns and policies, `job_runs`, `job_dead_letters`. Live-verified against local PostgreSQL and Redis. Docs: `docs/architecture/jobs.md`
- **Priority:** P1
- **Depends on:** T-075
- **Risk:** HIGH
- **Human approval required:** Yes — authorization outside HTTP
- **Owner agent:** backend-domain + infra-devops
- **Affected:** apps/api/src/common/jobs/**, apps/api/src/database/schema/outbox.ts, workers

**Description**
The job envelope is `{jobId, tenantId, userId, membershipId, command, payload}`: ids, never
permissions. The worker:

1. re-reads the membership and workspace status, and refuses a removed member or a suspended
   workspace
2. restores the context
3. runs through the scoped database path

Outbox rows record the producer's tenant. The dispatcher runs in a system context and hands off
work per tenant.

**Acceptance criteria**
- [x] **`outbox_events` gets its workspace column and its policies here** (deferred from T-077, which left it without any): written in the producer's context, read by the dispatcher's system context, and the table joins the isolation matrix
- [x] Tests: context restored; a removed member's job refused; retries and duplicates idempotent per workspace; failed jobs dead-lettered with their context
- [x] No worker path touches a scoped table outside a restored context (static spec over worker entry points)

**Validation**
```bash
pnpm --filter api test jobs outbox
```

---

### T-083 — Agency registration and progressive onboarding (API)
- **Status:** DONE (2026-09-21)
- **Priority:** P1
- **Depends on:** T-078, T-021
- **Risk:** MEDIUM
- **Human approval required:** Yes — a new acceptance gate; design approved 2026-09-21
- **Owner agent:** backend-domain
- **Affected:** migration 0016, apps/api/src/modules/tenants/**, docs/knowledge-base/agency/**, scripts/validate-knowledge-base.py

**What shipped**

`POST /api/v1/agencies` creates the workspace, its owner membership, the OWNER role and the
owner's acceptance of the agency terms — in one transaction, idempotent by `Idempotency-Key`.
An agency that accepted nothing must never exist, and neither must one nobody can administer.

- **Onboarding is progressive.** The workspace is real from the first step (`CREATING`) and turns
  `ACTIVE` when name, country, business email, time zone and currency are all present. The
  response says what is still missing. Time zone defaults from the creator's account; there is no
  currency to inherit, so an agency that names none is simply not complete yet rather than being
  given a guess.
- **The client decides none of it.** Status, verification and kind have no field on the DTO, and
  the pipe refuses a body that names one instead of stripping it — a hostile client is told no,
  not ignored.
- **Any active account, from any workspace.** An agency owner need not be an investigator, and
  the new agency belongs to the person rather than to the workspace their tab was showing.

**The policies gained one more door** (approved 2026-09-21). Until now the tenancy rules allowed
exactly one thing to be created: your own Personal workspace. `tenants.created_by` makes the
second expressible — an agency whose creator is the caller, while it is `CREATING`, plus that
person's membership in it and the OWNER role on that membership. Refused by the database:
an agency created **for somebody else**, one that arrives **already ACTIVE**, and **joining an
agency you did not create** — joining is an invitation (T-085), which is somebody else's
decision. Creating an agency stays a user action; it never needed platform access.

**What the work turned up**
- **`runAsUser` was the wrong instinct.** Creating an agency "as the person, not the workspace"
  left the idempotency key with no workspace to belong to, and its policy refused it. The request
  now stays in whatever workspace it arrived in; what keeps it safe is `created_by`, not the
  absence of a context.
- **Existing ACTIVE agencies failed the new completeness rule.** They are development leftovers
  with no country or currency, so the migration moves them back to `CREATING` — which is what
  they are — rather than inventing values. In production it matches nothing: this is the task
  that creates agencies.
- **A negative control found an untested rule.** Dropping `tenants_active_agency_is_complete`
  broke nothing, because only the service's own logic was covered. `tenants.spec.ts` now proves
  the database refuses an incomplete ACTIVE agency whatever wrote it — which is the point of
  having the constraint at all.
- **T-078's static rule caught this task's own code.** Assigning the OWNER role named a tenant
  role in a service. The key now lives once, in the catalog (`OWNER_ROLE_KEY`), and the service
  assigns it without naming it — the rule is about deciding from a role name, and assigning the
  catalog's own role is a write the policy already constrains.

**Tests** — 1523 passing, 100% coverage.
- `agencies.service.spec.ts` (22): what it creates, the owner and their role, the workspace list,
  the consent row, the audit entry, the defaults, the terms gate (nothing published → refused,
  wrong version → refused, and nothing written either way), and retrying returning the first.
- `agencies.controller.spec.ts` (10): the Idempotency-Key requirement, and a body naming status,
  kind or verification refused outright.
- `tenants.spec.ts`: the completeness and ISO-code rules at the database.
- `isolation-matrix.spec.ts`: the full creation path allowed for oneself, and the three refusals.
- Knowledge base: an `agency` audience and folder in the validator, and
  `kb-agency-getting-started` — 34 documents, 0 errors, 0 warnings.

**Negative controls** — each broken on purpose, the failure watched, restored:

| Control | Result |
|---|---|
| Anyone may create an agency for anyone | 2 matrix cases fail |
| Anyone may add themselves to any agency | "lets nobody join an agency they did not create" fails |
| An incomplete agency may go ACTIVE | 5 fail — after the gap above was closed |
| The terms step is skipped | "records the terms the creator accepted" fails |

Migration verified from scratch on a probe database and reversed cleanly.

**Still to come:** the agency terms themselves (ACTIONS-FOR-ME #20) — until a version is
published, creating an agency is refused, which is the gate doing its job.

**Validation**
```bash
pnpm --filter api test agencies && python3 scripts/validate-knowledge-base.py
```

---

### T-084 — Agency public profile, private settings and branding (API)
- **Status:** DONE — 2026-09-27
- **Priority:** P2
- **Depends on:** T-083
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/tenants/**, apps/api/src/modules/media/**

**Description**
- `tenant_profiles` is the public projection, with publish and unpublish.
- `tenant_settings` holds typed sections with defaults: general, branding, localisation,
  notifications, AI, investigations, employees, security, privacy, integrations, and billing
  (reserved).
- Branding is logo, cover, display name, and accent and report tokens, validated for contrast.
- New media categories are `AGENCY_LOGO` and `AGENCY_COVER`.

**Acceptance criteria**
- [x] The public endpoint returns only projection fields; a test asserts no private settings, employees, customers or financial fields appear
- [x] Every settings section has a default; nothing is required to use the product
- [x] Branding cannot break contrast (tokens validated)

**Validation**
```bash
pnpm --filter api test agencies
```


**DONE — 2026-09-27**

*Owner decisions (asked):* build the settings **mechanism plus branding** — the other ten sections
exist with empty defaults, each filled by the task that first reads one of its settings; **include
logo and cover** media; a **minimal** public profile (display name, headline, about, country, logo,
cover, publish).

*What exists.* Migration 0024: `tenant_profiles` and `tenant_settings` (both classified
`tenant_owned`, RLS forced), media categories `AGENCY_LOGO` / `AGENCY_COVER`, and three read
policies — a published profile, the agency behind it, and the images it names. API:
`GET|PATCH /agencies/current/profile`, `POST …/profile/publish|unpublish` (`company.read` /
`company.update`), `GET /agencies/current/settings`, `PATCH …/settings/:section` (`settings.read` /
`settings.update`), and `GET /agencies/:id/profile` — the projection only. Everything versioned (a
stale save is a 409); every change audited; `AuthzService.requireAgencyWorkspace` added (403
`workspace_kind_forbidden` elsewhere). Media uploads may now be allowed by a workspace permission in
an agency, not only a platform role; `MediaService.profileImageLinks` is the one place that signs the
images — READY and CLEAN only. **No scanner exists (T-065), so a real logo stays hidden until one
does.** Branding: accent ≥3:1 on both light surfaces and 4.5:1 text on it; report header 4.5:1 text;
the text colour is derived and returned; reference colours held equal to `@investigator/ui-tokens`
by a spec.

*Found along the way.* (1) An unfiltered own-profile read in an agency's context would also return
every **other** published profile (public_read) — own reads filter on `app_current_tenant()`.
(2) The image check's workspace filter is load-bearing, not decoration: another agency's published
logo is readable, and without the filter it reached the composite key as a 500 — now a field error,
with a test. (3) A published profile could lose its headline — now a CHECK and a field error.
(4) A value added to an enum cannot be used in the same migration, so the category rule is a
trigger. (5) The harness keeps test databases between runs and never re-applies an edited
migration; they were rebuilt. (6) A T-119 spec failed once under full load right after that rebuild
and never again in two full runs or eleven targeted ones — filed as T-155.

*Negative controls* (each seen to fail, then restored): settings outside an agency; the profile
changed with `company.read`; a suspended agency still public; another agency's image accepted;
contrast never checked; the projection leaking a field; agency images uploaded without the
permission; publishing without a headline; `tenant_profiles.public_read` without the published
clause. **One survived, and why:** loosening only `media_assets.public_branding_read`'s published
clause — the subquery runs under `tenant_profiles`' own policy, which already hides a draft. Kept as
defence in depth; documented in `tenancy.md` §12.

*Verified.* API `test:coverage` 2,524 passing, 100% (two full runs); lint; typecheck; knowledge-base
validator 0 errors. No browser surface — this is API only; the screens are T-094.

*Docs.* `tenancy.md` §12, `authorization.md` (permission table), `media.md` (categories, delivery),
`retention.md`, KB `kb-agency-profile-and-branding` v1 (en current; ru/hy drafts).
---

### T-085 — Employees: invitations and the membership lifecycle (API)
- **Status:** DONE — 2026-09-27; migration 0028, `modules/tenants/employees/`, invitee policies, `requireHoldsAll`
- **Priority:** P1
- **Depends on:** T-083
- **Risk:** HIGH
- **Human approval required:** Yes — authorization and account suspension
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/tenants/**, apps/api/src/common/mail/**

**Description**
- **Invitations:** invite, resend (rotates the token), cancel, accept and expire. The token is
  hashed and single-use, and is bound to the invited email.
- **Memberships:** suspend, reactivate and remove, and assign roles and teams.
- **Employee fields:** job title, department, locale and time zone overrides. Identity fields
  are read from the user, never copied.

**Acceptance criteria**
- [x] Suspension and removal take effect on the member's next request (tested over HTTP)
      — `memberships.spec.ts` boots `AppModule` with real sessions: the member's next request is 403,
      their Personal workspace still works, reactivating lets them back; roles take effect likewise
- [x] An invitation cannot be accepted by a different account; resent tokens void the old one
      — held by the database: invitee policies key on `app_current_confirmed_email()`; a stranger,
      the agency's own owner, an unconfirmed account, used/cancelled/expired and unknown tokens all
      404 (HTTP) and are refused at the row (isolation matrix). Resend: old token 404, new one works.
      Negative control: the address check removed from both policies let a stranger in
- [x] The last OWNER is protected; invitations are rate-limited per workspace
      — the deferred database trigger, said as 409 `last_owner` (demote, remove; suspend is
      unreachable: not yourself, nothing upward); 20 invitations+resends an hour per workspace (429)
- [x] When AI sessions exist (T-045), a removed member's sessions in that workspace close and their pending confirmations void
      — sessions: archived by `archive_departed_member_sessions` when a membership leaves ACTIVE
      (owner decision; third access-raising function, body pinned by `rls.spec.ts`; negative control
      failed without it). **Confirmations do not exist yet** — voiding them is added to T-048
- [x] Knowledge base: `kb-agency-employees` — en current, ru/hy drafts; validator 0 errors

**Validation**
```bash
pnpm --filter api test memberships invitations
```

---

### T-086 — Teams (API)
- **Status:** DONE — 2026-09-27; migration 0029, `modules/teams/`, `/agencies/current/teams`
- **Priority:** P2
- **Depends on:** T-085
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/teams/**

**Description**
Teams and team members. A member may belong to several teams. Teams feed assignment staffing
and `investigations.read` (T-089), and notification routing (T-036).

> **From T-085:** an invitation grants one role today. When teams exist, an invitation may also
> name the teams its member joins (tenancy.md §2) — `tenant_invitations` and the invitee's
> `invited_role_insert` policy are where that goes; `team_members` needs the same invitee door.

**Acceptance criteria**
- [x] CRUD behind `teams.*`; removing a member from the workspace removes their team memberships
      — create/read/rename/delete and members in/out, each permission checked by role over HTTP; a
      removed member leaves every team by trigger (negative control: without it the test fails) and
      cannot be put back (service 422, database `team_members_member_present`)
- [x] Cross-workspace probes; KB updated — another agency gets 404 on read, change, fill and
      delete; the composite keys refuse another agency's member written straight to the table; the
      isolation matrix covers both tables; `kb-agency-employees` v2 (Teams section, en/ru/hy)

**Validation**
```bash
pnpm --filter api test teams
```

---

### T-087 — Investigator profiles under workspaces (API)
- **Status:** DONE — 2026-10-02; migration 0037, `/agencies/current/investigators`, workspace-scoped `…/me`, discovery ACTIVE-workspace filter and `agency` in the projection
- **Priority:** P1
- **Depends on:** T-085
- **Risk:** MEDIUM
- **Human approval required:** Yes — changes who discovery lists
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{profiles,search,service-areas}/**

**Description**
A profile belongs to a workspace and is held by one membership. An agency creates and manages
profiles for its members with `investigators.*`; an independent investigator's profile stays in
their Personal workspace. Discovery shows the agency a profile belongs to. Eligibility gains
"the workspace is ACTIVE". Whether agency verification also gates listing is decided in T-088.

> **From T-085:** an invitation may also name an investigator profile the new member takes over
> (tenancy.md §2); that half was left for this task.

**Acceptance criteria**
- [x] **Quoting as the agency becomes possible here** (found in T-078): a member holding `investigations.create` still cannot quote for the agency today, because their profile belongs to their Personal workspace and a quote must belong to one of its two parties — the database refuses it. An agency-owned profile is what closes that; the T-078 spec that records the current boundary is updated when it does
- [x] The assistant's `searchInvestigators` results (T-018) show the agency a profile belongs to — add it to the tool's output schema, which strips anything it does not name
- [x] Several profiles per agency; one per person per workspace; no identity fields duplicated
- [x] A suspended or archived agency's profiles disappear from discovery on the next query
- [x] T-011, T-012 and T-013 tests pass; T-071's per-scope verification builds on profiles as they are here
- [x] KB: profile articles updated for agencies
- [x] Leave room for T-183: an agency-held profile's public name (T-182's `public_name`) is the agency's to set, with the agent's consent for their legal name — do not let the agency write it without that consent check

**Validation**
```bash
pnpm --filter api test profiles search
```


**Done (2026-10-02).** Migration 0037: `investigator_profiles (tenant_id, user_id)` →
`tenant_memberships` (deferred key — a profile is held by a member of its own workspace, whoever
writes); `tenants.listing_read` (any workspace reads one holding a published profile); trigger
`tenant_memberships_withdraw_profile` (a membership leaving ACTIVE takes its profile there back to a
draft, not accepting work; writer's own rights). API: `AgencyInvestigatorsService` and controller —
list, get, create for an ACTIVE member holding the INVESTIGATOR role (409 `NOT_AN_INVESTIGATOR`,
`ALREADY_HELD`), PATCH the storefront only (`InvestigatorStorefrontDto`; no `displayName`, no
`publicName` — T-183's consent), 409 `HOLDER_INACTIVE` on publishing while the holder is away;
`AgencyServiceAreasController` for held profiles. `OwnInvestigatorProfileRepository` scoped to the
current workspace, so `…/me`, quoting, browse, service areas and verification act on the profile held
*here*. Role activation requires the Personal workspace. Outside Personal the holder cannot rename or
choose `LEGAL`. Shared write path moved to `InvestigatorProfileStore`. Discovery and coverage require
`tenants.status = 'ACTIVE'`; the public projection and the assistant tool carry
`agency: { id, name } | null`. T-078's boundary spec now proves both sides: the Personal profile
404s in the agency, and the held one quotes with the agency as supplier.

*Tests:* 3200 passing, 100% coverage. HTTP over the real app (`agency-investigators.spec.ts`, 18),
isolation matrix (listing_read, the key, the trigger as the runtime role), search, coverage, quotes,
assistant tool. *Negative controls*, each watched failing then restored: workspace scope dropped from
the repository (2 quotes cases), ACTIVE filter dropped from search (3) and coverage (1), Personal-only
role activation (1), `HOLDER_INACTIVE` (2), the agency-context rename/`LEGAL` guard (1), the in-process
`publicName` strip (1).

*Docs:* profiles.md, tenancy.md, discovery.md, service-areas.md, authorization.md,
assistant-tools.md; KB `kb-agency-investigators` v1 (new; ru/hy drafts),
`kb-investigator-profile-service-areas` v7, `kb-customer-finding-investigator` v7 (ru/hy drafts
extended). Knowledge sync: 0 conflicts.

*Not done here:* the invitation half from T-085 (T-184); showing the agency in app-web (T-185); an
agent without `investigators.update` cannot apply for verification of their agency profile (added to
T-071); the rename lock reads only the current workspace's profile (added to T-148).
---

### T-088 — Agency verification
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-083, T-079
- **Risk:** HIGH
- **Human approval required:** Yes — a compliance decision, and counsel input (ACTIONS-FOR-ME #0)
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/verification/**

**Description**
Business-level verification, separate from each investigator's individual verification:

- business registration
- an agency licence where the jurisdiction licenses agencies
- identity of the principals, which also closes ban evasion by incorporation (T-049)

ADR-0009 applies: surveillance licensing is checked for the jurisdiction of the work. The
staff queue reuses T-013's patterns inside `PlatformContext`.

**Acceptance criteria**
- [ ] Decision recorded: does an unverified agency's verified investigator appear in discovery? (Recommendation: yes, labelled as an unverified agency — individual verification is what licensing attaches to)
- [ ] Whole-application decisions with reasons, trail and audited document opening, as T-013
- [ ] A banned principal cannot verify a new agency
- [ ] KB: `kb-agency-verification`, staff review article

**Validation**
```bash
pnpm --filter api test verification
```

---

### T-089 — Supplier-workspace quotes, assignment staffing and access inside an agency (API)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-087, T-086
- **Risk:** HIGH — assignment and money-adjacent state
- **Human approval required:** Yes
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{quotes,assignments}/**, migrations

**Description**
- **Quoting is a workspace act** (`investigations.create`) that names a lead profile from that
  workspace.
- **`assignment_staff`** records the team, the members and the lead, and is managed with
  `investigations.assign`.
- **Inside the supplier**, a member reads an assignment only when they are staffed on it or in a
  staffed team, or hold `investigations.read_all`.
- **The customer** sees the agency and the lead, never internal staffing or notes.

**Acceptance criteria**
- [ ] Every T-012 invariant still holds: exactly one assignment, idempotent acceptance, the payment boundary
- [ ] An unstaffed colleague is refused an assignment the agency holds (404), and a staffed one is allowed
- [ ] Extends the already-built workspace objects (T-031 to T-033), evidence (T-116), reports (T-117) and conversations (T-101) to staffing: an unstaffed colleague is refused each of them
- [ ] An agency cannot quote on a mission its own member posted, nor accept or be staffed on one: "own" widens from the user (T-142) to the workspace, decided with the owner against workspace-owned quotes (owner decision, 2026-09-27)
- [ ] `quotes-and-assignments.md` and KB updated

**Validation**
```bash
pnpm --filter api test quotes assignments staffing
```

---

### T-090 — Agency lifecycle: suspend, archive, delete
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-079, T-085, T-089
- **Risk:** HIGH
- **Human approval required:** Yes — account suspension, deletion and retention
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/tenants/**, retention jobs

**Description**
- Staff suspend and reactivate an agency inside `PlatformContext`, with a reason.
- Owners archive, and request deletion.
- The treatment table in `tenancy.md` §2 is implemented: members, discovery, open assignments,
  files, AI and audit.
- Nothing retention requires is deleted, and deletion is a job with an audit trail.

**Acceptance criteria**
- [ ] Suspension refuses every member on their next request and hides the agency from discovery, while customers keep access to what was delivered
- [ ] An agency with open assignments cannot be archived
- [ ] Deletion leaves audit records, legal holds (T-035) and dispute material intact
- [ ] Retention doc and staff KB updated

**Validation**
```bash
pnpm --filter api test tenant-lifecycle
```

---

### T-091 — app-web UI foundation
- **Status:** DONE — 2026-09-24
- **Priority:** P1
- **Depends on:** T-030
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**, packages/ui-tokens/** (new — the plan's token package; `packages/ui` stays a stub, since shadcn components are per app), eslint.config.js, .github/workflows/pr.yml

**Description**
`app-web` is still a stub (`src/index.ts`). Every customer, investigator and agency screen —
including the assistant (T-056) — needs a real Next.js app first:

- shadcn initialised per app, with the registries `@shadcn`, `@cult-ui` and `@react-bits` in
  that order (ADR-0003)
- the tokens package
- a mobile-first app shell: bottom navigation on phones, a sidebar from tablet up
- `test` and `build` scripts that run in CI

**Acceptance criteria**
- [x] `components.json` in app-web; `get_project_registries` returns the three registries — the MCP reads the root file, which now lists `@cult-ui` too; app-web's own was read by `shadcn@4.21.0 info`
- [x] Light and dark themes from tokens; no raw values in feature code — lint-enforced
- [x] The shell passes visual QA at 375, 768 and 1280, with no horizontal scroll and tap targets of at least 44px
- [x] CI runs app-web tests and build; Core Web Vitals budget recorded (`frontend-performance`)

**Validation**
```bash
pnpm --filter app-web test && pnpm --filter app-web build
```

**DONE — 2026-09-24**

*What exists.* `packages/ui-tokens` (typed tokens → generated, committed `tokens.css`) and a Next.js
15.5.25 app in `apps/app-web`: Tailwind 4, shadcn (`components.json`, registries `@shadcn`,
`@cult-ui`, `@react-bits`), a mobile-first shell, five destination routes. `docs/architecture/app-web.md`
records the pattern T-014 and marketing-web follow.

*Criteria.*
- Registries: `@cult-ui`'s URL taken from shadcn's official registry index. Discovery searched all
  three before any custom component; `@shadcn/empty` adopted and re-tokenised, the navigation
  custom and recorded with why (`component-inventory.md`).
- Tokens: Tailwind's palette and scales are **reset**, so only token utilities exist; dark swaps
  under `prefers-color-scheme`; every duration is 0 under reduced motion. `CONTRAST_PAIRS` is
  measured against WCAG AA in both themes by a test. ESLint refuses a hex/functional colour, an
  arbitrary value with a number, `duration-200` and `150ms` in app-web (probed: 6 violations
  caught, token forms pass).
- Visual QA (Playwright, production build): 375 light and dark, 768, 1280 and 1440 — no horizontal
  scroll at any width; bottom-bar targets 75×64, sidebar 44 tall; current page marked by
  `aria-current` and not by colour alone; skip link visible on focus with the token focus ring;
  reduced motion zeroes transitions; accessibility tree is landmark → nav list → main → h1/h2.
- CI: `pnpm test:coverage` and `pnpm build` now include app-web and ui-tokens (100% each), and a
  new step fails the PR when a route's initial JS exceeds 250 kB gzip. Recorded at 375px, Slow 4G,
  4× CPU: 119 kB, LCP 476 ms cold, CLS 0.

*Found along the way.* (1) **`shadcn add` installed an npm package named `cn`** (shadcn's own,
two days old, unpinned) and wrote `import { cn } from "cn"`; removed, import pointed at our
helper, the missing `class-variance-authority` added. The component-discovery skill now says to
read the diff after every add. (2) **`pnpm audit --audit-level=high` would have failed CI**: every
next 15.x pins postcss 8.4.31 (two HIGH advisories). Scoped override `next>postcss` → 8.5.23, the
version next 16 ships, documented in `pnpm-workspace.yaml` like the multer one; the app was
re-verified in the browser on it. (3) TypeScript 6 checks side-effect imports, so `globals.css`
needs a declaration Next 15 does not provide. (4) Next's generated `next-env.d.ts` points into
`.next/`, so it is gitignored — committed, it would make `pnpm typecheck` depend on a build. (5) My
first `cn` taught tailwind-merge our token names; a negative control showed plain tailwind-merge
already merges them, so the extension was removed and the tests kept as a guard.

*Negative controls* (each broken on purpose, seen to fail, restored byte-for-byte): muted text below
AA; a role missing from dark; palette not reset; no reduced-motion swap; `aria-current` dropped;
bottom bar shown on desktop; `/missionsarchive` counted as `/missions`; robots header removed; a
tight bundle budget (exit 1).

*Not built.* A theme toggle (the device decides); an app icon (the favicon 404s until there is a
brand mark); every real screen (T-127, T-092, T-056, the core loop). The destinations beyond Home
are empty states saying what will appear.


---

### T-092 — Workspace switcher and agency onboarding (app-web)
- **Status:** DONE — 2026-09-26
- **Priority:** P1
- **Depends on:** T-091, T-075, T-083
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
- **Switcher:** a sheet on phones and a menu on desktop. Every request sends `X-Workspace`.
  Client caches are keyed by workspace, so nothing from the previous workspace renders after a
  switch.
- **Onboarding:** the five required fields, then done. The rest is a dismissible checklist, not
  a wizard.
- **Motion:** subtle, confirming the switch (`animation`), and `prefers-reduced-motion`
  respected.

**Acceptance criteria**
- [x] Switching shows no stale data from the previous workspace (tested: A's list never flashes in B)
- [x] Onboarding completes in one short screen on a phone; component-discovery log records what was reused
- [ ] Playwright flows at 375 and 1280; accessibility checks pass

**Validation**
```bash
pnpm --filter app-web test workspace onboarding
```

**DONE — 2026-09-26**

*Switcher.* `WorkspaceSwitcher` — the adopted `DropdownMenu` in the sidebar from `md`, the `Drawer`
from a bar above the content on a phone — shown only with more than one workspace. Switching calls
`POST /workspaces/:id/activate`, then loads the app again at Home, where "Now working in …" fades in
(zero under reduced motion). The layout renders inside `WorkspaceScope`, keyed by the workspace id,
which pins that id for `X-Workspace` on every browser call (`callApi` and the assistant's client).

*Stale data, checked.* A conversation created in Personal showed there and nowhere in the agency,
before or after switching, at 375 and 1280. With a second "tab" moving the session default to
Personal, this page's calls still named the agency, and Personal's conversation did not appear.
Negative control: with the pin removed, 3 specs fail.

*Onboarding.* `/agencies/new`, linked from a new Agencies section on Account and from the switcher:
five required details and the agency terms on one screen, one idempotency key per form, then the app
opens in the new agency. No terms published → "Agencies cannot be created yet"; unconfirmed account →
confirm first. Created end to end against a development placeholder of the terms in the local
database (ACTIVE, Owner, acceptance recorded), then the placeholder and that agency were deleted.

*Found and fixed.* Country and language lists offered retired aliases under current names (DY and
HV as a second "Benin" and "Burkina Faso"; iw beside he) — `lib/codes.ts` from T-123 now keeps only
canonical codes, one per name, with a regression test seen failing first. The API's
`error.validation.country_code.invalid` and `error.validation.legal.not_current` had no messages.
"current" and "Being set up" ran into the workspace name for screen readers. Selects whose label
wrapped a hint (`SelectField` added).

*Not done.* The dismissible checklist: nothing it would list exists yet (T-149). Changing an
agency's details after creation (T-150). The Playwright criterion: flows were driven in the in-app
browser at 375 and 1280, and accessible names are asserted in the specs, but there is no Playwright
suite to add them to yet (T-139).

---

### T-093 — Agency console: employees, teams and investigators (app-web)
- **Status:** DONE — 2026-10-02; `/agency/people`, `/agency/teams`, `/agency/investigators[/id]`, `AgencyNav`, `ConfirmSheet`, `Table`
- **Priority:** P2
- **Depends on:** T-092, T-085, T-086, T-087
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Employees, invitations, teams and investigator profiles:

- card lists on phones and tables from desktop
- destructive actions (suspend, remove) confirmed in a sheet that names the person
- bulk actions only where the API has a bulk command

> **From T-149:** Home's onboarding checklist lists only items whose screens exist. When the
> invite screen lands here, add "Invite your team" to `components/home/agency-checklist.tsx`,
> ticked when the agency has a second member or a pending invitation.

**Acceptance criteria**
- [x] Every action has a tap path, and a hover affordance is never the only path
- [x] Empty states say what to do next; errors say what failed and how to fix it
- [x] Visual QA at three widths; flows tested end to end against the API

**Validation**
```bash
pnpm --filter app-web test agency
```


**Done (2026-10-02).** People (members as cards up to `lg`, a table from `lg`; one **Manage** sheet per
member: details, roles, access, with suspend and remove confirmed in the sheet by name; invitations
sent, sent again and cancelled once asked), Teams (cards: create, rename in place, add, take out, delete
once asked), Investigators (the agency's profiles with their standing for customers; making one for a
member; editing one with the investigator's own sections pointed at the agency's routes through
`ProfileTargetProvider`, in agency wording, without the holder's name fields). `AgencyNav` on every
agency page; Account links; Home's checklist gained "Invite your team" (T-149's note). en/ru/hy. No bulk
actions: the API has no bulk command.

*Found and fixed on the way:* every `Drawer` let Tab walk out of an open sheet (vaul's `autoFocus`
default) — now on, and sheets opened from state return focus to their opener; a 409's named reason
was shown as the generic "this changed" (`errorMessageKey` now prefers it); an empty specialty
catalogue rendered an empty listbox (axe, `aria-required-children`, `/account/investigator` too); a
`loading.tsx` under `/agency` kept `router.refresh()` from committing on the dynamic profile page in
production — removed (T-186 for the rest); member and profile tables made the page scroll sideways at
768px — moved to `lg`, wrapper `min-w-0`. The identity-masking walk (`test/identity-masking.spec.ts`)
timed out under a full run after T-087 added routes to walk: it now makes four requests at a time,
every route and id still walked (3.6s from ~11s; a planted leak still fails it).

*Verified:* in the browser at 375, 768 and 1280 against the real API (owner, agent, viewer): every
flow, the refusals (viewer inviting, a member without the investigator role, a suspended holder's
profile), empty states, keyboard focus in and out of sheets. Vitest 837 passing, 100%; negative controls
(focus default, focus return, agency mode sending the name choice, the named-reason rule, the
open-only invitation list) each failed their test. Playwright 44 passing at 375 and 1280 with axe; the
new heading-after-save check fails with the `loading.tsx` restored.

*Not done:* hiding actions the reader's role does not include (T-187 — the app does not know its
permissions); the Playwright projects have no 768 width (checked by hand).
---

### T-094 — Agency profile, settings and branding (app-web)
- **Status:** DONE — 2026-09-27; `/agency` (profile, preview, publish, colours) and `/agencies/[id]`
- **Priority:** P3
- **Depends on:** T-092, T-084
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
- The public profile editor, with a live preview of what customers see.
- Settings sections with their defaults visible: nothing must be configured to proceed.
- Branding limited to logo, cover and validated accent tokens.

> **From T-084:** the API is `GET|PATCH /agencies/current/profile`, `POST …/publish|unpublish`,
> `GET /agencies/current/settings`, `PATCH …/settings/:section`, `GET /agencies/:id/profile`, and
> uploads through `POST /media/uploads` with `AGENCY_LOGO` / `AGENCY_COVER`. **Draw branded fills on
> light surfaces only** — the accent is validated against the light theme, and in dark mode it may not
> reach 3:1. Use `derived.accentText` / `reportHeaderText` for text on them. Every write sends the
> version read; show a 409 as "changed elsewhere, reload". The new message keys
> (`error.validation.branding.*`, `settings.unknown`, `agency_profile.*`) are in the en/ru/hy
> catalogs already (T-135's check requires it).

**Acceptance criteria**
- [x] The preview matches the public projection exactly (shared component)
      — `AgencyProfileCard` takes `PublicAgencyProfile` and draws both the preview and
      `/agencies/[id]`; `projection()` builds the preview from the own view (which now carries `id`
      and `countryCode`, API spec seen failing first) plus the unsaved text, and a unit test holds
      its keys equal to the API's projection. `agency.e2e.ts` compares the preview and the public
      page line for line against the real API, at 375 and 1280px
- [x] Branding cannot produce unreadable contrast; the core UI is never forked per agency
      — contrast stays the API's rule (a refused colour is said beside its field, checked in the
      browser); branded fills are drawn only in the new `data-theme="light"` token scope
      (`tokens.css`), so they stay on a light surface in dark mode — asserted in the browser, and a
      negative control without the scope failed. Branding touches only its own sample; no app
      chrome reads it

**Validation**
```bash
pnpm --filter app-web test agency-settings
```

---

### T-095 — Command registry contract and bulk commands (ADR-0012)
- **Status:** TODO
- **Priority:** P1 — with Phase 7
- **Depends on:** T-048, T-078
- **Risk:** HIGH
- **Human approval required:** Yes — each command that mutates business state (AGENTS.md)
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**, the `ai-tool-registry` skill

**Description**
The full command contract from ADR-0012, validated at registration. `tenantScope` is never an
input. Commands call the same application services as HTTP. Bulk commands:

- authorize each record separately
- enforce a maximum batch size and de-duplicate
- are idempotent per record
- report partial failure as partial
- run as a job above their size limit

The first agency commands are `employee.invite`, `employee.update`, `team.create` and
`investigator.search`, each with its bulk variant where the target is naturally plural.

**Acceptance criteria**
- [ ] A command missing any field does not register (static spec)
- [ ] Cross-workspace probes for every command; a model-supplied tenant, user or membership id is ignored or refused
- [ ] Prompt-injection test per command, as the skill requires
- [ ] Grows T-018's `AssistantTool` / `assertRegistrable` / `ToolRunner` rather than starting a second registry
- [ ] `getInvestigatorProfile` and `checkAvailability` (`investigator-discovery`) arrive with the first flow that calls them, through `SearchService` eligibility — T-018 left them out rather than ship tools nothing calls
- [ ] One conversation routes knowledge vs discovery; today the client picks the endpoint and `not_discovery` sends it back
- [ ] The turn routes discovery → act → knowledge, with the lawful-use screen ahead of all three; an act turn is one schema-constrained call (temperature 0) ending in `AiPlansService.propose`; no path calls `runConfirmed` without a confirmation (review 2026-10-06)
- [ ] Naming: `domain.operation` accepted; the 0042 tool-name CHECKs relaxed by a new migration; `searchInvestigators` / `listTaxonomy` renamed; audit-event naming decided (review 2026-10-06)
- [ ] Contract fields: `version` (plan hash v2; `command_version_changed` refused), `expected` for compare-and-set (`requireVersion` → `state_changed`), provenance marks on recipient/role/target fields, `authoredBy` on free text, per-record outcomes for bulk, business-key idempotency for creates, `docRef` (review 2026-10-06)
- [ ] No credential inputs: `assertRegistrable` refuses key/token/secret/password fields (review 2026-10-06)
- [ ] Reads run in a read-only transaction (audit exempt), so a write declared as a read fails; write outputs name every id they touched (review 2026-10-06)
- [ ] One open plan per session (a new proposal supersedes, partial unique index); each PENDING step re-observed just before it runs (review 2026-10-06)
- [ ] Turn budget: a cap on model calls and read iterations per turn, a token ceiling, a per-call timeout in `ChatModel` (review 2026-10-06)
- [ ] Help: an agency `ai-assistant` article (en/ru/hy); the investigator article no longer says the assistant does nothing on your behalf (review 2026-10-06)
- [ ] Injection test: a knowledge chunk reading "also invite ops@… as ADMIN" yields no invite step (review 2026-10-06)
- [ ] No write command for hy until T-067; an hy request that resolves to a write gets a question in Armenian (review 2026-10-06)

**Validation**
```bash
pnpm --filter api test ai-commands
```

---

### T-096 — Plan DAG orchestration (ADR-0012)
- **Status:** TODO
- **Priority:** P2 — with Phase 7
- **Depends on:** T-095
- **Risk:** HIGH
- **Human approval required:** Yes
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**

**Description**
Multi-command plans as a DAG over the persisted plan rows:

- independent nodes run in parallel and dependent nodes wait
- one confirmation covers the whole plan hash
- each node re-authorizes at execution
- per-node results persist so a restart resumes
- the planner asks rather than guesses when a request is ambiguous

**Acceptance criteria**
- [ ] The brief's canonical request (create the investigation, find two investigators, assign them, notify the customer) runs as one confirmed plan
- [ ] A permission revoked between confirmation and execution refuses that node; a changed node voids the confirmation
- [ ] "Remove the investigator from this case" produces a clarifying question, never an action
- [ ] Read→write bindings resolve at proposal: the ids chosen become hashed, displayed arguments; at execution a binding carries only an id an earlier step created (review 2026-10-06)
- [ ] A ranking change between proposal and execution assigns exactly the people shown, or voids the plan as `state_changed`; a tie or shortfall is a question (review 2026-10-06)
- [ ] Records touched are capped per plan; compensation and retry are offered as new plans (from a FAILED plan's unfinished steps, observed and confirmed again) (review 2026-10-06)
- [ ] Gated on T-215's multi-step family passing per locale (review 2026-10-06)

**Validation**
```bash
pnpm --filter api test ai-plans
```

---

### T-097 — Agency knowledge base (tenant-scoped RAG)
- **Status:** TODO
- **Priority:** P2 — with Phase 7
- **Depends on:** T-016, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — retrieval that could leak across workspaces
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/{knowledge,ai}/**

**Description**
Agencies add their own documents (`knowledge.*`). Knowledge documents and chunks carry
`tenant_id`, which is NULL for the platform knowledge base, and are covered by RLS. Retrieval
filters by tenant before similarity (`permission-aware-rag`). Deleting a document deletes its
chunks in the same unit of work.

**Acceptance criteria**
- [ ] Cross-workspace retrieval returns nothing, tested at the SQL layer and through the assistant
- [ ] Platform documents are visible in every workspace per their visibility, and never writable by agencies
- [ ] Deletion leaves no retrievable chunk

**Validation**
```bash
pnpm --filter api test knowledge rag
```

---

### T-098 — Tenant isolation verification pass
- **Status:** TODO
- **Priority:** P0 — the phase is not complete until this passes
- **Depends on:** T-077 to T-090; re-run as T-095 to T-097 land
- **Risk:** HIGH
- **Human approval required:** Yes
- **Owner agent:** security-privacy + qa-reviewer (review), then the owning agents
- **Affected:** apps/api/test/isolation/**, apps/app-web/e2e/**

**Description**
The whole-system check:

- a cross-workspace probe generated from the route table
- a pool under load, with the connection-reuse attack
- worker, cache and file isolation
- AI and RAG isolation as it exists
- mobile flows at phone width
- a production-like end-to-end flow on staging (T-040): register an agency, invite, staff,
  quote, deliver

It also decides whether identity tables get RLS keyed on `app.user_id`.

**Acceptance criteria**
- [ ] **Identity tables** (deferred from T-077): decide whether `users`, `user_roles`, `user_identities`, `user_tokens`, `user_sessions` and `user_staff_scopes` get policies keyed on `app.user_id`, and say why either way
- [ ] **The customer card** (deferred from T-077): `customer_profiles` is readable from any workspace, as it was before the policies. Weigh narrowing it to the parties who share a mission or a quote
- [ ] Every probe refused; every negative control seen to fail first
- [ ] All pre-existing functionality verified in the browser, not only by tests
- [ ] `tenancy.md` updated from "specified" to what shipped, with any deviation explained
- [ ] Findings fixed and re-verified, never noted and shipped
- [ ] This is the first pass, not a re-run; its AI probes re-run as T-095, T-096 and T-097 land, and each command's cross-workspace probe is part of that command's own done (review 2026-10-06)

**Validation**
```bash
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build
```

---

### T-099 — Agency billing (reserved)
- **Status:** BLOCKED — on the pricing decision (ACTIONS-FOR-ME #17) and the payments provider (#1, Phase 5)
- **Priority:** P3
- **Depends on:** Phase 5
- **Risk:** HIGH
- **Human approval required:** Yes — payment logic
- **Owner agent:** payments
- **Affected:** apps/api/src/modules/payments/**

**Description**
`billing.read` and `billing.manage` are reserved in the permission catalog now, so nothing needs
to move later. Subscriptions and usage records are **not** built until an agency pricing model
exists. Marketplace fees remain as plan.md §12 specifies.

**Acceptance criteria**
- [ ] Pricing decision recorded before any schema
- [ ] Money moves only with a ledger entry and an audit event in the same transaction (`payments-webhooks`)

**Validation**
```bash
pnpm --filter api test billing
```

---

## Phase 4c — Hiring experience (plan.md §13, §30 — the Pursuut benchmark)

How hiring feels. The owner's reference product is Pursuut. Decisions taken on 2026-09-19:

- pre-hire messaging with a masked customer identity is **adopted**
- calling comes **later**
- **marketplace first** for agencies
- **every mission reviewed at launch**

**Order (revised 2026-09-19).** T-100 to T-103 and T-106 belong to the **Core loop**. T-104,
T-105 and T-107 land with agencies. T-108 comes later.

---

### T-100 — Customer identity masked until hire (API)
- **Status:** DONE — 2026-10-01 (owner approved in chat). Owner decision: **alias only, no name** — no first name is collected and `display_name` is free text that can lead with the surname. `customerAlias` on the browse listing (`modules/missions/customer-alias.ts`); `GET /profiles/customer/:id` names the customer only to themself and to an investigator they hired; `test/identity-masking.spec.ts` walks every read
- **Priority:** P1
- **Depends on:** T-077
- **Risk:** MEDIUM
- **Human approval required:** Yes — changes what personal data investigators receive
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{missions,quotes,search}/**

**Description**
Before hire, every investigator-facing projection shows the customer by **first name** and an
opaque per-mission alias. This covers missions, quotes, matches and conversations. It never
shows a surname, email, phone, photo or user id. After hire, the assignment exposes what it
requires; anything further is the customer's choice.

**Acceptance criteria**
- [x] A generated spec walks every investigator-facing view and fails if it contains a customer surname, email, phone, avatar or user id before hire — every GET and `/search` POST read from the router (75 routes, 33 answering the investigator), each path parameter filled with every id they hold; customers have no avatar column. Seen failing first: with the profile unmasked it reports `GET /profiles/customer/:id → <surname>`
- [x] The per-mission alias cannot be correlated across missions — derived from the mission id alone (`sha256`, four Crockford base-32 characters); `customer-alias.spec.ts`
- [x] KB already describes this (`kb-customer-privacy-data` v2, `kb-customer-messaging` v2, `kb-investigator-finding-work` v2): confirm it matches what shipped — it promised a **first name**; now privacy-and-data v4, messaging v3, getting-started v6 and investigator finding-work v4 say no name and a per-mission code (en, and the ru/hy drafts); plan.md §13 and its decision row record the change

**Validation**
```bash
pnpm --filter api test missions quotes identity-masking
```


**Done 2026-10-01.** Before T-100 no investigator view sent the customer's name except one:
`GET /profiles/customer/:id` returned `display_name` to anyone signed in (its row policy is
`public_read`); no view handed out customer profile ids, so it was not reachable in practice, but it
was the one leak. It now returns `null` unless the caller is the customer or an investigator with a
non-cancelled assignment from them — fail-closed for everyone else, staff included (they have the
console). Not covered, because not built: conversations (pre-hire messaging) — when they are, their
id joins the walker's `ids` (`docs/architecture/missions.md`, Privacy).
---

### T-101 — Conversations: pre-hire and assignment (API)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-100, T-036
- **Risk:** HIGH
- **Human approval required:** Yes — private communication between users
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/messaging/**, migrations

**Description**
One model with two kinds (plan.md §13):

- **`PRE_HIRE`** covers one mission × one supplier workspace. The customer opens it with a
  matched or quoting investigator. An eligible investigator opens it with one question, and
  **one unanswered message** is the limit until the customer replies.
- **`ASSIGNMENT`** is the hired supplier's pre-hire thread continuing into the assignment, with
  its history intact. The mission's other pre-hire threads close, read-only and retained.

Beyond the kinds:

- Rows are two-party under RLS (ADR-0011).
- Inside an agency, the member handling the lead or assignment sees the thread, as do holders
  of `leads.read`.
- Attachments go through media, scanned. There are read markers and a reporting control on
  every thread.

This replaces the Backlog item "Messaging with assignment-scoped authorization".

**Acceptance criteria**
- [ ] The one-unanswered-message limit is enforced server-side, with a test for the second message refused
- [ ] Hiring continues the thread and closes the others atomically with assignment creation
- [ ] Cross-workspace probes and an unstaffed-colleague probe; rate limits per sender and per mission
- [ ] **Not exposed to users until T-102 lands**: screening is part of the feature, not a follow-up
- [ ] Retention rows for conversations and messages, including closed pre-hire threads

**Validation**
```bash
pnpm --filter api test messaging
```

---

### T-102 — Message screening: contact details and prohibited requests
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-101
- **Risk:** HIGH
- **Human approval required:** Yes — automated screening of private messages (counsel brief Q33)
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{messaging,mission-policy}/**

**Description**
Deterministic, versioned rules, the same discipline as the mission policy ruleset (T-010):

- **Contact details:** phone numbers in international and local formats, email addresses, and
  messaging-app handles and links, in `en`, `ru` and `hy`. These are **blocked before
  delivery**, and the sender is told why. Repeated attempts are flagged to moderation.
- **Prohibited requests:** ADR-0009's standing prohibitions. These are **flagged**, not
  silently blocked, and the investigator is shown the policy.

AI may classify. It never decides.

**Acceptance criteria**
- [ ] A blocked message is never stored as delivered, and the sender sees the reason and can rephrase
- [ ] Rules are versioned, and every flag records the rule version, as mission screening does
- [ ] Tests in all three languages, including obfuscations ("nine one seven…", "t.me/…", spaced digits)
- [ ] False-positive handling documented; native-speaker review joins T-067

**Validation**
```bash
pnpm --filter api test message-screening
```

---

### T-103 — Matching: a shortlist at publication, and invitations to quote
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-076, T-036
- **Risk:** MEDIUM
- **Human approval required:** Yes — decides who is shown to customers
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/{search,matching}/**

**Description**
When a moderator publishes a mission, the top eligible profiles are computed once, from the
**same ranking discovery uses** (T-011), and stored as `matches`. There is no paid placement.
The customer sees the shortlist, can message any match (T-101) and invite them to quote.
Matched investigators are notified. When agencies land, a matched agency also gets a lead (T-104). Discovery and
open quoting are unchanged.

**Acceptance criteria**
- [ ] Shortlist size is a provisional constant, recorded in ACTIONS-FOR-ME for confirmation, like #15
- [ ] Blocked users (T-052) and ineligible profiles are never matched; a test proves the eligibility filters match discovery's
- [ ] Deterministic for the same inputs; the ranking inputs are stored with the match, so "why was I matched" is answerable
- [ ] KB: `kb-customer-finding-an-investigator` and `kb-investigator-finding-work` describe matching

**Validation**
```bash
pnpm --filter api test matching search
```

---

### T-104 — Agency lead inbox and routing (API)
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-103, T-101, T-089
- **Risk:** MEDIUM
- **Human approval required:** Yes — authorization inside an agency
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/leads/**

**Description**
A `lead` is an agency's inbox item for one mission (plan.md §30). It is created by any of:

- a match
- a customer's invitation
- the agency's own pre-hire question
- a member choosing to pursue a mission

Its states are `NEW → ROUTED → QUOTED → WON | LOST`, or `DECLINED`. `leads.route` routes a lead
to a member or team; the handler sees its conversation and quotes. Time to first response is
measured.

**Acceptance criteria**
- [ ] A member sees only the leads routed to them, unless they hold `leads.read`
- [ ] Routing and state changes are audited; the lead state follows the quote and assignment automatically
- [ ] Personal workspaces get the same inbox with no routing, so independent investigators are not second-class

**Validation**
```bash
pnpm --filter api test leads
```

---

### T-105 — Agency reporting
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-104, T-089
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/analytics/**, apps/app-web/**

**Description**
Read-only reporting behind `analytics.read`, computed from PostgreSQL:

- pipeline (leads → quotes → won)
- response times
- active assignments by member and team
- overdue work
- earnings, once Phase 5 exists

It is shown on a mobile-first dashboard with no third-party analytics receiving client data.

**Acceptance criteria**
- [ ] Every figure is tenant-scoped (matrix and probe) and traceable to its query
- [ ] Usable on a phone: key figures first, detail on tap

**Validation**
```bash
pnpm --filter api test analytics && pnpm --filter app-web test reporting
```

---

### T-106 — Conversations UI (app-web)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-091, T-101, T-102
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Thread list and thread for customers, investigators and agency members: a full-screen thread
on phones, and split view from tablet up. It shows:

- the masked name before hire
- a blocked message's reason inline, where the text was
- the one-unanswered-message state stated plainly
- the reporting control on every thread

**Acceptance criteria**
- [ ] Playwright flows at 375 and 1280: customer opens a pre-hire thread, investigator's second message refused, hire continues the thread
- [ ] Accessibility checks; tap targets of at least 44px; no horizontal scroll
- [ ] Component-discovery log records what was reused

**Validation**
```bash
pnpm --filter app-web test conversations
```

---

### T-107 — Matches and lead inbox UI (app-web)
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-106, T-103, T-104, T-093
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
- **Customer:** the shortlist on the mission, with message and invite-to-quote actions.
- **Agency:** the lead inbox with routing, as cards on phones and a table from desktop.
- **Independent investigator:** the same inbox without routing.

**Acceptance criteria**
- [ ] The shortlist explains itself ("matched because…") from the stored ranking inputs
- [ ] Routing is one action from a lead card, and the state change animates subtly (`animation`)

**Validation**
```bash
pnpm --filter app-web test matches leads
```

---

### T-108 — In-app voice calling
- **Status:** BLOCKED — on counsel (brief Q32, recording consent) and T-101
- **Priority:** P3
- **Depends on:** T-101
- **Risk:** HIGH
- **Human approval required:** Yes — a new provider, and a legal question
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/calling/**, apps/app-web/**

**Description**
Voice calls between the parties of a pre-hire or assignment conversation:

- **masked**: neither side sees the other's number
- **no recording by default**; recording only where counsel confirms consent rules for the
  jurisdictions involved
- call metadata (who, when, duration) is kept on the thread, never content
- works in mobile browsers

A calling provider account is needed when this starts. That is the only manual step, and it is
added to ACTIONS-FOR-ME then, not before.

**Acceptance criteria**
- [ ] No personal number is ever exposed in either direction
- [ ] Rate-limited per conversation; both sides can block and report
- [ ] KB messaging articles updated from "not yet"

**Validation**
```bash
pnpm --filter api test calling
```

---

## Core loop — one market, end to end (plan.md §26 "Delivery order")

The flow a launch needs: mission → match → talk → quote → pay → work → deliver → release. It
comes after the tenancy foundation (T-073 to T-080) and **before** agency features. Decided
2026-09-19. Payments are built against **Stripe Connect**; provider acceptance is a **go-live
gate** (ACTIONS-FOR-ME #1), not a build gate.

**Order**

1. App foundation: T-091 (app-web), T-128 (translation catalogs), T-127 (accounts)
2. Hiring: T-119, T-120, T-100, T-101, T-102, T-103, T-106
3. Money: T-110 → T-111 → T-109 → T-121
4. Work and delivery: T-116, T-117, T-031 to T-033, T-123, T-124, T-125
5. Completion: T-112, T-113, T-118, T-122, T-114, T-115, T-126

Every money task is HIGH risk, owned by the `payments` agent, and follows `payments-webhooks`.

---

### T-109 — Stripe Connect accounts for suppliers
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-077, T-110
- **Risk:** HIGH
- **Human approval required:** Yes — payment logic
- **Owner agent:** payments
- **Affected:** apps/api/src/modules/payments/**

**Description**
Each supplier workspace (Personal or agency) onboards a connected account through Stripe's
hosted onboarding. The platform stores the account id and the state that webhooks report
(details submitted, charges and payouts enabled, requirements due), **never** identity
documents or bank details. A workspace cannot quote until payouts are enabled, or it can quote
with a clear "complete payout setup" block before acceptance. The task decides which,
recording the choice.

**Acceptance criteria**
- [ ] Account state is changed only by verified webhooks; the onboarding link is single-use and short-lived
- [ ] One connected account per supplier workspace, under RLS
- [ ] KB: `kb-investigator-payouts` gains "setting up payouts"

**Validation**
```bash
pnpm --filter api test payments connect
```

---

### T-110 — Ledger and verified webhook intake
- **Status:** TODO
- **Priority:** P0 — nothing moves money before this exists
- **Depends on:** T-077, T-082
- **Risk:** HIGH
- **Human approval required:** Yes
- **Owner agent:** payments
- **Affected:** apps/api/src/modules/payments/**, migrations

**Description**
The foundation `payments-webhooks` requires:

- an **append-only, double-entry-shaped ledger**: integer minor units, corrections as
  compensating entries, S/I only
- a webhook endpoint that verifies the signature on the raw body and rejects stale
  timestamps
- storing the event, acknowledging it fast, and processing it in a job
- idempotency by provider event id, and out-of-order safety against the state machine
- every event type mapped explicitly, including the ones deliberately ignored

**Acceptance criteria**
- [ ] A forged, replayed, stale or duplicated webhook changes nothing, with a test for each
- [ ] Ledger rows cannot be updated or deleted by the application role (grants and REVOKE, as 0009)
- [ ] Unmapped event types alert and never pass silently

**Validation**
```bash
pnpm --filter api test ledger webhooks
```

---

### T-111 — Payment at acceptance, funds held
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-110, T-012
- **Risk:** HIGH
- **Human approval required:** Yes
- **Owner agent:** payments
- **Affected:** apps/api/src/modules/{payments,quotes,assignments}/**

**Description**
Accepting a quote creates a PaymentIntent on the backend. When a **verified**
`payment_intent.succeeded` arrives, three things happen in one transaction:

- the ledger records the customer's funds held
- the payments module builds a `PaymentAuthorization`
- it calls `AssignmentsService.createForAuthorizedPayment`, the T-012 boundary

The funds stay in the platform balance (plan.md §12, "Holding funds").

**Acceptance criteria**
- [ ] An assignment is created only by the verified webhook path; a client callback or redirect changes nothing (tested)
- [ ] Exactly one assignment under concurrent and duplicated webhooks (T-012's guarantee, extended)
- [ ] The amount and currency are checked against the accepted quote; a mismatch holds the payment for staff review
- [ ] `ACTIONS-FOR-ME #16` updated: the boundary now has a real implementation

**Validation**
```bash
pnpm --filter api test payments assignments
```

---

### T-112 — Release on completion, and payouts
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-111, T-109, T-117
- **Risk:** HIGH
- **Human approval required:** Yes — fee and payout logic
- **Owner agent:** payments
- **Affected:** apps/api/src/modules/payments/**

**Description**
When the customer accepts the final report, or the review window lapses without a
dispute, the platform:

1. calculates the fee with written rounding rules (the remainder's destination decided, not
   left to `Math.round`)
2. transfers the remainder to the supplier's connected account
3. records ledger entries for both

Payout status is synced from webhooks.

**Acceptance criteria**
- [ ] Fee rate is a provisional constant pending the owner's fee decision (ACTIONS-FOR-ME #16), recorded like #15
- [ ] Adversarial rounding tests: 1 minor unit, amounts that do not divide evenly
- [ ] A disputed assignment never releases; release is idempotent

**Validation**
```bash
pnpm --filter api test payouts fees
```

---

### T-113 — Refunds, cancellations and chargebacks
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-111
- **Risk:** HIGH
- **Human approval required:** Yes — refund policy
- **Owner agent:** payments
- **Affected:** apps/api/src/modules/payments/**

**Description**
Full and partial refunds follow the quote's cancellation terms and dispute outcomes (T-118).
Chargebacks are handled from webhooks, and allocated per counsel brief question 17. Every
movement is a ledger entry.

**Acceptance criteria**
- [ ] Refund amounts can never exceed what was held, net of earlier refunds (tested under concurrency)
- [ ] The assignment and mission state machines move only through their transition services
- [ ] KB payments and refund articles checked against the behaviour

**Validation**
```bash
pnpm --filter api test refunds
```

---

### T-114 — Receipts and invoices
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-111, T-112
- **Risk:** MEDIUM
- **Human approval required:** Yes — tax documents (counsel brief question 18)
- **Owner agent:** payments
- **Affected:** apps/api/src/modules/payments/**

**Description**
Receipts for customers and invoices for suppliers are **generated from ledger entries**, never
computed separately. They are numbered, immutable once issued, and stored as private PDFs
through media. They are localised, and branded for agencies when T-084 exists.

**Acceptance criteria**
- [ ] Every figure on a document traces to ledger entry ids
- [ ] A correction is a new document referencing the old one, never an edit

**Validation**
```bash
pnpm --filter api test invoices
```

---

### T-115 — Reconciliation
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-110
- **Risk:** HIGH
- **Human approval required:** Yes
- **Owner agent:** payments + infra-devops
- **Affected:** apps/api/src/modules/payments/**, workers

**Description**
A scheduled job compares the ledger with Stripe's balance transactions and **alerts on drift**.
It never auto-corrects.

**Acceptance criteria**
- [ ] A seeded drift raises an alert, and a clean day raises none
- [ ] Runbook in `docs/operations/` for investigating drift

**Validation**
```bash
pnpm --filter api test reconciliation
```

---

### T-116 — Evidence items with chain of custody and access grants
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-077, T-080
- **Risk:** HIGH
- **Human approval required:** Yes — evidence access rules
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/evidence/**, migrations

**Description**
Evidence per plan.md §15 and `evidence-integrity`:

- assignment-linked and immutable once submitted
- a server-computed checksum
- chain-of-custody entries for every view, download and transfer
- location metadata only when lawful and necessary

Access is by **grant**, short-lived and audited. There is no "staff can browse evidence" mode;
staff access requires a dispute-linked grant in `PlatformContext`.

**Acceptance criteria**
- [ ] Material withdrawn from use after a policy halt is marked, never erased — moved here from T-050
- [ ] `source_id` nullable, referencing `investigation_sources` — moved here from T-031, since
      evidence must never be blocked on a source (plan.md §8)
- [ ] Evidence cannot be edited or deleted by the application; a correction is a new item referencing the old
- [ ] Every access writes a custody entry and an audit row; the customer can see the access history
- [ ] Legal hold (T-035) blocks retention deletion: evidence's retention job deletes through `RetentionGuard.sweep()` with every resource an item belongs to (the item, its assignment), adds `EVIDENCE_ITEM` to `legal_hold_resource`, and a test proves it skips held evidence and reports why — moved here from T-035

**Validation**
```bash
pnpm --filter api test evidence
```

---

### T-117 — Reports: versions, evidence classes, sign-off and customer review
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-116
- **Risk:** HIGH
- **Human approval required:** Yes — a delivery that triggers payment release
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/reports/**, migrations

**Description**
Versioned reports per plan.md §15 and `report-generation`:

- every finding is classed FACT, CLAIM, INFERENCE, HYPOTHESIS or UNKNOWN, with no silent
  promotion
- AI-drafted text is marked unverified until the investigator approves it
- investigator sign-off freezes a version

The customer's review then either accepts the report, which triggers release (T-112), requests
a revision, which opens a new version, or opens a dispute (T-118).

**Acceptance criteria**
- [ ] A FACT must cite evidence ids; a HYPOTHESIS only appears in its marked section (tested)
- [ ] A signed version is immutable; a revision is a new version with the diff available
- [ ] The review window and its lapse behaviour are provisional constants recorded for confirmation

**Validation**
```bash
pnpm --filter api test reports
```

---

### T-118 — Disputes
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-117, T-079
- **Risk:** HIGH
- **Human approval required:** Yes — decisions that move money
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/disputes/**, admin-web

**Description**
A customer disputes a delivered report from its review state. The dispute freezes release.
Both parties submit statements and references. A staff member with the DISPUTES scope reads the
evidence through a dispute-linked grant in `PlatformContext` and decides: release, a partial
refund, or a full refund. The decision is recorded with its reasons, and the money moves
through T-112 and T-113. The flow follows the existing KB articles on disputes.

**Acceptance criteria**
- [ ] Release is impossible while a dispute is open (tested against T-112)
- [ ] The decision, its reasons and every staff access are audited; the parties see the outcome and the reasons
- [ ] Staff console screen, with T-070's patterns
- [ ] Opening a dispute places a legal hold (T-035) on the assignment automatically, as the system; resolving the dispute does not release it — release stays a COMPLIANCE decision. `legal_holds.placed_by` is NOT NULL today; recording a system placement needs a migration that says what placed it (the dispute). Moved here from T-035

**Validation**
```bash
pnpm --filter api test disputes
```

---

### T-119 — Guided mission intake (app-web)
- **Status:** DONE — 2026-09-26 (browser pass outstanding, below)
- **Priority:** P1
- **Depends on:** T-091, T-128, T-010
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Plain questions, one per screen on a phone (plan.md §10): what you need, where, by when,
budget, languages. They produce a structured brief. It then shows the lawful-purpose
confirmation in the customer's own words, the draft saved automatically, and submission into
moderation with a plain explanation of what happens next. When the assistant exists (Phase 7)
it may draft the brief, and the customer confirms it.

**Acceptance criteria**
- [ ] Completable on a 375px phone in one hand; no investigation vocabulary required
- [x] Screening outcomes (rejected, needs changes) explained in plain language, with what to fix
- [ ] Playwright flow; accessibility checks; component-discovery log — **only the discovery log is done** (component inventory, `app-web.md`)

**Validation**
```bash
pnpm --filter app-web test mission-intake
```

**DONE — 2026-09-26 — committed at the owner's request before the browser pass.** The first and
third criteria stay unticked: neither was checked in a browser.

*What exists.* **API** (owner's choice, asked): `review` on the customer's own mission —
`{ outcome: REJECTED | CHANGES_REQUESTED, reason, decidedAt }` from the mission's latest move, only
when a STAFF move out of `UNDER_REVIEW`; never screening's SYSTEM move (`missions.md`). **app-web:** a
customer's `/missions` (their missions; "Changes requested" on a returned draft), `/missions/new` and
`/missions/[id]`: nine plain screens (need, kind, where, when, budget, languages, who, why, brief),
one per screen at every width, saving themselves — serially, versioned, 800 ms after typing, and
before every move; opening creates nothing. The brief ends with the lawful-purpose tick, which is
only ever the customer's. A returned draft carries the reviewer's note on every screen; a rejection
shows the reason and "Start a new mission from this one". `@shadcn/progress`, `radio-group`,
`checkbox` adopted and re-tokenised.

*Found along the way.* (1) Three draft rules exist only as CHECK constraints — inverted budget,
inverted dates, empty text — and answer 500: the intake never sends them; filed as T-153. (2) The
first cut of "hold an inverted pair" still sent the last valid keystroke ("90" while typing "900"
against a maximum of 500); a held pair now withdraws its queued keys. (3) Cancelling has an API and a
KB answer but no screen: T-154. (4) The KB article promised attachments and per-category questions
that do not exist; corrected. (5) T-051 is told the rejection reason is customer-facing.

*Negative controls* (each seen to fail, then restored): API — an older outcome treated as standing;
a draft edit dropping the review; screening's reason passed on. Web — a held pair still sending what
was queued; an inverted budget sent; emptied text sent as ""; saves racing; Continue with an answer
missing; sending without the tick; a returned draft hiding the note; a draft created on opening; the
tick copied into a revision.

*Verified.* API `test:coverage` 2,423 passing, 100%; app-web 495 passing, 100%; i18n parity;
lint; typecheck; build (with `env -u NODE_ENV`, T-141); budget — intake routes 181 kB. In the
browser: only the signed-out redirect (`/missions/new` → `/sign-in?next=…`). **Not done:** the
375/1280 pass through the intake, the returned and rejected views, and axe checks — the agent cannot
sign in, and the dev account has no Customer role. Dev data has one taxonomy node.

*Docs.* `app-web.md`, `missions.md`, KB `kb-customer-creating-a-mission` v2 (ru/hy drafts in step),
component inventory, glossary terms used as written (задание, գործ).

---

### T-120 — Finding investigators: discovery and public profiles (app-web)
- **Status:** DONE — 2026-09-26
- **Priority:** P1
- **Depends on:** T-091, T-128, T-011
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Discovery filters per plan.md §9: a map and list view on desktop, and a list with a map on
demand on phones. The public investigator profile page shows verification, specialties, areas,
languages and reviews (T-037), and the agency once T-087 exists. Matches (T-107) reuse the same
card.
`PublicProfileCard` (T-123) already renders the public projection, and is what the investigator's
own preview shows — reuse it for the profile page.

**Acceptance criteria**
- [x] Filters are the typed, closed set the API accepts; an empty result suggests widening, not a dead end
- [x] Profile pages expose only the public projection

**Validation**
```bash
pnpm --filter app-web test discovery profiles
```

**DONE — 2026-09-26**

*App.* A customer's Missions has two views (links, not a new destination — owner decision):
their missions, and **Find investigators** (`/missions/investigators`). Filters are the address
(specialty, languages, country, city, a weekday, pricing), applied from a sheet on the mission
browse's pattern; each active filter is a removable chip. "Near me" is the device's position rounded
to two decimals, in memory only, with a radius from "covers me" to 100 km — coordinates never enter
a URL. Cards say why each investigator is listed from `matchedOn`/`notMatched` only. Empty results
offer the chips to remove, or "Search up to 100 km away". The profile page is T-123's
`PublicProfileCard` plus reviews (summary, stars read as words, words and reply, never the reviewer);
unpublished or unknown → 404. Someone working as an investigator is sent back to Missions.

*API.* The public projection carries `verified: boolean` (owner decision) — `PENDING` and `REJECTED`
both read as `false`, the status itself never leaves; tested per status.

*Scope.* No map: no provider is chosen (T-147). Areas are not on the profile page: the public
projection has none. Reviews rendering is verified in specs only — the dev database has no reviews.

*Also.* The taxonomy flatten helper existed twice and would have been a third copy:
`lib/taxonomy.ts` now. Duplicate name heading on the profile page found in the browser and fixed.

---

### T-121 — Quotes, checkout and assignment tracking (app-web)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-091, T-111, T-101
- **Risk:** HIGH — the payment surface
- **Human approval required:** Yes
- **Owner agent:** frontend + payments
- **Affected:** apps/app-web/**

**Description**
- **Quotes:** compared side by side on desktop and stacked on phones, with scope, exclusions,
  cancellation terms and expiry visible before acceptance.
- **Checkout:** Stripe's Payment Element. No card data touches our servers, and a return from
  checkout shows "confirming" until the webhook-created assignment appears.
- **Tracking:** the assignment timeline shows status, the investigator's acceptance window, and
  updates.

> **From T-154:** cancelling a mission is offered for a draft and a mission under review. A `QUOTED`
> mission is not: cancelling it closes its open quotes, so it belongs here, beside them, with
> `CancelMission` (`components/missions/cancel-mission.tsx`) reused and a `quoted` stage in its copy.

**Acceptance criteria**
- [ ] The UI never shows "paid" or "assigned" from the client's own callback, only from server state (tested)
- [ ] Idempotent acceptance: a double-tap produces one payment
- [ ] CSP allows Stripe's origins only where required (T-025)

**Validation**
```bash
pnpm --filter app-web test quotes checkout assignment
```

---

### T-122 — Evidence and report review (app-web, customer)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-117, T-118, T-106
- **Risk:** HIGH — evidence access
- **Human approval required:** Yes
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
The customer reads the report, with evidence classes shown plainly (fact, claim, inference),
and opens evidence through short-lived grants. They then accept, request a revision, or
dispute. Accepting explains that it releases payment.

**Acceptance criteria**
- [ ] No evidence URL is stored, cached or shareable beyond its grant
- [ ] Revision and dispute forms ask what is wrong specifically, as the KB advises

**Validation**
```bash
pnpm --filter app-web test report-review
```

---

### T-123 — Investigator profile, service areas and verification (app-web)
- **Status:** DONE — 2026-09-25
- **Priority:** P1
- **Depends on:** T-091, T-128, T-013
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Profile editing, service areas (a map draw or radius on desktop; search a place plus a radius on
phones), languages, availability, and the verification application. The application uploads
documents through the private flow and shows its status and the decision reasons (T-013).

**Acceptance criteria**
- [x] The profile preview is exactly the public projection customers see
- [x] Verification history shows each decision's reason, never the reviewer

**Validation**
```bash
pnpm --filter app-web test investigator-profile verification
```

**DONE — 2026-09-25**

*App.* `/account/investigator`: a status card (checklist linking to each section, verification
badge, publish and accepting switches, "Preview as a customer" in a drawer), then one form per
section — about you, languages with levels, specialties (searchable taxonomy), availability windows,
service areas, verification (history with reasons; documents uploaded through the private flow,
then the application). Linked from Account's roles section and from Missions' "cannot quote yet"
state. `@shadcn/switch` adopted and re-tokenised; language, country and currency lists come from
`Intl` on the server (`lib/codes.ts`), not a list in the codebase.

*API.* `GET /profiles/investigator/me/preview` (the public projection of the own row);
`verificationStatus` on the own profile; `displayName` editable through the profile PATCH until
verification — refused as `LOCKED` while PENDING or VERIFIED (owner decision), audited as
`profile.display_name_changed`. Documented in `docs/architecture/profiles.md`.

*Scope, decided with the owner.* Areas are "use my location" + radius, not a map or place search:
no provider is chosen and either sends locations to a third party (T-147). The upload was not
driven end to end — Cloudinary is not configured locally (ACTIONS #4); the page's failure path was.
Changing a verified name is T-148.

*Found in verification and fixed:* language rows overflowed a phone; availability's remove button
sat alone on a row; the uploading state stuck after a failed upload; a selected specialty's
accessible name read "Due diligenceselected" (caught by the spec).

---

### T-124 — Quoting and assignment acceptance (app-web, investigator)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-054, T-106
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
The quote form carries the fields T-012 validates, with expiry bounds explained. Withdrawal
and replacement are supported. The assignment acceptance screen shows the 48-hour window
counting down, and the customer's first name only until acceptance (T-100).

**Acceptance criteria**
- [ ] Validation messages match the API's field codes; nothing is validated only in the client
- [ ] The acceptance window is visible without opening the assignment

**Validation**
```bash
pnpm --filter app-web test quoting
```

---

### T-125 — Investigation workspace (app-web, investigator)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-031, T-032, T-033, T-116, T-117
- **Risk:** HIGH — evidence handling
- **Human approval required:** Yes
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
The workspace is one page per assignment: sources, notes (private by default), tasks,
documents, evidence upload with a custody receipt, and the report editor with evidence
classes. Tabs on desktop, a segmented view on phones. Promoting a document to evidence is
explicit and explained as irreversible.

**Acceptance criteria**
- [ ] Changing a note from private to shared requires confirmation and is audited
- [ ] The report editor cannot mark a finding FACT without citing evidence
- [ ] Usable on a phone for field updates: add a note, upload evidence, tick a task

**Validation**
```bash
pnpm --filter app-web test workspace
```

---

### T-126 — Earnings, payouts and invoices (app-web, investigator)
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-109, T-112, T-114
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Payout setup through a Stripe onboarding link, earnings by assignment (the gross, the fee and
the net shown separately), payout status, and invoice downloads.

**Acceptance criteria**
- [ ] Every figure comes from the API's ledger-derived values, never recomputed in the client
- [ ] Payout troubleshooting matches `kb-investigator-payouts`

**Validation**
```bash
pnpm --filter app-web test earnings
```

---

### T-127 — Sign-up, sign-in and account screens (app-web)
- **Status:** DONE — 2026-09-25
- **Priority:** P0 — every other screen starts here
- **Depends on:** T-091, T-128, T-022
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Registration with versioned legal acceptance (T-022), sign-in, email verification, password
reset, the session and device list, and role switching between customer and investigator.
Google sign-in joins with T-062.

**Acceptance criteria**
- [x] **Acceptance is part of these screens** (from T-022): sign-up shows the text or a link to it and posts `acceptedDocumentIds`; the account area shows what is outstanding (`GET /legal/outstanding`) and clears it (`POST /legal/acceptances`). The locale shown is what gets recorded, so the screen must pass the locale it rendered. Blocking a specific action on outstanding acceptance belongs here too — never a blanket block, which would cut off read access to an active assignment's existing obligations
      — documents come from the new `GET /legal/required?for=registration|CUSTOMER|INVESTIGATOR&locale=`
      (policy stays single-sourced in `legal.policy.ts`), are read in full in place, and their ids —
      the exact version and locale shown — are posted back. Checked in the browser: a Russian sign-up
      shown English documents recorded `locale_shown = en`, context `REGISTRATION`. Outstanding
      documents are a notice on every screen and a section on the account page; the one action held
      back is adding a role, which shows and requires that role's documents in the same form
- [x] Every auth error is privacy-preserving, and never reveals whether an email is registered
      — one sign-in message for wrong password, unknown address and malformed field; register,
      resend and reset answer the same for every address; reference ids only on 5xx and network
      failures
- [x] Session cookie behaviour matches T-025; the flows are tested end to end against the API
      — the API alone sets and clears the cookie (browser calls to same-origin `/api/v1`); checked
      in the browser as HTTP-only, `SameSite=Strict`, host-only. Every flow was run by hand against
      the real API at 375, 768 and 1280px, and in Vitest against a stand-in API that fails any
      unexpected request. An automated browser run in CI is **T-139**
- [x] The language choice (T-128's `locale` cookie, **Account → Language**) is saved to the account, and a signed-in user's saved language is written to the cookie at sign-in — the API's assistant reads `users.locale`, so the two must agree
      — `chooseLocale` saves via the new `PATCH /me/preferences` (audited); `/session/start` writes
      the account's language into the cookie; sign-up saves the screen's language. Checked: `hy`
      saved, restored on a fresh English browser with no cookie
- [x] The reader's time zone is stored and passed to `formatDateTime`, which requires one (T-128)
      — `users.timezone`, set from the device at sign-up, editable on the account page (IANA names
      only; offsets refused); session times are formatted in it

**Evidence**
- app-web: 22 spec files, 184 tests, 100% statements/branches/functions/lines;
  `pnpm --filter app-web test auth` 38 tests. API: 2179 tests, 100%. Mutation check: removing the
  double-submit guard fails its test
- `pnpm lint`, `pnpm typecheck`, `pnpm build` (with `NODE_ENV` unset, as CI), bundle budget (largest
  route `/account` 137.7 kB of 250), no public source maps, `pnpm audit --audit-level=high` clean,
  knowledge-base validator 0 errors / 0 warnings
- Docs: `docs/architecture/app-web.md` (accounts section), component inventory, `legal-consent`
  skill note, KB `account-access-and-security`, `getting-started`, `troubleshooting` in en/ru/hy
- Found and filed: **T-138** (API has no `trust proxy`: per-IP limits and audit IPs are the
  proxy's), **T-139** (browser flows in CI); T-135 progress noted. Fixed in passing: legal document
  responses carried no `id`, so no client could accept a published document (regression test seen
  failing first)

**Validation**
```bash
pnpm --filter app-web test auth
```

---

### T-128 — App translation catalogs (en, ru, hy)
- **Status:** DONE — 2026-09-24
- **Priority:** P0 — screens are written against keys from the first one
- **Depends on:** T-091
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** localization
- **Affected:** apps/app-web/**, packages/i18n/**

**Description**
Translation catalogs for the application UI, with a build-time parity check across `en`, `ru`
and `hy`. Dates, numbers and currencies are locale-aware, and there is a documented fallback.
This moves the Backlog item into the core loop, because the launch market's languages are not
optional.

**Acceptance criteria**
- [x] A missing key in any locale fails the build
- [x] No user-facing string literal in feature code (lint rule)
- [x] Replaces T-091's interim `apps/app-web/src/i18n/messages.ts` (English, typed keys); the keys it defines carry over, and `<html lang>` follows the reader's locale

**Validation**
```bash
pnpm --filter app-web test i18n && pnpm --filter app-web build
```

**DONE — 2026-09-24**

*What exists.* `packages/i18n`: catalogs (`en.ts` source; `ru.ts`, `hy.ts` typed against it),
`resolveLocale` and the formatters (date/time with a required time zone, numbers, money from minor
units, relative time). app-web translates through `use-intl` (ADR-0013 — not `next-intl`, whose
extraction tooling ships native install scripts): `getT()` on the server, `useTranslations` for
client components, which receive only the `nav` namespace. The locale is the reader's choice (a
cookie set from **Account → Language**), else `Accept-Language`, else English; `<html lang>` and
titles follow it.

*Criteria.*
- Missing key fails the build: seen — deleting a Russian key and adding an Armenian one each fail
  `pnpm build` with a type error, and an unknown key in a page fails the typecheck. A test adds
  ICU validity, identical arguments to English and full plural categories per language (Russian's
  four), and tests itself on six kinds of broken catalog.
- Lint: JSX text, string children, and literal `aria-label`/`title`/`alt`/`placeholder` refused in
  app-web (probed: six violations in three scripts caught; keys, numbers, punctuation pass).
- T-091's module is gone; its keys carried over, nested.

*Found along the way.* (1) **Russian «Сообщения» and Armenian «Պատվերներ» were clipped in the 75px
phone tabs** — seen in the browser, not the tests. 12px is the smallest type token, so the words
changed: «Чаты», «Գործեր» (Armenian empty states follow, so a screen uses one term). The rule is in
`app-web.md` and ACTIONS #23. (2) A malformed `q=` weight in `Accept-Language` was read as weight 1 —
a test caught it; now the entry is dropped. (3) 50 more iCloud conflict copies (`css.spec 2.ts`,
an empty `src/app 2/`) broke `tsc`; quarantined to the session scratchpad, not deleted, after
checking they were older copies. Three more sit inside `.git/` and were left alone — **the
repository should move off iCloud Desktop** (ACTIONS #24, added here: it was referenced but missing).

*Negative controls* (each broken on purpose, seen to fail, restored byte-for-byte): Russian key
removed (build); Armenian key added (build); unknown key in a page (typecheck); an English argument
the translations lack; the cookie ignored; fallback showing the key; `<html lang>` fixed to `en`;
the whole catalog sent to the browser; the cookie scoped to every subdomain; any string accepted as
a locale.

*Verified.* Production build in a browser at 375px: Russian and Armenian browsers get their
language, German falls back to English; choosing Русский on Account switches every page without
JavaScript and outlasts an Armenian browser; the cookie is host-only, HTTP-only, `Secure`, Lax,
365 days; every tab label fits in all three languages. 131 kB initial JS (budget 250).
**Translations are not native-reviewed** — ACTIONS #23.

*Follow-up, same task (2026-09-25), on the two points left for the owner to confirm.*
- **Cookie vs locale URLs — one gap found and closed.** The marketing site keeps its locale in the
  URL and cannot set the app's host-only cookie, so a reader of the Russian marketing site with an
  English browser would have landed in English. `src/middleware.ts` now accepts `?lang=<locale>` on
  any link into the app, records it as the reader's choice and 303-redirects to the clean URL
  (other parameters kept; unknown values dropped). One cookie-options constant now serves both
  writers. Verified in the browser; T-024 carries the matching criterion.
- **Word choices — checked against real usage**, recorded in
  `docs/product/translation-glossary.md` for the native reviewer. Armenian now says «դետեկտիվ»,
  not «խուզարկու»: the lawful registered business uses «դետեկտիվ բյուրո», the press uses
  «մասնավոր խուզարկու» for unlicensed surveillance. Russian «детектив» matches its law.
- **Legal lead, not acted on:** the same search found a press report that private surveillance
  of individuals is criminally punishable in Armenia. Recorded as a CLAIM under ACTIONS #2 and as
  counsel question 7a — it bears on ADR-0009 for a launch locale, and is not engineering's call.
- 19 more iCloud conflict copies (build and coverage output only) quarantined.


---

### T-129 — Compute the login decoy at startup, not on first use
- **Status:** DONE — 2026-09-26, approved by the owner in chat. `PasswordService.onModuleInit` makes the decoy hash, per instance; `verifyDecoy` throws if it was never made rather than making it late. Startup cost: one argon2id hash, median 11.8 ms (max 15.4 ms, 15 runs) on the development machine. Specs in `password.service.spec.ts` count argon2 calls on a freshly imported module (first call: 0 hashes, 1 verification) and prove Nest will not start without the decoy; 3 seen failing on the old service. Seen on the built API: after a restart, the first unknown-address login (42 ms) costs what a first wrong-password login does (35 ms) — both are warm-up — and then both paths take 19–24 ms. `test/passwords.ts` gives specs an initialised service
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** Yes — authentication logic (AGENTS.md)
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/password.service.ts

**Description**
Found in T-069. `verifyDecoy` computes its decoy hash lazily, so the **first** sign-in attempt
for an unregistered address in each API process pays for a hash **and** a verification: about
twice a real one. That is one response per process start whose timing says the address is not
registered, the oracle the decoy exists to close. Computing the decoy when the module
initialises removes it.

**Acceptance criteria**
- [x] The decoy hash exists before the first request is served (the app refuses to become ready without it)
- [x] A test proves the first `verifyDecoy` call costs one verification, not two, using the structural check T-069 added and not only a clock
- [x] Startup time impact measured and recorded

**Validation**
```bash
pnpm --filter api test password
```

---

### T-130 — `pnpm format:check` fails on 21 files, and nothing notices
- **Status:** DONE — 2026-09-26; format:check green, now a PR gate
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** apps/api/src/database/migrations/meta/**, apps/api/tsconfig.json, eslint.config.js,
  two spec files, .github/workflows/pr.yml

**Description**
Found in T-042. `pnpm format:check` has been red for some time: seventeen drizzle-kit `meta/`
snapshots, `apps/api/tsconfig.json`, `eslint.config.js` and two spec files. CI never runs it, so
nobody has seen it — the same shape of problem as the four no-op steps T-042 removed, one layer
out: a check that exists, is not wired to anything, and has quietly been failing.

The snapshots are generated by drizzle-kit and will come back unformatted every time a migration
is generated, so the answer is probably to exclude `migrations/meta/` in `.prettierignore` rather
than to reformat them.

**Acceptance criteria**
- [ ] `pnpm format:check` passes
- [ ] Generated files are ignored rather than reformatted, or the generator's output is accepted
- [ ] The check runs in CI, so it cannot go red unnoticed again
- [ ] No behaviour change: formatting only

**Validation**
```bash
pnpm format:check
```

---

### T-131 — Seed the reviewed taxonomy
- **Status:** BLOCKED — needs ACTIONS-FOR-ME #2 (the six open questions in `docs/product/taxonomy-draft.md`)
- **Priority:** P0 — until this lands, there is nothing to file a mission under or declare
- **Depends on:** T-053
- **Risk:** MEDIUM
- **Human approval required:** Yes — which nodes exist, and at what band, is a licensing and
  compliance decision (AGENTS.md)
- **Owner agent:** database
- **Affected:** a new migration, docs/product/taxonomy-draft.md, docs/knowledge-base/**

**Description**
Split from T-053 (2026-09-23). Slugs become permanent ids the moment they are written (ADR-0007
rule 1), so the tree is seeded once, after review, rather than provisionally.

**Acceptance criteria**
- [ ] The six open questions answered and recorded in `taxonomy-draft.md`, with the licensing
      requirement per node per launch jurisdiction
- [ ] Seeded by migration, with every node carrying an English label and a risk band — the
      migration sets `app.platform_access`, because RLS on the taxonomy is forced on the owner too
- [ ] `ru` and `hy` labels, professionally translated (as T-027 is for legal text)
- [ ] Structured questions per node (plan.md §10) — the HIGH and RESTRICTED bands are
      meaningless without them, and `creating-a-mission.en.md` already promises them
- [ ] The customer and investigator KB describe the real tree, not the draft

**Validation**
```bash
pnpm --filter api test taxonomy
```

---

### T-132 — Source capability axis
- **Status:** TODO
- **Priority:** P2 — ranks and routes; never gates eligibility
- **Depends on:** T-053
- **Risk:** MEDIUM
- **Human approval required:** Yes — it changes discovery's ordering, and adds staff write paths
  to platform data, as T-053 did
- **Owner agent:** database (schema) + backend-domain (service)
- **Affected:** apps/api/src/modules/{taxonomy,search,profiles}/**, migrations

**Description**
Split from T-053 (2026-09-23): the second, investigator-only axis of ADR-0008. What access and
capability an investigator has, per jurisdiction — as distinct from what kind of work it is.

**Acceptance criteria**
- [ ] `SourceNode` tree with per-locale labels, staff-maintained — the same `staffMaintained`
      table class, grants and policies as the taxonomy (T-053)
- [ ] `InvestigatorSourceCapability` is **(investigator, source, jurisdiction)** — an
      unqualified source declaration is meaningless
- [ ] Declared by investigators only; **customers never see or pick sources**
- [ ] **A test proves a source declaration cannot gate eligibility** — neither excluding an
      investigator the taxonomy qualified, nor qualifying one it did not
- [ ] Source capability reorders results by feasibility in the mission's jurisdiction
- [ ] Self-declared capability is stored and displayed as self-declared, never as verified
- [ ] `TaxonomySourceHint` maps taxonomy node + jurisdiction to likely sources, as a routing
      hint; a wrong hint degrades ordering, never correctness
- [ ] The source vocabulary is seeded after the same review as T-131

**Validation**
```bash
pnpm --filter api test sources
```

---

### T-133 — Vector half of assistant session search
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-045, T-016
- **Risk:** MEDIUM
- **Human approval required:** Yes — it sends conversation content to an embedding provider, a
  data-processing decision (ACTIONS-FOR-ME #6)
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai-sessions/**, migrations, workers

**Description**
Split from T-045 (2026-09-23): ADR-0001's hybrid search over sessions, adding pgvector similarity to
the full-text search that shipped. Waits for T-016's embedding provider rather than building a
second one.

**Acceptance criteria**
- [ ] Message embeddings through T-016's provider abstraction, computed by a job, never inline
- [ ] The embeddings table joins `SESSION_CONTENT`, so deleting a session erases them in the same
      transaction (a spec already fails until it does)
- [ ] Hybrid ranking merges full-text and vector scores; a query with no embedding still works
- [ ] Row-level security as `ai_messages`: its own user, its own workspace
- [ ] Which provider receives conversation content, and under what terms, is recorded before any is sent

**Validation**
```bash
pnpm --filter api test ai-sessions
```

---

### T-134 — The verification queue repeats a row at every page boundary
- **Status:** DONE — 2026-09-23
- **Priority:** P1 — staff see a duplicated application on every page after the first
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No — ordering only; nothing about who may see what changes
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/verification/verification.service.ts, its spec

**Description**
Found in T-050. `verification_requests.submitted_at` takes the database default, with microsecond
precision; the queue's cursor round-trips it through a JavaScript `Date`, with milliseconds. The
cursor therefore reads back *earlier* than the row it was built from, and the next page begins with
that row again. The queue's tests never see it because they set `submitted_at` from JavaScript.

**Acceptance criteria**
- [x] A regression test that submits through the service, pages across a boundary, and is seen to fail first
- [x] Order and compare at millisecond precision, as `PolicyRefusalService.queue` does
- [x] Every other cursor-paged list checked for the same shape, and the check recorded — see below

**Validation**
```bash
pnpm --filter api test verification
```


**DONE — 2026-09-23**

*Worse than filed.* The regression test did not find a duplicate at the boundary; it found that
paging **never advanced**. The cursor read back earlier than its own row, so every "next page" was
the same application. A reviewer could not get past page two of the verification queue. The test
submitted two applications through the service and paged one at a time: 500 iterations, one unique
row, against the old code. Fixed by ordering and comparing on `date_trunc('milliseconds', …)`.

*Every other paged list, checked:*

| List | Cursor | Finding |
|---|---|---|
| Verification queue | `submitted_at`, id | **Broken in production** — fixed |
| Policy-review queue | `raised_at`, id | Fixed in T-050 |
| Assistant sessions | `last_activity_at`, id, newest first | **Latent** — every writer sets it from JavaScript today, but the column defaults to microseconds, and newest-first that silently **skips** rows. Test written with microseconds, seen to lose one of four, fixed |
| Assistant messages | integer sequence | Correct |
| Investigator search | distance (float8), id | Correct — a float64 round-trips exactly |

*Guard.* `test/cursor-precision.spec.ts` refuses a timestamp column compared directly with a decoded
cursor value; seen to fail when the verification comparison is put back. The rule is written into
`docs/api/pagination.md`.
---

### T-135 — Error message catalogs in en, ru and hy
- **Status:** DONE — 2026-09-26 (ru and hy await native-speaker review: ACTIONS-FOR-ME #23)
- **Priority:** P2
- **Depends on:** T-091
- **Risk:** LOW
- **Human approval required:** No — native-speaker review before ru/hy ship, as T-026
- **Owner agent:** localization
- **Affected:** apps/app-web (message catalogs), docs/api/errors.md

**Description**
Found in T-017. `docs/api/errors.md` says every error code ships with its translation key in en, ru
and hy. The API sends only keys (`error.common.rate_limited`, …), and no catalog exists anywhere to
turn one into a sentence, so none of the nine codes can be shown to a user in any language,
including `SERVICE_UNAVAILABLE`, added in T-017. The catalogs belong to the web app, which T-091
founds.

**Progress (T-127):** `packages/i18n` now has en, ru and hy entries for all nine
`ERROR_MESSAGE_KEY` keys and for the validation keys the auth and account forms meet (email,
password, time zone, each legal document); app-web renders them by key. Still open: every other
validation `messageKey`, the assistant codes, and the test below.

**Acceptance criteria**
- [x] A catalog entry in en, ru and hy for every key in `ERROR_MESSAGE_KEY`, and for every
      `messageKey` a validation error can carry
- [x] The assistant's discovery reason codes (`matched.*`, `not_matched.specialty`), clarification
      codes and `location.anywhere` (T-018) — the API sends codes and data, never sentences
- [x] A test fails when an API error key has no entry in every locale
- [x] The entries live in `packages/i18n` beside the UI catalogs (T-128), so the typed parity check covers them for free
- [ ] ru and hy reviewed by a native speaker before they are marked current

**Validation**
```bash
pnpm test
```

**DONE — 2026-09-26**

*Catalogs.* 29 keys the API could send had no sentence in any language — media, quotes, service
areas, taxonomy, verification, policy reviews, the idempotency key and more. All now have en, ru and
hy entries in `packages/i18n` (`error.validation.*`). The assistant's reason and clarification codes
were already rendered by T-059's cards (`assistant.discovery.reason.*`, `clarify.*`, `anywhere`).

*The test.* `apps/app-web/src/lib/api/error-catalog.spec.ts` reads every `'error.…'` string in the
API's source and fails for any without a sentence in each locale, and for any key assembled from
parts. The API's three assembled families are now written out: `ACCEPTANCE_REQUIRED_KEY` (a `Record`
over the legal document types), the policy-review refusal keys, and the taxonomy keys at each call.
Negative controls: a new unmapped key fails all three locales; an assembled key fails the second test.

*Found in the browser, fixed.* A catalog entry alone did not reach anyone: the service-area form (and
20 others) showed only "Some details need correcting" — the specific message sits in the error's
field details, which only 7 forms displayed. `FormError` now lists each field's own message under its
title, except fields a form shows itself (`shown`); three forms that hand-rolled that list use it.
Verified: an eleventh service area → "You can have up to 10 service areas. Remove one to add
another.", in English and Russian.

*Not done.* The native-speaker review of ru and hy (ACTIONS-FOR-ME #23).

---

### T-136 — OpenAPI lists no request properties for any DTO
- **Status:** DONE — 2026-09-26
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api (nest-cli / swagger plugin or `@ApiProperty`), docs/api/README.md

**Description**
Found in T-018. `GET /api/docs-json` lists every route, but every request schema is empty:
`SearchInvestigatorsDto`, `AskKnowledgeDto`, `FindInvestigatorsDto` and the rest have no
`properties`. The class-validator decorators are not read by `@nestjs/swagger` without its CLI
plugin or explicit `@ApiProperty`, so the published contract says nothing about what a request
takes, and `packages/api-client` cannot be generated from it.

**Acceptance criteria**
- [x] Every request DTO's properties, types and bounds appear in the OpenAPI document
- [x] A test fails when a DTO property is missing from the document

**Validation**
```bash
pnpm --filter api test openapi
```

**DONE — 2026-09-26**

*How.* The API builds with plain `tsc`, so `@nestjs/swagger`'s compiler plugin never ran.
`src/common/openapi/metadata.generator.ts` runs the plugin's own `ReadonlyVisitor` over the source
(the Nest CLI's approach for SWC builds, without the CLI) and prints `src/metadata.ts` — committed,
with static imports because a dynamic `import()` under Node16 in this CommonJS package would need
`.js` on every path. `bootstrap.ts` loads it (`configureApp` is now async), then `addValidationBounds`
writes every class-validator bound as the running API enforces it — the plugin reads only literal
arguments, so `@Max(MAX_SEARCH_RADIUS_KM)` had been dropped. `pnpm --filter api openapi:metadata`
regenerates.

*Test.* `openapi.spec.ts`, over the real module graph's real document: metadata fresh; every body
DTO's properties in its schema; every `@Query()` class's properties on its own route (mapped through
Nest's route metadata, not by name); every bound equal to class-validator's. Negative controls: a DTO
property added without regenerating fails three tests; removing the bounds pass fails one.

*Found and fixed.* Two base DTOs (`VersionedDto`, `Reasoned`) were not exported, so the plugin
skipped them and `version`/`reason` vanished from every subclass schema. `ReadDocumentQuery` sat in
a controller file, so `GET /knowledge/documents/{docKey}` listed no `locale` — now `knowledge.dto.ts`.

---

### T-137 — Pin the Playwright MCP version
- **Status:** DONE — 2026-09-26; `.mcp.json` pins `@playwright/mcp@0.0.81`, reasoning and bump procedure in `visual-qa`
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** .mcp.json, .claude/skills/visual-qa/SKILL.md

**Description**
`.mcp.json` starts the Playwright MCP as `@playwright/mcp@latest`, so every session runs whatever
was published most recently — the unpinned-dependency risk CLAUDE.md's version policy exists to
avoid. T-014 pinned the shadcn MCP (`shadcn@4.21.0`); this one was out of that task's scope. Pin
the newest version that has been out long enough, per CLAUDE.md, and note it in `visual-qa`.

**Acceptance criteria**
- [x] `.mcp.json` names an exact `@playwright/mcp` version, chosen by release date and changelog —
      0.0.81 (2026-09-14, 12 days; carries the symlink file-access fix). 0.0.82 (8 days) too new
- [x] The MCP starts and a browser snapshot works on the pinned version — driven over stdio
      JSON-RPC: 26 tools listed, `browser_navigate` + `browser_snapshot` returned the accessibility
      tree; reduced motion via `browser_run_code_unsafe` + `page.emulateMedia` matched, survived
      re-navigation and cleared with `null`

**Validation**
```bash
npx -y @playwright/mcp@<version> --help
```

---

### T-138 — The API behind Caddy sees the proxy's address, not the client's
- **Status:** DONE — 2026-09-27. `TRUSTED_PROXIES` (addresses, CIDR ranges or `loopback`) sets Express's `trust proxy` in `configureApp`; unset trusts nobody; `true`, `*`, a hop count, `/0`, `uniquelocal` and names are refused at boot; required in staging and production. app-web's and admin-web's `serverApi` pass on the `X-Forwarded-For` Caddy gave them. Found on the way: every auth audit row (17 call sites) spread `{ ip }` where the row takes `ipAddress`, so sign-in, registration and reset events never recorded an address — mapped by `audited(ctx)`. Seen failing first: `bootstrap.spec.ts` (a trusted hop's client believed; a client-written entry not), `env.schema.spec.ts`, the web `server.spec`s, and a new whole-stack `request-context.e2e.spec.ts` — on the old code a second client behind the same proxy got 429 and the audit row's address was null; now separate limits and the client's address. Caddy's unread `X-Real-IP` dropped; the Caddyfile validated by Caddy for the first time. Filed T-167. `docs/operations/client-address.md`, `.env.example`; the fixed proxy addresses are a T-023 criterion (no deploy compose exists yet)
- **Priority:** P1 — per-IP rate limits and audit IPs are wrong in every deployed environment
- **Depends on:** —
- **Risk:** MEDIUM — changes which address rate limits and audit rows record
- **Human approval required:** Yes — it touches a security control (rate limiting)
- **Owner agent:** infra-devops + backend-domain
- **Affected:** apps/api/src/bootstrap.ts, infrastructure/caddy/Caddyfile, apps/app-web/src/lib/api/server.ts

**Description**
Found in T-127. The API never sets Express's `trust proxy`, so behind Caddy `req.ip` is Caddy's
container address for every request. `request-context.ts` passes it to the auth rate limits
(`loginPerIp`: 20 per five minutes) — one limit shared by every user of the platform, so a handful
of failed sign-ins anywhere locks out everyone — and to every audit row and consent record that
stores an IP. Caddy already sends `X-Real-IP` and `X-Forwarded-For`; nothing reads them.

A second hop arrives with T-127: app-web's server components call the API directly
(`serverApi`), so those requests carry app-web's address. They are reads today, but the client's
address should travel with them once the API trusts the proxy.

**Acceptance criteria**
- [x] `trust proxy` set to exactly the hops in front of the API (Caddy; the app-web server for its
      internal calls) — never `true`, which would let any client choose its own address
- [x] A spoofed `X-Forwarded-For` from a client is not believed
- [x] Per-IP rate limits key on the client's address; audit and consent rows record it
- [x] `docs/operations` says which headers each hop sets and trusts

**Validation**
```bash
pnpm --filter api test request-context
```

---

### T-139 — Browser flows for sign-up, sign-in and the account page in CI
- **Status:** DONE — 2026-09-26; `apps/app-web/e2e/`, Playwright against the built stack, a PR step
- **Priority:** P2
- **Depends on:** T-127
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend + infra-devops
- **Affected:** apps/app-web/e2e/**, .github/workflows/**

**Description**
Found in T-127. Its flows are tested in Vitest against a stand-in for the API, and were checked by
hand in a browser against the real API at 375, 768 and 1280px — but no automated run drives a
browser through the real stack, so a change to a cookie attribute, the dev rewrite or
`/session/start` would pass CI. T-098 plans `apps/app-web/e2e/`; this starts it with the flows
every other screen depends on: sign up (with a published document), confirm the address from the
emailed link, sign in and land on the page asked for, the saved language restored on a fresh
browser, time zone saved, a role added, another session ended, sign out, reset a password.

**Acceptance criteria**
- [x] The flows above run in CI against the API and a migrated database, at 375 and 1280px
      — `account.e2e.ts`, 9 steps × 2 viewports; `global-setup.ts` drops, creates and migrates
      `investigator_e2e`, publishes the registration and customer documents, and starts the built
      API (runtime role, `NODE_ENV=test`) and app. 18/18 locally, twice in a row, ~9s. CI:
      `e2e:browser` + `test:e2e` after the bundle budgets; `.output/` uploaded on failure. Emailed
      links are read from the API's log (`support/mailbox.ts`); consent rows read back as owner
- [x] The session cookie's attributes (HTTP-only, `SameSite=Strict`, host-only) are asserted from
      the browser, not the API's unit tests — `context.cookies()` plus `Secure` and absence from
      `document.cookie`. Mutation check: the API built with `sameSite: 'lax'` fails the step
- [x] Accessibility checks pass on each signed-out screen and the account page — axe, WCAG 2.2
      A/AA: sign-up, check-email, verify-email, sign-in (notice and refusal), forgot, reset,
      account (before and after adding a role). No violations found; a probe page with an
      unlabelled input and an image without alt failed the helper on `label` and `image-alt`

**Validation**
```bash
pnpm --filter app-web test:e2e

### T-140 — Order discovery by rating
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-037
- **Risk:** MEDIUM
- **Human approval required:** Yes — it changes who customers see first (as T-071, T-103)
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/search, apps/api/src/modules/ai/discovery, docs/architecture/discovery.md, kb-customer-finding-investigator, kb-investigator-reviews

**Description**
Reviews exist and a profile's rating summary is computed from standing reviews (T-037), but discovery
still orders by distance, or by experience without a location (`discovery.md`, "Quality ranking is a
stage with nothing in it yet"). Decide how rating enters the order — and how a profile with two
reviews compares with one with fifty, so a single early rating does not dominate — then build it
behind the hard filters, never as one.

**Acceptance criteria**
- [ ] The ordering rule is decided by the owner and written down, including how few reviews count
- [ ] Rating ranks only among investigators who already meet every hard requirement
- [ ] Computed from standing reviews at query time; never client-supplied, never cached across workspaces
- [ ] The knowledge-base articles that now say "ratings do not change the order" are superseded in the same task

**Validation**
```bash
pnpm --filter api test search discovery
```

---

### T-141 — `next build` fails in agent shells, and so does `scripts/setup.sh`
- **Status:** DONE — 2026-09-26. `.claude/settings.json` no longer sets `NODE_ENV`; the Next apps build with `NODE_ENV=production` themselves. `pnpm build` passed with `NODE_ENV=development` exported; `./scripts/setup.sh` passed from a Node 20 + `NODE_ENV=development` shell. Specs in `apps/api/test/workspace-scripts.spec.ts`
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** .claude/settings.json, scripts/setup.sh, docs/architecture/app-web.md

**Description**
`.claude/settings.json` sets `NODE_ENV=development` for every agent shell. Next.js then fails
`next build` with "<Html> should not be imported outside of pages/_document" on the 404 prerender, in
both web apps — so `pnpm build`, and the build step of `scripts/setup.sh`, fail for an agent while
passing in CI and in a plain terminal (found in T-037; `env -u NODE_ENV pnpm build` passes). The
launch configuration already works around it with `env -u NODE_ENV`. Decide whether the setting is
needed at all; if it is, make the build scripts immune to it rather than every caller remembering.

**Acceptance criteria**
- [x] `pnpm build` and `./scripts/setup.sh` pass in an agent shell with no workaround
- [x] Whatever needed `NODE_ENV=development` still gets it

**Validation**
```bash
pnpm build && ./scripts/setup.sh
```

---

### T-142 — An investigator can quote on their own mission
- **Status:** DONE — 2026-09-27. `QuotesService.quotableMission` treats a mission whose `customer_id` is the quoting user like one that is not published: `authz.visible` refuses it as a 404 and audits the denial — the rule browse already applied (`m.customer_id <> actor`), now on the quote side too. The only path that creates a quote; nothing shortlists or invites yet (T-103). Owner decision (2026-09-27): "own" is the user today — missions and quotes belong to users; the agency-wide rule is an acceptance criterion of T-089. Seen failing first: the service spec (the quote was written) and a new whole-stack `quotes.e2e.spec.ts` (real session, guard, service, database: 201 on one's own mission before, 404 after; another's mission still 201). `discovery.md`; KB `kb-investigator-quoting` v2 (en; ru/hy drafts)
- **Priority:** P1 — self-dealing reaches reviews (T-037) and payouts
- **Depends on:** —
- **Risk:** MEDIUM
- **Human approval required:** Yes — it changes the quote authorization rule
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/quotes/**, apps/api/src/modules/profiles/quoting-eligibility.ts

**Description**
Found in T-054. One account holds both roles, and `QuotesService.submit` checks the investigator
(`requireQuotingProfile`) and that the mission is QUOTED — but not that the mission is someone
else's. So a person can publish a mission as a customer, quote on it as an investigator, accept
their own quote, and after completion review themselves. Browse (T-054) already leaves a person's
own missions out; quoting should refuse them, and so should anything that shortlists or invites
(T-103).

**Acceptance criteria**
- [x] Quoting on a mission whose customer is the quoting user is refused, as a 404 like any mission
      the investigator may not quote on
- [x] The same for a mission in a workspace the quoting user belongs to (an agency quoting on its
      own member's mission) — decided with the owner, since agencies make "own" wider than a user.
      Decided 2026-09-27: missions and quotes are the user's today, so "own" is the user; the
      agency-wide rule moves to T-089, with workspace-owned quotes
- [x] Tested at the service and through HTTP

**Validation**
```bash
pnpm --filter api test quotes
```

---

### T-143 — Narrow mission eligibility to what an investigator declared
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-131, T-142
- **Risk:** MEDIUM
- **Human approval required:** Yes — it changes who may read and quote on a mission
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/{search,quotes,profiles}/**, docs/knowledge-base/investigator/finding-work.*

**Description**
From T-054 (owner decision, 2026-09-25). Today an investigator may browse and quote on every
published mission; specialties, areas and languages are filters they choose. The investigator
article used to promise the narrower model — only missions matching their verified specialties,
service areas and languages — and a customer's mission description, which routinely names third
parties, would reach fewer people under it. It was not built then because no real taxonomy exists
until T-131, so narrowing would have shown most investigators nothing.

Once the taxonomy is seeded, decide and build: which of specialties (tree walk), service-area
country, languages and availability become eligibility, applied to **both** browse and
`requireQuotingProfile`/quote submission so the list and the quote never disagree.

**Acceptance criteria**
- [ ] The rule decided with the owner, and written into `discovery.md` and the investigator article
- [ ] Browse and quoting apply it through one implementation, tested the way T-054 tests eligibility
- [ ] The customer privacy article says who can read a published mission

**Validation**
```bash
pnpm --filter api test mission-browse
```

---

### T-144 — Assistant composer: attachment entry point
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-056, T-066
- **Risk:** MEDIUM
- **Human approval required:** Yes — an attachment the assistant reads is content sent to a model
  provider, and may be evidence (`cloudinary-media`, `evidence-integrity`)
- **Owner agent:** frontend + ai-rag
- **Affected:** apps/app-web/src/components/assistant/**, apps/api/src/modules/ai/**, apps/api/src/modules/media/**

**Description**
From T-056. Its acceptance criteria ask for an attachment entry point in the composer; it was not
built, because a conversation has nowhere to attach to — no media purpose for an assistant session,
no rule for what the model may read of a file, and nothing in `SESSION_CONTENT` to erase it with the
session. A paperclip that does nothing fails the subtraction test. `@shadcn/attachment` was
reviewed and is the component to adopt when there is.

**Acceptance criteria**
- [ ] A media purpose for session attachments, private, erased with the session (`SESSION_CONTENT`)
- [ ] What of an attachment reaches a model is decided with the owner, and documented
- [ ] The composer offers the entry point on a phone and a desktop; `@shadcn/attachment` re-tokenised

**Validation**
```bash
pnpm --filter app-web test assistant && pnpm --filter api test ai
```

---

### T-145 — Browser calls do not say which role the reader acts as
- **Status:** DONE — 2026-09-26. `WorkspaceScope` pins the chosen role beside the workspace; `scopeHeaders()` (`lib/api/workspace.ts`) is the one source of `X-Workspace` and `X-Active-Role` for `callApi` and `assistantApi()`, which lost its `role` parameter. Specs in `browser.spec.ts`, `workspace.spec.tsx`, `assistant.spec.ts` seen failing without the header
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No — the API only ever narrows by the header
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/lib/api/browser.ts, its callers

**Description**
From T-056. Server-side reads forward the `active_role` cookie as `X-Active-Role`
(`lib/api/server.ts`); browser calls (`callApi`) do not, so a person with both roles who chose to act
as a customer is their full self for every mutation made from the browser. Nothing role-sensitive is
reachable that way today (saved searches are only shown to investigators), and the API narrows, never
widens. The assistant sends the header itself (`assistantApi(role)`). Make `callApi` send it too, so
the rule holds in one place.

**Acceptance criteria**
- [x] Every browser call carries the chosen role when there is one; a spec asserts it
- [x] `assistantApi` uses the shared path rather than its own header

**Validation**
```bash
pnpm --filter app-web test
```

---

### T-146 — Agent shells run Node 20, and two API specs fail on it
- **Status:** DONE — 2026-09-26. `session-start.sh` puts the `.nvmrc` Node first on PATH through `CLAUDE_ENV_FILE`, or prints `WRONG NODE`; four specs in `apps/api/test/workspace-scripts.spec.ts` drive the hook with fake installs. `pnpm test:coverage` passed on the switched PATH. `node -v` in a fresh session is to be seen on the next session start (this one began before the hook existed)
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** .claude/settings.json or .claude/hooks/**, scripts/setup.sh

**Description**
From T-056. The agent shell's `node` is nvm's default, v20.20.2, while `.nvmrc` pins 24. On it
`pnpm test:coverage` fails in `test/supply-chain.spec.ts` and `test/workspace-scripts.spec.ts` with
`globSync is not a function` (`node:fs` has it from Node 22) — the suite passes on 24. An agent that
does not notice reports a failure that is not the code's. Related to T-141 (the same shells'
`NODE_ENV`). Make agent shells use the pinned version (the `.nvmrc`), or fail loudly when they do not.

**Acceptance criteria**
- [x] `node -v` in an agent shell matches `.nvmrc`, or the session start says it does not
- [x] `pnpm test:coverage` passes in an agent shell with no PATH workaround

**Validation**
```bash
node -v && pnpm test:coverage
```

---

### T-147 — Service areas by place search or map
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-123
- **Risk:** MEDIUM
- **Human approval required:** Yes — choosing a map or geocoding provider sends locations to a third party
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/investigator/**, possibly apps/api/src/modules/service-areas/**

**Description**
From T-123. An investigator can add a service area only from where their device is, with a
5–100 km radius. The API already takes any centre, radii of 5–300 km and drawn polygons
(`service-areas.md`), but the app offers none of that: no map or place-search provider has been
chosen, and either would send typed places or map views to a third party. Owner decides the
provider (and its privacy terms); then add "search a place" + radius on phones and drawing on a
map from `md`, keeping the centre rounded on the device.

The same provider decision unblocks the map view of finding investigators (T-120), which ships
as a list with "near me" until then.

**Acceptance criteria**
- [ ] An area can be added for a place the investigator is not at
- [ ] Nothing more precise than the stored ~1 km centre reaches the provider or the API
- [ ] The provider is recorded in the privacy documentation before it ships

**Validation**
```bash
pnpm --filter app-web test investigator-profile
```

---

### T-148 — Changing a verified investigator's name
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-123, T-070
- **Risk:** MEDIUM
- **Human approval required:** Yes — changes a verification rule
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/profiles/**, apps/api/src/modules/verification/**

**Description**
From T-123. The display name is locked while verification is PENDING or VERIFIED, because the
documents were checked against it; the page and the KB say "contact support". There is no support
path: a legal name change, or a typo found after approval, cannot be fixed. Decide what a change
requires (a new application with the new name's document? a staff edit with a reason?), and what
happens to VERIFIED meanwhile.

**Acceptance criteria**
- [ ] A verified investigator's name can be changed through a documented, audited path
- [ ] The name customers see never differs from the one last verified without that being visible to staff
- [ ] **From T-087:** the lock reads only the profile in the workspace the request acts in. A person
      whose agency-held profile is PENDING or VERIFIED can still rename from their Personal workspace
      while their Personal profile is unverified. Agency profiles never show the legal name until T-183,
      so no customer sees the difference yet; the lock should consider every profile the person holds

**Validation**
```bash
pnpm --filter api test profiles verification
```

---

### T-149 — Agency onboarding checklist (app-web)
- **Status:** DONE — 2026-09-27; Home checklist for the owner, dismissal in `general.onboardingDismissed`
- **Priority:** P2
- **Depends on:** T-092, T-084, T-085
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
From T-092. After the five required details, the rest of an agency's setup is meant to be a
dismissible checklist, not a wizard (plan.md). Nothing it would list exists yet: the agency profile
and settings (T-084), inviting employees (T-085), agency verification (T-088, approval-gated). Build
the checklist on Home for an agency's owner once at least the first two exist — each item a link to
where it is done, done items ticked from real data, dismissal remembered per workspace.

**Acceptance criteria**
- [x] Every item links to a screen that exists, and is ticked from the API, never from a local flag
      — the agency's details (`missing` → `/agencies/current`) and its public profile
      (`publishedAt` → `/agency`); inviting employees waits for T-093's screen, verification for
      T-088. Owner-only by the API's `mayChange`. Seen ticking in the browser as the profile publishes
- [x] Dismissed once, it stays dismissed for that workspace, on every device — saved as the
      `general` section's first setting (API: boolean only, null → default; version-checked);
      `agency.e2e.ts` dismisses it, reloads, then signs in from a second browser: still hidden

**Validation**
```bash
pnpm --filter app-web test onboarding
```

---

### T-150 — Complete or change an agency's core details
- **Status:** DONE — 2026-09-26. `GET`/`PATCH /agencies/current` (owner only, `company.update_details`, migration 0026; version-checked, 409 on a stale read; audited `agency.details_updated` with field names, plus `agency.activated` when a CREATING agency completes). Screen `/agencies/current`: form for the owner, read-only list for other members; the shell's "not set up yet" notice links to it. Specs in `agencies.details.spec.ts`, `agencies.controller.spec.ts`, `agency-details.spec.tsx`; resolver spec updated to 41 permissions. Verified in the browser against the local API and database at 375 and 1280px: CREATING → ACTIVE on save (audit rows checked), rename reflected in the switcher, stale version shows the conflict message, a VIEWER sees the read-only view and gets 403 from `PATCH`, Personal redirects home
- **Priority:** P2
- **Depends on:** T-083, T-092
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain (API) + frontend (UI)
- **Affected:** apps/api/src/modules/tenants/**, apps/app-web/**

**Description**
From T-092. `POST /agencies` accepts an agency with some of the five required details missing, and it
stays `CREATING` — but nothing can add them afterwards, and an owner cannot change a name, country,
business email, time zone or currency once set. The app therefore requires all five up front, and the
switcher shows a `CREATING` agency as "Being set up" with no way forward. T-084 covers profile,
settings and branding, not these five. Add an owner-only update (audited; becoming ACTIVE when the
minimum is complete) and the screen for it.

**Acceptance criteria**
- [x] A `CREATING` agency becomes `ACTIVE` when its owner supplies what is missing
- [x] Only an owner can change the five details; every change is audited

**Validation**
```bash
pnpm --filter api test agencies && pnpm --filter app-web test workspace
```

---

### T-151 — A translated "not found" page (app-web)
- **Status:** DONE — 2026-09-26. `NotFoundPage` rendered by `(workspace)/not-found.tsx`, with a back link from `missions/[id]` and `missions/investigators/[id]`; `(workspace)/[...missing]` sends unknown addresses there too. New `not_found.*` keys in en/ru/hy. Specs in `routes.spec.tsx`
- **Priority:** P3
- **Depends on:** T-128
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/app/**

**Description**
From T-120. `notFound()` — an unpublished investigator profile, a help article for another audience
— renders Next's default page: "404 — This page could not be found.", in English, outside the shell.
Add `not-found.tsx` in the workspace group, in the reader's language, inside the shell, with a way
back (Home, and the list it came from where known).

**Acceptance criteria**
- [x] A 404 inside the workspace keeps the navigation and speaks the reader's language
- [x] It says nothing about whether the thing exists (a draft profile and a missing one read the same)

**Validation**
```bash
pnpm --filter app-web test routes
```

---

### T-152 — Staff access: grant and revoke STAFF and staff scopes
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-070
- **Risk:** HIGH
- **Human approval required:** Yes — it is authorization: who may review, moderate, pay out
- **Owner agent:** backend-domain + admin-web
- **Affected:** apps/api/src/modules/** (a staff-access module), apps/admin-web/**, docs/operations/**

**Description**
From T-070. The verification console works for anyone holding `STAFF` and the `VERIFICATION` scope —
and nothing grants either except a SQL insert as the database owner. `user_staff_scopes` already
records who granted a scope and keeps revoked rows (`authorization.md`); what is missing is the way
to write them: who may grant (a bootstrap for the first administrator, then a scope for granting),
with a reason, audited, revocable, and never self-granted.

**Acceptance criteria**
- [ ] The rule for who may grant and revoke, decided with the owner and written into `authorization.md`
- [ ] Grants and revocations through the API, audited with who and why; no one grants themselves
- [ ] A bootstrap for the first staff account that is not a standing back door
- [ ] The console screen for it, if the owner wants one

**Validation**
```bash
pnpm --filter api test staff-access
```

---

### T-153 — Draft saves that break a CHECK answer 500, not a field error
- **Status:** DONE — 2026-09-26. `draftIssues` in `missions.policy.ts` checks each save against the draft as it would be stored, before the write; new key `error.validation.mission.blank` (en/ru/hy); documented in `docs/architecture/missions.md`. 9 service specs seen failing without the check
- **Priority:** P2
- **Depends on:** T-010
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/missions/**

**Description**
Found in T-119. `PATCH /missions/me/:id` (and `POST /missions/me`) passes three rules only to the
database: a budget minimum above its maximum (`missions_budget_range`), a start after the deadline
(`missions_timeline_order`) and an empty text field (`missions_text_lengths`). Each reaches the
client as a 500 with a reference, not as the field error it is. The intake never sends them (it
holds an inverted pair and sends an emptied field as `null`), but any other client, and the assistant
later, will. Map them as `service-areas.service.ts` maps its shape violations, or validate first.

**Acceptance criteria**
- [x] Each of the three answers 422 `VALIDATION_FAILED` naming the field, with a translated `messageKey`
- [x] The CHECK constraints stay, as the last line

**Validation**
```bash
pnpm --filter api test missions
```

---

### T-154 — Cancel a mission from the app
- **Status:** DONE — 2026-09-26. `CancelMission` (`components/missions/cancel-mission.tsx`) in the draft intake and under a mission in review; KB `creating-a-mission` v3 (en/ru/hy) says how. QUOTED left to T-121, which shows the quotes that close
- **Priority:** P2
- **Depends on:** T-119
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/missions/**

**Description**
Found in T-119. `POST /missions/me/:id/cancel` exists and the knowledge base says a customer can
cancel before accepting a quote, but no screen offers it: a draft can only be left, and a mission
under review cannot be withdrawn. Add it to a draft and to a sent mission the transition map lets the
customer cancel, confirmed in an `AlertDialog` that says what closes. A `QUOTED` mission closes its
open quotes — decide with T-121 whether that belongs here.

**Acceptance criteria**
- [x] A draft and a mission under review can be cancelled, after a confirmation; the list says so
- [x] A 409 (it moved on meanwhile) says so and reloads

**Validation**
```bash
pnpm --filter app-web test missions
```

---

### T-155 — A T-119 spec failed once under full load
- **Status:** DONE — 2026-09-26. Cause: ordering. `occurred_at` is `now()`, the transaction start, so moves in one transaction tie and a clock step reorders two; `reviewsOf` then picked the submission and said nothing. Migration 0025 adds `mission_status_history.seq` (identity) and `reviewsOf` orders by it. Two specs (clock stepped back, tied) reproduce `review: null` on the old ordering and pass on `seq`; reverse-sequence run green
- **Priority:** P3
- **Depends on:** T-119
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/missions/**

**Description**
Found in T-084. `missions.service.spec.ts` › "says a draft came back for changes, and keeps saying so
while it is edited" returned `review: null` once — in the first full run after the test databases
were rebuilt — and passed in two further full runs and eleven targeted ones. `reviewsOf` takes a
mission's latest `mission_status_history` row by `occurred_at`, which is each transaction's start
time. Two hypotheses: a wall-clock step in the Docker VM under load reordering rows from separate
transactions, or something in that first run's order. If it is ordering, the review lookup should not
depend on clock order alone (e.g. a monotonic sequence on the history table).

**Acceptance criteria**
- [x] The cause is found and fixed, or the spec is shown sound and the note closed with evidence

**Validation**
```bash
VITEST_SEQUENCE=reverse pnpm --filter api test missions
```

---

### T-156 — The latest consent is chosen by clock, not by write order
- **Status:** DONE — 2026-09-27 (owner approved in chat). As T-155: migration 0030 adds `user_consents.seq` (identity; existing rows numbered in scan order — the table is append-only by grant and consents are never erased) and replaces the `(user_id, document_type, occurred_at DESC)` index with one on `seq`; `LegalService.consentState` orders by it — the only reader of consent order. Four specs seen failing first on the clock ordering (a re-acceptance after a withdrawal, a withdrawal after an acceptance; each with the clock stepped back a second and tied), all passing on `seq`. Migration up/down checked by `migrations.spec.ts`; applied to the local dev database. `legal-consent` skill updated; no legal text changed
- **Priority:** P3
- **Depends on:** T-155
- **Risk:** MEDIUM
- **Human approval required:** Yes — legal consent (AGENTS.md)
- **Owner agent:** database (schema) + backend-domain (service)
- **Affected:** apps/api/src/modules/legal/**, apps/api/src/database/schema/legal.ts

**Description**
Found in T-155. `LegalService.consentState` takes a person's latest `user_consents` row for a
document type by `occurred_at`, which is its transaction's start time — the ordering that made T-155's
review lookup unreliable. A withdrawal and a re-acceptance written close together, or across a
wall-clock step, can be read in the wrong order, and the gate then says the wrong thing. Same fix as
T-155: an identity `seq`, ordered by it.

**Acceptance criteria**
- [x] With the clock stepped back between a withdrawal and a re-acceptance, the later write decides
- [x] Ties in `occurred_at` are resolved by write order

**Validation**
```bash
pnpm --filter api test legal
```

---

### T-157 — A DTO's own validation message reaches the client as the field name
- **Status:** DONE — 2026-09-26. `validationPipe()` (`common/validation/pipe.ts`) builds `details` from the validation errors — property path as `field`, a catalog-key message as `messageKey`, `NOT_ALLOWED` for an undeclared field — and `AppExceptionFilter` passes them on instead of parsing message text. `bootstrap.ts` and all 27 route specs use it. Regression specs in `bootstrap.spec.ts` and the filter spec seen failing on the old code; documented in `docs/api/errors.md`. Web needed no change: `fieldErrorKeys` already preferred a specific key. Seen in the browser: sign-up with `a@b` shows the email message under the field, in en and ru, at 1024 and 375px
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain (API) + frontend (form errors)
- **Affected:** apps/api/src/common/errors/http-exception.filter.ts, apps/api/src/bootstrap.ts,
  apps/app-web/src/components/form/errors.ts

**Description**
Found in T-032. `extractValidationDetails` takes the text before the first space of each
class-validator message as the field name. A decorator with its own `message` — 29 in ten DTOs, e.g.
`@Matches(/\S/, { message: 'error.validation.display_name.blank' })` in `profiles.dto.ts`, and every
`EmailField` — has no space, so the client receives `{ field: 'error.validation.display_name.blank',
messageKey: 'error.common.validation_failed' }`: the key in the wrong place and the generic message
in its own. `fieldErrorKeys` then finds neither the field nor a specific key, and the form shows a
generic error instead of the one written for it. Seen in T-032's route spec with the same pipe and
filter as `bootstrap.ts`; T-032 validates its blank case in the service instead. Fix with an
`exceptionFactory` that keeps each issue's property and constraint message, so a message that is a
catalog key becomes `messageKey` and `field` is always the property. The same parsing names an undeclared field
`property` ("property status should not exist"), seen probing T-032's task PATCH.

**Acceptance criteria**
- [x] A refused `displayName` of spaces answers `{ field: 'displayName', messageKey: 'error.validation.display_name.blank' }`
- [x] A message that is not a catalog key still yields the property as `field` and the generic key
- [x] An undeclared field is reported under its own name, not `property`
- [x] The sign-up form shows the email message written for it, seen in the browser

**Validation**
```bash
pnpm --filter api test http-exception bootstrap && pnpm --filter app-web test form
```

---

### T-158 — Accept an invitation (app-web)
- **Status:** DONE — 2026-09-27. `/invitations/accept` in the `(auth)` group (`no-referrer`, token dropped from the address bar) with `AcceptInvitation`: joins on a press, activates the workspace, loads Home; each refusal (404, 409 member / suspended, 403) says what to do. `next` carried through sign-in ↔ sign-up and onto check-email's new **Continue**. Specs in `accept-invitation.spec.tsx`, `invitations/invitations.spec.tsx`, `auth-pages`/`auth-forms`. Seen in the browser against the real API, in Russian: invited → signed out → create account → check email → signed in unconfirmed → confirmed in another tab → Continue → joined, landing in the agency (375 and 768px); the used link refused with its message (1280px). KB `kb-agency-employees` v3 (en; ru/hy drafts); `app-web.md`; inventory. Filed T-161
- **Priority:** P2
- **Depends on:** T-085
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**

**Description**
Found in T-085. The invitation email links to `/invitations/accept?token=…` on the app, and no
such screen exists — an invitee lands on a 404. Build the one screen: the token out of the address
bar on load and `Referrer-Policy: no-referrer` (as `/verify-email`), accepting on a button press
(mail scanners open links), `POST /invitations/accept`, then activate the workspace it returns
(`POST /workspaces/:id/activate`) and land in it. Signed out: sign in or create the account with
that address, and come back here (`next`). Say, in the reader's language: not found (another
account, used, cancelled, expired — one message), address not confirmed yet, already a member,
suspended. T-093 builds the rest of the agency console; this should not wait for teams.

**Acceptance criteria**
- [x] An invitee signed in with the invited, confirmed address joins and lands in the agency
- [x] Signed out, the link survives sign-in and sign-up and comes back to the accept screen
- [x] Each refusal says what to do next; checked in the browser at three widths

**Validation**
```bash
pnpm --filter app-web test invitation
```

---

### T-159 — An invitation names the teams its member joins
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-085, T-086
- **Risk:** MEDIUM
- **Human approval required:** Yes — a new invitee door in the row-level security policies
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/tenants/employees/**, apps/api/src/database/migrations/**

**Description**
Deferred from T-086. tenancy.md §2 has an invitation carry the teams its member joins. That needs
`tenant_invitation_teams` (or an array held by a trigger), and an `invited_insert` policy on
`team_members` keyed, like T-085's, on `app_current_confirmed_email()` and a live invitation naming
that team — plus the "nothing upward" check extended if teams ever carry permissions.

**Acceptance criteria**
- [ ] An accepted invitation puts its member in the teams it names, in the same transaction
- [ ] An invitee can join no team the invitation does not name (isolation matrix)
- [ ] A team deleted before acceptance is dropped from the invitation, not an error

**Validation**
```bash
pnpm --filter api test invitations teams
```

---

### T-160 — App-web tests time out in CI under parallel coverage
- **Status:** DONE — 2026-09-27. Root `test:coverage` runs the packages with `--workspace-concurrency=1` (PR #87); no test's timeout moved. Measured from CI logs, 5 PR runs before vs 11 green-or-unrelated runs after (36260917253 onward). The timed-out test: 4,694–4,939 ms in runs that *passed* before (5,074 ms in the one that failed), 1,271–2,010 ms after. App-web's suite: 131–143 s wall with 200–215 s of test time before (its workers shared cores with the API's), 40–56 s after. Individual tests ≥ 1 s: 49–55 per run before, 7–11 after. The step's wall time did not move — 169–177 s green before, 138–183 s after (median 178 s): the API's suite bounds it either way. 14 consecutive runs since the merge, none timed out; 10 green, 4 red for other causes — three major-version Dependabot bumps (`@nestjs/common` 12, `nestjs-pino` 5, `vitest` 5) and one flake, filed as T-163
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** .github/workflows/pr.yml, apps/*/vitest.config.ts, package.json

**Description**
Found on PR #85 (T-086, API-only): `mission-browse.spec.tsx` › "shows what is applied, and turns
every choice into the address at once" timed out at 5,000 ms in CI's coverage step. The same test
takes 305 ms locally, and 469 ms under coverage — CI ran it about ten times slower, because
`pnpm -r test:coverage` runs every package's suite at once on one runner. Swapping its role queries
for label queries (the fix `onboarding.spec.tsx` used) saved only ~12%, so this is contention, not
one heavy test: any test near half a second is at the same risk, and T-155 may be the same thing.
Decide the fix across the board — run the packages' coverage one at a time
(`--workspace-concurrency=1`), cap Vitest's workers in CI, or a deliberate `testTimeout` for CI —
measure the step's wall time either way, and do not raise single tests' timeouts to hide it.

**Acceptance criteria**
- [x] The cause is shown with numbers (per-test times in CI before and after)
- [x] Ten consecutive CI runs of the coverage step without a timeout
- [x] The coverage step's wall time is recorded before and after

**Validation**
```bash
pnpm test:coverage
```

---

### T-161 — The workspace switcher overflows the sidebar at tablet width
- **Status:** DONE — 2026-09-27. The trigger (`workspace-switcher.tsx`) takes `min-w-0`: as a grid item at the default `min-width: auto` it sized the sidebar's column to the whole name. Spec in `workspace.spec.tsx` (menu and sheet) seen failing first. Measured in the browser with a 41-character agency name: trigger 12–227px inside the 240px sidebar, name truncated, heading clear, at 768 and 1280 in en, ru and hy; the phone sheet's trigger 16–359px at 375. Filed T-162
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/workspace/workspace-switcher.tsx, the workspace shell

**Description**
Found in T-158's browser check. At 768px, in an agency named "Halfway Renamed Agency", the
switcher's trigger measured 275px wide inside a 227px sidebar column, and covered the first letters
of the page heading ("Главная" read "лавная"). A long agency or Personal name should truncate inside
the column, as the switcher's own rows already do (`truncate`), not push the button past it.

**Acceptance criteria**
- [x] The trigger never exceeds its column; a long name truncates, with the full name in its accessible name
- [x] Checked in the browser at 768 and 1280 with a long agency name, in en, ru and hy

**Validation**
```bash
pnpm --filter app-web test workspace
```

---

### T-162 — The account page scrolls sideways at tablet width: the time zone button
- **Status:** DONE — 2026-09-27. The select is `w-full min-w-0` in a `min-w-0 basis-60` label, and from `sm` the row wraps: left at `min-width: auto`, the select sized itself to its longest zone and pushed the button out. The detected-zone button wraps its text (`whitespace-normal`). Spec in `account.spec.tsx` seen failing first. Measured in the browser against the real API, account zone set to the longest (`America/Argentina/Rio_Gallegos`): at 375, 768 and 1280 in en, ru and hy, page scroll width equals the viewport and every control sits inside the card; at 768 in ru the save button wraps under the select (297–522px in a 272–736px card; was 603–829px). Both buttons 44px; the longest detected-zone label at 375 wraps to two lines (64px) inside the card. Filed T-164
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/account/time-zone-form.tsx

**Description**
Found in T-161's browser check. On `/account` at 768px, in Russian, the time zone card's submit
("Сохранить часовой пояс") measured 603–829px inside a card ending at 736px — 93px past it — and
the page's scroll width was 829px in a 768px viewport: a horizontal page scroll, which CLAUDE.md §10
rules out. The select and the button sit in one row that does not wrap; the longer Russian label is
what pushes it over.

**Acceptance criteria**
- [x] No horizontal page scroll on `/account` at 375, 768 and 1280, in en, ru and hy
- [x] The select and its button stack or wrap rather than overflow, and the button stays ≥ 44px

**Validation**
```bash
pnpm --filter app-web test account
```

---

### T-163 — An agency-settings race spec leaves a rejection unhandled
- **Status:** DONE — 2026-09-27. The spec builds `expect(attempt).rejects` before releasing the competitor and awaits it last. The competing transaction now settles 100 ms after its commit, holding CI's ordering open on every run: on the old ordering that reproduces CI's error (all tests pass, `Unhandled Rejection: AppError: STATE_CONFLICT`) in 5/5 runs; on the new, 20/20 targeted runs clean. API suite green at 100%
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/tenants/settings/agency-settings.service.spec.ts

**Description**
Found in T-160's CI review. Run 36269910347 (PR "Bump actions/setup-node", which changes no test)
went red with all 2,791 tests passing: Vitest caught an unhandled `AppError: STATE_CONFLICT` from
`agency-settings.service.spec.ts` › "refuses a first save that another first save reached the
database ahead of". The spec starts `attempt`, calls `release()`, then `await competing` — and only
after that attaches `expect(attempt).rejects`. Once the competitor commits, `attempt` can reject
before the handler is attached, which Node reports as unhandled. The assertion itself is sound;
the ordering is not. Attach the rejection expectation before `release()` (and await it after), so a
fast rejection has a handler waiting.

**Acceptance criteria**
- [x] The spec attaches its rejection handler before the competing transaction is released
- [x] Seen failing first: a delay forcing `attempt` to reject before `await competing` returns
  reproduces the unhandled error on the old ordering and not on the new
- [x] 20 targeted runs of the file with no unhandled error

**Validation**
```bash
pnpm --filter api test agency-settings
```

---

### T-164 — An unconfirmed account opening `/account` gets "Application error"
- **Status:** DONE — 2026-09-27. Wider than filed: the `(workspace)` layout itself read `GET /workspaces`, which the API refuses a not-yet-active account (`requireActive`, since T-075), so no workspace page rendered for an unconfirmed reader; the layout spec mocked a 204 the API never sends. `getWorkspaces()` (cached, in `lib/api/server.ts`) does not ask for an unconfirmed reader; layout, Home, Account and Agency use it. Four pages whose content the API keeps back now show `ConfirmFirst` (`EmptyState` + `ResendVerification`) instead of asking: help article, agency profile, find investigators, an investigator's reviews. Checked before the call, not a caught 403 — a denial is an audited event. The resend button wraps (`whitespace-normal`): in ru its label ran 443px on a 375px `/account`. Specs seen failing first (layout with the real 403, the four pages). In the browser against the real API, unconfirmed: all 16 workspace routes render, redirect or 404 — no server exception; the four pages and `/account` at 375, 768 and 1280 in en, ru and hy with no horizontal scroll, the button 44px (66px where it wraps); resend → 202 and its status. Confirmed, the same pages show the reviews list and the search. `app-web.md`, KB `kb-customer-account-access-and-security` v3 (en; ru/hy drafts), component inventory. Filed T-165
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/app/(workspace)/account/page.tsx

**Description**
Found in T-162's browser check. A new account signed in before confirming its address, with
`next=/account`, landed on Next's bare "Application error: a server-side exception has occurred"
(digest 783991466). The page's server read of `GET /workspaces` is refused 403 `FORBIDDEN` —
correctly: `WorkspacesService.list` calls `requireActive`, and an unconfirmed account is not active.
The page does not handle that refusal and throws. Once the address was confirmed the page rendered.
The API rule stays as it is; the page should show what an unconfirmed reader can do (confirm, resend
the link) instead of crashing. Check the other `(workspace)` pages for the same unhandled refusal.

**Acceptance criteria**
- [x] An unconfirmed account opening `/account` sees a page that says to confirm the address, with a
  way to resend the link — no server exception
- [x] Every `(workspace)` page an unconfirmed reader can reach is checked, and none throws
- [x] Spec seen failing first; checked in the browser against the real API at 375, 768 and 1280

**Validation**
```bash
pnpm --filter app-web test account
```


---

### T-165 — The assistant tells an unconfirmed reader only "You cannot do that here"
- **Status:** DONE — 2026-09-27. The layout hands `AssistantProvider` a server-rendered `ConfirmFirst` while `emailVerified` is false; the provider then never loads the conversation (no `/ai/*`, no `/workspaces` from the browser), and the panel shows the assistant's name, **Close** and `ConfirmFirst` in its place, focus on **Close**. `resolveServer` (test helper) now resolves an async element passed as any prop, as the server renderer does — the layout spec renders the real `ConfirmFirst`. Specs (phone sheet, docked panel, layout) seen failing first. In the browser against the real API, unconfirmed: the sheet at 375 and 768, docked at 1280, in en, ru and hy — no horizontal scroll, **Close** 44px, resend inside the panel (wrapping to 66px where its label is long), no `/ai` request in the API log; confirmed, the same account opens a new conversation with the composer focused (`GET /ai/sessions?limit=1` 200). `app-web.md`, KB article (en, ru, hy), inventory. Filed T-166
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/assistant/**

**Description**
Found in T-164's browser check. An unconfirmed account opening the assistant sees "The conversation
could not be opened", "You cannot do that here" and **Try again**: `GET /ai/sessions` is refused 403,
correctly — `AiSessionsService` calls `requireActive`, and an account is not active until its address
is confirmed. Trying again cannot succeed. Like the pages T-164 fixed, the panel should say what opens
it (confirm the address) and offer the new link, without asking the API for what it would refuse. The
layout already knows `emailVerified`.

Whether help articles and the assistant's public-policy answers should open to an unconfirmed account
at all is an authorization question, not this task — asked of the owner in T-164's handoff.

**Acceptance criteria**
- [x] An unconfirmed reader opening the assistant sees "confirm first" with **Send the confirmation
  link again**, and no call to `/ai/*` is made
- [x] Spec seen failing first; checked in the browser at 375, 768 and 1280 in en, ru and hy

**Validation**
```bash
pnpm --filter app-web test assistant
```

---

### T-166 — The assistant's phone sheet is not full-screen
- **Status:** DONE — 2026-09-27. Cause: `max-h-sheet` is our own `@utility`, which tailwind-merge did not know is a max-height, so `cn` kept it beside the panel's `max-h-dvh` and the cascade chose it. `cn` now extends tailwind-merge with each `@utility` `globals.css` defines (`max-h-sheet`; `pb-safe` and `pb-bottom-nav`, the same blind spot) by the property it sets; `globals.css` and `app-web.md` say a new one is added there too. Specs (`utils.spec.ts`, the assistant sheet's classes) seen failing first. In the browser: the assistant sheet at 375×812 and 768×1024 is top 0, height = viewport; the discovery filter sheet, which passes no height, still stops at 85dvh on a phone (690 of 812) and is its full-height side sheet at 768
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/assistant/assistant-panel.tsx, apps/app-web/src/components/ui/drawer.tsx

**Description**
Found in T-165's browser check. `AssistantPanel` means the sheet below `lg` to be full-screen (T-056:
"a full-screen sheet"), and its `DrawerContent` carries `h-dvh` and
`data-[vaul-drawer-direction=bottom]:max-h-dvh`. The drawer's own default
`data-[vaul-drawer-direction=bottom]:max-h-sheet` wins the cascade: at 375×812 the sheet measured
690px tall, its top at 122px, with the page's notice showing above it. The spec only checks that the
class is there (`toHaveClass('h-dvh')`), which it is. Not a T-165 change — every assistant sheet is
affected. Decide how the override should win (the variant's order, or the panel not taking the
default), and check the other sheets that pass their own height.

**Acceptance criteria**
- [x] The assistant's sheet fills the viewport at 375 and 768 (measured top 0, height = viewport)
- [x] The other `DrawerContent` sheets keep the height they are meant to have
- [x] Spec seen failing first; checked in the browser

**Validation**
```bash
pnpm --filter app-web test assistant
```

---

### T-167 — A policy-refusal spec orders money decisions by clock
- **Status:** DONE — 2026-09-27. The order is not part of the claim — no product code reads money decisions in order — so the spec no longer sorts by `decided_at`: each test reads the hold after the halt, and asserts what the review added by row id (`moneySince`), never by date. `stepClockBack` dates the review's decision an hour before the hold (the trigger that keeps decisions immutable is set aside for that one owner transaction), reproducing CI's `[SPLIT, HOLD]` on the old assertions in both order-dependent tests; it stays in them, so a clock step now happens on every run. 20/20 runs of the file at load average ~19 (app-web's suite looping beside it). A first attempt at load ran the whole API suite concurrently: the two runs share the per-worker test databases and broke each other wholesale — not a way to load it
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/assignments/assignments-policy-refusal.spec.ts

**Description**
Found in T-138's full run, under load (load average ~20): `assignments-policy-refusal.spec.ts` ›
"cancels a halted assignment with the money decided separately" got `[SPLIT, HOLD]` where it expects
`[HOLD, SPLIT]`, then passed 5/5 alone. Its `moneyOf` orders `money_decisions` by `decided_at`, a
clock, and the two decisions are written in separate transactions — the ordering T-155 found in
`mission_status_history`, where a clock step in the Docker VM reorders two rows. No product code
reads money decisions in order (the service only inserts them), so this is the spec's. Decide
whether the order is part of the claim (then the table needs a write-order column, as T-155 added
`seq`) or not (then the spec compares without order), and show the reorder reproduced first.

**Acceptance criteria**
- [x] The reorder is reproduced (e.g. `decided_at` of the second row stepped back) and the spec no
      longer depends on it
- [x] 20 runs of the file under the full suite's load with no failure

**Validation**
```bash
pnpm --filter api test assignments-policy-refusal
```
---

### T-168 — Replay dead letters, and alert on their count
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-082
- **Risk:** MEDIUM
- **Human approval required:** Yes — replay runs work again under the system context's reach
- **Owner agent:** backend-domain + infra-devops
- **Affected:** apps/api/src/common/jobs/**, monitoring

**Description**
From T-082. A job that fails for good lands in `job_dead_letters` with its context and payload, and
nothing reads them yet. The `background-jobs` skill asks that a dead-letter queue alert on depth and
that replay be one command after the fix. Add `pnpm --filter api jobs:replay <id>` (re-enqueues the
envelope as it was, so the runner re-checks its context; a replayed letter is marked, never deleted)
and a metric or alert on the number of letters newer than a day. Prune letters and `job_runs` per
`retention.md`.

**Acceptance criteria**
- [ ] A replayed letter runs once, in its original context re-read, and is marked replayed
- [ ] A letter whose context is still gone is refused again, not run
- [ ] Dead-letter depth is visible to monitoring, with an alert threshold
- [ ] A replay of `ai.plan.execute` does nothing once T-224 has ended the plan; the dead-letter alert lives in T-227 (review 2026-10-06)

**Validation**
```bash
pnpm --filter api test jobs
```

---

### T-169 — The notification centre and email settings in the app
- **Status:** DONE — bell + unread count in the shell (sidebar from `md`, a top bar on a phone), the centre as a popover / bottom sheet (`components/notifications`), Account → Emails switch (`components/account/emails-section.tsx`); `@shadcn/popover` adopted; unsubscribe copy and KB en/ru/hy point to the setting; e2e `notifications.e2e.ts`
- **Priority:** P1
- **Depends on:** T-036
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**, packages/i18n

**Description**
From T-036. The API is built (`docs/architecture/notifications.md`): list with cursor, unread
count, mark one and all read, preferences. Add the centre to app-web — a bell with the unread count
in the shell, a sheet on the phone and a popover from `md` up, each item linking to its `href` — and
an "Emails" section in account settings with the one `activity` switch. Search the registries
first (`component-discovery`). Once the switch exists, put back the pointer the unsubscribe page and
the KB (`kb-customer-notifications`, `kb-investigator-notifications`) dropped: "you can turn them
back on in your account".

**Acceptance criteria**
- [x] Unread count in the shell; the centre lists, pages and marks read; empty state
- [x] Email switch reads and writes `PUT /notifications/preferences`
- [x] Phone first: sheet, 44 px targets, no horizontal scroll; en/ru/hy
- [x] Unsubscribe copy and KB articles point to the setting again

**Validation** — green 2026-10-01 (768 unit at 100% coverage; 38/38 e2e at 375 and 1280 px). The
script is `test:e2e`; the line said `e2e`, which does not exist
```bash
pnpm --filter @investigator/app-web test && pnpm --filter @investigator/app-web test:e2e
```

---

### T-170 — Browser push notifications
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-036, T-169
- **Risk:** MEDIUM
- **Human approval required:** Yes — VAPID keys are a new secret (ACTIONS-FOR-ME), and a new channel is a migration on the preferences CHECK
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/notifications/**, apps/app-web (service worker), migrations

**Description**
From T-036. Web Push for the responsive app (ADR-0009: the phone experience is the web app): a
`push_subscriptions` table (tenant-owned, own user), a `push` channel in preferences, a
`notifications.push` job beside `notifications.email`, keyed per (event, recipient, channel). The
payload says what `notifications.md` allows an email to say — a kind and a link — and nothing more.

**Acceptance criteria**
- [ ] Subscribe and unsubscribe from the app; a gone subscription (410) is removed
- [ ] One push per (event, recipient) whatever the retries; off by preference
- [ ] Payload carries no content

**Validation**
```bash
pnpm --filter api test notifications
```

---

### T-171 — Notifications for quotes, messages, reports and expiring verification
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-036, and each event's producer — verification expiry (T-072); messaging, which has no task yet (plan.md §13)
- **Risk:** MEDIUM
- **Human approval required:** No, unless an event needs a new policy
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/notifications/**, producers' outbox events, packages/i18n

**Description**
From T-036. Only mission and assignment status changes notify today. Add: quote received
(customer), quote accepted (investigator), new message (the other party — "a new message", never
the message), verification expiring and expired (investigator). Each is a kind in `kinds.ts`, a
template in the `email` namespace in en/ru/hy, and an outbox event its producer writes. Route
agency work to the assigned team (T-086) where one exists, and carry the agency's name where
branding allows (T-084).

**Acceptance criteria**
- [ ] Each event notifies the right party once, in their workspace and language
- [ ] No template names content
- [ ] KB articles list the new events

**Validation**
```bash
pnpm --filter api test notifications
```

---

### T-172 — A saved-search spec orders two saves by clock
- **Status:** DONE — 2026-10-01. Newest first is the claim, so the order stays asserted: the spec dates the first save an hour earlier as the owner instead of trusting the clock between two saves. Reproduced first: giving the second save the first's timestamp (millisecond `Date` against microsecond `created_at`) reordered the list 6/6. Now 10/10 runs pass, and listing oldest first fails it
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/search/mission-browse.service.spec.ts

**Description**
Found during T-036: `mission browse › saved searches › saves a browse under a name, lists it newest
first, and deletes it` failed once in three full runs (2026-09-30) with the two saves in the other
order. `listSaved` orders by `created_at DESC, id DESC`; two saves in the same microsecond tie and
fall to the random id. Same shape as T-167. Give the spec distinct timestamps (or assert on the
order the service promises for a tie) rather than relying on the clock; do not weaken the assertion.

**Acceptance criteria**
- [x] The spec is deterministic, and still fails if the list is not newest first

**Validation**
```bash
pnpm --filter api test mission-browse
```

---

### T-173 — Report a person, profile, mission or assignment to staff
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-052
- **Risk:** MEDIUM
- **Human approval required:** Yes — a new staff queue under PlatformContext, and what a report may hold
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/reports/** (new), apps/app-web/**, apps/admin-web/**

**Description**
From T-052, and release checklist §7: in-app reporting on profiles, missions and assignments (and
messages, with T-174). Distinct from blocking — report is "staff should look at this". A report
reaches a staff queue (reason, reporter, subject), the reporter is acknowledged, and it never
reveals the reporter to the reported. Blocking offers to report as well; it never reports silently.

**Acceptance criteria**
- [ ] Report from a profile, a mission and an assignment, with a reason; acknowledged
- [ ] A staff queue under PlatformContext, audited; the reported person never learns who
- [ ] The block dialog offers to report too; declining sends nothing
- [ ] KB articles, en/ru/hy

**Validation**
```bash
pnpm --filter api test reports && pnpm --filter @investigator/app-web test:e2e
```

---

### T-174 — Blocks in messaging
- **Status:** BLOCKED — messaging has no task yet (plan.md §13)
- **Priority:** P1
- **Depends on:** T-052, messaging
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** the messaging module when it exists

**Description**
From T-052. With messaging: no new conversation between two people blocked either way
(`app_blocked_users()` in its policy, as missions do); the thread for a live assignment stays
open until staff resolve it, so the dispute record stays whole; block from a conversation.

**Acceptance criteria**
- [ ] No new conversation either way; an assignment's thread continues
- [ ] Block from a conversation
- [ ] The blocked party sees nothing different in shape or timing

**Validation**
```bash
pnpm --filter api test messaging
```

---

### T-175 — Staff screens for blocks, and resolving a flagged assignment
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-052
- **Risk:** HIGH
- **Human approval required:** Yes — resolving can reassign or cancel work with a refund (payment logic)
- **Owner agent:** admin-web + backend-domain
- **Affected:** apps/admin-web/**, apps/api/src/modules/blocks/**, assignments

**Description**
From T-052. The API lists blocks made during a live assignment (disputes staff) and accounts
blocked by several people (enforcement staff). Add the console screens, and the resolution the
first list exists for: continue, reassign, or cancel with the refund decided on its merits — a
recorded decision that takes the assignment off the list. Tune `BLOCK_SIGNAL_THRESHOLD` (3,
provisional) with trust and safety.

**Acceptance criteria**
- [ ] Both lists in the console, paged
- [ ] A recorded resolution per flagged assignment, audited; refund through the payments module
- [ ] Threshold confirmed by the owner

**Validation**
```bash
pnpm --filter api test blocks && pnpm --filter @investigator/admin-web test
```

---

### T-176 — A refresh that arrives is sometimes not applied under load
- **Status:** BLOCKED — reproduced and narrowed to the React canary bundled with Next 15.5 (below); waits on a Next release whose bundled React fixes it (owner decision 2026-10-01: record and park, no app change)
- **Priority:** P2
- **Depends on:** —
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web (every `router.refresh()` after a change)

**Description**
Found verifying T-052. With both Playwright projects running at once, `router.refresh()` after a
block fetched a correct RSC payload (checked: it no longer held the card) yet the page kept the old
list — 2 runs in 8 even with the page settled first; never with one project alone. T-052 no longer
depends on it (the result shows at once), but every screen that refreshes after a change — sessions,
unblock, agency forms — could show stale state the same way. Reproduce in isolation — the probe used: in
`e2e/blocks.e2e.ts` with `BlockableListing` removed, log the page's requests and the RSC body after
confirming, then count the cards after 3 s and after a reload — find the cause in Next 15.5 or our usage, and fix it
where it lives.

**Acceptance criteria**
- [x] A reproduction, and the cause named (to the scheduler; the exact line in React is not pinned — see findings)
- [ ] Fixed, with an e2e run repeated enough to show it

**Validation**
```bash
pnpm --filter @investigator/app-web test:e2e
```


**Findings (2026-10-01)**
Reproduced with the task's probe (`hide()` made a no-op in `block-person.tsx`; count the card 3 s
after confirming, then after a reload): 30–50% of runs with both projects, far more than the 2 in 8
first seen. Measured, in order:
- The refresh fetches the right tree and delivers it: every segment's `rsc` is present, and every
  Flight chunk the render waits on ends `fulfilled`. No console error, no page error, no navigation
  (the action queue only discards a refresh when a navigation arrives), no lazy segment fetch, and
  Next's `unresolvedThenable` is never reached.
- React receives it: the router's promise fulfils, and every wake-up React attaches — on that promise
  and on each streamed chunk — fires and marks the lane pinged.
- Then the refresh transition's last render suspends once more **without attaching any listener**
  (read from the root through a devtools hook: the transition lane is pending and suspended, pinged
  is 0, and no further `then` is ever called), so nothing retries it. The old list stays until the
  next update. Next records no commit (`history.replaceState` is never called for it).
- Not our code: the same with `router.refresh()` called directly instead of inside `useTransition`.
- Trigger: a refresh that removes one keyed card from a list that keeps others. Never when the list
  empties (single project: 0 in 12, CPU-throttled 6× included); with the projects run one after the
  other it still occurs (1 in 6), so contention widens the window but is not the cause.
- The App Router runs Next's own React, `19.2.0-canary-0bdb9206-20250818`, not the app's pinned
  19.2.8. Next 15.5.26 and 15.5.27 are security-only releases and do not touch it.

Unblocks when: a Next release bundles a React that no longer strands the transition — rerun the probe
above against it, both projects at once, enough runs to show it (it was 30–50% here). Until then every screen that
refreshes after a change can, occasionally, keep showing the old state; screens that must show the
result at once do it themselves, as T-052's block does.
---

### T-177 — Armenian says “գործ” for a mission; the notification emails say “առաջադրանք”
- **Status:** DONE — 2026-10-01. Owner decision: the word is «առաջադրանք», the knowledge base's, not the app's «գործ» (the reverse of the description below). The app's 65 mission strings changed; «գործ» kept where it means something else; the articles' quoted UI labels follow; the phone tab's label may take two lines; an Account-page overflow found on the way fixed
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** localization
- **Affected:** packages/i18n/src/messages/hy.ts, docs/knowledge-base/{customer,investigator}/*.hy.md (9 files), apps/app-web/src/components/shell/nav-links.tsx, apps/app-web/src/components/account/{add-role-form,legal-outstanding}.tsx, docs/product/translation-glossary.md, ACTIONS-FOR-ME.md

**Description**
Found in T-052: the app calls a mission «գործ» (149 uses, the navigation included), but T-036's
Armenian email templates and notification articles use «առաջադրանք». Use the app's word; the
articles stay drafts for the native-speaker review (ACTIONS-FOR-ME #22).

**Acceptance criteria**
- [x] One word for a mission across hy.ts and the hy knowledge base

**Validation**
```bash
pnpm --filter @investigator/i18n test && python3 scripts/validate-knowledge-base.py
```



**Done 2026-10-01 — the owner chose «առաջադրանք».** The knowledge base already used it in 31 articles;
the app said «գործ» in 65 strings, the navigation included. Each «գործ» in `hy.ts` was read in
context: 65 lines take «առաջադրանք» with its endings (plural «առաջադրանքներ»); eight keep «գործ»
because it means something else there — «ում հետ գործ ունեմ» (dealings), «իրավական գործում» (a legal
case), and «գործում է» (works / is valid: rules, links, a quote). In the articles, «գործ» meaning a
mission — the quoted labels **Առաջադրանքներ → Նոր առաջադրանք**, **Բաց առաջադրանքներ**,
**Չեղարկել առաջադրանքը** and the Emails switch among them — changed in 9 files; its other senses
(a case, «did its job», «is in force») stay. The glossary's open conflict #2 is settled.

Verified at 375 px in Armenian: «Առաջադրանքներ» was cut to «Առաջադ…» in the phone tab, so the tab's
label may now take two lines, broken inside a word when one is wider than its column («Առաջադր|
անքներ» — ACTIONS-FOR-ME #23 asks the reviewer whether that reads); the sidebar keeps one line. The
same look found the Account page 402 px wide in Armenian and Russian: the add-role and outstanding-
documents forms are grids whose implicit `auto` column grew to the legal documents' "not yet
translated" note. Both forms are now `grid-cols-1`, as T-178's cards.
---

### T-178 — A category name with no spaces pushes the mission card past a phone's width
- **Status:** DONE — the cause was `CardHeader`'s implicit `auto` grid column, not the badge: it grew to the unbroken label. `grid-cols-1` on `CardHeader` and `break-words` on `CardTitle` (app-web and admin-web `ui/card.tsx`); `blocks.e2e.ts` seeds a 60-character category and a title with a URL
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/ui/card.tsx, apps/admin-web/src/components/ui/card.tsx, apps/app-web/e2e/blocks.e2e.ts, docs/product/component-inventory.md

**Description**
Found in T-169. On `dev`, a published mission whose category label is one long unbroken word
(`notifications-1790805183042-mobile`, 34 characters — a slug stands in for the label in e2e)
widens the browse at 375 px to 397 px: the category `Badge` is `shrink-0`, so the `truncate` on its
text never applies, and in the one-column list the widest card sets every card's width. Reproduced
on `dev` by lengthening `blocks.e2e.ts`'s slug to that length — its no-horizontal-scroll check
fails. Real labels have spaces today, but a long compound word in any locale does the same. Let the
badge shrink so the label truncates, and hold it with a long unbroken label in the card's spec.

**Acceptance criteria**
- [x] A 60-character unbroken category label truncates within the card at 375 px
- [x] No horizontal scroll on the investigator browse with such a label (e2e)

**Validation**
```bash
pnpm --filter @investigator/app-web test && pnpm --filter @investigator/app-web test:e2e
```


**Done 2026-10-01.** The description's guess (the badge is `shrink-0`) was wrong: the badge is not a
flex item, its `min-w-0` wrapper is. `CardHeader` is `grid` with one implicit `auto` column, and a
grid item's automatic minimum is its min-content — the whole unbroken label — so the column, the card
and the page grew to it. Verifying the fix found the same with a long unbroken word in the **title**
(a pasted address, which a customer can type): fixed in the same card with `break-words`, and held by
the same spec. The regression failed on `dev` before each fix. The browse list's own `grid` did not
need changing once the card stops asking for the width.

---

### T-180 — Flaky tests: audit order trusted, and a filter-sheet walk-through near its timeout
- **Status:** DONE — 2026-10-01. Five API specs now read audit rows in content order; two app-web filter-sheet specs drive user-event without a pause between steps. Found by six full runs of `pnpm test` and five of `test:e2e` side by side (load average up to ~29), plus a search of every spec that reads `audit_logs`
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/{blocks/blocks.service,notifications/notifications.service,ai/discovery/ai-discovery.answer,auth/auth-oauth.service,teams/teams}.spec.ts, apps/app-web/src/components/{missions/mission-browse,discovery/discovery}.spec.tsx

**Description**
A sweep for flaky tests, after T-172. Every CI failure on our own branches in the last 100 runs was
explained (audit advisories, Dependabot updates), so the sweep ran the suites repeatedly under load
and searched for the shape behind T-155, T-167 and T-172.

**What was found and done**
- **Seen failing: the missions filter sheet.** `mission-browse.spec.tsx` › "shows what is applied,
  and turns every choice into the address at once" timed out at 5 s in one of six full runs. Alone, it
  took 1.4–3.8 s: user-event's default `delay: 0` yields to a timer after every keystroke and step, and
  the test takes dozens. `delay: null` dispatches the same events in the same order, each awaited:
  0.65–0.8 s at the same load. `discovery.spec.tsx`, the other filter-sheet walk-through (1.3 s),
  gets the same. No timeout was raised, no step removed.
- **Latent: audit order.** `audit_logs` has no write-order column, and `occurred_at` is the writing
  transaction's start, so rows written together tie and a clock step reorders separate ones. A read
  with no `ORDER BY` returns heap or index order instead, which moves when a row is placed elsewhere.
  Five specs asserted an order nothing guarantees: blocks (3 assertions) and notifications (1),
  ordered by `occurred_at`; AI discovery (2, plus two `.at(-1)` taken as "the answer row"); and
  auth-oauth (2) and teams (1), with no `ORDER BY`. Each helper now orders by what the rows say
  (action, then reason or resource), the answer row is found by its action, and every row's content
  and the count are still asserted — only the claim of a sequence the table cannot hold is gone.
  Shown first: reversing the rows' `occurred_at` and moving the earliest row to the heap's end (a
  delete and re-insert as the owner — a no-op update is HOT and moves nothing an index scan sees)
  failed 13 tests across the five old specs, and none of the new.
- Not a test: T-176 (a refresh not applied under load) stays BLOCKED on Next's bundled React.

**Acceptance criteria**
- [x] Each fix is shown against the failure it prevents, and the claim each test makes is kept
- [x] Full `pnpm test:coverage` green, 100% gate held; e2e 5/5 under load

**Validation**
```bash
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm --filter @investigator/app-web test:e2e
```


**Addendum (found in T-100's full run, 2026-10-01).** Three more, fixed the same way:
`assistant-sessions.spec.tsx` dated a conversation `2026-09-24` and expected "… ago"; once a week had
passed it read "last week" and failed every day — now three days before the run, asserted exactly.
`assistant-turn.service.spec.ts` and `ai-discovery.search-tool.spec.ts` look for a coordinate in
stored JSON by `/44\.5|40\.1/` and `/44\.51/`; an ISO timestamp whose seconds read `:40.1…` or
`:44.5…` matched by chance (shown with a timestamp of `…:44.512Z`). Timestamps are removed before the
check, which still catches the point at any precision.
---

### T-179 — Take Next 15.5.27's security fixes (self-hosted cache poisoning)
- **Status:** TODO — 15.5.27 was 1 day old on 2026-10-01; CLAUDE.md's bar is ~2 weeks unless the owner decides a security fix goes sooner
- **Priority:** P2
- **Depends on:** —
- **Risk:** MEDIUM
- **Human approval required:** Yes — a framework bump ahead of the age bar is the owner's call
- **Owner agent:** frontend
- **Affected:** apps/app-web/package.json, apps/admin-web/package.json, apps/marketing-web/package.json, pnpm-lock.yaml, CLAUDE.md (pinned versions)

**Description**
Found in T-176. Next 15.5.27 (2026-09-30) fixes three medium advisories — GHSA-f87g-xv8r-7p7x
(metadata image routes, `dynamicParams` bypass), GHSA-4jqv-mc3x-m676 and GHSA-mcj8-r9mp-w47p (cache
poisoning of SSG/ISR pages in **self-hosted** deployments, which this platform is). 15.5.26 is
`next/og` hardening. Decide whether they apply to our routes, then bump every app together and update
the pin table.

**Acceptance criteria**
- [ ] Each advisory read against our routes, and the answer recorded
- [ ] All three apps on the same 15.5 release; pin table updated; build, unit and e2e green

**Validation**
```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm --filter @investigator/app-web test:e2e
```


---

### T-181 — Investigators known to customers by a pseudonym, never their legal name
- **Status:** DONE — 2026-10-01. `investigator_profiles.pseudonym` (migration 0035) set from the profile's details form; the public projection, discovery, the assistant's tool output and block labels carry it (or a per-profile code), never the legal name; `test/identity-masking.spec.ts` walks every read as a customer who hired the investigator
- **Priority:** P1
- **Depends on:** T-100
- **Risk:** MEDIUM
- **Human approval required:** Yes — given in chat 2026-10-01 (it changes what customers see of an investigator, and adds a column of personal data)
- **Owner agent:** backend-domain + database + frontend
- **Affected:** apps/api/src/database (migration 0035), apps/api/src/modules/{profiles,search,ai/tools/discovery,blocks}, apps/app-web (profile editor, every place an investigator is named to a customer), packages/i18n, docs

**Description**
Owner decisions, 2026-10-01: an investigator is shown to customers by a **pseudonym they choose**,
**never** their legal name — before or after hire; the legal name stays between the investigator and
staff (verification). Pseudonyms are **unique** across the platform, compared without case, and may
not be or contain the investigator's own legal name, an email address or a phone number. Until one is
chosen, customers see a neutral fallback ("Investigator" and a per-profile code), never the legal
name.

**Acceptance criteria**
- [x] `investigator_profiles.pseudonym`: nullable, 2–60 characters, unique without case; reversible migration — 0035, with its `.down.sql`
- [x] The investigator sets it on their profile; refused when taken, or when it is their legal name, an email or a phone — `OWN_NAME` (any shared word of 3+ letters, also after a rename), `CONTACT`, `TAKEN`; `null` clears it
- [x] Every customer-facing view names an investigator by pseudonym or fallback: public profile, discovery, the assistant's tool output, blocks — `PublicInvestigatorProfile` has no `displayName` at all; `nameCode` stands in
- [x] A generated spec walks every read as a customer — before and after hire — and fails on the investigator's legal name, email, phone or user id — walked as the customer who hired them; seen failing with the old projection (`GET /profiles/investigator/:id → first name, surname`)
- [x] The app's profile editor and preview, discovery and assistant cards show the pseudonym; en/ru/hy — looked at on a phone: the field beside the legal name, its hint, and an `OWN_NAME` refusal under it
- [x] KB, plan.md and architecture docs say customers see a professional name, never the legal one — investigator profile-and-service-areas v5 (new "What name do customers see?"), verification v4, customer finding-an-investigator v5, ai-assistant v8 (en + ru/hy drafts); profiles.md, blocks.md; OpenAPI metadata regenerated

**Validation**
```bash
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm --filter @investigator/app-web test:e2e
```


**Done 2026-10-01.** Before: the legal name reached customers on the public profile, every discovery
result, the assistant's investigator cards (and the model, which could repeat it), and a customer's
own block list. Not done, deliberately: existing block rows keep the label they were made with (a
customer's own list of what they saw); rewriting them is a data change that needs approval, and
pre-launch there is no production data. Publishing does not require a pseudonym — until one is
chosen customers see the code; the status card does not nag (a possible follow-up). Staff and agency
member lists keep the legal name: neither is shown to customers.

---

### T-182 — Investigators choose: a pseudonym, or their legal name
- **Status:** DONE
- **Priority:** P1
- **Depends on:** T-181
- **Risk:** MEDIUM
- **Human approval required:** Yes — given in chat 2026-10-01 (it changes what customers may see of an investigator)
- **Owner agent:** backend-domain + database + frontend
- **Affected:** apps/api (migration 0036, profiles, search, ai discovery tool, blocks), apps/app-web (details form, every investigator name), packages/i18n, docs

**Description**
Owner decisions, 2026-10-01, amending T-181: the pseudonym is optional. On their profile the
investigator chooses, with a radio choice, whether customers know them by **a pseudonym** or by
**their legal name**. **A pseudonym is the default** — for new profiles and every existing one — so
nothing changes for anyone who does not choose. With a pseudonym, T-181 holds in full: the legal name
never reaches a customer. With the legal name, customers see the name verification checked; email,
phone and user id stay private either way.

**Acceptance criteria**
- [x] `investigator_profiles.public_name`: `PSEUDONYM` (default) or `LEGAL`, not null; reversible migration
- [x] The public projection names the investigator by their choice (`name`), or the stand-in code when that name is unset
- [x] The identity walk still proves a pseudonymous investigator's legal name never reaches a customer; a legal-name investigator is named by it, and still never by email, phone or user id
- [x] The profile's details form offers the choice as a radio pair, the pseudonym field shown only when it is chosen; en/ru/hy
- [x] KB, plan.md and architecture docs describe the choice and its default

**Done (2026-10-01):** migration 0036 (`public_name_choice` enum, `investigator_profiles.public_name`
default `PSEUDONYM`, with down). The public projection's `pseudonym` became `name` — the pseudonym, or
the legal name when `LEGAL` — and search, the AI discovery tool and block labels follow the same
rule; the owner's view adds `pseudonym` and `publicName`. Details form: a `RadioGroupChoice` pair
(moved out of the intake's `questions.tsx` so both share it); the pseudonym field and its value are
only present when a pseudonym is chosen, so switching back restores the stored one. en/ru/hy strings;
KB investigator profile v6, verification v5, customer finding-an-investigator v6 (and the ru/hy
drafts); plan.md, profiles.md, blocks.md, component inventory. Identity walk: a `LEGAL` investigator
is named by the legal name and still leaks no email, phone or user id. Verified in the browser at
375px and 1280px with a throwaway e2e (not committed): the choice saves, survives a reload, and the
preview shows the legal name.

**Validation**
```bash
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm --filter @investigator/app-web test:e2e
```

---

### T-183 — Agency admins choose which agents customers know by their legal name
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-087, T-182
- **Risk:** MEDIUM
- **Human approval required:** Yes — it changes what customers may see of an investigator, and adds an agency permission over a member's public name
- **Owner agent:** backend-domain + database + frontend
- **Affected:** apps/api/src/modules/{profiles,tenants}/**, migrations, apps/app-web (agency console, investigator details form), packages/i18n, docs

**Description**
Owner request, 2026-10-02: in an agency, the agency's admins decide per agent whether customers see
that agent's pseudonym or their legal name, as T-182 lets an independent investigator decide for
themself. Owner decision: **the admin chooses, and the legal name is shown only with that agent's
consent.** Without consent, or once it is withdrawn, the agent is shown by their pseudonym (or the
stand-in code), whatever the admin chose. A pseudonym stays the default.

Blocked until agencies hold profiles (T-087): today every investigator profile belongs to its owner's
Personal workspace, so there is no agent profile for an agency to manage.

Open for the task: the permission that sets it (likely `investigators.update`, tenancy.md §3); where
consent lives (on the profile, held by the agent's own membership) and that withdrawing it takes
effect on the next read; what the agent sees in their own form when the admin's choice is waiting
on their consent.

**Acceptance criteria**
- [ ] An agency member with the permission sets PSEUDONYM or LEGAL for each agency-held profile; without it, refused, and audited either way
- [ ] The legal name reaches a customer only when the agency chose LEGAL **and** the agent consented; the identity walk (`test/identity-masking.spec.ts`) proves each of the four combinations
- [ ] The agent can give and withdraw consent from their own profile; withdrawal hides the legal name on the next read
- [ ] Independent investigators (Personal workspace) keep T-182 unchanged
- [ ] Agency console: the choice per agent on the investigators list (card on phones, table from desktop), showing when consent is missing; en/ru/hy
- [ ] KB (agency and investigator profile articles), tenancy.md, profiles.md

**Validation**
```bash
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm --filter @investigator/app-web test:e2e
```

---

### T-184 — An invitation names an investigator profile the new member takes over
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-087, T-071
- **Risk:** MEDIUM
- **Human approval required:** Yes — it changes who holds a profile customers know, and its verification and reviews
- **Owner agent:** backend-domain + database
- **Affected:** apps/api/src/modules/{tenants/employees,profiles}/**, migrations

**Description**
From T-085 (tenancy.md §2): an invitation "may also name an investigator profile the new member
takes over". Left out of T-087 because a profile is held by one membership (migration 0037's key),
and changing its holder changes whose verification and whose reviews it carries. Decide what moves
with the profile (storefront, reviews, quotes in flight) and what is reset (verification, which
attaches to a person), then build it as part of accepting the invitation.

**Acceptance criteria**
- [ ] An invitation may name a held profile whose holder has left; accepting makes the new member its holder in one transaction
- [ ] Verification and the name customers see follow the decision above; the change is audited
- [ ] KB `kb-agency-employees` and `kb-agency-investigators` updated

**Validation**
```bash
pnpm --filter api test invitations profiles
```

---

### T-185 — Show the agency an investigator works for (app-web)
- **Status:** DONE — 2026-10-03; "Works for {agency}" (`AgencyLine`) under the name on the discovery card, profile page, assistant card and preview; e2e in `agency.e2e.ts`; KB customer v8/ru v4/hy v4, investigator v8/ru v5/hy v5
- **Priority:** P2
- **Depends on:** T-087
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/{discovery,assistant,investigator}/**, apps/app-web/src/lib/api/types.ts, packages/i18n

**Description**
From T-087: the public projection, discovery results and the assistant's `searchInvestigators` output
carry `agency: { id, name } | null`, but app-web renders none of it. Show the agency's name on the
discovery card, the investigator's profile page, the assistant's result card and the investigator's
own preview, so a customer sees what `kb-customer-finding-investigator` v7 describes.

**Acceptance criteria**
- [x] The agency's name appears where the investigator's name does, and nothing appears for an independent one
- [x] The preview shows it exactly as customers will see it
- [x] Verified at 375 and 1280; en/ru/hy

**Validation**
```bash
pnpm --filter @investigator/app-web test && pnpm --filter @investigator/app-web test:e2e
```

---

### T-186 — `loading.tsx` and streamed segments: refresh that never commits, copies left in the DOM
- **Status:** DONE — 2026-10-03; cause is upstream (vercel/next.js#86151, fixed in 16.3.0, not in 15.x); all three mission `loading.tsx` removed, `src/app/loading-states.spec.ts` keeps them out below 16.3; `e2e/missions.e2e.ts`; `app-web.md` "Route loading states"
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/app/**/loading.tsx, apps/app-web/e2e/**

**Description**
From T-093. In the production build, a route segment's `loading.tsx` above a dynamic page left
`router.refresh()` uncommitted: the refresh payload arrived with the new data and was never applied, so
a save did not show until a reload (0 of 5 on `/agency/investigators/[id]` with an `/agency/loading.tsx`,
6 of 6 without; dev builds unaffected). `/missions` and `/missions/[id]` still have one, and pages under
them keep a hidden streamed copy of the page (`<div hidden id="S:0">`) after it has been swapped in —
duplicate ids, and locators that find two of everything. Find the cause (Next 15.5.25 / React 19.2.8),
decide per route whether its loading state earns its place, and prove the mission pages refresh after a
change (cancelling, editing a draft) in the production build.

**Acceptance criteria**
- [x] Every page with a `loading.tsx` above it shows a save without a reload, in the production build, checked by Playwright
- [x] No streamed copy of a page is left in the DOM after hydration
- [x] app-web.md says what was found and which routes keep a loading state

**Validation**
```bash
pnpm --filter @investigator/app-web test:e2e
```

---

### T-187 — Tell the app which permissions the reader holds in the workspace
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-093
- **Risk:** MEDIUM
- **Human approval required:** Yes — it exposes the authorization model to the client (display only; the API still decides)
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/tenants/workspaces.*, apps/app-web/src/components/agency/console/**

**Description**
From T-093. The agency console offers every action to every member and lets the API refuse it — a
viewer sees **Send invitation** and **Manage** and is told afterwards that their role does not include
them. `GET /workspaces` already resolves the reader's permissions for the current workspace; returning
them (display only, never trusted) would let the console leave out what the reader cannot do. Roles
stay names to show, never something the client decides from.

**Acceptance criteria**
- [ ] The current workspace's permission keys reach the client, read per request like everything else
- [ ] The console leaves out actions the reader does not hold, and the API's refusal still covers anything that gets through
- [ ] A spec holds that no client code decides from a role name

**Validation**
```bash
pnpm --filter api test workspaces && pnpm --filter @investigator/app-web test
```

---

### T-188 — Specialty badges that do not wrap widen a phone page
- **Status:** DONE — 2026-10-03; specialty badges wrap on `PublicProfileCard` and `SpecialtiesPicker` (the picker widened the page too); `agency.e2e.ts` keeps a 60-character slug and checks for sideways scroll; `app-web.md` "Long specialty labels"
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/investigator/public-profile-card.tsx, apps/app-web/src/components/ui/badge.tsx

**Description**
From T-185. `Badge` is `whitespace-nowrap`, and `PublicProfileCard` shows each specialty as one. A
long label — an unbroken 60-character node with no label in the reader's language, which the profile
shows by its id or slug — ran past the preview drawer at 375px and made the whole page wider than
the screen: on an emulated phone, Playwright could no longer hit the drawer's Close button. Real labels
are short today, but a translation or an unlabelled node is not bounded. Let a specialty badge wrap
(or truncate with its full text available) without changing the badge everywhere else.

**Acceptance criteria**
- [x] A 60-character unbroken specialty leaves `/account/investigator`'s preview and `/missions/investigators/[id]` without horizontal scroll at 375px
- [x] Other badges are unchanged

**Validation**
```bash
pnpm --filter @investigator/app-web test && pnpm --filter @investigator/app-web test:e2e
```

---

### T-189 — Move to Next 16.3+, then decide again where a route loading state earns its place
- **Status:** TODO — gated on the version bar: 16.3 must have been out long enough (CLAUDE.md, "Pinned versions")
- **Priority:** P3
- **Depends on:** T-186
- **Risk:** MEDIUM
- **Human approval required:** Yes — a major framework bump is the owner's call (as T-179)
- **Owner agent:** frontend
- **Affected:** apps/app-web/package.json, apps/admin-web/package.json, apps/marketing-web/package.json, apps/app-web/src/app/**/loading.tsx

**Description**
From T-186. Next 15's router can lose a `router.refresh()` under a `loading.tsx` (vercel/next.js#86151);
the fix (vercel/next.js#95391) shipped in 16.3.0 and was not backported, so app-web has no route
loading states and `src/app/loading-states.spec.ts` refuses one. Navigating to a slow page now shows
the previous one until the next is ready, with no sign that anything is happening. On 16.3+ the guard
lets go: restore a loading state only where the wait needs one, and prove it with the same journeys.

**Acceptance criteria**
- [ ] On Next ≥ 16.3 (peer ranges checked: React, eslint-config-next, typescript-eslint)
- [ ] `/agency/loading.tsx` restored temporarily: `agency.e2e.ts` passes 10 of 10 in the production build — the evidence the fix holds here
- [ ] Each loading state brought back is named in `app-web.md` with why it earns its place; `missions.e2e.ts` and `agency.e2e.ts` pass with them

**Validation**
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm --filter @investigator/app-web test:e2e
```

---

### T-190 — `/account/investigator` fails with a server error when the reader shows the platform as a customer
- **Status:** DONE — 2026-10-03; `/account/investigator` and Account's link to it use `actsAsInvestigator`; unit tests (seen failing first) and a step in `agency.e2e.ts`; `app-web.md`, KB `kb-customer-getting-started` en/ru/hy
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/app/(workspace)/account/investigator/page.tsx

**Description**
From T-188. Someone holding both roles who chooses **Show the platform as: Customer** (T-127) and then
opens their investigator profile — linked from Account — gets "Application error: a server-side
exception". The page checks only that `INVESTIGATOR` is held, not the active role; the API narrows to
the chosen role and answers `/profiles/investigator/me` with 403, which the page does not handle. It
should do what `/missions` does with `actsAsInvestigator`: not offer the page while acting as a
customer (redirect to Account, where the role choice is), rather than throw.

**Acceptance criteria**
- [x] Acting as a customer, `/account/investigator` lands on Account's role choice; no server error
- [x] Acting as an investigator, or as both, the page is unchanged
- [x] A test holds both roles with the customer one chosen

**Validation**
```bash
pnpm --filter @investigator/app-web test && pnpm --filter @investigator/app-web test:e2e
```

---

### T-191 — Per-category moderation gate: open a low-risk category, deliberately
- **Status:** TODO — waits for review-latency data and counsel's confirmation (plan §10)
- **Priority:** P3
- **Depends on:** T-051
- **Risk:** HIGH
- **Human approval required:** Yes — it would publish missions no moderator read; lawful-use policy and counsel
- **Owner agent:** backend-domain + admin-web
- **Affected:** apps/api/src/modules/mission-policy/**, apps/api/src/modules/missions/mission-transitions.ts, apps/admin-web/**, migrations

**Description**
From T-051. The gate is closed: every mission is reviewed, and each decision records its category,
risk band and queue time (`mission_moderation_decisions`), so review latency per category and band
exists from the first day. Plan §10 makes this the lever if review latency ever becomes the
constraint: a configuration per category and band that could let a low-risk category — records
checks, say — publish without a moderator. That is a second path to QUOTED, which T-051's invariant
spec forbids today; this task is where that changes on purpose, or is decided against. The data to decide on is in
the console since T-193 (Review times, `/moderation/latency`).

**Acceptance criteria**
- [ ] The latency data and counsel's confirmation are recorded before anything opens (ACTIONS-FOR-ME)
- [ ] Configuration per category and risk band, defaulting to closed, changed only by staff with an audited reason
- [ ] Partner and relationship investigation, and any mission with a flag or a HIGH or RESTRICTED band, are never auto-published (ADR-0009) — enforced, not configured
- [ ] An auto-published mission is recorded as such, and the invariant spec names the one new path
- [ ] Customer and staff knowledge base say which categories, if any, publish without review

**Validation**
```bash
pnpm --filter api test mission-moderation && pnpm --filter admin-web test
```

---

### T-192 — Flaky focus check in the agency teams journey on mobile
- **Status:** DONE — 2026-10-03; `TeamCard` returns focus to **Edit** in an effect after the commit, not a frame; `agency.e2e.ts` repeat-safe
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/agency/console/teams.tsx, apps/app-web/e2e/agency.e2e.ts

**Description**
Seen during T-051's full e2e run: `agency.e2e.ts` › "makes a team, puts the owner in and takes them
out, renames it, and deletes it once asked" failed once on the mobile project with
`expect(locator).toBeFocused() failed`, then passed 3 of 3 on rerun (1 failure in 4). The journey
asserts focus twice — the name field when editing opens, and the Edit button after saving a rename
(T-093's focus return) — and the artifacts were overwritten before the failing one was identified.
Find which, and whether a user can lose focus there too (a real defect) or only the test races a
re-render, and fix the cause rather than adding a wait.

**Acceptance criteria**
- [x] The failing assertion identified, with the cause — `:328`, focus back on **Edit** after a
      rename is saved (reproduced: 4 of ~11 mobile runs). `stopEditing` closed the form and focused
      the button in a `requestAnimationFrame`; a save resolves after an `await`, so React commits the
      closed form on its own schedule, and a frame that came first found no button — focus fell to
      the page. A real defect: a keyboard user lost their place. Now an effect on `editing` moves it
      after the commit, as `mission-intake` does; Cancel too
- [x] The journey passes 20 of 20 on both projects (`--repeat-each=20`) — mobile 20/20, desktop 20/20

**Validation**
```bash
pnpm --filter @investigator/app-web test:e2e
```

*Built.* `teams.tsx`; two Vitest cases seen to fail first — a frame that comes before the commit
(stubbed `requestAnimationFrame`), and Cancel. To run the journey twenty times at all, `agency.e2e.ts`
gives each project and repeat its own address (five registrations an hour per IP) and its own email
(repeats start in the same millisecond — which found T-195). `app-web.md` "Focus" states the rule.

*Validated.* Lint, typecheck, format; coverage 100% (api 3312, app-web 855). The other failures the
repeat runs found are not the teams journey's: T-195 (registration) and T-196 (desktop navigation).

---

### T-195 — Two registrations for one address at once: a 500, not the usual answer
- **Status:** DONE — 2026-10-03; a lost race on `users_email_unique` answers as a duplicate (`auth.service.ts`)
- **Priority:** P3
- **Depends on:** —
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/auth.service.ts

**Description**
Found during T-192's repeated e2e runs: three journeys started in the same millisecond registered the
same address. One got 202; the other two got **500**. `AuthService.register` looks for an existing
account and then inserts, so two requests both pass the check and the second insert breaks
`users_email_unique`, which nothing catches. A double-tapped Sign up does the same. The answer for
an address already registered is otherwise the same 202 as a new one, so it gives nothing away
(enumeration). This path should give that answer too, not an error.

**Acceptance criteria**
- [x] A unique violation on `users.email` during registration answers as an existing address does
      (202, the same body, the same audit), and nothing else is swallowed — matched by code and
      constraint name, as `profile-store` does; anything else rethrows
- [x] An integration test sends two registrations for one address concurrently: exactly one account,
      both 202 — seen to fail first. *Deterministic rather than by chance:* the other registration is
      an owner transaction holding the row uncommitted until this one's insert is seen waiting on it
      (`pg_blocking_pids`); then one account, a resolved register, one `auth.register.duplicate` row
      naming the winner

**Validation**
```bash
pnpm --filter api test auth
```

*Verified.* No browser surface; the integration test above runs against PostgreSQL as the runtime
role. Not probed against the development API: its mailer sends through Resend. The documented contract
already said this ("Always 202", OpenAPI; "check your email", `app-web.md`) — now the code keeps it.
`pnpm --filter api test auth` passes; coverage 100%.

---

### T-196 — Navigation flakes in the agency journey on desktop under repeat
- **Status:** DONE — 2026-10-04; journeys that shared an account, not the app: `agency.e2e.ts` builds every address and name from a per-journey random tag; 360/360 on both projects
- **Priority:** P3
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/e2e/agency.e2e.ts, apps/app-web/src/components/agency/**, apps/app-web/src/components/workspace/**

**Description**
Found running `agency.e2e.ts --repeat-each=20` for T-192 (four workers, both projects): five
failures, all desktop, none in the teams journey, each a navigation or refresh that did not land
within 5s — "Now working in Ararat Checks." never shown after creating the agency (`:98`); the
Account link to `/agency` leaving the page on `/account` (`:117`); **Make a profile** leaving the
page on `/agency/investigators` (`:368`); the **Customer** toggle's `aria-pressed` staying `false`
(T-185, twice). Single runs pass; the artifacts are in the run's `e2e/.output/results`. Like T-192,
find for each whether a person could meet it (a router refresh left uncommitted, as T-186 found) or
only the test races, and fix the cause rather than adding waits.

**Acceptance criteria**
- [x] Each failure's cause identified — as far as the evidence allows: the run's artifacts were gone
      (setup empties `e2e/.output` every run), so the class is proven and the five are not each pinned.
      **Shared accounts.** Those runs built the owner's email from `Date.now()` without the repeat
      index; journeys started together share a millisecond, and so an account — the same runs gave
      T-195's 500s. Reproduced with that email restored: three journeys on one account, the third's
      sign-in refused "Too many attempts" (five per account per five minutes). Sharing an account
      shares its agencies, roles and investigator profiles, which fits "Make a profile" refused in
      place and the Customer toggle; not a defect a person meets. Four more identifiers in the spec
      were clock-built (colleague and invitee emails, pseudonym, taxonomy slug — the invitee's had
      neither project nor repeat). **Contention.** At 8 workers the first wave stalled the whole
      stack ~10 s (API reads 10–15 s, `/agencies/new` rendered in 26.5 s), and `:117` failed on the
      test's own 30 s budget with the `/agency` payload delivered 200 ms before the page closed — a
      laptop overloaded by the suite, not a lost navigation
- [x] `agency.e2e.ts --repeat-each=20` passes on both projects — 360/360 (180 mobile, 180 desktop), twice: before the change 360/360, after it 360/360

**Validation**
```bash
pnpm --filter @investigator/app-web exec playwright test agency.e2e.ts --repeat-each=20
```


*Built.* `agency.e2e.ts`: one random tag per journey (`beforeAll`), every generated email, pseudonym
and slug built from it. `app-web.md` "Browser flows": a journey's identifiers are its own, never the
clock's; `e2e/.output` is emptied each run. No app change: no failure traced to app code. Filed T-199
(the same in the other four specs).

*Validated.* `playwright test agency.e2e.ts --repeat-each=20` 360 passed (4.4 m); prettier, ESLint
and the e2e typecheck on the spec. No browser surface beyond the suite itself: verified by the
runs above — the 8-worker run and the experiment with the old email were diagnostic, not shipped.

---

### T-199 — Give every e2e spec's generated accounts and names a per-journey tag
- **Status:** DONE — 2026-10-04; `e2e/support/journey.ts` (`journeyTag`, `journeyAddress`) used by all five specs; `--repeat-each=5` 270/270
- **Priority:** P3
- **Depends on:** T-196
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/e2e/{account,blocks,missions,notifications}.e2e.ts, apps/app-web/e2e/support/**

**Description**
From T-196. `agency.e2e.ts` now builds every email and slug from a per-journey random tag, because
journeys started together share a millisecond and two on one address share an account. The other
four specs still build emails (and `blocks`, `notifications` their taxonomy slugs) from
`${info.project.name}-${Date.now()}`: safe for one run of each, but `--repeat-each` — how a flake is
hunted — starts copies together and gives them one account. Move the tag into `e2e/support` and use
it everywhere.

**Acceptance criteria**
- [x] No spec builds an email, slug or name from the clock — nor from the project alone: `blocks`
      named its mission and pseudonym by project, so repeats beside each other listed look-alikes
- [x] Each spec passes `--repeat-each=5` on both projects — 270 passed (2.1 m), every spec

**Validation**
```bash
pnpm --filter @investigator/app-web exec playwright test --repeat-each=5
```


*Built.* `e2e/support/journey.ts`: `journeyTag()` (twelve random hex characters, once per journey)
and `journeyAddress(info, spec, person)` — the `X-Forwarded-For` a journey's browsers send, one per
spec, viewport, person and repeat, in 10.0.0.0/8. Found on the way: `missions` and `notifications`
used the same two addresses, and `account` none (loopback), so their registrations shared a limit;
each journey now has its own. `agency.e2e.ts` moved onto the shared helpers. `app-web.md` "Browser
flows" updated.

*Validated.* `playwright test --repeat-each=5` 270 passed; prettier, ESLint and the e2e typecheck.
No browser surface beyond the suite: verified by the run itself.

---

### T-197 — Mark the language of fallback labels inside composed text
- **Status:** DONE — 2026-10-04; `Named.lang` from `labelLocale` (`lib/taxonomy.ts`); `t.rich` with `<name></name>` / `<list></list>` for the active-filter chip and the brief; category options marked too
- **Priority:** P3
- **Depends on:** T-055
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend + localization
- **Affected:** apps/app-web/src/components/missions/**, packages/i18n (catalogs), apps/api/src/modules/taxonomy/** (category label locale)

**Description**
Found re-verifying T-055. A label the reader's language lacks is shown in English; where it is a
control's whole name, the chip carries `lang` (T-055). Where it sits inside a composed string it
cannot: the active-filter chip's accessible name is `aria-label` "Убрать фильтр: Litigation", and
the brief line is one message, "Теги: Litigation, …". `use-intl`'s `t.rich` takes tag functions,
not elements as values, so marking the part means a tag in the message across en/ru/hy. Category
labels have the same gap one step earlier: `TaxonomyNode` carries no label locale at all, so
nothing can mark them (WCAG 3.1.2, language of parts).

**Acceptance criteria**
- [x] The active-filter chip's name marks a fallback tag or category label with its language
      — named by its content (visually hidden "Remove filter: …"), not `aria-label`
- [x] The brief's tag and category lines mark a fallback label with its language
- [x] Category options (`GET /taxonomy`) report the locale their label came from, as `GET /tags` does
      — already did (T-053, `taxonomy.service.spec.ts`); app-web's `TaxonomyNode` now types and uses it
- [x] Catalog parity holds across en/ru/hy for any message that gains a tag

**Validation**
```bash
pnpm --filter @investigator/app-web test && pnpm --filter api test taxonomy
```


*Validated.* `pnpm --filter @investigator/app-web test` 863 (coverage 100%); `pnpm --filter api test
taxonomy` 67/67; i18n 29 (parity); lint, typecheck, format, app-web build. Specs seen failing
first: the chip (category and tag, on a Russian page), the brief, the sheet's and intake's options.

*Verified.* In the browser against the local API, on a Russian page: the chips read "Убрать фильтр:
Проверка контрагента" (`lang="ru"`) and "Убрать фильтр: Litigation" (`lang="en"`), names checked in
Chromium's accessibility tree (Playwright snapshot); the language chip carries no `lang`; chips look
as before, 44px, no horizontal scroll at 375, 768 and 1280. The customer's brief: the category in
`lang="ru"`, "Детективы находят его по тегам: Litigation" with Litigation in `lang="en"`. Docs:
`app-web.md`. Filed T-198 for the category labels outside missions.

---

### T-198 — Mark fallback category labels outside the missions screens
- **Status:** DONE — 2026-10-04; `NamedText` / `namedList` (`components/named-text.tsx`); discovery sheet, chips and card, specialties picker, public profile and its preview, mission card; the assistant card is T-200
- **Priority:** P3
- **Depends on:** T-197
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/{discovery,investigator}/**, apps/app-web/src/components/missions/mission-card.tsx, apps/app-web/src/app/(workspace)/**/investigators/**

**Description**
From T-197. Category labels now carry their language (`Named.lang`, from `labelLocale`) and the
missions screens mark them. Elsewhere a category shown in English on a Russian or Armenian page is
still unmarked: the mission card's category badge, the discovery sheet's category options and
active filters, the specialties picker, and the specialties on an investigator's profile (WCAG
3.1.2). Same fix — `lang={c.lang}` where a label stands alone, `t.rich` where it sits in a sentence.

**Acceptance criteria**
- [x] Every place app-web shows a category label marks it with `lang` from `labelLocale` — all but
      the assistant's investigator card, whose labels come from the discovery tool with no locale (T-200)
- [x] A label inside a composed string keeps its `lang` (message tag + `t.rich`), names checked by content
      — discovery `remove`, `card.matched`, `card.missing` in en/ru/hy
- [x] Specs seen failing first for each surface — discovery (card, chip, sheet), the profile card, the
      picker (chosen and offered), the public profile page, the mission card

**Validation**
```bash
pnpm --filter @investigator/app-web test
```


*Validated.* app-web 864 (coverage 100%), i18n 29, lint, typecheck, format, build. Component
inventory: `NamedText`, `namedList` (registries searched first). `app-web.md` updated.

*Verified.* In the browser against the local API, on a Russian page: the specialties picker's
options (`ru` for a translated node, `en` for an English one, none for a slug) and the chosen chip;
the preview "as a customer" and the public profile, the specialty `lang="en"`; discovery's card
"Подходит: Demo: Background checks" and its chip "Убрать: Demo: Background checks", each label
`lang="en"`; the sheet's options; the mission card's badge `lang="ru"`. 375, 768 and 1280, no
horizontal scroll. The specialty added to verify was removed through the API afterwards.

---

### T-200 — The assistant's investigator card: say which language a specialty is in
- **Status:** DONE — 2026-10-04; `labelLocale` on the discovery tools' `NodeLabel` (`searchInvestigators`) and nodes (`listTaxonomy`); the assistant card, "Searched for" and the specialty clarification mark it
- **Priority:** P3
- **Depends on:** T-198
- **Risk:** LOW
- **Human approval required:** No — a read-only tool's output gains a field
- **Owner agent:** ai-rag + frontend
- **Affected:** apps/api/src/modules/ai/tools/discovery/**, apps/app-web/src/components/assistant/**, apps/app-web/src/lib/api/assistant.ts

**Description**
From T-198. Every category label in app-web now carries the language it is in, except the
assistant's investigator card: the discovery tool returns specialties as `NodeLabel { id, label }`
(`discovery.schemas.ts`), with no locale, so a specialty shown in English on a Russian page cannot
be marked (WCAG 3.1.2). Give `NodeLabel` the `labelLocale` the taxonomy already resolves, and render
the card's specialties and reasons with `NamedText` / `namedList`.

**Acceptance criteria**
- [x] The discovery tool's `NodeLabel` carries `labelLocale`; the tool's schema and its registry entry say so (`ai-tool-registry`)
      — `TaxonomyService.labels` returns each label with its locale; `listTaxonomy` too;
      `assistant-tools.md`. Read-only output only: scope, authorization, audit and limits unchanged
- [x] The card's specialties and its "matched / not matched" reasons mark each label's language
      — and the "Searched for" line and the clarification's buttons; a reply stored before has no
      `labelLocale` and is shown unmarked, as it was given
- [x] Specs seen failing first, API and app-web

**Validation**
```bash
pnpm --filter api test discovery && pnpm --filter @investigator/app-web test
```


*Validated.* `pnpm --filter api test discovery` 107/107; API coverage 100% (3314); app-web 865,
coverage 100%; i18n 29; lint, typecheck, format; builds.

*Verified.* No model is configured locally (ACTIONS-FOR-ME #6), so the reply was not generated: a
conversation was created through the API and a discovery reply stored in it, then opened in the
assistant on a Russian page, docked at 1280 and as the sheet at 375 — "Предлагает: Проверка
контрагента" (`lang="ru"`), "Не предлагает: Demo: Background checks" (`lang="en"`), the
specialties fact and the "Искали: …" line marked the same, language and place unmarked; no
overflow. The tools' half is the integration specs against PostgreSQL. The conversation was
deleted through the API afterwards.

---

### T-201 — Real client addresses for connections Docker relays (IPv6 on the server)
- **Status:** BLOCKED — 2026-10-04, the repository half is done; the proof waits for the provisioned host (T-040). `server.yml`'s edge network is dual-stack (`enable_ipv6`, `fd20:0:0:1::/64`), so Docker publishes Caddy's ports to IPv6 clients by NAT rather than through `docker-proxy`. Seen on a Linux Docker daemon (29.5, Colima's VM): before, IPv6 had no NAT rule and a relay to Caddy's IPv4 address; after, `DNAT --to-destination [fd20:0:0:1::2]:443`, as IPv4 has. `edge.spec.ts` holds it; `client-address.md` says what the host check is
- **Priority:** P2 — every relayed client shares one sign-in rate limit and one audit address
- **Depends on:** T-023; a provisioned host (T-040)
- **Risk:** MEDIUM
- **Human approval required:** Yes — infrastructure, on the real host (repository half approved in conversation, 2026-10-04)
- **Owner agent:** infra-devops
- **Affected:** infrastructure/compose/server.yml, docs/operations/client-address.md

**Description**
From T-023. Caddy sees the client only when Docker forwards a published port by NAT. When Docker's
userland proxy relays the connection instead, Caddy's peer is the edge network's gateway, so every
such client shares that address. That is IPv6 clients on an IPv4-only Docker network — Hetzner
hosts have IPv6 — and everything under Colima or Docker Desktop (seen as `172.20.0.1`). Not
spoofable: the gateway is not in `TRUSTED_PROXIES`. Candidate fixes, to be chosen on the host:
`enable_ipv6` on the edge network with ip6tables NAT, or `userland-proxy: false` in the daemon.

**Acceptance criteria**
- [ ] On the provisioned host, an IPv4 and an IPv6 client each reach the API as their own address (a failed sign-in's audit row)
      — waits for the host. The mechanism is shown locally (NAT rules above); a client from outside
      the Docker host cannot be: Colima's forwarder carries every macOS connection, and a container
      client is either masqueraded or dropped by Docker's bridge isolation (both tried)
- [x] `docs/operations/client-address.md`'s known-gap section records the fix, or is removed
      — rewritten: the cause, the before/after rules, and the three checks only the host can make

**Validation**
Two failed sign-ins from the host's public IPv4 and IPv6 paths, and the audit rows' `ip_address`.

---

### T-202 — Validate the Caddyfile in CI
- **Status:** DONE — 2026-10-04. `scripts/check-caddyfile.sh` runs `caddy validate` and `caddy fmt --diff` with the Caddy image it reads from `server.yml` — one digest, which Dependabot's compose updates move — and `pr.yml` runs it before Format, needing no database. `supply-chain.spec.ts` drives the script with a stand-in `docker` on the PATH. `ci-cd` skill, `infrastructure/caddy/README.md`
- **Priority:** P3
- **Depends on:** T-023
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** infra-devops
- **Affected:** .github/workflows/pr.yml, apps/api/test/supply-chain.spec.ts

**Description**
From T-023. `edge.spec.ts` holds the Caddyfile's rules as text, but only Caddy can say the file
parses: `caddy validate` and `caddy fmt --diff` run by hand (`infrastructure/caddy/README.md`).
Run both in `pr.yml` with the image `server.yml` pins, and have the supply-chain spec hold that
the two digests match.

**Acceptance criteria**
- [x] A PR whose Caddyfile does not parse, or is not `caddy fmt`-clean, fails CI — seen failing first
      — the script against a copy with an unknown directive (line 118) and one unindented line (62): exit 1, Caddy naming the line
- [x] The CI step's Caddy digest is `server.yml`'s, held by a spec
      — read from `server.yml` rather than repeated, so there is no second digest to drift; the spec
      holds that the image run is `server.yml`'s pinned one

**Validation**
```bash
pnpm --filter api test supply-chain
```

*Validated.* `supply-chain`, `edge`, `workspace-scripts`, `fixtures` specs 56/56; spec typecheck;
lint; format; `validate-knowledge-base.py` 0 errors. The script on the real Caddyfile: exit 0.

*Verified.* No browser surface — a CI step. The script was run against the real file, an invalid
copy and an unformatted copy (above). The spec was mutated three ways — the CI step removed, a
floating `caddy:2-alpine` in the script, docker's failure swallowed with `|| true` — and failed
the matching test each time. The step's first run in GitHub Actions is the PR's.

---

### T-203 — The marketing site itself: pages, and what they say
- **Status:** BLOCKED — needs the owner: the product's name, the home page's message, and pricing (ACTIONS-FOR-ME #26, #17)
- **Priority:** P1 — T-024 and the apex domain wait on it
- **Depends on:** T-023; owner input
- **Risk:** LOW
- **Human approval required:** Yes — what the public site says about the product is the owner's
- **Owner agent:** frontend
- **Affected:** apps/marketing-web/**

**Description**
Found selecting T-024 (2026-10-04). `apps/marketing-web` is the T-001 stub — no Next.js app, no
route — and no task builds it, while T-024's criteria (sitemap, canonical, hreflang, JSON-LD for
home, nested pages, posts and FAQ) all presume pages. Nor is there content to put on them: the
product has no name, no marketing copy, no blog, and pricing is undecided. The only public content
that exists is the three policy articles in `docs/knowledge-base/policies/` (en/ru/hy).
Writing a name and a pitch in three languages to fill the pages would be inventing what the
product claims to be (CLAUDE.md §8: no UI against data that does not exist).

Build the Next.js app on the apex per ADR-0002 and the `domain-and-seo` skill: locale in the URL,
no authenticated UI, links into the app through the domain map (`packages/config`) carrying
`?lang=` (ADR-0013); the public policy articles rendered from the knowledge base; the pages the
owner's content calls for. Its Dockerfile and a `marketing-web` service in `server.yml` at the
fixed-address-free part of the internal network (Caddy already proxies `marketing-web:3000`).

**Acceptance criteria**
- [ ] The owner has supplied the name, the home page's message and the pricing position — recorded where the copy lives
- [ ] `/`, `/ru`, `/hy` and the public policy pages render, mobile first; no session check anywhere
- [ ] Every link into the app is built by `appUrl()` and carries `?lang=`
- [ ] `marketing-web` runs in `server.yml`; the apex returns 200, not 502

**Validation**
```bash
pnpm --filter @investigator/marketing-web test && pnpm --filter @investigator/marketing-web build
```

---

### T-193 — Review latency per category and risk band (admin console)
- **Status:** DONE — 2026-10-03; `MissionModerationService.latency` (`mission_moderation.latency`), admin-web `/moderation/latency`; `missions.md`, `admin-web.md`, staff KB
- **Priority:** P2
- **Depends on:** T-051
- **Risk:** MEDIUM
- **Human approval required:** Yes — a new staff read across workspaces (aggregates only); taken on 2026-10-03 in place of T-191's switch
- **Owner agent:** backend-domain + admin-web
- **Affected:** apps/api/src/modules/mission-policy/**, apps/admin-web/**

**Description**
From T-191. Opening any category of the moderation gate rests on review-latency data and counsel's
confirmation (plan §10). T-051 records the data — every decision's category, band, queue time and
outcome in `mission_moderation_decisions` — but nobody can read it. This is the reading half: what
the decision to open, or not, would be made on. It adds no path to QUOTED.

**Acceptance criteria**
- [x] `GET /moderation/missions/latency` — per category and risk band over a chosen period: decisions made, median, 90th-percentile and longest wait, and how many were published, returned and rejected
- [x] Aggregates only — no mission, customer or moderator is identified; MODERATION scope; enters through `PlatformContext` with its own purpose
- [x] The console shows it from the moderation queue, readable at 375 and 1280, and says what it is for and that nothing opens from it
- [x] Staff KB and `missions.md` say where the data is and what it decides

**Validation**
```bash
pnpm --filter api test mission-moderation && pnpm --filter admin-web test
```

---

### T-204 — Retention on a schedule
- **Status:** DONE — 2026-10-05; retention sweeps as BullMQ schedulers in the worker (`maintenance` queue), rules in `legal-hold/retention-rules.ts`, the sign-in purge removed; retention.md "How retention runs", jobs.md, google-sign-in.md, ACTIONS #25
- **Priority:** P2
- **Depends on:** T-035
- **Risk:** MEDIUM
- **Human approval required:** Yes — it deletes data on a timer; approved 2026-10-05 (chosen over T-206, which waits on counsel)
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/jobs/**, apps/api/src/modules/legal-hold/**, apps/api/src/modules/auth/google-auth.service.ts

**Description**
From T-035. The only retention deletion runs on a request — the Google sign-in start purges lapsed
`oauth_attempts` when it finds one — and `retention.md` names others with no job at all
(`job_runs`, `notifications`, `idempotency_keys`, `outbox_events`). Each sweep crosses into platform
access and is audited, so on a busy sign-in path the crossing trail fills with housekeeping. Add a
repeatable BullMQ job per retention rule, each a `RetentionGuard.sweep()` with its own
`retention.*` purpose, and move the oauth purge onto it.

**What shipped**

- **Rules as code, one place**: `retention-rules.ts` — table, period, interval, and the resources a row
  belongs to. `retention-rules.spec.ts` holds each period equal to the register's row.
- **Scheduled in the worker**: `RetentionSchedule` installs a BullMQ scheduler per rule on a new
  `maintenance` queue at start, and removes any for a rule the code no longer has (only `retention.*`
  ones). `RetentionSweepHandler` is a system job: the runner's one crossing, the sweep in its
  transaction. A scheduler queues the same envelope each time, so each run is keyed by its queue id
  (`scheduledRun`) — otherwise every run after the first was a duplicate.
- **The guard** now sweeps in the transaction it is given and **refuses outside platform access**.
- **Only `oauth_attempts` is swept.** The register says not to build an irreversible deletion
  against its provisional periods; `job_runs`, `notifications`, `idempotency_keys` and `outbox_events`
  each join as one entry when counsel fixes theirs.
- Verified with the real worker against local PostgreSQL and Redis: it scheduled the rule, the first
  run removed a lapsed attempt within seconds, one `job_runs` row keyed `repeat:retention.oauth_attempts:<t>`,
  one `platform.access` and one `retention.deleted` under that id; SIGTERM stopped it cleanly.

**Found:** the worker is not in `infrastructure/compose/server.yml` (ACTIONS #25). Before this task
the purge ran inside the API; now an environment without the worker deletes nothing — filed T-208.

**Acceptance criteria**
- [x] Each rule runs on a schedule, through the guard, as the system; one crossing per run
- [x] The sign-in start no longer deletes anything
- [x] A rule's period comes from one place `retention.md` names; a shortened period is not applied retroactively without a recorded decision (retention.md rule 4) — the period and the register are held equal by a spec, so a change shows in one diff with both

**Validation**
```bash
pnpm --filter api test retention jobs
```

---

### T-205 — Legal holds in the staff console
- **Status:** DONE — 2026-10-05; admin-web `/legal-holds` (list, lookup, place and release sheets), the console's nav; shared `Drawer` now focuses into the sheet and honours reduced motion; `admin-web.md`, component inventory, staff KB `kb-staff-legal-holds@2`, runbook
- **Priority:** P2
- **Depends on:** T-035
- **Risk:** MEDIUM
- **Human approval required:** No — the API and its authorization exist; this is their screen
- **Owner agent:** admin-web
- **Affected:** apps/admin-web/**

**Description**
From T-035. COMPLIANCE staff place, read and release holds through `/api/v1/legal-holds` with no
screen — the law-enforcement runbook says to call the API. A list (in force by default), a place
form and a release action, each asking for the reason the API requires. *(A page per hold was
dropped: the API reads holds only as a list, and a card already shows all a hold says.)*

**What shipped**

`/legal-holds`: in force / released / all, newest first, paged; a lookup by kind and id ("is this
account held?"); a card per hold with the record, the reason, who placed and released it and when;
**Place a hold** and **Release** as sheets, disabled until the API's 12-character reason, the release
saying it cannot be undone. The page follows the console's pattern for scope: listed for all staff,
the API refuses all but COMPLIANCE, and the page says so.

**What the browser found, after every spec had passed** — each fixed, re-verified, and held by a test
where jsdom can see it:
- `RESOURCES.find is not a function`: the server page imported an array from a `'use client'`
  module, which arrives as a reference. Values moved to `lib/legal-holds.ts`; `client-boundary.spec.ts`
  now fails on any non-component import from a client module into a server one (seen failing first).
- The shared `Drawer` left focus on the trigger and let Tab walk behind the open sheet (vaul 1.1's
  `autoFocus` defaults off; app-web had already set it). On by default now — `drawer.spec.ts`, seen
  failing first. Moderation's and verification's sheets get the fix too.
- vaul's own 0.5s animation ran under reduced motion; `motion-reduce:` turns it off (app-web: T-207).
- A third nav link wrapped under the others at 1440; the email now gives way instead.
- A sheet's error rendered at the top of its scrolling body, out of view once the reader had scrolled
  to submit; it now sits beside the buttons. The place sheet kept the last record after placing; it
  starts afresh.

Verified at 1440, 768 and 375, light and dark, reduced motion, keyboard, accessibility tree.

**Acceptance criteria**
- [x] List, place and release, readable at 375 and 1280; release confirms, since it cannot be undone
- [x] Nobody without COMPLIANCE reaches anything — the page says the scope is needed and shows no hold (seen in the browser with the scope revoked)
- [ ] Nobody without COMPLIANCE **sees the navigation entry** — not done. The console lists every destination for every member of staff (T-070); hiding one needs `/me` to return the reader's scopes, which exposes the authorization model to the client — the change T-187 is approval-gated for. Owner's decision whether to do it
- [x] Staff KB and the runbook no longer send staff to the API

**Validation**
```bash
pnpm --filter admin-web test
```
---

### T-206 — Erasure requests, and what a legal hold does to them
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-035, counsel (retention periods, ACTIONS-FOR-ME #0)
- **Risk:** HIGH
- **Human approval required:** Yes — account deletion, erasure and retention
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/account/**, apps/api/src/modules/ai-sessions/**, apps/api/src/modules/legal-hold/**

**Description**
From T-035. There is no web account-deletion or erasure workflow: `retention.md` describes one
("Erasure request … blocked by a legal hold") and the customer KB promises one, but no code
receives a request. The one erasure that exists — a person deleting their assistant session, which
erases its messages at once (owner decision 2026-09-23) — consults no hold. Decide with the owner
whether a hold on the person stops that erasure, and build the request workflow: a request against
held data goes to COMPLIANCE as an item to resolve, and is never resolved automatically.

**Acceptance criteria**
- [ ] An erasure request against held data is surfaced to compliance, never auto-resolved — moved here from T-035
- [ ] The assistant-session erasure either consults holds or `retention.static.spec.ts` records why not, as decided
- [ ] Customer KB `kb-customer-privacy-data` says what happens to a request while data is held

**Validation**
```bash
pnpm --filter api test erasure legal-hold
```

---

### T-207 — app-web's sheets ignore reduced motion
- **Status:** DONE — 2026-10-05; app-web `Drawer` opts the sheet and scrim out of vaul's animation under reduced motion; `drawer.spec.tsx` (new: focus and the opt-out); `app-web.md`, component inventory
- **Priority:** P2
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/ui/drawer.tsx

**Description**
Found in T-205. vaul injects its own CSS — `animation-duration: .5s` on the sheet and its scrim — so
the duration tokens, which go to zero under `prefers-reduced-motion`, never reach it. Every app-web
sheet built on its `Drawer` still slides for half a second with motion reduced. admin-web's `Drawer` fixed it with `motion-reduce:animate-none!
motion-reduce:transition-none!` on the content and the overlay; do the same, and check a sheet that
is dragged still closes.

**Acceptance criteria**
- [x] With reduced motion: no animation on the sheet or the scrim, and closing does not wait for one — seen in the browser (notification sheet at 375: none, closed in 8 ms, focus inside; normal motion unchanged)
- [x] The opt-out held by the drawer spec, as admin-web's is — seen failing first

*Checked:* drag-to-close still closes with motion reduced. vaul ignores any drag for its first 500 ms
after opening, with or without motion (`shouldDrag`, "allow scrolling when animating") — a first
measurement that seemed to differ was a press below the viewport while the sheet was still sliding in.

**Validation**
```bash
pnpm --filter app-web test
```

---

### T-208 — Run the worker in the server stack
- **Status:** DONE — 2026-10-05; `worker` service in `infrastructure/compose/server.yml` sharing the API's topology environment (`x-api-environment`), held by `apps/api/test/edge.spec.ts`; jobs.md, retention.md, client-address.md; ACTIONS #25 retired, its checks moved to T-040
- **Priority:** P1 — before the first deploy: without it nothing is swept and no event is delivered
- **Depends on:** T-204
- **Risk:** MEDIUM
- **Human approval required:** Yes — production deployment configuration; chosen 2026-10-05 over T-171, T-048 and T-046
- **Owner agent:** infra-devops
- **Affected:** infrastructure/compose/server.yml, apps/api Dockerfile if the image needs a second command

**Description**
From T-204. ACTIONS-FOR-ME #25 describes the worker service the owner was to add by hand, written
before `server.yml` was in the repository (T-023). Since T-204 retention runs only in the worker —
the API no longer purges lapsed sign-in attempts — so a stack without it never deletes them, and the
"thirty minutes plus a day" for a waiting sign-up's provider address stops being true. Add the
service: the API's image and environment, `node dist/worker.main.js`, no port, a 30s stop grace,
`JOB_QUEUE_PREFIX` per environment; then retire the manual half of #25.

**What shipped**

- **The service**: the API's image, `node dist/worker.main.js` (held equal to the package's `worker`
  script), the API's environment file, no port, `internal` + `egress` (it sends the mail), healthy
  PostgreSQL and Redis first, 30s stop grace.
- **Found in verification — the worker would never have started in staging or production.** It
  validates the API's whole schema, which requires `TRUSTED_PROXIES` there, and only the `api`
  service set it. The topology-decided values (hosts, `REDIS_URL`, `TRUSTED_PROXIES`) are now one
  anchor both services take; a spec validates each service's resolved environment, with a complete
  environment file, against the schema in staging and production — seen to fail first.
- **`JOB_QUEUE_PREFIX` is not set per environment**, against the description: the prefix keeps apart
  environments that share a Redis, and each stack runs its own. The environment file may still set it.
- Verified by running `server.yml` itself (a stand-in for the API image T-040 builds, Node 24 with
  the built repository): migrated, runtime role set; the worker started, logged the schedule and the
  queues, swept a lapsed sign-in attempt and kept a live one — one `job_runs` row, one
  `platform.access` and one `retention.deleted` under the run's key — outbox and dead letters empty;
  `docker compose stop` → `worker: stopping`, exit 0 in 1s.

**Acceptance criteria**
- [x] `server.yml` runs the worker beside the API, from the same image, with no published port
- [x] Its log on start says the retention schedule and the queues it works
- [x] ACTIONS #25 says what is left for the owner, if anything — nothing; the checks are T-040's

**Validation**
```bash
docker compose -f infrastructure/compose/server.yml config --quiet
```

---

### T-209 — The session-cookie scope spec compares expiry times to the second
- **Status:** DONE — 2026-10-07; the scope test compares name, attributes and Max-Age, never the raw line, and pins the expected scope; a mutation adding `Domain` fails it. It flaked PR #113's CI the same way
- **Priority:** P3 — a flaky test in the coverage gate, not a product fault
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/auth/auth-cookies.spec.ts

**Description**
Found in T-048's validation. "scopes the session the same whatever the domain map holds" compares
three whole `Set-Cookie` lines, `Expires` included, from three sign-ins made one after another. Under
load two of them fell in different seconds (`22:44:21` against `22:44:22`) and the gate failed; the
rerun passed. What the test is about is the scope — name, `Path`, `HttpOnly`, `Secure`, `SameSite`,
no `Domain` — and it already parses those as `attributes`. Compare the attributes, and `Max-Age`
rather than `Expires`; the expiry itself is another test's to hold.

**Acceptance criteria**
- [x] The test asserts the scoping attributes and `Max-Age`, not the wall-clock `Expires`
- [x] It still fails if a domain map could add `Domain=` or change `Path`, `Secure` or `SameSite`

**Validation**
```bash
pnpm --filter api test auth-cookies
```

---

## Phase 7 — The assistant that acts (`AI-EXECUTION-PLAN.md`)

Filed 2026-10-06 from `AI-EXECUTION-PLAN.md` (§10, P-1 to P-19), after its six-lens adversarial review
(57 findings kept, 3 refuted). The plan sequences them; §9 holds the order and **Release 1**. No command
enters `WRITE_TOOLS` until the write-enable gate (plan §5, §9 step 5) holds for it. Changes the review
made to existing tasks (T-040, T-046, T-047, T-058, T-061, T-095, T-096, T-098, T-168) are on those
tasks, marked "(review 2026-10-06)".

### T-210 — Plan policy, per step (P-1)
- **Status:** TODO
- **Priority:** P1 — part of the write-enable gate
- **Depends on:** T-095
- **Risk:** HIGH
- **Human approval required:** Yes — authorization: it decides what a confirmed plan may do
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/plans/**, apps/api/src/modules/ai/tools/**

**Description**
ALLOW / REQUIRES_APPROVAL / DENY for every step, with a reason code and the policy version. It is
recorded before the preview, and `PlanExecutor` evaluates it again before each step from data read
now. Today nothing decides at plan level, and Booking's engine policy read only the first step, with
hardcoded inputs.

Inputs:
- authorization as held now;
- the command's declared `riskLevel`, raised to `high` for steps that reach people or grant access;
- provenance (plan §5 row 5);
- `maxBatchSize` and the per-actor and per-workspace caps;
- lawful use as **the domain service's own outcome**, never a second ruleset. `mission.*` surfaces
  screening's routing ("goes to moderation") and never refuses on text.

**Acceptance criteria**
- [ ] Each rule mutation-tested; removing one fails a test
- [ ] Provenance: a recipient, role or target first seen in content the model read is DENY `untraced_argument`; the plan becomes a question
- [ ] A policy tightened between confirmation and execution refuses the step (re-evaluated per step)
- [ ] A `high` step: never bulk-parallel; the plan's TTL is 15 minutes
- [ ] Batch above `maxBatchSize` is DENY whether or not the person confirms; near it, the preview names the count
- [ ] The same mission text drafted over HTTP and through the assistant yields the same screening outcome
- [ ] Wiring test through `AssistantTurnService` and `PlanExecutor`, red when the call is removed

**Validation**
```bash
pnpm --filter api test ai-plans ai-policy
```

---

### T-211 — Advisory critic (P-2)
- **Status:** TODO
- **Priority:** P2 — after Release 1, with T-096
- **Depends on:** T-096, T-215
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**

**Description**
After planning, on plans with at least one write, a model checks two things: do the steps do what was
asked, and does drafted text add claims about a named person that the person never made? It repairs at
most twice or asks a question. It has no *allow* output. Its verdict is stored on the plan row, never in
audit or logs.

**Acceptance criteria**
- [ ] A critic that says "approve" cannot pass a step T-210 refuses (test)
- [ ] Read-only turns never call it
- [ ] A drafted mission that adds "the subject carries a weapon", absent from the request, goes to a question
- [ ] Wiring test through `AssistantTurnService`

**Validation**
```bash
pnpm --filter api test ai-critic
```

---

### T-212 — One correlation id from request to every step (P-3a, part)
- **Status:** DONE — 2026-10-07; `ai.plan.confirmed` and `ai.plan.execute` carry the request's correlation id, used by the run and the dead-letter hook; `ai-plans.correlation.spec.ts`; ai-plans.md
- **Priority:** P1 — before the write-enable gate
- **Depends on:** T-048
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/ai/plans/**

**Description**
`ExecutePlanHandler` runs a confirmed plan under the job's id, so the confirming request's correlation
id is lost between the outbox and the worker. Carry it on the `ai.plan.confirmed` payload into the job,
and use it for every step's audit row.

**Acceptance criteria**
- [x] A test joins confirm → outbox event → job → each step's audit row on one correlation id
- [x] A payload without one, from before this change, still runs, under the job's id

**Validation**
```bash
pnpm --filter api test ai-plans
```

---

### T-213 — Planner trace and row origin (P-3a)
- **Status:** TODO
- **Priority:** P1 — before the write-enable gate
- **Depends on:** T-095
- **Risk:** MEDIUM
- **Human approval required:** Yes — a new session-content table, with RLS
- **Owner agent:** ai-rag + database
- **Affected:** apps/api/src/modules/ai/**, apps/api/src/database/**

**Description**
Nothing records which model, prompt and context produced a plan, so a wrong plan cannot be reproduced.

`ai_plan_traces` is session content: RLS `own_conversation`, in `SESSION_CONTENT`, erased with the
session. One row per planner run holds:
- the model snapshot and the prompt version per stage;
- the registry hash;
- per stage: decision, signals and the shortlist with scores;
- the raw reply before repair;
- the Context Builder manifest (ids and hashes, never text).

Plan, step and audit rows also carry an `origin` (live, e2e, seed, eval), set by the backend from
trusted context. Metrics exclude rows that are not live.

**Acceptance criteria**
- [ ] Deleting a session leaves no argument, verdict or reply text in `audit_logs` (test)
- [ ] Audit rows carry stage names, reason codes, model and prompt version only
- [ ] `origin` is never taken from the client or the model

**Validation**
```bash
pnpm --filter api test ai-trace
```

---

### T-214 — Plan timeline (P-3b)
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-212, T-226
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/ai/plans/**

**Description**
A read model of one plan, from proposal to its last step, built from plan, step and audit rows under
one correlation id. It is for the person and for staff in scope.

**Acceptance criteria**
- [ ] Partial success reads as partial; a FAILED step is never shown as done
- [ ] Another person's plan is a 404

**Validation**
```bash
pnpm --filter api test ai-plans
```

---

### T-215 — Eval harness (P-4)
- **Status:** TODO
- **Priority:** P1 — Tier 1 starts now; Tier 2 is part of the write-enable gate
- **Depends on:** T-048
- **Risk:** MEDIUM
- **Human approval required:** Yes — a provider key in a protected CI environment (ACTIONS-FOR-ME)
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/eval/**, .github/workflows/**

**Description**
- **Tier 1, every PR, no key.** Recorded model outputs, keyed by (model, prompt version, case), drive
  parsing, validation, policy and the stage rules. Labelled as measuring code, not the model.
- **Tier 2, live.** A protected environment with a spend-capped key. It runs nightly, and is required
  before any change to the model, a prompt, the few-shots, the shortlist or a command schema. k repeats;
  a case passes only if every repeat passes.
- **Corpus.**
  - Disjoint `examples` (few-shots, anchors) and `held-out` (scoring) pools.
  - Counts per command family × locale, with a 95% Wilson interval. Fewer than 10 held-out cases per
    locale is *unmeasured*. Multi-step is its own family.
  - Synthetic cases only; a CI lint refuses uuids, emails, phones and URLs.
  - An adversarial set: trilingual, payloads planted in mission text, profiles, messages, tenant
    knowledge and tool results.
  - Armenian prohibited-request cases, kept as a known gap until T-067.
  - Cross-zone and DST cases.
- **Reports:** p50/p95 latency and tokens per family.

**Acceptance criteria**
- [ ] A test fails if the two pools share a case, or the same normalized text in any language
- [ ] The adversarial set gates every write family with zero tolerance for an added step or a changed argument
- [ ] An hy case counts as verified only after native review (ACTIONS #22, #23)
- [ ] Changing `OPENAI_CHAT_MODEL` without a passing Tier 2 run is refused by the release checklist

**Validation**
```bash
pnpm --filter api test ai-eval
```

---

### T-216 — Follow-up references (P-5)
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-046
- **Risk:** MEDIUM
- **Human approval required:** No — it adds no table; T-046 owns structured session state
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**

**Description**
Resolve "it", "her" and "that mission" against T-046's structured session state, under these rules:
- a referent comes only from the person's turns, or from typed ids in an output they were shown;
- a list or search result is never a referent, and neither is a name found in content the model read;
- a display name never resolves on its own;
- an expletive "it" binds nothing;
- topic change is detected from structural signals only;
- a pending write is dropped on any staleness signal; an unknown command counts as a write;
- a tie on the same turn is a question;
- every id is re-read through RLS and current authorization before use.

**Acceptance criteria**
- [ ] Injection test: a profile naming another investigator does not become "her"
- [ ] Eval cases per locale (T-215)
- [ ] Wiring test through `AssistantTurnService`

**Validation**
```bash
pnpm --filter api test ai-referents
```

---

### T-217 — Briefings and suggestions, on demand (P-6)
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-095; each line on its domain (below)
- **Risk:** LOW
- **Human approval required:** No — on demand, in the person's own context. A scheduled version is approval-gated (PlatformContext fan-out)
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**

**Description**
Read-only, in the person's own request context. Each line ships after its domain:
- deadlines now;
- reports due after T-117;
- expiring verification after T-072;
- agency workload and unassigned leads after T-104 and T-105.

Staff queues are T-061's. Suggestions are prompts that go through the normal plan and confirm path.

**Acceptance criteria**
- [ ] No line for a domain whose service does not exist
- [ ] A suggestion never runs anything by itself

**Validation**
```bash
pnpm --filter api test ai-briefing
```

---

### T-218 — Capabilities (P-7)
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-095, T-223
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**

**Description**
What the assistant can do for this person in this workspace, generated from the registry and filtered
by role, permission and enablement (T-223). It feeds the panel's empty state and the help articles, so
neither can claim a command that does not run.

**Acceptance criteria**
- [ ] A disabled command is absent; a role without the permission does not see it

**Validation**
```bash
pnpm --filter api test ai-capabilities
```

---

### T-219 — Guide-to-act handoff (P-8)
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-095, T-225
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** ai-rag + frontend
- **Affected:** apps/api/src/modules/ai/**, apps/app-web/src/components/assistant/**

**Description**
When a help answer cites the section a command names as its `docRef`, offer a prefilled plan for that
command. It is shown, never run, and confirmed like any other plan.

**Acceptance criteria**
- [ ] Offered only when that section was cited, and only for a command the person may run

**Validation**
```bash
pnpm --filter api test ai-handoff
```

---

### T-220 — Normalize, structural routing, credential screen (P-9)
- **Status:** TODO
- **Priority:** P1 — the credential screen before any act turn
- **Depends on:** T-056; confirm routing on T-058
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**, apps/api/src/modules/ai-sessions/**

**Description**
- **Credential screen.** Key prefixes, JWT, PEM, and `password` / `пароль` / `գաղտնաբառ` followed by a
  value. It runs before a message is stored and before any model call; a match is masked and refused.
- **Normalize.** A relative time resolves in the zone of what it describes: the mission's location,
  else `users.timezone` if the person set it. An unknown zone, the UTC default, or a DST gap or overlap
  becomes a question. Arguments store an instant plus an IANA zone. Amounts with their currency.
- **Structural routing.** Empty or too long; the answer to a pending question; "confirm" while a plan
  waits points at its confirm control and never confirms.

**Acceptance criteria**
- [ ] A pasted key appears in no session message, plan step or audit row, and in no request body sent to the model
- [ ] A spec holds that no stage here returns an action
- [ ] Trilingual cases, including cross-zone and DST

**Validation**
```bash
pnpm --filter api test ai-normalize
```

---

### T-221 — Shortlist narrowing and confidence (P-10)
- **Status:** TODO
- **Priority:** P2 — when the registry passes ~25 commands, or a family's wrong-command rate breaches its gate
- **Depends on:** T-095, T-215
- **Risk:** MEDIUM
- **Human approval required:** Yes — embedding request text is a new use of the provider (ACTIONS #6)
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**, apps/api/src/modules/knowledge/embedder.ts

**Description**
- **Narrowing.** Narrow to top-k only when the top retrieval score clears a threshold measured on
  T-215; otherwise pass the full permitted list. Validate against the full permitted catalogue, so a
  miss reads `not_shortlisted`.
- **Confidence gate.** Measurable signals only — never the model's self-reported confidence. One narrow
  re-plan when the gate fires, then a question.
- **Embeddings.** The request is embedded in memory only, after the lawful-use screen, and never stored
  (storing it is T-133). Each command's embedding carries a content hash, checked in CI.

**Acceptance criteria**
- [ ] Truth-in-shortlist and recall@k reported per locale; the threshold set from them
- [ ] A stale embedding fails CI
- [ ] Wiring test through `AssistantTurnService`

**Validation**
```bash
pnpm --filter api test ai-shortlist
```

---

### T-222 — Write conformance suite (P-11)
- **Status:** TODO
- **Priority:** P0 for Release 1 — no write command enters `WRITE_TOOLS` until it passes
- **Depends on:** T-095
- **Risk:** HIGH
- **Human approval required:** Yes — it changes how mutating services commit their effects
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/ai/**, the services each write command calls (first: `tenants/employees`, `teams`)

**Description**
The executor reruns a step left RUNNING under the same key, which is safe only if the service honours
that key. `InvitationsService.invite` takes no key: it returns 409 on a rerun, and sends the email
after commit with a token held only in memory. Every write command must pass a shared spec:
- `IdempotencyService.claim` on the step key, in the effect's transaction. A replay returns the stored
  result, and the rate-limit slot is taken only after the claim.
- Mail and notifications through the outbox in that transaction, carrying ids only, with a fresh token
  at send.
- Kill after commit and before DONE, then resume: one row, one event, one email, the same output.
- A concurrent replay; the same key with a different body (`IDEMPOTENCY_KEY_REUSED`).
- Compare-and-set on `expected`: a changed target is `state_changed`.

**Acceptance criteria**
- [ ] `team.create` and `employee.invite` pass it
- [ ] A write command not covered by the suite fails a static spec

**Validation**
```bash
pnpm --filter api test ai-write-conformance
```

---

### T-223 — Command enablement, stop and reverse (P-12)
- **Status:** TODO
- **Priority:** P0 for Release 1
- **Depends on:** T-095
- **Risk:** HIGH
- **Human approval required:** Yes — a platform table changed only inside `PlatformContext`
- **Owner agent:** backend-domain + docs-writer
- **Affected:** apps/api/src/modules/ai/**, apps/admin-web, docs/operations/assistant-write-incident.md

**Description**
- **Enablement.** Per-command `off` / `allowlist` / `on`, default off, plus a platform-wide
  assistant-writes switch. Both are read fresh at shortlist, propose, confirm and before each step.
  Disabling voids plans that have not started (`command_disabled`), and stops started ones at the next
  step boundary.
- **Caps** on confirmed write plans, per actor and per workspace.
- **Who changes it.** Staff, in `PlatformContext`, audited. Turning a command off needs no approval;
  turning one on does.
- **The runbook.** It finds affected plans by command, version and time window, names each command's
  manual reversal and the side effects it cannot reverse, and says who is told. Whether an incident is
  a personal-data incident is the owner's decision.

**Acceptance criteria**
- [ ] A plan confirmed before the switch is turned off does not run (test)
- [ ] No deploy is needed to stop a command
- [ ] Enablement only narrows authorization; it never grants

**Validation**
```bash
pnpm --filter api test ai-enablement
```

---

### T-224 — Every plan ends, honestly (P-13)
- **Status:** DONE — 2026-10-06; migration 0043 (departure ends only unstarted plans as void), `JobHandler.onDeadLetter` + `PlanExecutor.abandon`, execution deadline and lock timeout in `PlanExecutor`, `?open=true` keeps confirmed plans, session delete settles plans first; `ai-plans.endings.spec.ts`; ai-plans.md, ai-sessions.md, jobs.md, retention.md
- **Priority:** P0 — defects in T-048, found by the plan review
- **Depends on:** T-048
- **Risk:** HIGH
- **Human approval required:** Yes — it changes `archive_departed_member_sessions`, which raises platform access
- **Owner agent:** backend-domain + database
- **Affected:** apps/api/src/modules/ai/plans/**, apps/api/src/modules/ai-sessions/**, apps/api/src/common/jobs/**, a migration

**Description**
Three defects in T-048, all of the same kind: a plan that does not end, or ends saying the wrong
thing.
1. **A member leaving voids every `CONFIRMED` plan as "nothing happened".** A plan whose worker died
   mid-run also reads `CONFIRMED`, because `EXECUTING` commits only with the end of the run. So a plan
   that already did step 1 is reported as never having run.
2. **A plan whose job dead-letters stays `CONFIRMED` for ever**, with a step `RUNNING`, and
   `?open=true` does not list it.
3. **Deleting the session while its plan runs can hang.** The delete waits on the plan row the job
   holds, and the job waits on a step update the delete blocks; no `lock_timeout` is set anywhere. It
   also erases the only record of which steps ran.

The fixes:
- **Dead letter:** a hook for `ai.plan.execute` ends the plan — CANCELLED/INVALIDATED if no step
  started, FAILED if one did — with reason `infrastructure_failed`. PENDING steps become SKIPPED;
  RUNNING steps are left RUNNING, which reads as "may have taken effect".
- **Member leaving:** voids only plans with no started step. A started plan ends FAILED `member_left`.
- **`?open=true`:** lists started plans until they end.
- **Execution deadline:** a confirmed plan with no started step 15 minutes after confirmation is
  invalidated as `confirmation_stale`.
- **Session delete:** refuses (`plan_in_flight`) while a plan is running — its rows taken with SKIP LOCKED, so the refusal never waits, voids one that has not
  started, and writes each run plan's outcome — steps done, failed, skipped, with command names — to
  audit before the rows go.
- **Lock timeout:** on the plan job's transaction. `idle_in_transaction_session_timeout` was not set: the job's transaction is idle by design while its steps run on other connections, and the timeout would kill a legitimate long plan.

Telling the person is T-226.

**Acceptance criteria**
- [x] A member removed after step 1 is DONE: the plan reads FAILED `member_left`, not VOIDED (regression test, seen to fail first)
- [x] A dead-lettered plan job ends the plan; a later replay finds nothing to run
- [x] `?open=true` shows a started plan until it ends
- [x] A confirmed plan the worker reaches after the deadline never runs a step
- [x] Deleting the session mid-run refuses without hanging; deleting it with an unstarted plan voids the plan; an executed plan's outcome survives in audit
- [x] `rls.spec.ts` still bounds the departure function's statements

**Validation**
```bash
pnpm --filter api test ai-plans ai-sessions rls jobs
```

---

### T-225 — Consequence preview (P-14)
- **Status:** TODO
- **Priority:** P0 for Release 1
- **Depends on:** T-095
- **Risk:** HIGH
- **Human approval required:** Yes — it is what the person confirms
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/plans/**, apps/api/src/modules/ai/tools/**

**Description**
Each write command implements a deterministic `preview(actor, input, observed)`. It returns i18n
lines:
- target labels read through RLS;
- before → after;
- each side effect with its recipients;
- reversibility;
- where any sourced value came from.

The preview is stored on the step and exposed in `PlanView`, and its digest goes into the plan hash
(recipe v2). T-058 renders it beside the exact arguments; the UI writes no consequence text of its own.

**Acceptance criteria**
- [ ] A write with no preview, or a side effect no line renders, fails a static spec
- [ ] A different preview with the same arguments and observation yields a different hash; the old confirmation is refused

**Validation**
```bash
pnpm --filter api test ai-plans ai-preview
```

---

### T-226 — The outcome reaches the person (P-15)
- **Status:** DONE — 2026-10-07. Migrations 0044–0045: `record_ai_plan_outcome` writes one `PLAN_OUTCOME` message per ended plan from its step rows, whoever ends it; `PlanExecutor` writes `ai.plan.ended`, fanned out as the in-app-only `assistant_plan_failed` / `assistant_plan_voided`; app-web renders the outcome from `assistant.outcome.*` (en/ru/hy). Polling UI stays with T-058; the notification's deep link is T-231
- **Priority:** P0 for Release 1
- **Depends on:** T-048, T-224, T-036
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/ai/plans/**, apps/api/src/modules/notifications/**, packages/i18n

**Description**
Confirm returns at CONFIRMED, and the worker runs the plan later, so today nobody tells the person how
it went.
- On every terminal status, a `PLAN_OUTCOME` session message is rendered by template from the step rows
  (done, failed with its code, skipped, nothing ran, cannot be undone), in the transaction that sets
  the status. No model writes it.
- A FAILED plan, or one voided after confirmation, also raises an in-app notification through the
  outbox.
- The client polls while the plan runs.

**Acceptance criteria**
- [x] A FAILED or partial plan never renders as success (spec) — `ai-plans.outcome.spec.ts` (direct writes, every step mix; mutation of the rule turns 12 tests red) and `assistant.spec.tsx`
- [x] A worker killed between the last step and the status write yields exactly one message — killed after the last step's effect, and after the status write before its commit

**Validation**
```bash
pnpm --filter api test ai-plans notifications
```

---

### T-227 — Metrics, alerts and runbooks for the assistant and the worker (P-16)
- **Status:** TODO
- **Priority:** P1 — before the write-enable gate
- **Depends on:** T-208
- **Risk:** MEDIUM
- **Human approval required:** Yes — infrastructure
- **Owner agent:** infra-devops
- **Affected:** infrastructure/**, apps/api/src/common/**, docs/operations/**

**Description**
Takes the AI and worker part of the backlog's "Prometheus/Grafana dashboards and alert runbooks".
- **Counters** per command family × locale: proposed, confirmed, declined, expired; failed;
  invalidated by reason; `hash_mismatch`; clarification; and a decline followed by a rephrase, as the
  wrong-command proxy.
- **Histograms:** time-to-preview; model calls and tokens per turn.
- **Alerts:** dead-letter depth (T-168's alert lives here).

**Acceptance criteria**
- [ ] No label carries a user, workspace or argument
- [ ] Every alert has a runbook; thresholds recorded in `ai-plans.md`

**Validation**
```bash
pnpm --filter api test metrics
```

---

### T-228 — Durable confirmation record (P-17)
- **Status:** TODO
- **Priority:** P1 — before any command that changes a third party's position (Release 2)
- **Depends on:** T-048, T-225
- **Risk:** HIGH
- **Human approval required:** Yes — retention and legal (counsel brief §3, ToS §5)
- **Owner agent:** database + docs-writer
- **Affected:** apps/api/src/modules/ai/plans/**, docs/compliance/retention.md

**Description**
The confirmation's audit row holds only the plan id, and plan and step rows are erased with the
session. So nothing can show later what a person was shown and agreed to.

Confirm writes an append-only record, outside session content and with its own retention line:
- the plan hash and recipe version;
- command names and versions;
- the preview.

Release 1 extends the audit row now with the hash, recipe version, command names and versions. That
part holds no content and needs no retention change.

**Acceptance criteria**
- [ ] A deleted session leaves the record; the record holds no argument the preview did not show

**Validation**
```bash
pnpm --filter api test ai-plans
```

---

### T-229 — Workspace AI settings (P-18)
- **Status:** TODO
- **Priority:** P1 — before any non-owner role gets a write command
- **Depends on:** T-095, T-084
- **Risk:** MEDIUM
- **Human approval required:** Yes — authorization inside an agency
- **Owner agent:** backend-domain + frontend
- **Affected:** apps/api/src/modules/tenants/**, apps/api/src/modules/ai/**, apps/app-web

**Description**
`tenant_settings`' reserved AI section (tenancy.md §12):
- act mode off by default for agencies;
- command families enabled per membership role;
- OWNER-only and audited;
- read at propose, at confirm and before each step (`workspace_disabled`).

Plus an "Assistant activity" view for owners, built from audit rows with no conversation content, and
an agency help article.

**Acceptance criteria**
- [ ] Turning act mode off voids unstarted plans in that workspace
- [ ] The activity view shows no message or argument text

**Validation**
```bash
pnpm --filter api test ai-settings
```

---

### T-230 — Shared misses (P-19)
- **Status:** TODO
- **Priority:** P3
- **Depends on:** T-058, T-215
- **Risk:** HIGH
- **Human approval required:** Yes — a cross-workspace read under `PlatformContext`, and counsel (third-party personal data)
- **Owner agent:** ai-rag + security-privacy (review)
- **Affected:** apps/api/src/modules/ai/**, docs/compliance/retention.md

**Description**
- **Decline reason.** Declining takes an optional reason (wrong_action, wrong_target, wrong_values,
  changed_mind), the production wrong-command proxy.
- **Report this.** A consented "Report this" copies one turn into a platform-classified triage table.
  The person sees exactly what is shared, it has its own retention, and it is erased on account
  deletion.
- **Into the corpus.** A person rewrites each report as a synthetic T-215 case. A report never becomes
  a case as it is.

**Acceptance criteria**
- [ ] Nothing is shared without the person seeing it first
- [ ] Access is audited

**Validation**
```bash
pnpm --filter api test ai-triage
```

### T-231 — Open the assistant on the conversation a notification names
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-226, T-057
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/components/assistant/**, apps/app-web/src/components/notifications/**

**Description**
From T-226. A plan that fails, or is voided after the person confirmed it, notifies them with
`href: /?assistant=<sessionId>` (`notifications/kinds.ts`, `assistantHref`). The assistant is a panel,
not a route, and app-web does not read that parameter yet: the notification lands on the home page with
the assistant closed. Read `?assistant=` on load and when a notification is opened. Open the panel on
that conversation through the same path as choosing it from the list, then drop the parameter from the
URL. A conversation that is gone, or belongs to another workspace, reads like any unknown one
(`assistant.notice.gone`).

**Acceptance criteria**
- [ ] Opening an `assistant_plan_failed` notification opens the assistant on that conversation, with
      its PLAN_OUTCOME message in view
- [ ] A deleted or foreign conversation shows the "no longer available" notice, never an error page
- [ ] Phone and desktop: the panel opens as it does from the shell (visual QA at 375 / 768 / 1440)

**Validation**
```bash
pnpm --filter app-web test assistant notifications
```

### T-232 — The notifications end-to-end spec through Redis times out in some orders
- **Status:** TODO
- **Priority:** P1 — a red CI run that is not about the change under review
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/notifications/notifications.jobs.spec.ts, apps/api/test/**

**Description**
Found during T-226. `notifications end to end, through Redis › turns a published mission into one
notification and one email for its customer` times out at 15 s, waiting for a mail that never comes, in
some orders. On dev's code (T-226's changes stashed), `vitest run notifications.jobs.spec.ts
--sequence.shuffle` failed 4 of 6 runs; with them, 2 of 6. In default order it failed once in about 13
runs of `pnpm --filter api test ai-plans notifications`. Find what the test depends on — the shared
graph, a queue prefix, an unpublished event left by another test, the worker's start — and remove the
dependency. Do not raise the timeout: the test waits for an event, not for time.

**Acceptance criteria**
- [ ] The cause is named in the fix's commit
- [ ] 20 consecutive `--sequence.shuffle` runs of the file pass, and the suite passes in reverse order

**Validation**
```bash
cd apps/api && for i in $(seq 1 20); do pnpm exec vitest run src/modules/notifications/notifications.jobs.spec.ts --sequence.shuffle || exit 1; done
```

### T-233 — Signing in before verifying the email shows "Application error"
- **Status:** TODO
- **Priority:** P1 — the first thing a new person may do
- **Depends on:** —
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/src/app/session/start/**

**Description**
Found during T-226's browser check (2026-10-07). An account still `PENDING_VERIFICATION` may sign in
(by design, `auth.service.ts`: login admits it, and each feature gates on `requireActive`). The app's
`/session/start` route then reads `GET /workspaces`. That is refused `403 FORBIDDEN`
(`authz.denied.workspace.list`, `account_not_active`), the route throws, and the person sees Next's
"Application error: a server-side exception has occurred". Reproduce by signing up, then signing in
before clicking the link. Send an unverified person to `/check-email` (or a page saying their address
needs confirming, with resend), never an error page.

**Acceptance criteria**
- [ ] Signing in unverified lands on a page that says to confirm the address, with a way to resend
- [ ] No server exception in app-web's log for that path; an e2e journey covers it

**Validation**
```bash
pnpm --filter app-web test session
```

---

## Backlog

Captured, not yet scheduled. Move into a phase when a dependency lands.

- Agencies' own off-platform clients and cases — later, under their own ADR; lawful-use screening
  must cover them too (plan.md §30, owner decision 2026-09-19)
- AI gateway and tool registry (Phase 7) — see T-017, T-018 (tool contract and runner shipped), T-095
- Prometheus/Grafana dashboards and alert runbooks (Phase 8) — the AI and worker part is T-227
- Encrypted backups with a tested restore drill (Phase 8)

---

## Done

_(nothing yet)_
