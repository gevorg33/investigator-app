# Compliance documentation

## Authority

The published legal documents are the authority. Everything else — knowledge-base articles,
in-app copy, support answers, assistant responses — explains them and defers to them.

Where a summary and the legal text differ, the legal text governs. Summaries say so.

## Status of the drafts in this directory

Files named `*.draft.*` are **structured drafts prepared for legal review. They are not
legal advice and must not be published or presented to users in their current form.**

They exist to give counsel the platform-specific facts up front — what data is held, who can
see it, how money moves, how evidence is handled — so that drafting starts from the actual
product rather than from a questionnaire.

Counsel review is a blocking prerequisite for launch, not a formality. See
`counsel-brief.md` for the questions that must be answered before drafting can finish.

## Who owns what

| Artifact | Owner |
|---|---|
| Legal document substance | Compliance owner + counsel |
| Version, effective date, materiality flag | Compliance owner |
| Consent mechanism, storage, gating | Engineering (`legal-consent` skill) |
| Plain-language summaries | `docs-writer`, deferring to the legal text |

Per `.claude/agents/docs-writer.md`: engineering changes the plumbing of legal pages, never
their substance.

## Document set

| Document | Scope |
|---|---|
| Terms of Service | The user's relationship with the platform — account, conduct, IP, liability, termination |
| Terms & Conditions | The commercial terms of transactions between users — missions, quotes, assignments, payment, delivery, disputes |
| Privacy Policy | What personal data is processed, why, on what basis, shared with whom, kept how long, and the rights available |
| Lawful Use Policy | Prohibited activities and the consequences of attempting them |

ToS and T&C overlap in common usage. The split used here is deliberate: ToS governs
platform–user, T&C governs user–user commerce that the platform facilitates. If counsel
prefers a single combined instrument, that is their call.

## Localisation

Documents are published in `en`, `ru` and `hy`. **One locale per version must be designated
authoritative**, and every consent record stores which locale the user was actually shown.
Which locale is authoritative is a legal decision, not a product one — see the brief.
