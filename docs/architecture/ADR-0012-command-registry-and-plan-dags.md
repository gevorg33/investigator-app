---
adr: 0012
title: Command registry contract, bulk commands and plan DAGs
status: Accepted
date: 2026-09-19
supersedes: ADR-0006 § "Deferred — the orchestration layer"
superseded_by: —
related:
  - docs/architecture/ADR-0006-ai-session-context.md
  - docs/architecture/ADR-0011-workspaces-and-tenant-isolation.md
  - .claude/skills/ai-tool-registry/SKILL.md
  - plan.md §16, §18
---

# ADR-0012 — Command registry, bulk commands and plan DAGs

**Status:** Accepted · **Date:** 2026-09-19

## Context

ADR-0006 deferred DAG planning until one of two things happened: "tools appear that genuinely
require ordered multi-step execution with dependencies", or "organisational accounts become a
product requirement". Both have now happened. ADR-0011 makes agencies real, and the agency
brief's canonical request is inherently multi-step:

> Create a new investigation for John, find two English-speaking investigators in the requested
> service area, assign them, and notify John.

ADR-0006 also recorded what keeps this additive. Plans are already persisted with a hash and a
confirmation state, and tool calls are already structured events. None of that changes. This
ADR adds structure on top.

## Decision

### The pipeline

```
normalise → classify → model semantics → resolve context and entities → retrieve
  → select commands (registry) → plan → order as a DAG → validate → authorize
  → assess risk → confirm → execute → verify → audit → respond
```

The **active workspace and actor come from the execution context (ADR-0011)**, before the first
step and through the last. No step can produce, change or infer them. The model never chooses a
tenant, a user id or a membership.

### The command contract

The existing nine-field tool declaration (`ai-tool-registry`) grows into a command contract. A
command that is missing a field does not register:

| Field | Notes |
|---|---|
| `name`, `version` | `domain.operation`, e.g. `employee.invite`. A version bump is required when the input or output schema changes |
| `description`, `intentExamples`, `aliases` | Used for retrieval and classification only, never for authorization |
| `domain`, `entity`, `operation` | `operation`: `read` · `create` · `update` · `delete` · `action` |
| `inputSchema`, `outputSchema` | Zod. The output is a projection, never an entity |
| `permissions` | Tenant permissions (`employees.invite`), checked in the command, not by the planner |
| `roles` | Platform roles (CUSTOMER / INVESTIGATOR / STAFF) where they still apply |
| `tenantScope` | `workspace` (the active one) or `platform` (only inside `PlatformContext`). Never a parameter |
| `confirmation` | `none` · `required`. Writes default to `required`; lowering it is approval-gated |
| `riskLevel` | `low` · `medium` · `high`. `high` always confirms and is never bulk-parallel |
| `bulk` | `{ supported, maxBatchSize }` |
| `idempotency` | Key derivation. Every write is idempotent (docs/api/idempotency.md) |
| `sideEffects` | Declared, e.g. `sends_email`, `notifies_customer`, `creates_assignment` |
| `audit` | Event name and redaction rules |
| `failure` | `abort_plan` · `continue_independent` · `compensate` |
| `timeoutMs`, `retry` | Retries apply to idempotent commands only |

A command calls the same application service that the HTTP controller calls. There is no second
implementation for the assistant, and the same is true of MCP or internal callers if they are
ever built.

### Bulk commands

A bulk variant exists only where multiple targets are natural: `investigator.bulk_update`
yes, `employee.invite_owner` no. Every bulk command:

- authorizes **each record** separately; one permission check for the batch is not enough
- enforces `maxBatchSize`, de-duplicates targets, and reports per-record outcomes
- is idempotent per record, so a retried batch does not double-apply
- reports partial failure as partial failure, never as success
- runs as a job above a declared size, and restores the tenant context in the worker (ADR-0011)
- is rate-limited per actor and per workspace

### Plan DAGs

- A plan is a set of command nodes. Its edges are data dependencies (`investigation.assign`
  consumes the output of `investigator.search`).
- **Independent nodes may run in parallel. Dependent nodes wait.**
- The **plan hash covers the whole DAG**: nodes, arguments and edges. A confirmation binds to
  that hash, exactly as it binds to a single call today. Change one node and the confirmation
  is void.
- **One confirmation covers every mutating node**, shown together. The user confirms the plan,
  not a stream of prompts.
- Each node **re-authorizes at execution**. A permission granted at planning time and revoked
  since is refused at execution.
- Per-node results are persisted, so a worker restart resumes rather than repeats.

### No guessing

When the request is ambiguous in a way that changes the operation, the planner asks rather than
chooses. "Remove the investigator from this case" could mean remove the assignment, suspend the
investigator, or delete the profile. The same applies to the target, or to anything
destructive. The workspace and authority are never inferred from language, because they are
never inputs.

### Risk assessment

Risk is **declared, not predicted**:

- the command's `riskLevel`
- the mission policy screening that already exists (plan.md §10)
- the approval gates in AGENTS.md

A learned risk engine is not part of this decision.

## Consequences

**Gained:** multi-step requests execute as one confirmed, auditable unit. Bulk operations are
safe by construction. MCP and internal callers can only reach capabilities through the same
contract.

**Accepted:** the registry is larger, and each command carries more metadata to maintain. A
static spec validates every registration so the metadata cannot drift silently.

**Not changed:** the assistant still never writes SQL, never touches tables directly, and never
decides authorization.
