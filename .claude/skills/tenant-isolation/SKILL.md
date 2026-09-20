---
name: tenant-isolation
description: How workspaces are isolated — execution context, transaction-local database context, row-level security policies by table class, PlatformContext, and the isolation test matrix. Use whenever adding or changing a table, a query path, an endpoint, a job, a cache, a file path, an audit call or an AI command, and whenever reviewing anything that could read across workspaces.
---

# Tenant isolation

The design is `docs/architecture/tenancy.md`; the decision is ADR-0011. This skill is the
procedure for following it.

**The rule:** tenant isolation is a database and infrastructure boundary, not a parameter. If you
are about to write `tenantId` as a function argument in a service, repository, domain method or
command, stop. The context already has it.

## Never

- A `tenantId` parameter on a service, repository, domain method or command input.
- Reading a tenant from `body`, `query`, a path segment, model output, a tool argument or MCP input.
- `SET app.tenant_id` without `LOCAL`, or at connection level. It survives into the next request.
- Connecting at runtime as the owner or a superuser. RLS silently stops applying.
- A policy that joins a table whose own policy joins back. That is infinite recursion at query time.
- A table without `FORCE ROW LEVEL SECURITY`, when its class requires it.
- A cache key, storage path or job built by hand from a tenant id.
- Setting `app.platform_access` anywhere except `PlatformContext`.
- Carrying permissions in a job, a token or a summary. Store ids; re-read them at execution.

## Adding a table

1. **Classify it** in `apps/api/src/database/table-classes.ts`. The classes are identity,
   platform, tenancy, tenant-owned, two-party, system and platform record.
   `table-classes.spec.ts` fails when a table is unclassified, when a column does not match its
   class, or when the table lacks the move-guard.
2. **Fill it with a trigger, never from a service.** An owner column gets `fill_owner_tenant`
   (the context, else the owning user's Personal workspace). A column copied from a parent gets
   `fill_party_from_parent`, plus a composite foreign key to the parent's `(id, party)` unique.
   Every tenant or party column gets `forbid_tenant_change`. See migration 0012 for the pattern.
2. **Columns.** Tenant-owned: `tenant_id uuid NOT NULL DEFAULT app_current_tenant()`. Two-party:
   `customer_tenant_id` and `supplier_tenant_id`, **denormalised** onto the row and never joined
   in a policy.
3. **Migration** (`db-migration`), in this order:
   - `ENABLE` and `FORCE ROW LEVEL SECURITY`
   - the class's policy template (`tenancy.md` §7), with both `USING` and `WITH CHECK`
   - grants for `investigator_app`, and **REVOKE** whatever it must not have, because
     `ALTER DEFAULT PRIVILEGES` grants everything by default
4. **Index** with the tenant or party column first.
5. **Retention row** in `docs/compliance/retention.md`, stating what happens when the workspace
   is deleted.
6. **Tests.** The isolation matrix (`apps/api/test/isolation/`) picks the table up from the
   registry — add one seeded row for it in `graph.ts`, in a state no projection publishes. Add a
   direct test for anything class-specific, such as the public projection or the QUOTED-mission
   read, and one for each fill trigger the table has (`fill-triggers.spec.ts`): the trigger reads
   the parent with the writer's privileges, so a parent the writer cannot see must refuse the
   insert rather than fill in the writer's own workspace.
7. **Geography or full text in a query against it?** Check the plan. Once a table has policies,
   a predicate that is not `LEAKPROOF` cannot be an index condition — that is what cost discovery
   its GIST index (tenancy.md §7, rule 6). If a new operator class is involved, EXPLAIN it
   against a seeded table before assuming the index is still used.

## Adding a query path

- **Await every query inside the context.** Drizzle queries are lazy. One returned un-awaited
  from a function the caller awaits *outside* the context runs with no context (no rows under
  RLS). Services are `async` and await their queries; keep it that way.
- The raw pool (`@Inject(SQL)`, `drizzle(`, `createPool(`) is the unscoped path. Only
  `database.module.ts` may touch it, and `tenant-plumbing.spec.ts` enforces that.

- Inside a request or job, use the injected database handle. It opens the transaction and sets
  the context. Do nothing else.
- Outside any context (authentication before a session exists, the outbox dispatcher, retention
  sweeps), use the **unscoped path**, and add the caller to its allowlist spec with a comment
  saying why no context can exist there.
- Cross-workspace reads by platform staff go through
  `platform.asStaff(actor, { scope, purpose }, req, fn)` — the injected `PlatformContext` — and an
  operation with no user at all through `platform.asSystem(purpose, req, fn)`. These are the only
  code that may turn on `app.platform_access`, and `tenant-plumbing.spec.ts` lists every caller of
  each: adding one is editing that list on purpose.
  - A **route** purpose is a new member of `RoutePurpose` and takes no reason. **Ad-hoc** access
    (a support lookup) is an `AdHocPurpose` and does not compile without typed reason text, which
    must say something — entry refuses anything under 12 characters.
  - Every entry writes its own audit row before the work runs. Do not add one by hand; do not
    remove the action's own audit row either, because they answer different questions.
- A read that has to happen **before a workspace is chosen** — the resolver, and the Personal
  workspace a new session opens in — uses `runAsUser(userId, fn)`. It sets `app.user_id` and no
  workspace, so the policies show that user their own memberships, the workspaces they are in and
  their own role assignments, and nothing else. It is not a way to read around a workspace: it
  sets the current workspace aside, and its callers are listed in the same static spec.

## Adding an endpoint

The workspace is already resolved when your handler runs. Then:

- Check **permissions**, not role names: `authz.requirePermission('employees.invite', c)`.
- Keep checks 4 and 5. RLS stops other agencies; it does not stop the wrong colleague.
- Write the cross-workspace probe: the same call from a member of another workspace returns 404
  (not visible) or 403 (visible but not allowed), exactly as the `authorization` skill already
  requires.

## Jobs, cache, files, audit, AI

| Thing | Do |
|---|---|
| Job | Enqueue through the job helper. It stores `{tenantId, userId, membershipId}`. The worker re-reads membership and tenant status, restores the context, then runs |
| Cache | `cache.get(namespace, query)`. Never compose a key. Permission-dependent results key on the membership too |
| File | Ask the storage layer for a path. It derives `tenant/{id}/{category}/{uuid}`. Folders never authorize |
| Audit | `audit.record({ action, resourceType, resourceId, … })`. Tenant, user, membership, session and correlation come from the context |
| AI | A session belongs to one workspace for life. Memory defaults to `user_in_tenant`. Retrieval filters by tenant before similarity. A command declares `tenantScope`; it is never an input (ADR-0012) |

## Test recipe

- **Matrix** (generated): for every scoped table, as `investigator_app`, check that cross-tenant
  SELECT, INSERT, UPDATE and DELETE are refused, and that no context returns nothing and refuses
  an insert.
- **Pooling:** on one reserved connection, run tenant A, commit, then tenant B; A's rows must be
  invisible. The setting reads empty after commit.
- **Probe:** every new route, command, retrieval, cache namespace and job type gets a
  cross-workspace test.
- **Two pools in integration tests:** fixtures are inserted by the owner pool; the code under test
  runs on the `investigator_app` pool inside a context. A test that runs the code under test as
  the owner proves nothing about isolation.
- **Enter the workspace the way a request does.** Build the client with `scopedDb(sql)` and wrap
  the service in `asRequests(service, ownerSql)` (`test/workspace-context.ts`), which runs each
  call in that actor's Personal workspace. A call with no actor argument — or a raw query — uses
  `inWorkspaceOf(ownerSql, userId, fn)`. A service called with no context at all sees nothing,
  and is testing a situation production does not have.
- **Assertions read as the owner.** What the application can see is the matrix's subject; a
  spec's own `SELECT` is a fixture.
- **Negative control:** open the policy (`ALTER POLICY … USING (true)`), watch the matrix fail on
  exactly that table, restore it byte-for-byte and diff `pg_policies` to prove it.

## Checklist

- [ ] No `tenantId` parameter anywhere in the change
- [ ] Every new table classified, with `FORCE` RLS and a policy by class, both clauses
- [ ] Tenant or party column leads every new index; no policy recursion
- [ ] Grants plus REVOKEs; retention row written
- [ ] Unscoped-path and `PlatformContext` callers unchanged, or added with a reason
- [ ] Cross-workspace probes written; the matrix passes; a negative control was seen to fail
- [ ] Jobs, cache, files, audit and AI derive the tenant from context
