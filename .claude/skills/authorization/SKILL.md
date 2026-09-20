---
name: authorization
description: The resource-level authorization procedure for every protected endpoint — the six required checks, the IDOR test recipe, and staff scoping. Use whenever writing or reviewing a controller, service, guard, or any code path that reads or mutates user data, evidence, reports, or payments.
---

# Authorization

A role check alone is never sufficient. "Is an investigator" does not mean "is *this*
assignment's investigator".

## The six checks

Every protected resource verifies, in order:

1. **Identity** — valid, unexpired, non-revoked token; the session still exists.
2. **Account status** — active. Not suspended, deleted, or pending verification where
   that gate applies.
3. **Platform role** — the actor's role may perform this action *in principle*
   (`requireRole`: CUSTOMER, INVESTIGATOR, STAFF).
   **3b. Tenant permission** — their membership lets them do it *in this workspace*
   (`requirePermission('investigations.create', c)`). A permission, never a role name.
4. **Resource relationship** — the actor owns this row, or is a participant in the
   assignment/conversation/mission it belongs to. This is the check that gets forgotten.
5. **State** — the mission/assignment state permits this action. You cannot upload
   evidence to a cancelled assignment or accept an expired quote.
6. **Staff scope** — if the actor is staff, their *specific* scope covers this resource.
   A moderator is not a payments reviewer.

Checks 4 and 5 are where real bugs live. Checks 1–3 are usually already handled by a guard.

## Where the check goes

In the **application service**, not only in the controller or a decorator. A service is
callable from a job, an event handler, another module, or an AI tool — each of which
bypasses the controller.

A guard is a fast rejection, not the authorization.

## Query shape

Scope the query; do not fetch then compare.

```ts
// Wrong: fetches another user's row, then decides.
const mission = await repo.findOneById(id);
if (mission.customerId !== actor.id) throw new ForbiddenException();

// Right: the actor's scope is part of the query.
const mission = await repo.findOneForActor(id, actor);
if (!mission) throw new NotFoundException();
```

The second form cannot leak through a forgotten branch, and it returns 404 rather than
403 — which does not confirm the row exists to someone who should not know.

## Choosing 403 vs 404

- The actor may know the resource exists (they are a participant, but the state forbids
  the action): **403**.
- The actor should not learn it exists: **404**.

Be consistent per resource type. Inconsistency is itself an enumeration oracle.

## Evidence and reports

Access requires an explicit grant row, not merely assignment participation. Check the
grant, check it has not expired or been revoked, and audit the access. See
`evidence-integrity`.

## AI tools

An AI tool executes with the *caller's* scope, never the assistant's. Re-run the six
checks inside the tool. Never accept an actor ID from the model.

## Test recipe — required for every endpoint

Write these before the endpoint is considered done:

1. Owner succeeds.
2. **A different user of the same role gets 403/404.** This is the IDOR test. Without it,
   the endpoint is untested.
3. Wrong role gets 403.
4. Suspended account gets rejected.
5. Wrong resource state gets rejected.
6. Staff outside scope gets 403.
7. No token gets 401.

A test suite that only exercises the owner proves the happy path and nothing else.

## Workspaces (ADR-0011)

There is a **check 0**: an ACTIVE membership in an ACTIVE workspace, resolved from `X-Workspace`
intersected with memberships read per request. Inside a workspace, check 3b asks for a tenant
**permission** (`requirePermission`), never a role name — the catalog says what a role grants, and
`role-names.spec.ts` refuses any source outside it that contains one. The list comes from the
execution context the resolver filled this request, so a revoked role lands on the next one.
Customer actions additionally require a Personal workspace (`requirePersonalWorkspace`): agencies
are supplier-only in v1, and a row takes the workspace it was written in. Underneath all of it,
row-level security enforces the workspace boundary. That does not replace checks 4 and 5: RLS stops another agency,
and only the six checks stop the wrong colleague. Staff act across workspaces only inside
`PlatformContext`. Procedure: `tenant-isolation`.

## Review checklist

- [ ] Check lives in the service, not only the guard
- [ ] The action names a permission the catalog holds, not a role name — and a customer action
      requires a Personal workspace
- [ ] Query is actor-scoped, not fetch-then-compare
- [ ] State is validated, not just ownership
- [ ] Staff scope is specific, not `isStaff`
- [ ] IDOR test asserts on a *different* actor
- [ ] Failure mode leaks nothing in body, headers, or timing
- [ ] Mutation emits an audit event
