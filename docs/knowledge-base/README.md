# Knowledge base

The retrieval source for the AI Assistant. Everything here is ingested into
`knowledge_documents` / `knowledge_chunks` and served through permission-aware RAG.

Authoring rules: `.claude/skills/documentation-first/SKILL.md`.

## Non-negotiable

1. **Every file has frontmatter.** Ingestion rejects files without it.
2. **`visibility` is enforced at query time**, not by folder. The folder organizes; the
   frontmatter authorizes.
3. **No structured business data here.** Investigators, locations, specialties,
   availability, services and pricing live in PostgreSQL and are reached through discovery
   tools. A roster in markdown is stale on the next profile edit — and will be read to a
   customer as fact. See `.claude/skills/investigator-discovery/SKILL.md`.
4. **Documents explain rules, never values**, when the database owns the values.
5. **Supersede, do not silently overwrite.** A customer may have acted on the old text.

## Audiences and visibility

| Folder | `audience` | Typical `visibility` |
|---|---|---|
| `customer/` | customer | `authenticated` |
| `investigator/` | investigator | `authenticated` |
| `staff/` | staff | `staff` |
| `policies/` | public | `public` |

`docs/operations/` is **never** ingested. A runbook reaching a customer is an incident.

## Locales

One file per locale, sharing an `id`, differing in `locale`. Retrieval prefers the user's
locale and falls back to `en` — the fallback is reported, never silent.
