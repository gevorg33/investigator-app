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

## Search

PostgreSQL full-text over titles and message content, `simple` configuration — Armenian has no
stemmer, and one configuration serves three languages — parsed with `websearch_to_tsquery`, which
accepts anything a person types. Ranked by the better of the title match and the best message
match; the first matching message is returned so a client can jump to it. The vector half of the
specified hybrid search is T-133's, once an embedding provider exists (T-016).

## Not yet

- **Title generation** — T-056. Titles today are only what the user typed; a generated one must
  never carry evidence content.
- **Summaries, memory, embeddings** — T-046, T-047, T-133; each joins `SESSION_CONTENT`.
- **A route to post messages** — the assistant appends (T-056); `append` is a service method.
