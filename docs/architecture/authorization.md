# Authorization

How the platform decides whether a caller may do a thing. The procedure is
`.claude/skills/authorization/SKILL.md`; this describes what implements it, and why it is
shaped the way it is.

Built in T-006.

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
| 1 | Identity — live, unrevoked session | `ActorService`, via `ActorGuard` |
| 2 | Account status | `ActorService` (session-ending) and `AuthzService.requireActive` (per action) |
| 3 | Role permission | `AuthzService.requireRole` |
| 4 | Resource relationship | `ActorScopedRepository` + `AuthzService.visible` |
| 5 | Resource state | `AuthzService.stateAllows` |
| 6 | Staff scope | `AuthzService.requireStaffScope` |

Checks 4 and 5 are where the real bugs live. 1–3 are usually already handled by the guard.

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
