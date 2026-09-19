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

1. **Classify it** in the registry. The classes are identity, platform-global, tenant-owned
   (optionally with a public projection), two-party marketplace, and system. The generated spec
   fails when a table is unclassified.
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
6. **Tests.** The isolation matrix picks the table up from the registry. Add a direct test for
   anything class-specific, such as the public projection or the QUOTED-mission read.

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
- Cross-workspace reads by platform staff go through `PlatformContext.run({ scope, reason }, fn)`.
  The reason is audited with every access.

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
- **Negative control:** drop the policy, watch the matrix fail, restore it.

## Checklist

- [ ] No `tenantId` parameter anywhere in the change
- [ ] Every new table classified, with `FORCE` RLS and a policy by class, both clauses
- [ ] Tenant or party column leads every new index; no policy recursion
- [ ] Grants plus REVOKEs; retention row written
- [ ] Unscoped-path and `PlatformContext` callers unchanged, or added with a reason
- [ ] Cross-workspace probes written; the matrix passes; a negative control was seen to fail
- [ ] Jobs, cache, files, audit and AI derive the tenant from context
