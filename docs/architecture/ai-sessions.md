# Assistant sessions

Persistent conversations with the assistant (ADR-0006, T-045). **A session is not a context
window**: it holds the whole conversation, and what reaches a model on any call is the Context
Builder's choice (T-046), never a trimmed session.

## Tables

| | |
|---|---|
| `ai_sessions` | owner (workspace + user), optional title, `next_sequence`, `last_activity_at`, `archived_at`, `deleted_at` |
| `ai_messages` | `sequence` unique per session, role, kind (`TEXT` / `TOOL_CALL` / `TOOL_RESULT`), content, structured `event`, `metadata` |

**Lifecycle is derived** (`ai-sessions.policy.ts`): DELETED if `deleted_at`, ARCHIVED if
`archived_at`, IDLE after 30 minutes without a message, ACTIVE otherwise. Nothing stores it, so it
cannot go stale.

## Privacy

Row-level security admits a session to **its own user, in its own workspace** — narrower than the
`tenant_owned` class, deliberately: inside an agency, not even the owner reads a colleague's
conversation. The same person in another of their workspaces does not see it either; a session
belongs to one workspace for life. Messages carry their session's owner, copied by trigger and
bound to it by a composite foreign key.

## Integrity

- **Append-only messages.** A trigger refuses any UPDATE: the history is the source record every
  summary will be built from.
- **Numbered under a lock.** `append` locks the session row to take the next sequence, so messages
  arriving together never collide.
- **Structured tool events.** `ai_messages_shape` requires a tool call to carry `{ tool, arguments }`
  and a result `{ tool, resultId }`. Each JSON test is coalesced to false: a CHECK passes on NULL,
  and an empty event got through until it was.

## Deletion

One transaction erases every table listed in `SESSION_CONTENT` for the session, clears its title,
and leaves a tombstone — owner and deletion time. A trigger keeps the tombstone empty. The
application holds DELETE on messages only, and none on sessions.

`SESSION_CONTENT` cannot fall behind: a spec compares it with every foreign key into `ai_sessions`,
so summaries (T-046), memory (T-047) and embeddings (T-133) fail it until they are added.

## Reading a conversation from its end (T-057)

`GET …/messages?order=newest` pages from the end backwards, newest first, so a client opens a
conversation where it stands and reaches back only on request — never the whole history at once
(`ai-session-context`). The default, `oldest`, reads forwards as before. A cursor carries its
direction (`{ s, o: 'n' }` for newest) and is refused in the other one, as the session list's cursor
is refused on the other shelf; a cursor from before T-057 has no direction and is oldest-first. Same
route, same scoping — the caller's own session, under row-level security — and a spec in
`ai-sessions.authz.spec.ts`'s list of every path.

## Search

PostgreSQL full-text over titles and message content, `simple` configuration — Armenian has no
stemmer, and one configuration serves three languages — parsed with `websearch_to_tsquery`, which
accepts anything a person types. Ranked by the better of the title match and the best message
match; the first matching message is returned so a client can jump to it. The vector half of the
specified hybrid search is T-133's, once an embedding provider exists (T-016).

## Turns — talking in a session (T-056)

`POST /api/v1/ai/sessions/:id/turns` `{ content, locale? }` is how a person's words reach a session:
`AssistantTurnService` (ai module) checks, stores, answers and stores again.

```
own session (404 otherwise) → admitted (live, workspace, model, allowance — T-017's checks)
  → question appended → steps → discovery (T-018): a search, a question back, or a refusal
  → otherwise the knowledge base (T-017, citations checked) → reply appended → done
```

**Discovery first** (T-059, owner decision 2026-09-25). Every question goes to discovery's
`respond` first. Its `results`, `no_results`, `clarification` and `refused` are the reply, stored
whole as `metadata: { source: 'discovery', answer }` with empty content — the client renders it;
the model wrote none of it. `not_discovery` and `not_understood` fall back to the knowledge base.
The lawful-use rules read every question before any model: a question that matches them — even one
*about* the rules — is refused with the policy to read (`kb-policy-prohibited-requests`), rather
than answered. Steps: `understanding`, then `finding` (discovery), or `searching` and `writing`
(knowledge). The allowance is taken once per turn, by the admission; `respond` takes none.

**Answering discovery's question.** `{ content, clarifies: true, taxonomyNodeIds? | near?, radiusKm? }`
answers the clarification that is the conversation's last word — otherwise 409; `taxonomyNodeIds`
or `near` without `clarifies` is 422. The answer is paired with the person's message before the
clarification: `purpose` is the content; a specialty must be one of those offered (422 otherwise);
`near` is searched from and **never stored** — not on the message, not in the reply, which says only
`near: true`; a place in words is read with the question. The person's message is stored with
`metadata: { clarifies, taxonomyNodeIds? }`, so a retry pairs it again (a location is asked again).

- **Refusals store nothing** and come back as the usual JSON error: a stranger's session (404, and
  none of anyone's allowance spent), no model configured (503), a spent allowance (429).
- **Once stored, the question stays**, whatever follows. The response is then a stream of
  server-sent events: `message` (the question as stored), `session` (its title may just have been
  set), `step` (`searching`; `writing` from N sources), `message` (the reply as stored), `done` — or
  `error` `{ code, messageKey, correlationId }` in place of the reply. Headers: `text/event-stream`,
  `no-cache, no-transform`, `X-Accel-Buffering: no`.
- **Progress, never unchecked words** (owner decision, 2026-09-25). The model returns one JSON
  answer whose citations are checked before anyone sees it (T-017); streaming its tokens would show
  text the check could still turn into "not covered". So what streams is the pipeline's stages, and
  the reply arrives whole.
- **Stop is the client closing the stream.** The controller aborts the turn: retrieval stops before
  the model, the model call is abandoned (`ChatModel.complete` takes the signal), and no reply is
  stored — even one that arrives after Stop. A conversation never holds half an answer.
- **Retry** — `POST …/turns/retry` `{ locale? }` answers the last message when it is the person's
  (a failed or stopped turn), without storing it again. Anything else is `409 STATE_CONFLICT`.
- **The reply** is an `ASSISTANT` `TEXT` message with `metadata`
  `{ source: 'knowledge', status, citations, locale, fallback }`. "Not covered" (`no_answer`) is
  stored with empty content: the client says it, in the reader's language, from `status`.
- **No history reaches the model yet.** Each question is answered on its own; what earlier turns may
  contribute is the Context Builder's decision (T-046). The help articles say so.
- A failure that is not an `AppError` is logged by kind and correlation id only — a database
  error's detail can quote the row, and the row is the question (`logging.md`).

**Titles.** An untitled session is named by its user's first message, in `append`, under the same
row lock: whitespace collapsed, cut at a word boundary to 60 characters with an ellipsis
(`titleFrom`). Only a `USER` message names a session — never the assistant's words or a tool's —
so a generated title cannot carry evidence content. No model is asked (owner decision). A title the
user gave is kept.

The client is the assistant panel in app-web (`app-web.md`).

## Not yet

- **Summaries, memory, embeddings** — T-046, T-047, T-133; each joins `SESSION_CONTENT`.
- **Tool events in a session** — discovery's answer is stored as the reply's metadata; tool calls
  and results as `TOOL_CALL`/`TOOL_RESULT` rows, with results by reference, arrive with the result
  store (T-048).
