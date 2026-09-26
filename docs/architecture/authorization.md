# Authorization

How the platform decides whether a caller may do a thing. The procedure is
`.claude/skills/authorization/SKILL.md`; this describes what implements it, and why it is
shaped the way it is.

Built in T-006.

> **Workspaces (ADR-0011).** Check 0 is **built** (T-075), row-level security underneath all six
> is **built** (T-077, `tenancy.md` §7), and tenant permissions in check 3 are **built** (T-078,
> below).

## The shape of it

```
request → ActorGuard ─── ActorService ──→ Actor (checks 1, 2)
                                            │
                                            ▼
                         application service ── AuthzService (checks 2, 3, 6)
                                            │
                                            └─ ActorScopedRepository (checks 4, 5)
```

A role check alone is never sufficient. "Is an investigator" does not mean "is *this*
assignment's investigator", and every mechanism here exists to make that distinction hard
to skip.

## The Actor

`@investigator/auth` defines it; `ActorService` builds it.

| Field | |
|---|---|
| `userId` | who |
| `sessionId` | which device, so a mutation traces to one session |
| `status` | account status, for check 2 |
| `roles` | every role held |
| `staffScopes` | empty unless `roles` includes `STAFF` |
| `activeRole` | the one role the caller has narrowed to, if any |

It is frozen. An Actor a downstream service can edit is not a security boundary.

**Roles and scopes are read per request, never carried in the token.** A revoked role or a
withdrawn staff scope therefore takes effect on the caller's next request rather than
whenever they next happen to sign in — the same reasoning that made the session token
opaque in T-005.

The shared package holds the vocabulary and no logic. Authorization is a backend
responsibility, and a rule shipped in a browser bundle invites the belief that the browser
enforces it. (It is also ESM while the API is CommonJS, so the API consumes these as
type-only imports that erase at compile time.)

## Role switching

Someone may hire an investigator for one thing and take work as one on another, on a single
account (`plan.md:12`). Switching between those workspaces must not require signing in
again.

The client sends `X-Active-Role`. `ActorService` **intersects** it with the roles actually
held:

```ts
activeRole: isRole(requested) && roles.includes(requested) ? requested : undefined
```

Intersect, never union. A client naming a role it does not hold ends up with `undefined` —
exactly where it would have been without switching — and never acquires the role. Narrowing
can only ever remove permissions: while narrowed to `INVESTIGATOR`, actions requiring
`CUSTOMER` are refused even though that role is held.

It is a request header rather than stored state, so a switch cannot outlive the request
that asked for it.

## The six checks

| | Check | Where |
|---|---|---|
| 0 | Workspace — an ACTIVE membership in a workspace that is neither suspended, archived nor deleted | `WorkspaceResolver`, via `ActorGuard` (T-075) |
| 1 | Identity — live, unrevoked session | `ActorService`, via `ActorGuard` |
| 2 | Account status | `ActorService` (session-ending) and `AuthzService.requireActive` (per action) |
| 3 | Platform role — may this person do this at all | `AuthzService.requireRole` |
| 3b | Tenant permission — may they do it **in this workspace** | `AuthzService.requirePermission` (T-078) |
| 4 | Resource relationship | `ActorScopedRepository` + `AuthzService.visible` |
| 5 | Resource state | `AuthzService.stateAllows` |
| 6 | Staff scope | `AuthzService.requireStaffScope` |

Checks 4 and 5 are where the real bugs live. 1–3 are usually already handled by the guard.

Checks 3 and 3b answer different questions and are not interchangeable. The platform role says
what someone *is* — a customer, an investigator, staff. The tenant permission says what their
membership lets them do *here*. Someone can be an investigator on the platform and hold nothing
but read access in the agency whose workspace they are currently in.

### Check 2 has two strengths, deliberately

- **Session-ending** (`ActorService`): `SUSPENDED` and `DELETED`, plus a soft-deleted row.
  No Actor is issued at all, so nothing downstream has to remember to check again. Sessions
  are additionally revoked on the refresh path, so the refusal is permanent rather than
  repeated per call site.
- **Per action** (`AuthzService.requireActive`): demands `ACTIVE`, which also excludes
  `PENDING_VERIFICATION`.

`PENDING_VERIFICATION` is not session-ending because login already admits an unverified
account; severing the session on its first rotation would sign people out for no reason.
What such an account may *do* is a per-feature gate.

Suspension previously blocked only the next login — an existing session kept rotating for
up to `REFRESH_TTL_DAYS`. An enforcement action that leaves the offender working for thirty
days is not an enforcement action. That is closed, with regression tests.

### Check 6 is never `isStaff`

A moderator is not a payments reviewer. Scopes come from the staff capabilities in
`plan.md` §7, one per capability:

`VERIFICATION` · `MODERATION` · `DISPUTES` · `PAYMENTS` · `TAXONOMY` · `ENFORCEMENT`

They live in `user_staff_scopes`, granted and revoked one at a time, each grant recording
who made it. Revoked rows are kept: who could see payments last March is a question a
dispute or an incident review will ask.

Scopes are read only for an account holding `STAFF`, so a stray row can never become
authority.

## Where the check goes

**In the application service, not only the controller or the guard.**

A guard runs on the HTTP path alone. A service is also reachable from a job, an event
handler, another module, and an AI tool — none of which pass through a guard. A guard is a
fast rejection; it is not the authorization.

## Scope the query, do not fetch then compare

```ts
// Wrong: reads someone else's row, then decides.
const row = await repo.findById(id);
if (row.customerId !== actor.userId) throw forbidden();

// Right: the scope is part of the query.
const row = await repo.findOneForActor(actor, id);
```

The wrong form fails open. A forgotten branch, an early return, a refactor that moves the
comparison — any of them leaves the row already fetched and in hand. The right form has no
such failure: the row never leaves the database.

`ActorScopedRepository` has no `findById`. That is the design. Every read demands an Actor,
so fetching unscoped means leaving the repository and touching `db` directly — conspicuous
in review rather than something that blends in.

Subclasses answer one question, in `scopeFor`: what makes a row this actor's?
`SessionRepository` is the reference implementation. Returning `undefined` from `scopeFor`
means "no restriction" and is a decision to expose every row — only ever right for a staff
scope that genuinely spans the table, and worth a comment where it happens.

## 403 or 404

- The actor may know the resource exists — they are a participant, but the state forbids
  the action: **403**.
- The actor should not learn it exists: **404**.

`AuthzService.visible` answers 404 for both "no such row" and "not yours", because any
difference between them confirms an id is real to someone who should not know. Be
consistent per resource type; inconsistency is itself an enumeration oracle.

## Denials are audited, and say nothing

Every refusal writes an audit row naming which of the six checks failed. The caller gets
only "no" — three different reasons produce one indistinguishable response.

The audit row is the point. A burst of denials across many ids is what enumeration looks
like from the inside, and it is invisible without them.

## Testing

Seven cases per protected endpoint, from `apps/api/test/authz-cases.ts`:

1. Owner succeeds.
2. **A different user of the same role gets 404.** The IDOR case.
3. Wrong role gets 403.
4. Suspended account is rejected.
5. Wrong resource state is rejected.
6. Staff outside scope gets 403.
7. No token gets 401.

Case 2 is the one that gets skipped. A suite written by whoever wrote the endpoint tends to
exercise the owner, confirm it works, and stop — which proves the happy path and nothing
about whether a stranger is kept out.

`expectAuthorized` takes them as a single call, so omitting one is visible rather than
absent. Cases that genuinely do not apply are omitted deliberately, not faked — sessions,
for instance, are neither role-gated nor state-gated.

The helper is itself tested (`test/authz-cases.spec.ts`) by driving deliberately broken
subjects past each case and asserting it notices. A checklist that cannot fail is
decoration.

## What T-006 did not build

- **Per-endpoint role decorators.** `@Roles()` style metadata was left out; the check
  belongs in the service, and a decorator makes it look as though the route is where
  authorization lives.
- **Evidence and report grants.** Access there needs an explicit grant row, not merely
  participation — see `evidence-integrity` and the relevant phase task.
- **AI tool scoping.** A tool executes with the caller's scope and re-runs the six checks;
  it never accepts an actor id from the model. Built with the AI gateway.

## Check 0 — the workspace (T-075)

`ActorGuard` resolves the actor and then the workspace, and `ContextInterceptor` (global) runs the
handler inside the resulting execution context. The DB provider carries that context into every
query (`database/scoped-client.ts`).

- **`X-Workspace` chooses; memberships decide.** The header is intersected with the caller's
  ACTIVE memberships, read on this request. So it can only choose among workspaces already held,
  as `X-Active-Role` can only narrow. A workspace the caller is not in, or one that is suspended,
  archived or deleted, is refused with **403** and audited as `workspace_not_available`.
- **No header** uses the session's default while it is usable. Otherwise it uses the caller's
  Personal workspace, and the default follows it.
- **Permissions are read with the membership,** on every request, and travel in the frozen
  context. A removed member is refused on their very next request.
- **Nothing takes a workspace as a parameter.** A static spec (`tenant-plumbing.spec.ts`) parses
  the source and refuses any `tenantId` parameter or DTO field. Only the database module may touch
  the raw pool, which is the unscoped path.
- **Denials outlive the transaction around them.** Context is set per unit of work, not per
  request. `AuthzService.deny` records through its own short transaction, so a denial inside a
  transaction that rolls back still leaves its audit row (end-to-end test).

---

## Check 3b — the tenant permission (T-078)

```ts
await this.authz.requireRole(actor, 'INVESTIGATOR', c);        // what they are
await this.authz.requirePermission(actor, 'investigations.create', c);  // what they may do here
```

- **A permission, never a role name.** What a role grants is the catalog — 40 permissions, 6
  system roles, 134 grants, seeded from `tenancy.md` §3 and read with the membership on every
  request. A service that tested for `ADMIN` would be a second copy of that catalog, updated by
  hand. `role-names.spec.ts` holds that no source outside the catalog contains a tenant role
  name, and that only the resolver and the workspace switcher touch the role tables at all.
- **From the context, not from a query.** `requirePermission` reads the list the resolver already
  resolved for this request. A revoked permission, a changed role or a removed member therefore
  lands on the next request, with nothing to invalidate.
- **Outside a workspace there is nothing to hold a permission,** so the answer is no —
  `workspace_context_missing`, audited like any other refusal.
- **The names are typed.** `TenantPermission` comes from `common/authz/permissions.ts`, which
  `permissions.spec.ts` holds equal to the seeded catalog. A permission that does not exist fails
  to compile instead of producing a check that can never pass.

### Which permission each action needs

Only where the catalog already speaks. Its vocabulary is a supplier organisation's, so marketplace
and customer actions keep their platform-role checks until an agency version of them exists
(owner decision, 2026-09-20).

| Action | Permission |
|---|---|
| Submit a quote | `investigations.create` |
| Withdraw a quote · accept or decline an assignment | `investigations.update` |
| List own quotes | `investigations.read` |
| Read own investigator profile, service areas, verification applications | `investigators.read` |
| Change them, or apply for verification | `investigators.update` |
| Read the agency's core details — name, country, business email, time zone, currency (T-150) | `company.read` |
| Complete or change them — the OWNER only | `company.update_details` |
| Read the agency's own public profile, published or not (T-084) | `company.read` |
| Change the agency's public profile, publish or unpublish it | `company.update` |
| Read the agency's settings | `settings.read` |
| Change a settings section · upload an agency logo or cover | `settings.update` |
| List the agency's members and invitations (T-085) | `employees.read` |
| Invite, resend or cancel an invitation | `employees.invite` |
| Change a member's details or roles | `employees.update` |
| Suspend or reactivate a member | `employees.suspend` |
| Remove a member | `employees.remove` |
| List or read the agency's teams (T-086) | `teams.read` |
| Create a team | `teams.create` |
| Rename a team, change its description, put members in or take them out | `teams.update` |
| Delete a team | `teams.delete` |

**Nothing upward (T-085).** Beside the permission, `AuthzService.requireHoldsAll(actor, permissions,
ctx)` refuses — 403, audited `exceeds_own_permissions` — granting a role that carries a permission
the actor does not hold, and acting on a member who holds one. Accepting an invitation needs only an
active account; which invitation is the caller's is the database's (`tenancy.md` §2).

The agency's profile and settings exist only in an agency workspace:
`AuthzService.requireAgencyWorkspace` refuses them elsewhere, 403 audited as
`workspace_kind_forbidden` — the mirror of `requirePersonalWorkspace`. Reading a **published**
agency's profile needs only an active account.

### Customer work happens in a Personal workspace

`AuthzService.requirePersonalWorkspace` guards every action that requires the `CUSTOMER` platform
role: missions, the customer side of quotes, and the customer profile. A row takes the workspace
of the context it was written in (T-076), so a customer acting while an agency workspace was
active would file their mission into that company. Agencies are supplier-only in v1
(`tenancy.md` §3), and the refusal is a **403** audited as `workspace_kind_forbidden`.

### Where v1 actually stops

A member of an agency who holds `investigations.create` still cannot quote *as* the agency: their
investigator profile belongs to their Personal workspace, and a quote must belong to one of its
two parties, so the database refuses the write (T-077). Authorization is not what stops it —
agency-owned investigator profiles are what would make it work, and they do not exist yet.
