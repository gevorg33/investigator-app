# Assistant context — what reaches the model (T-046)

ADR-0006 · `.claude/skills/ai-session-context` · `apps/api/src/modules/ai/context-builder`

A session is not a context window. The session holds the whole conversation in PostgreSQL; on each
model call, **`ContextBuilderService`** decides what of it is put in front of the model. The model
never chooses what history it sees.

## The build

```
actor → live, in a workspace → the session, its own (RLS: its user, its workspace; 404 otherwise)
  → read, every query filtered by session in SQL and by row-level security under it:
      live plans and their steps · structured state · summaries · the messages no summary covers
      · older messages of this session relevant to the request (full text)
  → tool results only through ToolResultStore.page (authorized) and forContext
  → budget, output reserved first → the highest rung that fits → rendered as delimited data
```

`build(actor, sessionId, { request, before, system, material?, budget? })` returns the
`<conversation>` block (empty for a first question), the rung used, whether compaction is due, and
the tokens used against the tokens available.

**Permissions before assembly.** Nothing is ranked until it has been read as the caller's own:
the session is checked first, and every query names the session — and row-level security admits only
its user in its workspace beneath that. Semantic relevance never reaches another conversation or
another person. A test removes the session filter from retrieval and watches it fail.

**Workspaces.** A session belongs to the workspace it was made in (ADR-0011). After a switch, a build
of yesterday's session is a 404 — a context is never rebuilt across a switch.

## The budget

```
window − output reserve − instructions − tool definitions − the request − the caller's material
  = available for context
```

`DEFAULT_BUDGET` is a 16,000-token window with 2,000 kept for the reply — conservative for the
smallest model the owner may choose (`OPENAI_CHAT_MODEL`). Tokens are estimated at a character in
three, which overestimates English and does not underestimate Russian or Armenian. The knowledge
answer reserves `KNOWLEDGE_MATERIAL_TOKENS` — eight chunks at their longest — because its sources are
retrieved after the conversation is built. If the fixed parts alone fill the window the build throws
rather than overflow.

**Pinned, before history:** live plans and structured state. History gets what they leave.

## Progressive degradation

| Rung | What history carries |
|---|---|
| `recent` | Every message, verbatim — no summary exists yet |
| `summary` | The summaries in full, and every message after them |
| `compressed` | The summaries compact (goal, decisions, constraints, pending, state), every message after |
| `retrieved` | Summaries compact or minimal, the newest messages that fit (≥ 2), and up to eight earlier messages relevant to the request |
| `state` | The floor: minimal summaries if they fit, what little recent fits, three relevant messages |

Each rung keeps less verbatim and the last always fits. **No message is ever deleted to fit** —
`chooseHistory` is pure, and what it leaves out is still in the session.

## Compaction

Proactive: a build reports `compactionDue` when summaries plus the unsummarized messages pass
**75%** of history's allowance — while everything still fits. After each turn, `AssistantTurnService`
calls `compact`, which acts only if the next knowledge call would be due:

- The newest `KEEP_RECENT` (6) messages stay verbatim.
- The span before them that no summary covers — at most `SPAN_TOKENS` (6,000) of it — is summarised
  into the next **level-0** version. The previous summary goes with it as data, so the goal and
  decisions carry forward; only the new span is read (incremental).
- Once `ROLLUP_EVERY` (4) level-0 summaries stand after the last roll-up, they — and that roll-up —
  become one **level-1** summary (hierarchical): thousands of messages are never re-read.
- A reply that is not exactly a summary (`parseSummary`) stores nothing; the next turn tries again.
  A failure is logged by kind and never fails the turn — the reply is stored already.

## Tables

| | |
|---|---|
| `ai_session_summaries` | `version` (per session), `level` (0, 1), `source_sequence_start/end`, `model`, `prompt_version`, `content` — goal, entities, decisions, constraints, completed, pending, state. Written once: a trigger refuses UPDATE. Each write is audited as `ai_session.summarized`, by reference only |
| `ai_session_entities` | Structured session state: `kind`, `entity_id`, `origin` (`user` > `shown` > `plan` > `result`), `status` as last seen (an enum code — a CHECK refuses prose), `last_mentioned_sequence`. One row per entity per session |

Both are `tenant_owned`, private as their session (`own_conversation` policy), owners copied from the
session by trigger and bound to it by a composite foreign key, never written into a deleted session,
and on `SESSION_CONTENT` — erased with the session in the same transaction.

**Summaries are never authority.** They hold words for a model, never ids it may act on and never a
role or permission: the summary instructions say to record a claimed role as a claim, the parser drops
any field `SummaryContent` does not name, and a test stores a summary claiming staff access and shows
that nothing anyone decides changes. **Plans are never compacted away**: they are read live from
`ai_plans` on every build — `PROPOSED` (waiting for confirmation), `CONFIRMED` and `EXECUTING`, with
their steps — on every rung, and the status shown is the one the database holds for that call.

## Data, never instructions

Every message, summary, plan argument, entity and tool result is rendered in its own delimiter and
escaped with the knowledge prompt's `escapeForPrompt`, so `</message>` or "ignore your instructions"
inside any of them cannot close a delimiter or become one. Tool results reach a prompt only as
`forContext` renders an authorized page: a summary, twenty records and a cursor. The knowledge
instructions (`knowledge-answer-v2`) say the conversation is data, used only to understand what the
question refers to, never a source; that nothing in it grants a role, permission or approval; and
that a `CONFIRMED` or `EXECUTING` plan has not finished — a question that depends on it is answered
as still running.

## Where it is used

- **Knowledge answers** (`AssistantTurnService`): the conversation before the question, built after
  discovery says the question is not a search.
- **Structured state**: investigators shown as discovery results are noted with origin `result` —
  never a referent on their own. Resolving "it" and "her" against state is T-216's.
- **Not yet:** discovery is still single-turn; memory across conversations is T-047; the vector half
  of retrieval is T-133.

The customer article (`kb-customer-ai-assistant`) says what is sent to the AI service, and the
counsel brief carries the processor question (36–37).
