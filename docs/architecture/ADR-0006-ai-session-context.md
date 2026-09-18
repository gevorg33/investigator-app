---
adr: 0006
title: AI session, memory and context architecture
status: Accepted
date: 2026-09-13
supersedes: —
superseded_by: in part — ADR-0011 (multi-tenancy), ADR-0012 (orchestration)
related:
  - plan.md §16, §17, §18
  - .claude/skills/ai-session-context/SKILL.md
  - .claude/skills/permission-aware-rag/SKILL.md
  - .claude/skills/ai-tool-registry/SKILL.md
  - docs/architecture/ADR-0005-investigation-intelligence-boundary.md
---

# ADR-0006 — AI session, memory and context

**Status:** Accepted · **Date:** 2026-09-13 · **Superseded in part** on 2026-09-19 — see the two marked sections

## Context

The assistant needs to hold conversations that outlive a model context window, survive a
browser close, a worker restart and an LLM failure, and still never become the authority on
application state.

A proposed "AI-native command, semantic, session and orchestration architecture" was put
forward. Most of it is adopted. Two parts are not, and one is rejected outright.

## Decision

### Adopted — the session, memory and context layer

The central distinction, and the reason this ADR exists:

```
SESSION         = persistent conversational workspace   (may hold 50,000 messages)
CONTEXT WINDOW  = temporary working set for one call    (holds what the builder selects)
```

The conversation is effectively unlimited; the window is not. They are separate systems.

**Persistence.** Sessions, messages, summaries, structured session state, memory, plans and
confirmations all live in PostgreSQL. None of it lives in a model process. An agent is
disposable; the conversation is not.

**Layers, kept distinct.** Raw history · recent context · rolling summary · structured session
state · user memory · domain knowledge · **application state**. They answer different
questions and must not be conflated — see the skill.

**Context Builder.** One service decides what reaches the model, applying permissions, token
budget, ranking, deduplication and compaction. The model never chooses what history it is
allowed to see.

**Progressive compaction.** Triggered proactively at ~70–80% of budget, never at the hard
limit, and **never by deleting messages**. Raw history stays; only its context representation
compacts.

**Structured state over prose.** IDs, plan identity, confirmation status, authorization status
and workflow state are columns, never sentences inside a summary.

**Large results by reference.** Tool results go to a result store and are referenced by
`result_id` with a summary and a page. Ten thousand records never enter a prompt.

### Deferred — the orchestration layer

> **Superseded by ADR-0012 (2026-09-19).** Both of this section's own revisit triggers fired:
> organisational accounts became real, and the agency brief's canonical request is an ordered
> multi-step plan. What it says about persistence, plan hashes and structured tool calls is
> exactly what ADR-0012 builds on.

**No DAG planner, no multi-step command orchestration, no risk engine in v1.**

`plan.md` §18 defines sixteen tools, and every one is a single step: `listMyMissions`,
`getPaymentStatus`, `acceptQuote`. A DAG planner over single-step tools is machinery without a
problem, and it would sit on the most security-sensitive path in the product.

What v1 builds instead is what `ai-tool-registry` already specifies: one tool call, validated,
authorized, confirmed if it mutates, executed, audited.

This follows ADR-0005's discipline exactly — do not build the layer, and do not abstract for it
either. What keeps it cheap to add later:

1. Plans are already persisted with `plan_id`, `plan_hash`, status and confirmation state.
   A multi-command plan is more rows, not a new concept.
2. Tool calls are already recorded as structured events, not prose.
3. Confirmation is already bound to an exact plan hash and re-validated before execution.

A DAG is then an ordering over rows that already exist.

### Rejected — multi-tenancy

> **Superseded by ADR-0011 (2026-09-19).** Organisational accounts are now a product
> requirement, which is the condition this section named. Workspaces are real, and isolation is
> enforced by PostgreSQL row-level security *underneath* the six-check procedure, not instead of
> it. The reasoning below is kept as the record of why it was rejected at the time.

The proposal carries `tenant_id` through the session model, memory, context security and
persistence.

**This product has no tenants.** `plan.md` mentions the word zero times. It is a marketplace of
individual customers and independent investigators, isolated by *resource relationship* —
assignment participation — not by organisational boundary.

Adding `tenant_id` everywhere would be speculative schema for an unbuilt B2B model, and worse,
it would imply an isolation guarantee nothing enforces. Isolation here is the six-check
authorization procedure, which is the real control.

If organisational accounts are ever built, that is its own ADR with its own migration.

## The rule that governs all of it

```
Summary → AI understanding → entity ID → authoritative database state → decide
```

Never:

```
Summary → assume still true → mutate
```

A summary saying "the assignment is with Investigator A" is a conversational artefact. Before
anything depends on it, the assignment is read from the database. Availability, permissions,
assignment, status, financial and workflow state are **always** refreshed before a decision —
they are exactly the fields that change while a conversation is idle.

Compaction never carries authorization. A summary saying "user is staff" grants nothing; the
authorization service decides, every time, independently.

## Consequences

**Accepted:** a real persistence layer for conversation before the assistant ships · the
Context Builder is a genuine service with its own tests, not a prompt template · summaries are
versioned and reproducible, which costs storage.

**Gained:** conversations survive restarts, crashes and long-running jobs · the window stops
being the application's memory · confirmation survives a browser close and is re-validated
before execution · compaction cannot leak, because permissions are applied at build time ·
adding orchestration later is additive.

**Not gained, deliberately:** multi-step autonomous planning, cross-tenant isolation, a risk
engine beyond the mission policy screening `plan.md` §10 already specifies.

## Revisit when

- Tools appear that genuinely require ordered multi-step execution with dependencies —
  then the DAG layer is specified on evidence rather than anticipation
- Organisational accounts become a product requirement, making tenancy real
- Autonomous background agents are built; the harness contract in the skill already assumes
  they use the same authorization and confirmation path as an interactive user
