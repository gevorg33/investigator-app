# Knowledge ingestion and retrieval

The knowledge base in `docs/knowledge-base/` is the Assistant's source for prose knowledge
(CLAUDE.md non-negotiables 6 and 7). T-016 copies it into PostgreSQL so retrieval (T-017) can search
it. The repository is authoritative; the tables are derived data that the sync rebuilds.

Module: `apps/api/src/modules/knowledge/`. Migration: `0021_add_knowledge`.

## Tables

| | |
|---|---|
| `knowledge_documents` | one row per `id` × `locale` × `version`: status (`current` / `superseded` / `removed`), audience, visibility, source path, `related_code`, `updated`, the file's content hash |
| `knowledge_chunks` | one per `## ` question of a current document (long answers split at paragraph boundaries): heading, content, content hash, visibility and locale copied from the document, `embedding vector(1536)` with its model and version, a `simple` tsvector |
| `knowledge_conflicts` | a pair of current documents that may answer the same question for the same readers: reason, subject, `open` / `resolved` |

`tenant_id` is NULL for the platform knowledge base. An agency's own documents (T-097) carry their
workspace.

## The sync

`pnpm --filter api knowledge:sync [--fail-on-conflict] [--staleness] [--root <repo>]` makes the
tables match the files and prints what it did. It runs as the system inside `PlatformContext`
(`knowledge.sync`), which is the only context the tables accept writes from, and records a
`knowledge.synced` audit entry.

- **Idempotent.** A file whose version and hash match what is stored is skipped. A second run
  changes nothing, and CI checks that.
- **Corrections in place.** Same version, new text: the document row is updated and its chunks are
  replaced. A chunk whose text did not change keeps its embedding.
- **Supersession.** A higher version, or `status: superseded` in the file, retires the old row and
  deletes its chunks **in the same transaction**. Retrieval never sees withdrawn guidance. The old
  document row is kept as a record.
- **Removal.** A file that is gone marks its document `removed` and deletes its chunks the same way.
- **No going back.** A version lower than the one in force is refused. Publish a new version
  instead.
- **Refusals.** A document without frontmatter, with an invalid field, with a visibility that does
  not belong in its folder, with no answer in it, or carrying the `not-for-ingestion` marker is
  refused and nothing is written. Symlinks are refused. `README.md` and drafts are skipped.

## Embeddings

Keyed on `(chunk content hash, model, version)`. `version` is `input-v1/1536d`: what the vector was
made from and how wide it is. Changing the model, the input format (`EMBEDDING_INPUT_REVISION`) or
the width re-embeds everything. The adapter is `OpenAiEmbedder`, which calls the embeddings endpoint
with `fetch`. It reports failures by HTTP status only, because an error body can echo the request.

Without `OPENAI_API_KEY` the sync still ingests every document: the chunks are searchable by text
and their embeddings stay **pending** until a key exists (ACTIONS-FOR-ME #6). A pending chunk has
all four embedding columns NULL. A CHECK refuses a vector that does not say which model made it.

## Conflicts

Whether two answers contradict each other cannot be decided mechanically, so detection
**over-flags** and never ranks (`evidence-integrity`). A pair is flagged when two current documents
in the same locale, for the same audience (or where one is public):

- ask the **same question**: headings equal after case, spacing and trailing punctuation are
  normalised, or
- give **near-duplicate answers**: cosine similarity ≥ 0.95 between embedded chunks.

A person resolves a conflict by editing a document; the next sync marks it `resolved`. If both
documents are meant to answer the question and agree, record that in
`docs/knowledge-base/overlaps-reviewed.yml`:

```yaml
- subject: what personal data do you hold about me
  documents: [kb-customer-privacy-data@2, kb-policy-privacy-summary@1]
  by: <who read both>
```

A review is **bound to the versions it names**. When either document gets a new version, the
overlap is flagged again, because the text that was reviewed is no longer the text that is served.
`--fail-on-conflict` exits 1 on any open, unreviewed conflict. CI runs with it.

## Staleness

`--staleness` reports each current document whose `related_code` changed, according to git, after
the document's `updated` date. It also reports a path that does not exist, but only for documents
that say they are `partial` or `implemented`. A `specified` document points at code that is still to
be built. This is a report for a person and never fails a build: code can change without changing
what a document says, and only someone reading both can tell.

## Rules the database holds

The sync is not trusted to get these right. Each is enforced in the migration and tested without
the sync:

- Only the sync writes. RLS admits writes only under `app_platform_access()`, and the application
  role has no DELETE on documents or conflicts.
- Any context reads the platform's rows. **Visibility is not enforced by RLS.** It is stored on
  every chunk, and retrieval enforces it (below).
- A chunk's visibility, locale and tenant are **copied from its document** by trigger, whatever the
  insert says. A writer cannot widen who sees an answer.
- Only a current document has chunks. A document cannot stop being current while it still has
  chunks, and never returns to current.
- A chunk's text never changes. Only its embedding arrives later.
- A document's `source_path` is under `docs/knowledge-base/`. Nothing from `docs/operations/` gets
  in by any route.
- There is one current version per `id` and locale.

## Retrieval (T-017)

`KnowledgeRetrievalService.retrieve(reader, question, locale)` in `knowledge-retrieval.service.ts`.

**Who reads what** (`knowledge-reader.ts`). Public guidance goes to everyone. CUSTOMER reads
`customer`, INVESTIGATOR reads `investigator`, STAFF reads `staff`, and an agency workspace adds
`agency`. The roles used are the ones in force, so someone who has narrowed themselves to one role
(`X-Active-Role`) reads as that role. Visibility `authenticated` is open to every caller, `staff` to
STAFF only, and `participant` to nobody yet: a knowledge question names no mission to be a party to.

```
scope (reader, workspace, locale) ─→ lexical leg ─┐
                                   ─→ vector leg  ─┴─ RRF ─→ load by id ─→ mayRead ─→ top 8
```

- **Scope.** Both legs run inside the reader's scope: current documents, the reader's audiences and
  visibilities, the platform's or this workspace's own, in the requested locale, or in English where
  a document has no translation. The legs return ids only.
- **The gate.** Rows are loaded by id and each one passes `mayRead` again before it is returned. The
  scope is a pre-filter and the gate is the authorization. A test replaces the scope with `true` and
  shows that the gate alone keeps staff, participant and investigator content from a customer. The
  scope still matters: without it, hidden sections take the 40 candidate slots, and a test covers
  that as well.
- **Lexical leg.** Each question word is weighted by how rare it is among the chunks this reader may
  see (an IDF computed in SQL, since `ts_rank` has none). A word found in more than half of those
  chunks counts for nothing, which works as a stop-word list in any language. A word in the section's
  heading counts twice, because headings are written the way people ask.
- **Vector leg.** Only vectors made by this embedder's model and version are compared. Chunks below
  cosine 0.3 (provisional, tuned to the model) are not candidates.
- **Fusion.** Reciprocal rank fusion with k = 60. Up to 40 candidates per leg go in, and at most 8
  chunks come out.

Without an embedder, only the lexical leg runs.

## Answering (T-017)

`POST /api/v1/ai/knowledge/answer` with body `{ question, locale? }`, for signed-in callers only.
The response is `{ status: 'answered' | 'no_answer', answer, citations, locale, fallback }`.

1. Checks: the account is active, the request is in a workspace, a model is configured (otherwise
   **503 `SERVICE_UNAVAILABLE`**), and the rate limit allows 60 questions per account per hour.
2. **Locale.** The one asked for, else the user's saved locale, else English. `fallback` is true when
   a cited source is in English because it has no translation.
3. **Nothing retrieved means no model call:** the response is `no_answer`.
4. **Prompt** (`knowledge-answer.prompt.ts`, version `knowledge-answer-v1`). The instructions
   contain behaviour only, never platform facts. Sources are numbered `S1…S8`, and both the sources
   and the question are escaped inside their delimiters, so no text can close them. The model has
   no tools.
5. **Validation.** The reply must be JSON with a non-empty answer that cites at least one source it
   was given. Anything else is `no_answer`, including a reply that cites one source it was **not**
   given, even if its other citations are real.
6. **Audit.** One entry, `assistant.knowledge_answered`, records the outcome, the documents cited
   (`en/kb-…@v`), the model and the prompt version. It never records the question or the answer.
   Request logs record only method and path.
7. A provider failure (`ProviderError`) becomes a 503. Any other error is a 500.

The endpoint is stateless. In a conversation the same answering runs as the fallback of a turn
(T-056, T-059 — `ai-sessions.md`), and the question and answer are kept in the caller's session.

## Opening an article (T-059)

`GET /api/v1/knowledge/documents/:docKey?locale=` — the page a citation links to
(`KnowledgeDocumentsService`). The same gate as retrieval: `mayRead` over the document (current,
an audience and visibility the reader holds, the platform's or this workspace's), then each section
again. The reader's language, or English when it has no current version (`fallback: true`); drafts
are never ingested, so never served. An article the reader may not read is the same 404 as one that
does not exist, and a key that is not shaped like one (`kb-…`) is a 404 before any query. Not
audited: it is the platform's own documentation, not anyone's data. The app renders it at
`/help/[docKey]`, a section at `#` its heading's slug.
Configuration: `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL`, which has no default because choosing the
model is the owner's decision (ACTIONS-FOR-ME #6).

## Where it runs

- **CI** (`pr.yml`, after Build): twice against the database migrated from empty, as the runtime
  role. The second run must report no changes.
- **Deploys**: after migrating, before serving. This is a placeholder until T-040 (staging) and
  T-041 (production).
