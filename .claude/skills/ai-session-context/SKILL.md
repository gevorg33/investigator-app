---
name: ai-session-context
description: Sessions, conversation memory, context building and compaction for the AI assistant — the session/context-window distinction, the Context Builder contract, token budgets, summaries, memory layers and stale-state refresh. Use when implementing sessions, messages, summaries, memory, context assembly, or anything that builds a prompt.
---

# AI sessions and context

Decided in `docs/architecture/ADR-0006-ai-session-context.md`.

```
SESSION         persistent conversational workspace — may hold 50,000 messages
CONTEXT WINDOW  temporary working set for one model call
```

**These are different systems.** Conflating them is the mistake this skill exists to prevent:
it produces either a prompt that overflows, or a product that forgets.

## Layers — never conflated

| Layer | Answers | Authority |
|---|---|---|
| Raw history | What was said? | Source record |
| Recent context | What just happened? | Derived |
| Rolling summary | What is this conversation about? | **Context aid only** |
| Structured session state | What are the IDs and statuses? | Derived, but structured |
| Session memory | What matters in this conversation? | Derived |
| User memory | What holds across conversations? | Derived |
| Domain knowledge (RAG) | What does the documentation say? | `permission-aware-rag` |
| **Application state** | **What is true right now?** | **The only authority** |

## The governing rule

```
Summary → AI understanding → entity ID → authoritative database state → decide
```

Never `summary → assume still true → mutate`.

A summary saying "the assignment is with Investigator A" is a conversational artefact. Read
the assignment before anything depends on it.

**Always refresh before a decision:** availability · permissions · assignment · status ·
financial state · account state · workflow and job state. These are exactly the fields that
change while a conversation sits idle.

## Context Builder

One service decides what reaches the model. The model never chooses what history it may see.

Responsibilities: load session, summary and structured state · fetch recent messages · retrieve
relevant historical messages · retrieve session and user memory · run RAG · **apply
permissions** · apply the token budget · rank · deduplicate · compact · assemble.

### Security

Retrieval is authorization-scoped, always. Semantic relevance is not a permission.

- A historical message is retrievable only from a session the actor owns
- RAG runs the vector → load-from-Postgres → authorize → filter order (`permission-aware-rag`)
- Memory is scoped to its owner
- **Compaction never carries authorization.** A summary saying "user is staff" grants nothing;
  the authorization service decides independently, every call

### Token budget

```
model limit − system prompt − tool definitions − output reservation − current request
= available context
```

Allocate what remains across recent messages, summary, memory, retrieved history, RAG and tool
results. **Always reserve output space.** Never fill the window with input.

### Priority when the budget binds

1. Current request
2. Safety and security constraints
3. **Pending confirmation / active plan** — never dropped for being old
4. Current task state
5. Recent relevant conversation
6. Structured session state
7. Session summary
8. User memory
9. Relevant historical messages

## Compaction

Trigger **proactively at ~70–80%** of budget, never at the hard limit.

**Never delete messages to fit.** Raw history is the source record; only its context
representation compacts.

```
recent only → + summary → compress older → retrieve relevant history → structured state + targeted retrieval
```

Graceful degradation, not sudden failure.

### Never summarise away

`user_id` · `assignment_id` · `mission_id` · `plan_id` · `plan_hash` · `confirmation_status` ·
`authorization_status` · `job_id` · `workflow_status` · `pending_action`.

These are **columns**, not sentences. The model reads them from state, never from prose.

An **active plan is never compacted away.** It is persisted independently and reconstructed
into context.

## Summaries

Incremental, not regenerated per message. Update only on meaningful change: a new entity,
decision, constraint, preference, completed or pending action, plan or workflow transition, or
an explicit correction. Casual conversation changes nothing.

Hierarchical for long sessions — summarise spans, then summarise the summaries, so thousands of
messages are never re-read.

Versioned: `summary_version`, model, `source_sequence_start/end`, timestamp. This makes a
summary reproducible and debuggable, and lets a bad one be traced.

Preserve: goal · entities · decisions · constraints · completed actions · pending actions ·
current state.

## Memory

**Selective.** Do not store every sentence. Store what is useful later: a stable preference, a
standing constraint, a decision with consequences.

Every memory carries **provenance** — the session and message it came from, a confidence, and
a timestamp — so "where did this come from?" is answerable and a wrong memory is correctable.

Conflict resolution, strongest first:

```
new explicit instruction > current session state > older session memory > long-term preference
```

And above all of them: **authoritative application state**. Memory never overrides the database,
and never substitutes for authorization.

Session memory and user memory stay separate. Session memory dies with its session; user
memory is cross-session, reviewable and deletable by the user.

## Large tool results

Never dump a result set into context.

```
tool → result store → result_id + summary + top-N + cursor
```

The model then asks for the next page, a filter, or a specific record. A search returning
10,000 rows contributes a summary and twenty records, not 10,000.

## Plans and confirmation

Persisted server-side, independent of any model process: `plan_id`, `plan_hash`, commands,
parameters, status, confirmation status, job ids, results, errors.

This is what makes a confirmation survive a browser close, an app restart, a worker restart and
an LLM failure.

**Before executing a confirmed plan, always re-validate:** re-authorize, check the plan hash,
and re-read resource state. If anything material changed, **invalidate the confirmation and ask
again.** A confirmation is for the plan that was shown, not for a plan that has since drifted.

## Sessions

Lifecycle `ACTIVE → IDLE → ARCHIVED → DELETED`, separate from workflow lifecycle — a session
stays active while a job runs.

Users can create, open, resume, rename, archive, delete and search sessions. Titles may be
generated but must be renameable, and must not expose anything the UI policy would not.

On resume: load metadata, summary, structured state and recent messages — then **resolve
current application state**. Do not assume yesterday's answer still holds.

## Workspaces (ADR-0011)

- **A session belongs to one workspace for life.** Switching workspace opens that workspace's
  sessions; a context is never rebuilt across a switch.
- **Memory scopes:** `platform`, `tenant`, `user_in_tenant` (the default for anything learned in
  a conversation), `user_global` (only preferences the user declared, explicitly marked), and
  `session`.
- A summary never carries a workspace or authority.
- A confirmation from one workspace is invalid in another, because its plan row is not visible
  there.

## Agents are disposable

Never keep workflow state in memory. A crashed worker must be replaceable by another that
reads session, plan, workflow and job state from PostgreSQL and continues.

Autonomous background agents use the **same** authorization, confirmation and audit path as an
interactive user. No separate, quieter road to execution.

## Checklist

- [ ] Nothing critical exists only in a summary
- [ ] Dynamic state refreshed from the database before any decision
- [ ] Context Builder applies permissions before assembly, not after
- [ ] Token budget reserves output space
- [ ] Compaction proactive; no message deleted to fit
- [ ] Active plan and confirmation never compacted away
- [ ] Summaries versioned with their source range
- [ ] Memory has provenance and is user-deletable
- [ ] Large results referenced by id, not inlined
- [ ] Confirmation re-validated and re-authorized before execution
- [ ] All state survives a worker restart
