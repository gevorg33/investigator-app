# Knowledge base

The retrieval source for the AI Assistant. Everything here is ingested into
`knowledge_documents` / `knowledge_chunks` and served through permission-aware RAG.

How to write for retrieval — one question per section, self-contained sections, limits stated
beside the rule — is in `.claude/skills/documentation-first/SKILL.md`. This file is the
**contract**: what a document must carry to be accepted at all. `scripts/validate-knowledge-base.py`
enforces it, and runs on every pull request (T-015).

## Non-negotiable

1. **Every file has frontmatter.** A file without it fails validation, and ingestion rejects it.
2. **`visibility` is enforced at query time**, not by folder. The folder organises; the
   frontmatter authorises — and the validator refuses a visibility that does not belong in its
   folder, so the two cannot disagree.
3. **No structured business data here.** Investigators, locations, specialties,
   availability, services and pricing live in PostgreSQL and are reached through discovery
   tools. A roster in markdown is stale on the next profile edit — and will be read to a
   customer as fact. See `.claude/skills/investigator-discovery/SKILL.md`.
4. **Documents explain rules, never values**, when the database owns the values.
5. **Supersede, do not silently overwrite.** A customer may have acted on the old text.

## Frontmatter

```yaml
---
id: kb-customer-quote-expiry     # shared by every locale of the same document
title: How long a quote stays valid
audience: customer               # customer | investigator | agency | staff | public
visibility: authenticated        # public | authenticated | participant | staff
locale: en                       # en | ru | hy
version: 3                       # required, and not 0, while status is current
status: current                  # current | superseded | draft
supersedes: kb-customer-quote-expiry@2   # optional; see superseding in the skill
updated: 2026-09-12              # YYYY-MM-DD
source_of_truth: docs            # docs | database
implementation_status: specified # optional: specified | partial | implemented — does the product do this yet?
related_code:                    # optional, and how staleness is detected
  - apps/api/src/modules/quotes
tags: [quotes, expiry]           # optional
---
```

**Required:** `id`, `title`, `audience`, `visibility`, `locale`, `version`, `status`, `updated`,
`source_of_truth`. Each enumerated field — including `implementation_status` when present — must
hold one of the values shown. `id` and `locale`
together are unique across the whole knowledge base.

`source_of_truth: database` means the document explains a rule whose *values* live in PostgreSQL.
It must not list those values.

A `draft` is validated but reported, and is not ingested until it is `current`.

## Folders and visibility

| Folder | `audience` | Allowed `visibility` |
|---|---|---|
| `customer/` | customer | `authenticated`, `participant` |
| `investigator/` | investigator | `authenticated`, `participant` |
| `agency/` | agency | `authenticated`, `participant` |
| `staff/` | staff | `staff` |
| `policies/` | public | `public` |

A staff document marked `public` fails validation — that is the case this table exists for.

## What is never ingested

`docs/operations/` — runbooks, escalation and law-enforcement procedure, anything that would be a
map for gaming the platform. A runbook reaching a customer is an incident, so this is held by
construction, not by where a file happens to sit:

- every operations document carries `<!-- not-for-ingestion -->`, and the validator refuses any
  knowledge-base file that does — so copying one in, frontmatter added, fails CI;
- operations documents carry no frontmatter, so without the marker they would still be rejected;
- the knowledge base may contain no symlinks, which is how a file outside it would otherwise be
  pulled in without being copied.

`apps/api/test/knowledge-base-validator.spec.ts` holds all three.

## Headings

At least one `## ` heading per document is in the user's voice: a question ("Can I cancel after
paying?") or a first-person symptom ("I cannot sign in"). Chunks are retrieved alone and matched
against how people ask; a heading like "Cancellation semantics" matches nobody. A document without
one is a warning, and the repository keeps zero warnings.

## Locales

One file per locale, `<name>.<locale>.md`, sharing an `id` and differing in `locale`. Retrieval
prefers the user's locale and falls back to `en` — the fallback is reported, never silent.

Every translation needs its English source: a `ru` or `hy` file whose `id` has no `en` document is
an orphan and fails validation, since it would serve content with no authoritative original.
Missing translations are reported as coverage, not as errors.

## Checking your work

```bash
python3 scripts/validate-knowledge-base.py
```

Zero errors is required to merge. Zero warnings is the standard the repository keeps.
