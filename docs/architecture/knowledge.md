# Knowledge ingestion

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
  every chunk for retrieval (T-017) to filter on in every query, and T-017 carries the test that a
  customer cannot reach staff content.
- A chunk's visibility, locale and tenant are **copied from its document** by trigger, whatever the
  insert says. A writer cannot widen who sees an answer.
- Only a current document has chunks. A document cannot stop being current while it still has
  chunks, and never returns to current.
- A chunk's text never changes. Only its embedding arrives later.
- A document's `source_path` is under `docs/knowledge-base/`. Nothing from `docs/operations/` gets
  in by any route.
- There is one current version per `id` and locale.

## Where it runs

- **CI** (`pr.yml`, after Build): twice against the database migrated from empty, as the runtime
  role. The second run must report no changes.
- **Deploys**: after migrating, before serving. This is a placeholder until T-040 (staging) and
  T-041 (production).
