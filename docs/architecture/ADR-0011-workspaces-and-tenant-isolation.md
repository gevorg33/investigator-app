---
adr: 0011
title: Workspaces, agencies and database-enforced tenant isolation
status: Accepted
date: 2026-09-19
supersedes: ADR-0006 § "Rejected — multi-tenancy"
superseded_by: —
related:
  - docs/architecture/tenancy.md
  - docs/architecture/authorization.md
  - docs/architecture/ADR-0006-ai-session-context.md
  - docs/architecture/ADR-0009-surveillance-in-scope.md
  - docs/architecture/ADR-0012-command-registry-and-plan-dags.md
  - .claude/skills/tenant-isolation/SKILL.md
  - plan.md §29
---

# ADR-0011 — Workspaces, agencies and database-enforced tenant isolation

**Status:** Accepted · **Date:** 2026-09-19

## Context

ADR-0006 rejected multi-tenancy because the product had no organisations: "If organisational
accounts are ever built, that is its own ADR with its own migration." This is that ADR.

The product now adds **agencies**. An agency registers, keeps a profile, invites employees,
organises teams, runs investigator profiles and takes work through the marketplace as an
organisation. Individual customers and independent investigators remain.

Three facts about the current system shape the decision:

1. **Isolation today is application-only.** It relies on the six-check procedure
   (`authorization.md`). It works, but it depends on every query being written correctly.
2. **The runtime connects as `postgres`**, a superuser. Superusers and table owners bypass
   row-level security entirely. As long as that holds, RLS policies would do nothing and
   would pass their own tests.
3. **This is a marketplace, not a collection of silos.** A mission is written by a customer and
   read by every eligible investigator; an assignment has two parties. A pure
   `tenant_id = current` rule would break the product.

## Decisions

Four were put to the owner on 2026-09-19. All four took the recommended option.

| # | Question | Decision |
|---|---|---|
| 1 | §44 of the tenancy brief vs ADR-0009 | **ADR-0009 stands.** Lawful surveillance stays in scope, with a stated basis, screening and licensing. Agencies inherit every restriction and weaken none |
| 2 | Who supplies work in the marketplace | **Every workspace is a tenant.** Each user has a Personal workspace; agencies are tenants; quotes and assignments are held by the supplier tenant and name a lead investigator |
| 3 | When the foundation lands | **Next, before new features.** T-069 goes first, because RLS adds many database-heavy tests |
| 4 | Agency subscription billing | **Planned, not decided.** The model and permissions are reserved; nothing is built until the payments provider and pricing are decided |

## The decision

### 1. Four separate concepts

```
User (identity) ──< Membership (employee) >── Tenant (workspace) ──< InvestigatorProfile
```

- A **user** is a person who signs in.
- A **tenant** is a workspace: `PERSONAL` (exactly one per user, created automatically, never
  shared) or `AGENCY`. A kind for a customer organisation is reserved but not built.
- A **membership** is a user's employment in a tenant, with a status and roles.
- An **investigator profile** is a professional capability that belongs to a tenant and is held
  by one member.

A user is never a company. An independent investigator works from their Personal workspace; the
same person can also be employed by an agency and switch between the two.

### 2. Marketplace rows have two parties

A mission belongs to the customer's workspace. A quote and an assignment carry both the
`customer_tenant_id` and the `supplier_tenant_id`. **The assignment remains the investigation**
(plan.md §8). Who works on it inside the supplier is recorded in assignment staffing, not in a
new `investigations` table.

### 3. Two layers, each with one job

| Layer | Answers | Mechanism | Fails |
|---|---|---|---|
| Database | *Which workspace's rows can this execution touch?* | PostgreSQL RLS keyed on transaction-local settings | Closed. No context means no rows |
| Application | *What may this member do, to which record, in this state?* | The six checks plus tenant permissions | Closed. Deny by default |

Neither replaces the other. RLS assumes application code will one day forget a filter. The six
checks assume RLS cannot express "only the assigned investigator may read this assignment's
private notes".

### 4. The mechanism

- **The runtime connects as `investigator_app`.** It is `NOBYPASSRLS` and owns nothing.
  Migrations run as the owner. Every tenant-scoped table is `ENABLE` **and** `FORCE ROW LEVEL
  SECURITY`.
- **Context is transaction-local.** It is set with `set_config('app.tenant_id', …, true)` (and
  `app.user_id`, `app.membership_id`) as the first statement of every transaction. Nothing is
  set at session level, because a pooled connection outlives the request that used it.
- **Policies read the context through one function.** `app_current_tenant()` returns
  `NULLIF(current_setting('app.tenant_id', true), '')::uuid`. After a transaction ends,
  the setting reverts to an empty string, not NULL, and casting `''` to uuid throws. This
  function makes "no context" mean "no rows" rather than an error.
- **A tenant column defaults to the context.** `tenant_id … DEFAULT app_current_tenant()`, and
  `WITH CHECK` refuses any other value. Business code inserts without naming a tenant.
- **Context lives in `AsyncLocalStorage`.** It is established once, at the request or job
  boundary. The database provider reads it; services and repositories never receive a
  `tenantId` argument.
- **One transaction per unit of work, not per request.** A request-wide transaction would hold
  a connection across Cloudinary and email calls. Worse, it would **roll back the audit row of
  every denial**, because `AuthzService` records a denial and then throws. Bare queries run in
  a short transaction that sets the context first. The interception happens in the driver
  wrapper, invisible to business code.

### 5. The active workspace is selected by the client and authorized by the server

The client sends `X-Workspace`, as it already sends `X-Active-Role`. The server **intersects**
it with the user's ACTIVE memberships, which are read on every request. A workspace the user
does not belong to resolves to 403. The header can only choose among workspaces the user
already holds, so it grants nothing. A request with no header uses the session's default
workspace.

This is why the choice is a header rather than a server-side "current workspace". With two
tabs open in two workspaces, server-side state would let tab A write into whichever workspace
tab B switched to last. Here, each request names the workspace the user is actually looking at.

`body.tenant_id`, `query.tenant_id`, URL segments, and any AI- or MCP-produced value are never
read as a tenant.

### 6. Cross-tenant access is an explicit, audited context

Platform staff do not bypass RLS ambiently. `PlatformContext` requires a staff scope and a
written reason. It sets `app.platform_access` for one unit of work, and every row it reads is
under an audited purpose. It is the only code permitted to set that setting, and a static spec
holds that, as it already does for status writers. There is no `BYPASSRLS` role.

### 7. Everything derived inherits the context

The following take the tenant from the context, never from a parameter:

- job envelopes
- cache keys
- storage paths
- audit rows
- embeddings and retrieval
- AI sessions, memory, plans and confirmations
- notifications

The details are in `tenancy.md`.

### 8. Every table is classified

Every table is classified as one of:

- identity
- platform-global
- tenant-owned
- two-party marketplace
- system

A generated test fails when a table has no classification, or when its policies do not match
its class. A new table cannot ship unprotected by omission.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Application filters only (`WHERE tenant_id = ?` everywhere) | The failure mode this ADR exists to remove: isolation as a thing developers must remember |
| Schema-per-tenant or database-per-tenant | Migrations multiply by the number of tenants, and marketplace queries across tenants (discovery, a mission read by many agencies) become federated queries. Kept possible later, because `tenant_id` leads every index |
| Session-level `SET app.tenant_id` | Survives connection reuse. Request B can inherit request A's tenant |
| A `BYPASSRLS` role for staff and workers | Ambient bypass with no reason, no scope and no audit. Workers restore a tenant context instead |
| A server-side "current workspace" on the session | Cross-tab wrong-workspace writes (see §5) |
| `tenant_id` parameters threaded through services | Plumbing that one forgotten argument defeats. The prompt forbids it, and the context makes it unnecessary |

## Consequences

**Accepted costs:**

- Each transaction begins with a `set_config`, one extra round-trip, and pipelining can absorb it.
- Integration tests run the code under test as `investigator_app` and create fixtures as the
  owner, which means two pools.
- Marketplace policies are more complex than tenant equality. Policies must not reference
  another RLS table's policy, or recursion follows, so party ids are denormalised onto the rows
  that need them.
- Every policy change is an authorization change and goes through the approval gate.

**Gained:**

- A forgotten filter returns nothing instead of another agency's data.
- Workers, AI tools and internal calls get isolation from the same mechanism as HTTP.
- Customer organisations, sharding by tenant, or database-per-tenant for one large agency later
  become additive rather than a rewrite.

**Deliberately not done now:**

- partitioning, sharding and read replicas
- a customer-organisation tenant kind
- custom roles, for which only the catalog is designed
- subscription billing

## Revisit when

- A single tenant's volume dominates a table. Consider partitioning by `tenant_id`.
- The customer side needs organisations. Add the tenant kind; the schema already carries
  `customer_tenant_id`.
- The `set_config` round-trip shows up in latency. Pipeline it into the first statement.
