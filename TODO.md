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
- **Status:** TODO — unblocked by T-013 (API) on 2026-09-18
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
- **Depends on:** T-004, T-015, T-077
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/knowledge/**, migrations, workers

**Description**
Ingest `docs/knowledge-base/**` into `knowledge_documents` / `knowledge_chunks` with
pgvector embeddings. Content-hash keyed, idempotent, and synchronized on change. Per
plan.md §17 and the `documentation-first` skill.

**Tenancy (ADR-0011).** `knowledge_documents` and `knowledge_chunks` carry `tenant_id`, which is NULL for the platform knowledge base, under RLS from the first migration. Agency documents are T-097.

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
- **Depends on:** T-016, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — AI retrieval surface
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/**

**Description**
Answer customer knowledge questions from the knowledge base through permission-aware
retrieval. Per `.claude/skills/permission-aware-rag/SKILL.md`.

**Tenancy (ADR-0011).** Retrieval runs as context → permission filter → tenant filter → search. The cross-workspace retrieval test ships with this task (`tenant-isolation`).

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
- **Depends on:** T-011, T-017, T-078
- **Risk:** HIGH
- **Human approval required:** Yes — AI tool surface over business data
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/tools/**

**Description**
Structured discovery tools so the Assistant can find investigators by location, distance,
specialty, service, availability and language, and explain each match from real criteria.
**Not RAG.** Per `.claude/skills/investigator-discovery/SKILL.md`.

**Tenancy (ADR-0011).** Discovery tools run in the caller's execution context; results show each profile's agency (T-087). No tool accepts a workspace, tenant or user id as input.

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

**Tenancy (ADR-0011).** The user's Personal workspace and OWNER membership are created by a database trigger in the same statement as the user (T-074): nothing to add here. Agency terms acceptance is its own gate (T-083).

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
- **Depends on:** T-012, T-077
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/investigation-sources/**, migrations

**Description**
`InvestigationSource` per plan.md §8. Assignment-scoped record of where information came from,
distinct from the evidence obtained from it.

**Tenancy (ADR-0011).** Workspace objects belong to the supplier workspace. Inside an agency, access follows assignment staffing once T-089 lands, and T-089 extends these objects; `shared` items are visible to the customer's workspace through the two-party policy.

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
- **Depends on:** T-006, T-082
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/notifications/**, workers

**Description**
`NotificationsModule` per plan.md §13 — one of two modules with no task. Load-bearing: quote
received, report submitted, verification expiring and message received all depend on it.

**Tenancy (ADR-0011).** Notifications are tenant-scoped rows, delivered by jobs that restore their workspace context (T-082). They route to teams (T-086) and carry agency branding (T-084). A notification never names data from a workspace the recipient is not in.

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
- [ ] Migrations run with `MIGRATION_DATABASE_URL` (the owner); the API's environment holds **only** `DATABASE_URL` (`investigator_app`) and never the owner's credentials. The deploy runs `scripts/set-app-role-password.sh` with `APP_DB_PASSWORD` from the environment's secrets after migrating (T-073)
- [ ] Deployment audit log: version, actor, approver, outcome

**Validation**
A rehearsed deploy and a rehearsed rollback against production, signed off.

---

### T-042 — Test infrastructure: factories, fixtures, coverage config
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-002, T-073
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** packages/test-utils/**, vitest/jest config, apps/api/test/**

**Description**
The shared test substrate. Landing it before module work is what makes the 100% gate
achievable rather than punitive.

**Tenancy (ADR-0011).** Factories create workspaces and memberships. Integration tests use **two pools**: owner fixtures, and the code under test on `investigator_app` inside a context helper (`withContext`), per the `tenant-isolation` skill.

**Acceptance criteria**
- [ ] Factories with sensible defaults and explicit overrides for every core entity
- [ ] Database reset between tests; **no shared mutable state, no ordering dependency**
- [ ] Suites pass run alone, in reverse order, and in parallel — verified, not assumed
- [ ] Time is freezable; expiry logic is testable deterministically
- [ ] Reusable authorization-test helper covering the seven cases from `authorization`
- [ ] Coverage thresholds set to 100% **per package**, wired into `pnpm test:coverage`
- [ ] `docs/operations/coverage-exclusions.md` referenced by the config, not duplicated
- [ ] **No real or realistic personal data** in any fixture
- [ ] `fixtures:load` actually exists and the CI step runs it — it is currently
      `--if-present` and does nothing, because `pr.yml` referenced the script before
      anything defined it. Prove the step fails when fixtures fail to load, or it is the
      coverage gate all over again (T-063)
- [ ] `test:integration`, `test:api` and `test:e2e` likewise run something — all three are
      `--if-present` at the root today and match no package script

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
- **Depends on:** T-004, T-077
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai-sessions/**, migrations

**Description**
The persistent conversation layer per ADR-0006. Must exist before the assistant, because the
alternative is a chatbot whose memory is a prompt.

**Tenancy (ADR-0011).** `ai_sessions`, `ai_messages` and their state carry `tenant_id` under RLS. **A session belongs to one workspace for life**; switching workspace opens that workspace's sessions.

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
- **Depends on:** T-046, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — persistent memory is a privacy surface
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/memory/**

**Tenancy (ADR-0011).** Memory scopes: `platform`, `tenant`, `user_in_tenant` (default), `user_global` (declared preferences only, explicitly marked) and `session`. A cross-workspace memory test ships with this task.

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
- **Depends on:** T-045, T-018, T-077
- **Risk:** HIGH
- **Human approval required:** Yes — confirmation is the mutation gate
- **Owner agent:** ai-rag
- **Affected:** apps/api/src/modules/ai/plans/**, apps/api/src/modules/ai/results/**

**Description**
What makes a confirmation survive a browser close, and keeps 10,000 records out of a prompt.

**Tenancy (ADR-0011).** Plans, confirmations and tool results are tenant-scoped rows. A confirmation from workspace A is invalid in B. Superseded in scope by ADR-0012: the command contract and DAGs follow in T-095 and T-096.

**Acceptance criteria**
- [ ] `AiPlan` persisted with `plan_id`, `plan_hash`, commands, status, confirmation status
- [ ] A pending confirmation **survives browser close, app restart and worker restart** — tested
- [ ] Before execution: re-authorize, re-check the hash, re-read resource state
- [ ] **Material change invalidates the confirmation** and forces a fresh one — tested
- [ ] A confirmation is single-use and bound to exact arguments (`ai-tool-registry`)
- [ ] Large tool results stored and referenced by `result_id` with summary, top-N and cursor
- [ ] A test proves a large result set never enters a prompt in full
- [ ] A killed worker is replaced by another that resumes from persisted state
- [ ] Plan rows are workspace-scoped (`tenant_id` under RLS, ADR-0011). **No DAG orchestration here**: it lands in T-096 over these rows (ADR-0012). No learned risk engine

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
- **Depends on:** T-017, T-045, T-039, T-091
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**, packages/ui/**

**Description**
The conversation interface. Six backend tasks build a full assistant engine with no way to
reach it; this is the surface.

**Tenancy (ADR-0011).** Needs the app-web foundation (T-091). The assistant shows the active workspace and opens that workspace's sessions.

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

**Tenancy (ADR-0011).** Session lists are per workspace; switching workspace switches the list.

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

**Tenancy (ADR-0011).** The Personal workspace comes with the user, created by the database trigger (T-074). A first OAuth sign-in that creates a user gets one without any code here.

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
- **Status:** TODO
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
- [ ] `pnpm typecheck` covers `**/*.spec.ts`
- [ ] `dist/` still contains no spec output
- [ ] A deliberate type error in a spec fails `pnpm typecheck`
- [ ] Decorator syntax works in a spec; the `auth.boot.spec.ts` workaround is removed

**Validation**
```bash
pnpm typecheck && pnpm --filter api build && test ! -e apps/api/dist/modules/auth/auth.boot.spec.js
```

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
- [ ] A `MISSION_ATTACHMENT` media category with its own size, formats, visibility and retention
- [ ] Attachments belong to a mission and are authorised through the existing media flow
- [ ] **A mission with an unscanned or infected attachment cannot be published** — fails closed
- [ ] A moderator may open a mission's attachments; **every access is audited** (T-051 surfaces it)
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
- **Status:** TODO
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
- [ ] Every screen reachable only with the VERIFICATION scope; the API refuses regardless
- [ ] Documents open only through `/verification/requests/:id/documents/:assetId/delivery-url`;
      the link is never cached, stored or shown as text
- [ ] The declaration shown is the one recorded on the application, not the live profile
- [ ] The decision form cannot submit without a reason; the refusal of one's own application is
      shown as such
- [ ] admin-web has a `test` script, and it runs in CI

**Validation**
```bash
pnpm --filter admin-web test && pnpm --filter admin-web build
```

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
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-074
- **Risk:** HIGH
- **Human approval required:** Yes — authorization plumbing
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
- [ ] A header naming a foreign workspace → 403, audited; a removed or suspended member is refused on their next request
- [ ] Pooling: on one reserved connection, tenant A then tenant B — the settings read empty after commit and nothing carries over; concurrent A/B requests on a pool of two never cross
- [ ] Regression: a denied request that then fails still leaves its denial audit row
- [ ] Static specs: no service, repository or domain method takes `tenantId`; only allowlisted callers use the unscoped path
- [ ] `authorization.md` documents check 0

**Validation**
```bash
pnpm --filter api test context tenants authz
```

---

### T-076 — Tenant and party columns on existing tables (expand and backfill)
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-075
- **Risk:** HIGH — touches quotes and assignments
- **Human approval required:** Yes
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
- [ ] Zero NULLs after backfill, asserted by the migration itself
- [ ] The classification registry covers every table; a spec fails on an unclassified table
- [ ] Every existing test passes unchanged; the migration is reversible; applies from empty
- [ ] Discovery's `EXPLAIN` spec (T-011) still uses its indexes

**Validation**
```bash
pnpm --filter api test && pnpm --filter api migration:run
```

---

### T-077 — Row-level security policies and the isolation matrix
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-076
- **Risk:** HIGH
- **Human approval required:** Yes, plus a `security-privacy` review before merge
- **Owner agent:** database; review by security-privacy
- **Affected:** migrations, apps/api/src/database/**, apps/api/test/isolation/**

**Description**
The policies:

- `app_current_tenant()` and `app_platform_access()`
- `ENABLE` and `FORCE` RLS by class, with the policy templates in `tenancy.md` §7
- the special cases: the public projection of published profiles, QUOTED missions readable by
  any workspace, two-party rows, and `audit_logs`

A **generated isolation matrix** runs as `investigator_app` for every scoped table:

- cross-workspace SELECT, INSERT, UPDATE and DELETE are refused
- no context returns nothing, and an insert without context fails

**Acceptance criteria**
- [ ] Matrix green; a policy recursion check passes (no policy reaches a table whose policy reaches back)
- [ ] Negative control per class: drop the policy, watch the matrix fail, restore byte-for-byte
- [ ] **Registration under RLS** (from T-074): the trigger that creates a Personal workspace runs during registration, before any workspace context exists, and inserts into `tenants`, `tenant_memberships` and `membership_roles`. Their policies must let exactly that through — and nothing else — with a test that registers a user as `investigator_app` with RLS on
- [ ] Every existing test green under RLS; discovery and quoting unchanged for Personal workspaces
- [ ] `tenancy.md` §7 marked built, with any deviation recorded

**Validation**
```bash
pnpm --filter api test isolation && pnpm --filter api test:coverage
```

---

### T-078 — Tenant permissions in authorization
- **Status:** TODO
- **Priority:** P0
- **Depends on:** T-077
- **Risk:** HIGH
- **Human approval required:** Yes — authorization logic
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/authz/**, packages/auth/**, the `authorization` skill

**Description**
`AuthzService.requirePermission(permission, ctx)`. Permissions are resolved with the
membership on every request, never carried. Existing endpoints behave identically in Personal
workspaces. Agency endpoints check permissions, never tenant role names.

**Acceptance criteria**
- [ ] Every role × permission pair from the seeded catalog is tested (generated), not sampled
- [ ] A revoked permission or removed role takes effect on the next request
- [ ] A static spec forbids checking a tenant role name where a permission exists
- [ ] `authorization.md` and the `authorization` skill updated

**Validation**
```bash
pnpm --filter api test authz
```

---

### T-079 — PlatformContext: staff across workspaces, scoped, reasoned and audited
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-077
- **Risk:** HIGH
- **Human approval required:** Yes, plus a `security-privacy` review
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/context/**, apps/api/src/modules/{verification,missions,media}/**

**Description**
`PlatformContext.run({ scope, reason }, fn)` is the **only** setter of `app.platform_access`.
The existing cross-workspace staff paths move into it:

- verification review (T-013)
- mission moderation (T-010)
- verification-document delivery

Fixed-purpose staff routes carry a route-defined purpose. Ad-hoc cross-workspace access, such
as a support lookup, requires typed reason text.

**Acceptance criteria**
- [ ] Staff without the scope refused; agency owners and admins can never enter (entry checks the platform `STAFF` role)
- [ ] Every platform access audited with scope and purpose or reason
- [ ] A static spec holds that nothing else sets `app.platform_access`; there is no `BYPASSRLS` role
- [ ] T-013 and T-010 staff tests pass through the new path

**Validation**
```bash
pnpm --filter api test platform-context verification missions
```

---

### T-080 — Tenant-aware audit and storage paths
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-077
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/common/audit/**, apps/api/src/modules/media/**, migrations

**Description**
`audit_logs` gains nullable `tenant_id` and `membership_id`. `AuditService.record` fills the
tenant, user, membership, session and correlation from the context, and the event type no
longer accepts them from callers. The existing call sites are migrated.

The storage layer derives `tenant/{tenantId}/{category}/{uuid}` for new uploads. Existing assets
keep their stored `public_id`.

**Acceptance criteria**
- [ ] Every audited action in the codebase writes the workspace; a caller cannot supply or override it
- [ ] New uploads carry the derived prefix; no business code builds a path (static spec)
- [ ] `audit-logging` and `cloudinary-media` skills already describe this — confirm, do not duplicate

**Validation**
```bash
pnpm --filter api test audit media
```

---

### T-081 — Tenant-scoped cache wrapper
- **Status:** TODO — build with the first cache consumer; until then nothing caches tenant data
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
- **Status:** TODO — with the first queue (BullMQ) or outbox dispatcher, whichever lands first
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
- [ ] Tests: context restored; a removed member's job refused; retries and duplicates idempotent per workspace; failed jobs dead-lettered with their context
- [ ] No worker path touches a scoped table outside a restored context (static spec over worker entry points)

**Validation**
```bash
pnpm --filter api test jobs outbox
```

---

### T-083 — Agency registration and progressive onboarding (API)
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-078, T-021
- **Risk:** MEDIUM
- **Human approval required:** Yes — a new acceptance gate (agency terms, `legal-consent`)
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/tenants/**, docs/knowledge-base/agency/**, scripts/validate-knowledge-base.py

**Description**
`POST /agencies` creates an `AGENCY` workspace in `CREATING` and makes the creator its OWNER,
in one transaction. It is idempotent.

The minimum to become ACTIVE is name, country, business email, time zone and currency. Time
zone and currency default from the creator. Everything else in plan.md §29 can be completed
later: legal name, type, size, languages, areas, services, specialties, credentials,
experience, hours and branding.

Agency terms are accepted per version (`legal-consent`). The text itself waits on counsel;
the gate does not.

**Acceptance criteria**
- [ ] Status, verification and tenant kind can never be set by the client
- [ ] ACTIVE only when the minimum is complete; everything else optional and editable later
- [ ] The creator is the OWNER; the agency appears in their workspace list at once
- [ ] Knowledge base: an `agency` audience and folder added to `scripts/validate-knowledge-base.py` (visibility `authenticated`); first article `kb-agency-getting-started`. Agency owners are not necessarily investigators, so the investigator folder is the wrong home

**Validation**
```bash
pnpm --filter api test agencies && python3 scripts/validate-knowledge-base.py
```

---

### T-084 — Agency public profile, private settings and branding (API)
- **Status:** TODO
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
- [ ] The public endpoint returns only projection fields; a test asserts no private settings, employees, customers or financial fields appear
- [ ] Every settings section has a default; nothing is required to use the product
- [ ] Branding cannot break contrast (tokens validated)

**Validation**
```bash
pnpm --filter api test agencies
```

---

### T-085 — Employees: invitations and the membership lifecycle (API)
- **Status:** TODO
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
- [ ] Suspension and removal take effect on the member's next request (tested over HTTP)
- [ ] An invitation cannot be accepted by a different account; resent tokens void the old one
- [ ] The last OWNER is protected; invitations are rate-limited per workspace
- [ ] When AI sessions exist (T-045), a removed member's sessions in that workspace close and their pending confirmations void
- [ ] Knowledge base: `kb-agency-employees`

**Validation**
```bash
pnpm --filter api test memberships invitations
```

---

### T-086 — Teams (API)
- **Status:** TODO
- **Priority:** P2
- **Depends on:** T-085
- **Risk:** LOW
- **Human approval required:** No
- **Owner agent:** backend-domain
- **Affected:** apps/api/src/modules/teams/**

**Description**
Teams and team members. A member may belong to several teams. Teams feed assignment staffing
and `investigations.read` (T-089), and notification routing (T-036).

**Acceptance criteria**
- [ ] CRUD behind `teams.*`; removing a member from the workspace removes their team memberships
- [ ] Cross-workspace probes; KB updated

**Validation**
```bash
pnpm --filter api test teams
```

---

### T-087 — Investigator profiles under workspaces (API)
- **Status:** TODO
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

**Acceptance criteria**
- [ ] Several profiles per agency; one per person per workspace; no identity fields duplicated
- [ ] A suspended or archived agency's profiles disappear from discovery on the next query
- [ ] T-011, T-012 and T-013 tests pass; T-071's per-scope verification builds on profiles as they are here
- [ ] KB: profile articles updated for agencies

**Validation**
```bash
pnpm --filter api test profiles search
```

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
- **Status:** TODO
- **Priority:** P1
- **Depends on:** T-030
- **Risk:** MEDIUM
- **Human approval required:** No
- **Owner agent:** frontend
- **Affected:** apps/app-web/**, packages/ui/**

**Description**
`app-web` is still a stub (`src/index.ts`). Every customer, investigator and agency screen —
including the assistant (T-056) — needs a real Next.js app first:

- shadcn initialised per app, with the registries `@shadcn`, `@cult-ui` and `@react-bits` in
  that order (ADR-0003)
- the tokens package
- a mobile-first app shell: bottom navigation on phones, a sidebar from tablet up
- `test` and `build` scripts that run in CI

**Acceptance criteria**
- [ ] `components.json` in app-web; `get_project_registries` returns the three registries
- [ ] Light and dark themes from tokens; no raw values in feature code
- [ ] The shell passes visual QA at 375, 768 and 1280, with no horizontal scroll and tap targets of at least 44px
- [ ] CI runs app-web tests and build; Core Web Vitals budget recorded (`frontend-performance`)

**Validation**
```bash
pnpm --filter app-web test && pnpm --filter app-web build
```

---

### T-092 — Workspace switcher and agency onboarding (app-web)
- **Status:** TODO
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
- [ ] Switching shows no stale data from the previous workspace (tested: A's list never flashes in B)
- [ ] Onboarding completes in one short screen on a phone; component-discovery log records what was reused
- [ ] Playwright flows at 375 and 1280; accessibility checks pass

**Validation**
```bash
pnpm --filter app-web test workspace onboarding
```

---

### T-093 — Agency console: employees, teams and investigators (app-web)
- **Status:** TODO
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

**Acceptance criteria**
- [ ] Every action has a tap path, and a hover affordance is never the only path
- [ ] Empty states say what to do next; errors say what failed and how to fix it
- [ ] Visual QA at three widths; flows tested end to end against the API

**Validation**
```bash
pnpm --filter app-web test agency
```

---

### T-094 — Agency profile, settings and branding (app-web)
- **Status:** TODO
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

**Acceptance criteria**
- [ ] The preview matches the public projection exactly (shared component)
- [ ] Branding cannot produce unreadable contrast; the core UI is never forked per agency

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
- [ ] Every probe refused; every negative control seen to fail first
- [ ] All pre-existing functionality verified in the browser, not only by tests
- [ ] `tenancy.md` updated from "specified" to what shipped, with any deviation explained
- [ ] Findings fixed and re-verified, never noted and shipped

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
- **Status:** TODO
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
- [ ] A generated spec walks every investigator-facing view and fails if it contains a customer surname, email, phone, avatar or user id before hire
- [ ] The per-mission alias cannot be correlated across missions
- [ ] KB already describes this (`kb-customer-privacy-data` v2, `kb-customer-messaging` v2, `kb-investigator-finding-work` v2): confirm it matches what shipped

**Validation**
```bash
pnpm --filter api test missions quotes identity-masking
```

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
- [ ] Evidence cannot be edited or deleted by the application; a correction is a new item referencing the old
- [ ] Every access writes a custody entry and an audit row; the customer can see the access history
- [ ] Legal hold (T-035) blocks retention deletion

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

**Validation**
```bash
pnpm --filter api test disputes
```

---

### T-119 — Guided mission intake (app-web)
- **Status:** TODO
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
- [ ] Screening outcomes (rejected, needs changes) explained in plain language, with what to fix
- [ ] Playwright flow; accessibility checks; component-discovery log

**Validation**
```bash
pnpm --filter app-web test mission-intake
```

---

### T-120 — Finding investigators: discovery and public profiles (app-web)
- **Status:** TODO
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

**Acceptance criteria**
- [ ] Filters are the typed, closed set the API accepts; an empty result suggests widening, not a dead end
- [ ] Profile pages expose only the public projection

**Validation**
```bash
pnpm --filter app-web test discovery profiles
```

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
- **Status:** TODO
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
- [ ] The profile preview is exactly the public projection customers see
- [ ] Verification history shows each decision's reason, never the reviewer

**Validation**
```bash
pnpm --filter app-web test investigator-profile verification
```

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
- **Status:** TODO
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
- [ ] Every auth error is privacy-preserving, and never reveals whether an email is registered
- [ ] Session cookie behaviour matches T-025; the flows are tested end to end against the API

**Validation**
```bash
pnpm --filter app-web test auth
```

---

### T-128 — App translation catalogs (en, ru, hy)
- **Status:** TODO
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
- [ ] A missing key in any locale fails the build
- [ ] No user-facing string literal in feature code (lint rule)

**Validation**
```bash
pnpm --filter app-web test i18n && pnpm --filter app-web build
```

---

### T-129 — Compute the login decoy at startup, not on first use
- **Status:** TODO
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
- [ ] The decoy hash exists before the first request is served (the app refuses to become ready without it)
- [ ] A test proves the first `verifyDecoy` call costs one verification, not two, using the structural check T-069 added and not only a clock
- [ ] Startup time impact measured and recorded

**Validation**
```bash
pnpm --filter api test password
```

---

## Backlog

Captured, not yet scheduled. Move into a phase when a dependency lands.

- Agencies' own off-platform clients and cases — later, under their own ADR; lawful-use screening
  must cover them too (plan.md §30, owner decision 2026-09-19)
- AI gateway and tool registry (Phase 7) — see T-017, T-018
- Prometheus/Grafana dashboards and alert runbooks (Phase 8)
- Encrypted backups with a tested restore drill (Phase 8)

---

## Done

_(nothing yet)_
