---
name: documentation-first
description: The mandatory documentation rule — every feature, business rule, workflow, API behaviour and AI capability is documented in the same task that implements it, in a form the AI Assistant can retrieve through RAG. Use when completing any task, writing FAQ or knowledge-base content, or changing behaviour that existing documentation describes.
---

# Documentation-first

Documentation is part of the task, not a follow-up to it. A task that changes behaviour
and does not update the documentation describing that behaviour is **incomplete**, even
if its tests pass.

This is not a tidiness rule. The AI Assistant answers customers from this documentation.
Undocumented behaviour is behaviour the Assistant cannot explain; stale documentation is
behaviour it explains **wrongly**, to a customer, with confidence.

## The two kinds of knowledge

The single most important distinction in this system. Getting it wrong produces an
assistant that is confidently, subtly wrong.

| | Prose knowledge | Structured business data |
|---|---|---|
| Examples | FAQs, policies, workflows, limitations, troubleshooting, how pricing works | Investigators, locations, specialties, availability, languages, services, prices |
| Lives in | `docs/knowledge-base/**` | PostgreSQL |
| Retrieved by | RAG (pgvector) | SQL + PostGIS, through an AI tool |
| Answers | "How do quotes work?" | "Who works in Yerevan and speaks Armenian?" |

**Never embed structured business data into the knowledge base.** An investigator roster
in a markdown file is stale the moment someone updates their availability, and it will be
retrieved and read aloud to a customer as fact. See `investigator-discovery`.

The rule that follows from this: when a document describes something the database owns, it
explains **the rule, never the values**.

```markdown
<!-- Right: explains the rule. Stays true. -->
Investigators declare service areas as a point plus a radius, or a drawn region.
Discovery returns only verified investigators whose service area covers the
requested location.

<!-- Wrong: duplicates the database. Stale on the next profile edit. -->
Investigators in Armenia: Ani Petrosyan (Yerevan, 50km), Davit Sargsyan (Gyumri, 30km)
```

## What must be documented

Every one of these, in the task that creates or changes it:

- Product features, workflows and their limitations
- Business rules (eligibility, expiry, fees, cancellation, disputes)
- Authorization rules — who may see and do what
- API behaviour, error semantics, idempotency
- AI Assistant capabilities and their boundaries
- Mission and assignment state transitions and what triggers them
- Troubleshooting and common support scenarios
- Anything a customer or investigator would reasonably ask about

## Where it goes

```
docs/
├── architecture/      ADRs. Internal. Never customer-facing.
├── api/               Internal API supplements.
├── operations/        Runbooks. Internal. NEVER retrievable by a customer.
├── product/           Internal product specs.
├── compliance/        Retention, lawful use, prohibited categories.
└── knowledge-base/    The RAG source.
    ├── customer/      Customer-facing FAQ and guides
    ├── investigator/  Investigator-facing guides
    ├── staff/         Staff procedures (staff scope only)
    └── policies/      Public policy pages
```

Only `knowledge-base/**` and published `compliance/` pages are ingested for retrieval.
An operations runbook reaching a customer is a security incident, not a formatting problem
— which is why visibility is declared in the document itself and enforced at query time
(`permission-aware-rag`).

## RAG-ready format

Every knowledge-base document carries frontmatter. Without it, ingestion rejects the file.

```yaml
---
id: kb-customer-quote-expiry
title: How long a quote stays valid
audience: customer            # customer | investigator | agency | staff | public
visibility: authenticated     # public | authenticated | participant | staff
locale: en                    # en | ru | hy
version: 3
status: current               # current | superseded | draft
supersedes: kb-customer-quote-expiry@2
updated: 2026-09-12
source_of_truth: docs         # docs | database
related_code:
  - apps/api/src/modules/quotes
tags: [quotes, expiry, missions]
---
```

- `visibility` drives the permission filter. Never rely on the folder.
- `source_of_truth: database` means this document explains a rule whose *values* live in
  PostgreSQL. It must not list those values.
- `related_code` is what makes staleness detectable — see below.
- The full contract — required fields, folder-to-visibility rules, what is never ingested — is
  `docs/knowledge-base/README.md`, and the validator enforces it on every pull request (T-015).

## Writing for retrieval

Chunks are retrieved in isolation, without the surrounding document. Write accordingly.

1. **One question per section.** Use the question as the heading, phrased the way a
   customer would ask it: "Can I cancel after paying?" not "Cancellation semantics".
2. **Make each section self-contained.** A chunk saying "this is not permitted in that
   case" is useless alone. Restate the subject.
3. **Short sections.** A section that needs splitting mid-idea to fit a chunk will be
   split badly.
4. **State limits and exceptions explicitly**, in the same section as the rule. A retrieved
   rule without its exception is a wrong answer.
5. **No cross-references as the only content.** "See the pricing page" retrieves nothing.
6. **Write the answer, not a pointer to it.**

## Superseding, never silently editing

When a rule changes, the old documentation does not just get overwritten — customers may
have acted on it, and a dispute may turn on what it said.

- Set the old document `status: superseded`, and point the new one at it via `supersedes`.
- Superseded documents are excluded from retrieval but retained.
- Two `current` documents that contradict each other are a **conflict**: ingestion flags it
  rather than picking one. Resolution is a human decision: edit a document, or — when both are
  meant to answer and agree — record the pair in `docs/knowledge-base/overlaps-reviewed.yml`,
  bound to the versions read. The same discipline as `evidence-integrity`.

## Keeping RAG synchronized

Documentation that is not ingested is not knowledge.

1. Ingestion is keyed on content hash: `pnpm --filter api knowledge:sync` (T-016) re-chunks a
   changed file and re-embeds only chunks whose text or embedding model changed, idempotent on
   `(chunk content hash, model, model version)`. CI runs it on every pull request with
   `--fail-on-conflict`; `docs/architecture/knowledge.md` has the details.
2. Deleting or superseding a document deletes or re-scopes its chunks **in the same unit
   of work**. A stale chunk pointing at withdrawn guidance is a wrong answer waiting for a
   query.
3. A staleness check (`knowledge:sync --staleness`) compares each document's `related_code`
   paths against their last change. Code that moved after its documentation flags the document
   for review. This is a report for a human, not an automatic edit.
4. Narrowing a document's `visibility` re-scopes its chunks immediately.

## Verification — run before marking any task DONE

- [ ] Is the functionality documented?
- [ ] Is the relevant FAQ / knowledge-base content updated?
- [ ] Can the Assistant actually retrieve it — ingested, correct `visibility`, sensible chunks?
- [ ] If it involves investigators, locations, services or availability: is that data
      **structured in PostgreSQL**, not written into prose?
- [ ] Are outdated or conflicting entries superseded or removed?
- [ ] Do the code, the structured data, the documentation and the retrieval index all agree?

The last one is the point. Documentation, structured data, RAG retrieval and application
behaviour evolve together, in one task, or they diverge permanently.
