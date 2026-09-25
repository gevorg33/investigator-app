# Workspaces, agencies and tenant isolation

The architecture reference for ADR-0011 (tenancy) and the parts of ADR-0012 (commands) that touch
it. **Status: specified, not built.** The work is sequenced in `TODO.md` Phase 4b (T-073 to
T-099) and summarised in plan.md §29.

> **The rule (CLAUDE.md non-negotiable 16).** Tenant isolation is an infrastructure and database
> security boundary, not business-domain plumbing. The active workspace is resolved from trusted
> authentication context at the request or job boundary. The database enforces isolation even
> when application code makes a mistake.

---

## 1. Vocabulary: the brief's terms and this repository's

The agency brief uses general terms. Some of them name things this repository already has under
another name, and two must not be built as the brief spells them:

| Brief says | Here it is | Why |
|---|---|---|
| Company, organisation, tenant | **Workspace** (`tenants`), kind `AGENCY` | One word in code: `tenant`. "Workspace" in the UI |
| Personal workspace | Workspace of kind `PERSONAL`, one per user | Makes isolation uniform: every row belongs to some workspace |
| Employee | **Membership** (`tenant_memberships`) | A person's employment in a workspace, not a second user |
| Investigation | **Mission** (the customer's request) + **Assignment** (the engaged work) | plan.md §8: *the assignment is the investigation*. No `investigations` table |
| `investigation_assignments` | **Assignment staffing** (`assignment_staff`) | Who inside the supplier works on it: a team, members, a lead investigator |
| Command Registry | The **tool registry**, grown into the command contract | ADR-0012. One registry, not two |
| `workflows`, `workflow_steps`, `plans`, `confirmations` | **Plan rows** (`ai_plans`) ordered as a DAG, with per-node results | ADR-0012: a DAG is an ordering over plan rows that already exist; no second workflow engine |
| `sessions` (AI) | `ai_sessions` | `user_sessions` are authentication sessions; the two are unrelated |
| Customers / Orders (inside a tenant) | **The customers of the agency's assignments**, derived | Marketplace first (2026-09-19). Agencies' own off-platform clients come later under their own ADR, and would still pass lawful-use screening (plan.md §30) |
| Agency role "Staff" | Tenant role key `AGENCY_STAFF`, shown as "Staff" | `STAFF` is already the platform-employee role with scopes. Two meanings for one key is a privilege-confusion bug waiting to happen |

---

## 2. The model

> **Built in T-074:** workspaces, memberships, the permission catalog and a Personal workspace
> for every user (migration 0011). Each invariant below that says "never" or "always" is held
> by the database itself, whoever the writer is:
>
> - **Every user has exactly one Personal workspace.** A trigger on `users` creates it, with an
>   OWNER membership, in the same statement as the user. It runs with the invoker's privileges,
>   never elevated. A unique index allows at most one.
> - **A Personal workspace holds only its owner.** A trigger checks the member is the owner, with
>   a partial unique index behind it as a backstop.
> - **Every workspace not DELETED has an ACTIVE owner at commit.** A deferred constraint trigger,
>   so ownership can move within one transaction. It locks the workspace row before counting,
>   because two concurrent removals of different owners otherwise both commit and leave nobody.
>   A test forces that overlap, and without the lock it fails 5 of 5 times.
> - **A workspace's kind and owner, and a membership's workspace and person, never change.**
> - Deleting a user, which only the retention workflow does, takes their empty Personal
>   workspace with it. An agency membership blocks the delete. That check is deferred to commit,
>   because a per-statement check ran before the cascade and refused even an empty workspace.
> - Sessions open in the Personal workspace (`user_sessions.default_tenant_id`), and it survives
>   token rotation.

```
User ─────────────< Membership >───────────── Tenant (PERSONAL | AGENCY)
 (identity)          (employee: status,        │
                      roles, teams)             ├── TenantProfile   (public)
                          │                     ├── TenantSettings  (private)
                          │                     ├── Teams ──< TeamMembers
                          └── holds ──────────> ├── InvestigatorProfiles
                                                ├── Missions (as customer)
                                                ├── Quotes, Assignments (as supplier)
                                                ├── Files, AI sessions, memory, knowledge
                                                └── Audit (its own rows)
```

- **User** — who someone is. Authentication and platform roles (`CUSTOMER`, `INVESTIGATOR`,
  `STAFF`) stay here unchanged.
- **Tenant** — a workspace. `PERSONAL` is created with the user, can never have other members,
  and is where individual customers and independent investigators work. `AGENCY` is registered
  deliberately and has employees. A customer-organisation kind is reserved, not built.

  > **Built in T-083** (migration 0016): `POST /api/v1/agencies` creates an agency, its owner
  > membership and the owner's acceptance of the agency terms in one transaction, idempotent by
  > `Idempotency-Key`. Onboarding is progressive — the workspace exists as `CREATING` and turns
  > `ACTIVE` when name, country, business email, time zone and currency are all present; the
  > response says what is still missing, and `tenants_active_agency_is_complete` means nothing
  > else can activate a half-filled one. Time zone defaults from the creator's account; there is
  > no currency to inherit, so an agency that names none is simply not complete yet. Status,
  > verification and kind have no field on the DTO, and the pipe refuses a body that names one.
  > **Any active account may create one, from any workspace** — an agency owner need not be an
  > investigator, and the new agency belongs to the person rather than to the workspace their tab
  > was showing.
- **Membership** — the user's employment in a workspace. Holds status, tenant roles, job title,
  department, team memberships, locale and time zone overrides. Identity fields (name, email,
  avatar) are **not duplicated**; they are read from the user.
- **Investigator profile** — a professional capability that **belongs to a tenant** and is held
  by one membership. An agency may run many. An independent investigator's profile lives in
  their Personal workspace. The same person can hold one in their Personal workspace and
  another in an agency; `UNIQUE (tenant_id, user_id)`.

### Tenant lifecycle

```
CREATING ──► ACTIVE ◄──► SUSPENDED
                │            │
                └──► ARCHIVED ◄┘ ──► DELETED (tombstone; data per retention)
```

| State | Members | Discovery | Open assignments | Files and evidence | AI | Audit |
|---|---|---|---|---|---|---|
| CREATING | Owner only, onboarding | Hidden | — | Owner uploads (logo) | Onboarding help only | Kept |
| ACTIVE | Normal | Listed if published and verified | Normal | Normal | Normal | Kept |
| SUSPENDED | **Refused on their next request** (per-request membership read) | Hidden | Frozen. Customers keep read access to what was delivered; staff decide continuation | Customer-facing grants honoured; no new uploads | Off | Kept |
| ARCHIVED | Read-only for owners and admins, for export | Hidden | None may be open | Retained per retention rules | Off | Kept |
| DELETED | None | Hidden | — | Removed by the retention job **except** what retention, legal hold or disputes require | Tenant memory and knowledge purged | **Kept** (append-only, retention-governed) |

Nothing is physically deleted on request when retention requires it (`docs/compliance/retention.md`).
Deletion is a job with an audit trail, not a cascade.

### Membership and invitation lifecycle

The brief lists `INVITED → ACCEPTED → ACTIVE → SUSPENDED → REMOVED`. Here that lifecycle is two
records. "Accepted" is the moment an invitation turns into a membership, not a state anyone
stays in:

```
tenant_invitations:  PENDING ──► ACCEPTED   (creates the membership)
                        │  └──► CANCELLED
                        └─────► EXPIRED
tenant_memberships:  ACTIVE ◄──► SUSPENDED
                        └──────► REMOVED (row kept; audit and attribution survive)
```

- An invitation is addressed to an email address. It carries the roles, teams and optional
  investigator profile it will grant, and a **hashed single-use token** (the `user_tokens`
  pattern). Resending rotates the token; cancelling invalidates it.
- Accepting requires signing in as the invited email, or registering with it. An invitation
  cannot be accepted by a different account.
- Suspension and removal take effect **on the member's next request**. Membership is read per
  request, never carried in a token, exactly as roles are today (`authorization.md`). Their AI
  sessions in that workspace close, and pending confirmations they created are voided.
- The **last OWNER cannot be removed or demoted**, so an agency is never left unmanageable.

---

## 3. Roles and permissions (inside a workspace)

Platform roles answer *what may this person do on the platform*. Tenant roles answer *what may
this member do in this workspace*. Authorization checks **permissions**, never role names.

| Permission | OWNER | ADMIN | MANAGER | INVESTIGATOR | AGENCY_STAFF | VIEWER |
|---|---|---|---|---|---|---|
| `company.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `company.update` | ✓ | ✓ | | | | |
| `company.delete` | ✓ | | | | | |
| `employees.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `employees.invite` · `employees.update` · `employees.suspend` · `employees.remove` | ✓ | ✓ | | | | |
| `teams.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `teams.create` · `teams.update` · `teams.delete` | ✓ | ✓ | ✓ | | | |
| `investigators.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `investigators.create` · `investigators.update` · `investigators.delete` | ✓ | ✓ | | | | |
| `investigators.assign` | ✓ | ✓ | ✓ | | | |
| `investigations.read` (assigned to me or my team) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `investigations.read_all` (every assignment in the workspace) | ✓ | ✓ | ✓ | | | |
| `investigations.create` (quote) · `investigations.update` | ✓ | ✓ | ✓ | ✓ | | |
| `investigations.assign` · `investigations.cancel` | ✓ | ✓ | ✓ | | | |
| `reports.read` · `evidence.read` (assignment-scoped: staffed members, or `read_all` holders) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reports.create` · `reports.update` · `evidence.upload` | ✓ | ✓ | ✓ | ✓ | | |
| `knowledge.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `knowledge.create` · `knowledge.update` · `knowledge.delete` | ✓ | ✓ | ✓ | | | |
| `leads.read` (every lead and its pre-hire conversation) | ✓ | ✓ | ✓ | | | |
| `leads.route` | ✓ | ✓ | ✓ | | | |
| `analytics.read` | ✓ | ✓ | ✓ | | | |
| `billing.read` | ✓ | ✓ | | | | |
| `billing.manage` | ✓ | | | | | |
| `audit.read` | ✓ | ✓ | | | | |
| `settings.read` · `settings.update` | ✓ | ✓ (read + update) | read | | | |

- The catalog (`permissions`, `roles`, `role_permissions`) is **data**, seeded by migration. The
  system roles are immutable. Custom roles are a later addition to the same tables. **Built in
  T-074:** 40 permissions, 6 roles, 134 grants, generated from this table. `tenants.spec.ts`
  parses the table and fails if the seed and this document ever disagree, naming the role.
  The application role can only read the catalog.
- **Open:** as written, `AGENCY_STAFF` ("Staff") and `VIEWER` grant identical permissions. That
  is fine until support work needs something Viewer should not have. It is a product decision,
  made when that permission exists.
- A **Personal** workspace's single member holds an implicit owner set restricted to what a
  Personal workspace can do. There are no invitations, teams or employee operations.
- Permissions are read per request with the membership. A revoked permission takes effect on
  the next request.
- **Customer actions happen in the Personal workspace in v1.** Agencies are supplier-only until
  a customer-organisation kind exists.

> **Built in T-078.** `AuthzService.requirePermission(actor, permission, ctx)` reads the list the
> resolver filled for this request; `requirePersonalWorkspace` refuses a customer action outside a
> Personal workspace (403, audited `workspace_kind_forbidden`). The names code may ask for are
> typed in `common/authz/permissions.ts` and held equal to the seeded catalog by a spec, and every
> role × permission pair — 6 × 40 — is exercised against a real membership. `role-names.spec.ts`
> keeps a tenant role name out of every source but the catalog, and the role tables out of every
> module but the resolver and the workspace switcher. Which action needs which permission is in
> `authorization.md`; marketplace and customer actions keep their platform-role checks, because
> this catalog is a supplier organisation's vocabulary (owner decision, 2026-09-20).
>
> **Where v1 stops:** an agency member who holds `investigations.create` still cannot quote as the
> agency — their investigator profile belongs to their Personal workspace, and a quote must belong
> to one of its two parties, so the database refuses the write. Agency-owned investigator profiles
> are what would make it work.

---

## 4. Teams

`teams (tenant_id, name, description)` and `team_members (team_id, membership_id)`. A member may
be in several teams. In v1 teams drive:

- assignment staffing
- `investigations.read`: a member sees assignments staffed to their teams
- notification routing

Workload, team-level permissions and AI routing are later uses of the same rows; none of them
needs new structure.

---

## 5. The marketplace across workspaces

```
Customer (Personal ws) ──creates──► Mission (customer_tenant_id)
                                        │ published (QUOTED): readable by any workspace
Agency or independent ──quotes──► Quote (customer_tenant_id, supplier_tenant_id,
  (supplier ws)                            lead investigator_profile_id)
                          accepted + paid ▼
                                   Assignment (customer_tenant_id, supplier_tenant_id, …)
                                        └── assignment_staff (team, members, lead)
```

- **Quoting is a workspace act.** A member with `investigations.create` quotes for the workspace
  and names a lead investigator profile from it. The eligibility checks of T-012 (published,
  VERIFIED, accepting work) apply to that profile.
- **Inside the supplier, access is not automatic.** A member reads an assignment only if they
  are staffed on it, are in a staffed team, or hold `investigations.read_all`. RLS stops other
  agencies; the six checks stop the wrong colleague.
- **The customer sees the supplier as an agency with a named lead**, never the agency's internal
  staffing, notes or other assignments.
- **Existing data backfills cleanly.** Every existing investigator profile moves to its owner's
  Personal workspace. Every mission's customer tenant is the customer's Personal workspace. Every
  quote and assignment's supplier tenant is the lead investigator's Personal workspace. Behaviour
  is unchanged for everyone who never creates an agency.

---

## 6. Tenant context

> **Built in T-075.** `ExecutionContext` lives in `common/context/execution-context.ts`, frozen,
> held in AsyncLocalStorage. `WorkspaceResolver` implements the resolution below, and
> `ContextInterceptor` runs each handler inside the context. `database/scoped-client.ts` sets
> `app.tenant_id`, `app.user_id` and `app.membership_id` transaction-locally on every query run in
> a context: a bare query becomes `BEGIN; set_config(…); query; COMMIT`. Measured on the local
> database: **+0.73 ms per bare query** (0.19 → 0.93 ms). Pipelining `set_config` with the query
> saved only 0.02 ms locally, so it was not taken; across a network it would save one round trip,
> and it is the first optimisation to try if latency shows up.
>
> **The one footgun:** drizzle queries are lazy. A query built inside a context but awaited
> outside it runs with **no** context. Under RLS that means no rows, which is the safe direction,
> but the rule is simple: await queries inside the code that runs in the context. A test pins
> this behaviour.

```ts
interface ExecutionContext {         // infrastructure; frozen; never a function parameter
  tenantId: string;                  // the active workspace
  tenantKind: 'PERSONAL' | 'AGENCY';
  userId: string;
  membershipId: string;
  permissions: ReadonlySet<Permission>;
  platform?: { scope: StaffScope; reason: string };   // only via PlatformContext
  correlationId: string;
}
```

**Resolution, once per request:**

```
cookie → ActorGuard → Actor (identity, platform roles)
       → WorkspaceResolver: X-Workspace ∩ ACTIVE memberships (read now) → membership + permissions
       → tenant ACTIVE? (SUSPENDED/ARCHIVED refuse)                   → ExecutionContext
       → AsyncLocalStorage.run(context, handler)
```

- `X-Workspace` chooses among workspaces the user already belongs to. Intersected, it can only
  narrow access, exactly like `X-Active-Role`. Unknown or foreign → 403.
- With no header, the session's `default_tenant_id` is used, which is the last workspace the user
  switched to. In app-web (T-092) a page is **rendered** in the session's default, and every
  **browser** call from that page then sends `X-Workspace` naming the workspace it was rendered
  in (`lib/api/workspace.ts`, pinned by `WorkspaceScope`). So if another tab switches, this one
  keeps reading and writing where it shows: **a tab cannot write into a workspace it is not
  showing**.
- Body, query, path, AI output and MCP input are never read as a tenant.

**Switching workspace** (built in T-092):

- The server check first: `POST /workspaces/:id/activate` refuses a workspace the user cannot
  use, and otherwise sets `default_tenant_id`.
- Then a **full page load at Home**, not a client transition. Every list, draft, conversation
  and permission on screen belongs to the workspace being left; a reload is the one way none of
  it can render under the new name, and the page being left may not exist in the new workspace.
  The workspace layout is also keyed by the workspace id, so client state cannot outlive a
  workspace even without a reload.
- The new page confirms where the user now is ("Now working in …").

Nothing tenant-specific survives the switch, because nothing tenant-specific was kept without
the tenant.

---

## 7. Database isolation

### Roles

| Role | Used by | RLS |
|---|---|---|
| owner (`postgres` locally; a dedicated owner in production) | migrations, test fixtures | Bypasses (owner or superuser) |
| `investigator_app` | the API and workers at runtime | **Enforced**: `NOBYPASSRLS`, owns nothing, `FORCE ROW LEVEL SECURITY` on every scoped table |

**Built in T-073.** Until then the API connected as `postgres`, and every policy would have been
decorative, with its tests passing for the wrong reason. Now:

- **`DATABASE_URL` is `investigator_app`, and the API refuses to boot otherwise.**
  `RuntimeRoleCheck` (`src/database/runtime-role.ts`) refuses a superuser, a role with
  `BYPASSRLS`, a role that owns any table in `public`, and a role that can `SET ROLE` into one
  of those. It fails closed in every environment, local development included.
- **`MIGRATION_DATABASE_URL` is the owner.** drizzle-kit uses it and never falls back to
  `DATABASE_URL`. It must never be given to the API process outside local development.
- **The runtime role's password comes from `APP_DB_PASSWORD`,** set by
  `scripts/set-app-role-password.sh` after migrations. It travels via psql's `\getenv`, so it
  never appears on a command line, and psql quotes it as a literal. CI generates a new one every
  run; the production deploy (T-041) calls the same script. Local development keeps the
  migration's default. **Roles are cluster-wide:** on a shared server, every database there
  shares one `investigator_app` password.
- **Tests use two pools.** Code under test runs as `investigator_app` (`testPool()`). Fixtures
  and schema-rule tests run as the owner (`testPool({ role: 'owner' })`). A spec asserts each
  pool's `current_user`, so a silent fallback to the owner cannot pass unnoticed.

Measured before the split: with everything run as `investigator_app`, **no grant was missing from
any real application path**. All 94 failures were fixtures writing what the application
deliberately may not (93 taxonomy inserts), plus one schema test that a revoked privilege reached
before the constraint it tests.

### Context settings

Set as the first statement of **every** transaction, transaction-local:

```sql
SELECT set_config('app.tenant_id',     $1, true),
       set_config('app.user_id',       $2, true),
       set_config('app.membership_id', $3, true);
-- only inside PlatformContext:
SELECT set_config('app.platform_access', 'on', true);
```

```sql
CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
CREATE FUNCTION app_platform_access() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.platform_access', true), '') = 'on'
$$;
```

`NULLIF` matters. Once a setting has been set on a pooled connection, it reads back as `''`
after the transaction ends, and `''::uuid` throws. With `NULLIF`, "no context" is NULL, and
`tenant_id = NULL` matches nothing. **No context fails closed.**

### How queries get the context

A driver-level wrapper, not a request-wide transaction:

- `db.transaction(cb)` → `BEGIN; set_config(…); cb(tx); COMMIT`.
- A bare query → a short transaction with the same first statement.
- Code outside any context gets the unscoped path, which is legal only for identity lookups
  before authentication (login, token redemption) and for `PlatformContext` and system workers.
  A static spec lists every caller of the unscoped path.

Why not one transaction per request: it holds a connection across external calls, and it would
roll back `AuthzService`'s denial audit row whenever the request fails (ADR-0011 §4).

### Policy templates by class

> **Built in T-077** (migration 0013): 34 policies over 20 tables, every one `ENABLE`d and
> `FORCE`d. The isolation matrix (`apps/api/test/isolation/`) is generated from
> `table-classes.ts` and runs as `investigator_app`, so a table added to the registry is in the
> matrix the same day. `src/database/rls.spec.ts` fails when a table's row-level security state
> does not match its class.

```sql
-- Tenant-owned
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rw ON teams
  USING      (tenant_id = app_current_tenant() OR app_platform_access())
  WITH CHECK (tenant_id = app_current_tenant() OR app_platform_access());

-- Tenant-owned with a public projection (discovery reads across workspaces)
CREATE POLICY tenant_rw   ON investigator_profiles USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY public_read ON investigator_profiles FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND visibility = 'PUBLISHED');

-- Two-party marketplace rows
CREATE POLICY parties ON assignments
  USING      (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access())
  WITH CHECK (app_current_tenant() IN (customer_tenant_id, supplier_tenant_id) OR app_platform_access());
```

**Rules that keep policies correct:**

1. **Columns default to the context.** `tenant_id uuid NOT NULL DEFAULT app_current_tenant()`,
   so an insert that names no tenant gets the right one, and `WITH CHECK` refuses any other.
2. **No policy may reach a table whose policy reaches back.** That is infinite recursion at
   query time. Party ids are **denormalised** onto the rows that need them (`quotes` carries
   `customer_tenant_id`), so a policy compares columns and never joins.
3. **Every scoped index leads with the tenant or party column.** Policies add a predicate to
   every query, and that predicate needs an index.
4. **`FORCE` everywhere.** Without it, the owner role bypasses policies silently, which is how a
   migration-run fixture "proves" isolation that does not exist.
5. **Policies are authorization.** Adding or changing one needs approval (AGENTS.md) and a test
   in the isolation matrix.
6. **A predicate that is not `LEAKPROOF` cannot be an index condition** once a table has
   policies: PostgreSQL evaluates the security quals first. PostGIS does not mark `ST_DWithin`
   leakproof, so discovery stopped reaching `service_areas_area_gist` — 392 ms instead of 5 ms on
   10,000 published profiles. Migration 0013 marks four PostGIS predicates leakproof
   (`st_dwithin`, `_st_dwithin`, `geography_overlaps`, `overlaps_geog`), which restores the index
   at 3 ms (owner decision, 2026-09-20). What is accepted is that an error inside one of them, or
   the time it takes, could in principle say something about a row the policy hides — here, the
   coordinates of an **unpublished** profile's service area. Only a superuser may mark a function
   leakproof: where the migration cannot, it warns and carries on, and `rls.spec.ts` fails rather
   than let discovery run 80× slower unnoticed (ACTIONS-FOR-ME #19).

### What runs before a workspace exists, and what crosses workspaces

Three things do not have a workspace of their own, and each has exactly one way through:

- **Choosing a workspace.** `WorkspaceResolver` reads the caller's memberships before any
  workspace is chosen. It runs in the **pre-workspace context** — `runAsUser(userId, fn)`, which
  sets `app.user_id` and no workspace — and the tenancy policies key on `app_current_user()`: a
  user sees their own memberships, the workspaces those memberships are in, and their own role
  assignments. Nothing else. Login opens a session in the Personal workspace the same way. A
  static spec lists every caller (`tenant-plumbing.spec.ts`).
- **Creating an agency.** The second — and, so far, last — thing a person may create for
  themselves (**T-083**). `tenants.created_by` is what makes it expressible: an agency whose
  `created_by` is the caller, while its status is `CREATING`, may be inserted, and so may that
  person's own membership in it and the OWNER role on that membership. An agency created for
  somebody else, one that arrives already ACTIVE, and joining an agency you did not create are
  all refused by the database — joining is an invitation (T-085), which is somebody else's
  decision.
- **Registration.** The trigger that creates a Personal workspace runs during the insert of the
  user, before any context exists. It sets `app.user_id` to the person it is creating for its own
  three inserts and restores what was there; the policies allow exactly a Personal workspace for
  that user, its owner membership and that membership's `OWNER` role, and nothing else.
- **Crossing workspaces on purpose.** `PlatformContext.asStaff` (a staff member holding the
  scope, acting as staff) and `PlatformContext.asSystem` (an operation with no user, such as the
  assignment created when a payment is authorized) are the only code that turns on
  `app.platform_access`. T-079 adds the audit row for every entry and typed ad-hoc reasons.

**One exception inside the database.** The two tenancy integrity checks — `assert_tenant_has_owner`
and `assert_personal_member_is_owner` — read with platform access, declared as a `SET` clause on
the function so it lasts only for the call. An invariant evaluated under the writer's own
visibility fails *open*: the owner check returns early when it cannot see the workspace row.
`rls.spec.ts` asserts that these two functions, and no others, raise access.

### Classification of every existing table

> **Built in T-076** (migration 0012). The registry is `apps/api/src/database/table-classes.ts`;
> `table-classes.spec.ts` fails on an unclassified or vanished table, a missing or wrongly nullable
> column, a table without the move-guard, or a missing leading index.
>
> - **Owner columns** (a profile, a customer profile, a media file, an idempotency key, a mission's
>   customer) take the context's workspace, else the owning user's Personal workspace. The trigger
>   is `fill_owner_tenant`, backed by `app_tenant_for_user()`.
> - **Copied parties** are always taken from the parent row, even when a different context is set.
>   The trigger is `fill_party_from_parent`. **Composite foreign keys** hold each equal to its
>   parent, for example `quotes (mission_id, customer_tenant_id) → missions (id, customer_tenant_id)`.
> - **Nothing moves between workspaces:** `forbid_tenant_change` guards all 20 columns on all 17
>   tables.
> - **One exception:** an idempotency key's workspace is NULL for a system action. Assignment
>   creation from a payment runs as a system actor with no workspace, so its key belongs to none
>   (`NULLS NOT DISTINCT` keeps two system claims colliding). The replay lookup and the completion
>   match the workspace through the same database function the insert used; without that, one
>   workspace replayed another's response (negative control).
> - **A caveat:** a row's workspace is derived from rows inserted *before* it. A single statement
>   (chained `WITH` inserts) cannot see what it has itself inserted, so one that creates a user and
>   their profile together fails. Create them in separate statements, as the application does.

| Table | Class | Isolation |
|---|---|---|
| `users`, `user_roles`, `user_identities`, `user_tokens`, `user_staff_scopes` | Identity | No tenant. Authentication must read them before any context exists. Guarded by grants and the six checks. RLS keyed on `app.user_id` is reviewed in the isolation pass (T-098) |
| `user_sessions` | Identity | Gains `default_tenant_id` (the last workspace used) |
| `taxonomy_nodes` | Platform-global | Readable by all; written only by platform staff |
| `spatial_ref_sys` | PostGIS system | Untouched |
| `customer_profiles` | Tenant-owned (Personal) | `tenant_rw` + `public_read` for any workspace — the application already served a customer's card to any signed-in caller, and the service projects the fields; narrowing it to the parties who share a mission is T-098's to weigh (owner decision, 2026-09-20) |
| `investigator_profiles` | Tenant-owned + public projection | `tenant_rw` + `public_read` (published) |
| `investigator_languages`, `investigator_specialties`, `investigator_availability`, `service_areas` | Tenant-owned + public projection | `tenant_id` denormalised; public read where the parent profile is published (`EXISTS` on the profile, whose policy does not reach back) |
| `media_assets` | Tenant-owned | `tenant_rw`; verification staff and the delivery path go through `PlatformContext` |
| `verification_requests`, `verification_request_documents`, `verification_decisions` | Tenant-owned (the profile's workspace) + platform review | `tenant_rw`; the T-013 reviewer routes move into `PlatformContext` |
| `missions` | Two-party | Customer tenant: full access. Any workspace: `SELECT` while `status = 'QUOTED'`. Suppliers: rows they quoted on or are assigned to, via a denormalised `supplier_tenant_ids` index or an `EXISTS` on `quotes`, whose policy does not reach back |
| `mission_status_history`, `mission_screenings` | Two-party / platform | Customer tenant + platform (moderation) |
| `quotes` | Two-party | `parties` (`customer_tenant_id` denormalised from the mission) |
| `assignments`, `assignment_status_history` | Two-party | `parties` |
| `reviews`, `review_texts` | Two-party + public projection | `parties_read`; `public_read` of a standing rating on a published profile, and of a text only while `PUBLISHED`; the customer writes the review, the supplier the response; staff moderate and remove under `PlatformContext` (T-037, `reviews.md`) |
| `saved_mission_searches` | Tenant-owned, own user | As `ai_sessions`: `tenant_id = current AND user_id = current` — an investigator's saved browses are theirs alone, not even their agency owner's (T-054) |
| `idempotency_keys` | Tenant-owned | **`tenant_id` joins the unique key.** A replay in another workspace must never return this workspace's response |
| `outbox_events` | System | Written in the producer's context (`tenant_id` recorded for the worker); read only by the dispatcher's system context. **No policies yet:** the column arrives with T-082 |
| `audit_logs` | Platform record | **Built in T-080:** `tenant_id`, `membership_id` and `session_id`, filled by DEFAULT from the context — `AuditEvent` has no field for any of them, so a caller cannot name one. `workspace_read` (own workspace, or platform access) and `workspace_insert` (this workspace or none). Append-only grants unchanged; a row written outside a workspace cannot be read back by its writer, which is what append-only means here. `tenant_id` nullable (platform events have none). Holding `audit.read` is checked above this, in the service (T-078): a policy can see the settings, not the permission list |

New tables are all tenant-owned unless they appear in this table:

- `tenants` (policy: own row, or public read of the published profile)
- `tenant_profiles`, `tenant_settings`, `tenant_memberships`, `tenant_invitations`
- `teams`, `team_members`
- `membership_roles`, `assignment_staff`
- `leads` (tenant-owned; a member reaches a lead routed to them, or holds `leads.read`)
- `matches`, `conversations`, `messages`: **two-party**, carrying `customer_tenant_id` and `supplier_tenant_id` (plan.md §9, §13, §30)
- AI and knowledge tables (§11)

`permissions`, `roles` and `role_permissions` are platform-global in v1. Custom roles later add
tenant-owned rows to `roles`.

A generated spec lists every table from the schema and fails when a table is unclassified, or
when its RLS state does not match its class.

---

## 8. Authorization, layered

```
0  workspace   ACTIVE membership in an ACTIVE tenant             (resolver; per request)
1  identity    live session                                       (ActorGuard; unchanged)
2  status      account ACTIVE                                     (unchanged)
3  permission  tenant permission, e.g. employees.invite           (AuthzService.requirePermission)
               platform role where it still applies               (requireRole; unchanged)
4  relation    the record is this member's to act on              (repositories; unchanged)
5  state       the record's state allows it                       (unchanged)
6  staff       platform staff scope, only inside PlatformContext  (unchanged, plus reason)
── database    RLS: the row belongs to the context's workspace    (always, underneath)
```

Check 0 is new. Check 3 gains permissions. Checks 4–6 are the existing procedure, now also
enforced one layer down.

### Platform administration across workspaces

> **Built in T-077 and T-079.** `PlatformContext` is an injected service with two ways in and no
> third:
>
> ```ts
> platform.asStaff(actor, { scope: 'VERIFICATION', purpose: 'verification.review' }, req, fn)
> platform.asStaff(actor, { scope: 'VERIFICATION', purpose: 'support.lookup', reason }, req, fn)
> platform.asSystem('assignment.create_from_payment', req, fn)
> ```
>
> A `RoutePurpose` takes no reason — the route is the reason. An `AdHocPurpose` does not compile
> without one, and entry refuses text under 12 characters. **Every entry writes one audit row
> before the work runs** (`platform.access`: actor, scope, purpose, reason, correlation id),
> through its own statement, so a crossing whose work then fails is still recorded. Entry
> re-checks the `STAFF` role, the scope, and that the caller is acting as staff right now; a
> refusal records nothing, because nothing was crossed.
>
> The access is **held** in `platform-access.ts` and **entered** from `platform-context.ts`. That
> split is not taste: the scoped client reads the access on every query and the audit service
> reaches the database through that client, so one module doing both closes a circle whose
> classes then resolve as `undefined`.
>
> **Mission moderation is not here yet.** The transition map allows `STAFF:MODERATION`, but no
> moderation endpoint exists; T-051 carries the criterion that its queue enters through
> `PlatformContext` from the first line.

Platform staff (moderation, verification, disputes, payments) must see across workspaces. They
do so **only inside `PlatformContext`**:

- the scope is checked at entry, on top of the caller's own `requireStaffScope`
- ad-hoc access requires typed reason text; a route's purpose stands in for it otherwise
- `app.platform_access` is set for that unit of work only

Normal agency members can never enter it, because entry checks the platform `STAFF` role, not a
tenant role. A static spec holds that `PlatformContext` is the only writer of
`app.platform_access`.

---

## 9. Background work

```
producer (in context) → outbox row / job { jobId, tenantId, userId, membershipId, command, payload }
worker → re-read membership + tenant status (fail if suspended/removed)
       → AsyncLocalStorage.run(restored context)
       → BEGIN; set_config(…); execute; COMMIT
```

- The job stores **ids, never permissions**. They are re-read at execution, so a job queued by a
  member who has since been removed does not run with their old authority.
- Retries and duplicates: every job is idempotent (`background-jobs`), keyed within its tenant.
- System jobs that genuinely span workspaces (the outbox dispatcher, retention sweeps) run in an
  explicit system context. Each hands off per-tenant work in that tenant's context.

---

## 10. Derived stores

| Store | Isolation |
|---|---|
| **Cache** | `cache.get(namespace, query)`. The wrapper derives `tenant:{id}:{namespace}:{hash(query)}:v{version}` from the context; there is no API that takes a key. Permission-dependent results also key on the membership. **No cache exists yet.** The wrapper is built with its first consumer (T-081), and until then nothing may cache tenant data |
| **Files (Cloudinary)** | The storage layer derives `tenant/{tenantId}/{category}/{uuid}` from the context. Business code never builds a path. Folders are organisation, not authorization: `media_assets` (RLS) plus the delivery check decide, as today |
| **Audit** | `AuditService.record(event)` fills `tenant_id`, `user_id`, `membership_id`, `session_id` and `correlation_id` from the context. AI events add intent, classification, command and version, plan id and hash, confirmation and outcome. Callers stop passing actor fields they cannot get wrong |
| **Rate limits** | Per actor **and** per workspace, so one agency cannot exhaust another's allowance |
| **Search indexes** | Discovery reads published profiles across workspaces **by policy** (§7). No second index |

---

## 11. The AI assistant, tenant-aware from its first line

Phase 7 is unbuilt, so none of this is a retrofit. Every AI task in Phase 7 (T-016–T-018,
T-045–T-048, T-056–T-061) carries these as acceptance criteria:

- **Sessions belong to one workspace for life** (`ai_sessions.tenant_id`). Switching workspace
  shows that workspace's sessions. A context is never rebuilt across a switch, because a session
  never crosses one.
- **The Context Builder reads only through the context.** Summaries, state, plans and tool
  results are tenant-scoped rows. A summary never carries a tenant, and never carries authority
  (ADR-0006).
- **Memory has explicit scopes:**

  | Scope | Visible in | May contain |
  |---|---|---|
  | `platform` | everywhere | Platform knowledge base only; never written from conversations |
  | `tenant` | the workspace | Agency knowledge written by members with `knowledge.create` |
  | `user_in_tenant` (**default**) | that user, in that workspace | Anything learned in a conversation there |
  | `user_global` | that user, everywhere | **Only** user-declared preferences (language, tone), each explicitly marked; never content derived from workspace data |
  | `session` | that session | Working state |

- **RAG order:** context → permission filter → tenant filter → semantic search → rerank →
  context build.
  - Platform documents have `tenant_id` NULL and are visible by `visibility`.
  - Tenant documents need `tenant_id = current`, enforced by RLS on `knowledge_documents` and
    `knowledge_chunks`, and again in the query.
  - Vector metadata is still not an authorization system (`permission-aware-rag`).
- **Commands run in the context.** `tenantScope` is `workspace` or `platform`, never an input
  (ADR-0012). A plan, its confirmation and its results are tenant-scoped rows. A confirmation
  from workspace A is invalid in workspace B, because the plan is not visible there.
- **MCP and internal callers** reach capabilities only through the same registry, context and
  authorization. There is no side door.

---

## 12. Settings and branding

`tenant_settings` holds typed, defaulted sections. Onboarding asks for **none** of them:

- general
- branding
- localisation
- notifications
- AI
- investigations
- employees
- security
- privacy
- integrations
- billing (reserved)

Branding is limited to logo, cover, display name and **token overrides** (accent colour, report
header), which are validated for contrast. The application is never forked per tenant.
Email and report branding read the same tokens.

---

## 13. Migrating the existing data

Expand and contract (`db-migration`), in order:

1. **Expand.** Add `tenants` and memberships. Create a Personal workspace and an OWNER membership
   for every existing user, and create them in the registration transaction from then on.
2. **Expand.** Add nullable `tenant_id` and party columns. Backfill from the Personal workspaces
   (§5).
3. **Switch the runtime role** to `investigator_app`. The test suite moves with it.
4. **Contract.** Set `NOT NULL`, add the defaults (`app_current_tenant()`), and enable plus force
   RLS with policies, one class at a time. Each step is guarded by the isolation matrix.
5. Only then do agency features start.

Every step keeps the product working for users who never create an agency. Nothing is
all-at-once.

---

## 14. Testing

The **isolation matrix** is generated from the classification registry, per table:

- cross-tenant SELECT, INSERT, UPDATE and DELETE are refused as the app role
- a missing context returns nothing and inserts fail
- the platform context reads, and writes an audit row

Alongside it:

| Area | Tests |
|---|---|
| Pooling | One reserved connection: tenant A's transaction, commit, then tenant B, and A's rows are invisible. A setting read after commit is empty. Concurrent requests on a small pool |
| API | Workspace switching; a header naming a foreign workspace; removed and suspended members on their next request; a suspended tenant; permission denials; a cross-workspace IDOR probe over every route |
| AI | Cross-tenant RAG, memory, sessions, commands and confirmations; stale context after a switch; confirmation replay in another workspace |
| Cache, files | Tenant A's cache entry is unreachable from B; a storage path is derived, never accepted; private delivery across workspaces is refused |
| Workers | Context restored; a removed member's job refused; retries and duplicates idempotent per tenant |
| Audit | Tenant, user, action, resource, authorization result and AI plan fields present |
| Static | Every table classified; only `PlatformContext` sets platform access; no `tenantId` parameter in a service signature; every unscoped-path caller listed |

Coverage stays at 100% per package. The isolation paths carry negative controls: drop a policy,
watch the matrix fail.

> **Built in T-077.** `apps/api/test/isolation/` holds the matrix (127 cases over 20 tables) and
> the fill-trigger paths; `src/database/rls.spec.ts` holds the database's own state. A service
> spec now runs the way a request runs — `scopedDb()` for the client and `asRequests(service,
> ownerSql)` to enter the caller's Personal workspace — because a service called with no context
> is testing something production cannot do. Fixtures and assertions read as the owner.
> Negative controls run for T-077: each class's policy opened to `USING (true)`, the matrix
> watched to fail on exactly that table, then restored byte-for-byte.

---

## 15. Scaling later without a rewrite

The shared database with RLS is the design point. Keeping `tenant_id` or a party column leading
every scoped index, and keeping tenant context in one place, keeps these open **without
building any of them now**:

- read replicas (the context applies there too)
- partitioning by `tenant_id`
- moving one large agency to its own database (the resolver picks the pool)
- tenant groups and regional residency

---

## 16. The legal boundary is unchanged

Agencies inherit ADR-0009 in full:

- lawful investigation, including surveillance, with a stated lawful basis
- moderation (mandatory for partner investigation)
- licensing checked for the jurisdiction of the work
- the standing prohibitions: no tracking devices; no access to accounts, devices or
  communications; no interception; no ongoing monitoring; nothing unlawful where the work
  happens

The tenancy work adds two things:

- **An agency answers for its members' conduct on the platform.** Enforcement (T-049) applies to
  the individual investigator **and** can reach the agency. A permanent ban of a person applies
  in every workspace they belong to.
- **Ban evasion by incorporation is closed.** Registering a new agency does not reset a banned
  person's identity (`BanIdentityHash`, T-049). Agency verification (T-088) checks the principals.

Legal text for agencies is new work for counsel, recorded in `docs/compliance/counsel-brief.md`:

- agency terms
- a processing agreement for employee data
- responsibility for employees' conduct
