---
name: investigator-discovery
description: How the AI Assistant finds and recommends investigators — structured tools over SQL and PostGIS rather than RAG, match explanation from real criteria, and the clarification policy. Use when implementing AI discovery capabilities, match explanations, or any assistant feature that answers "who can help me".
---

# Investigator discovery

The Assistant must be able to find investigators by location, distance, specialty,
service, availability and language, and explain why each one matches.

**None of this is RAG.** Every fact in that list is a column in PostgreSQL.

## Why not RAG

Embedding investigator profiles and retrieving them by similarity fails in four ways that
all reach the customer:

1. **Approximate answers to exact questions.** "Who speaks Armenian?" has a correct answer.
   Similarity gives a plausible one.
2. **Stale.** An embedding reflects the profile when it was embedded. Availability changes
   hourly.
3. **Unenforceable eligibility.** A suspended or unverified investigator whose profile text
   matches well will surface. Verification status is not negotiable by cosine distance.
4. **No distance.** "Nearest" is `ST_DWithin` and `ST_Distance`. A vector index does not
   know kilometres.

Semantic similarity has exactly one legitimate role here: **ranking** free-text fit
("someone experienced with corporate due diligence") *within* an already-eligible,
already-filtered set. It never adds a result. See `permission-aware-rag` and
`postgis-search`.

## Routing

Classify the question before answering it:

```
Customer question
  ├── Knowledge      "How do quotes work?"          → RAG over knowledge-base
  ├── Discovery      "Who works near Yerevan?"      → structured tool (SQL + PostGIS)
  ├── Own records    "What's my mission status?"    → structured tool, actor-scoped
  └── Mixed          "Can someone in Gyumri do X,
                      and how much will it cost?"   → tool for who, RAG for how
```

Answering a discovery question from documentation is the failure mode this skill exists to
prevent.

## Tools

Registered per `ai-tool-registry`. All read-only, all actor-scoped, all returning
projections.

| Tool | Purpose |
|---|---|
| `searchInvestigators` | Filters + optional location, returns ranked eligible matches |
| `getInvestigatorProfile` | Public projection of one profile |
| `listSpecialties` / `listServices` | The controlled vocabularies, for building a query |
| `checkAvailability` | Current availability for a specific investigator and window |

`searchInvestigators` input is a closed set of typed filters — never a free-text string
that reaches a query:

```ts
{
  location?: { lat: number; lon: number; radiusMeters: number }
       | { countryCode: string; region?: string; city?: string },
  specialtyIds?: string[],
  serviceIds?: string[],
  languages?: Array<'en' | 'ru' | 'hy'>,
  availableFrom?: string,
  relevanceHint?: string,   // free text: ranking only, never filtering
  limit: number,            // bounded
  cursor?: string,
}
```

`relevanceHint` is the only free-text field and it can only reorder results that already
passed every hard filter.

## Pipeline

```
hard filters      country / city / specialty / service / language / availability
  → eligibility   verified, not suspended, accepting work, has capacity
  → geography     ST_DWithin against service area; ST_Distance sorts
  → relevance     optional semantic rank over the surviving set
  → quality       rating, response time, completion rate
  → projection    public fields only
```

Each stage narrows or reorders. No stage adds. An ineligible investigator cannot appear
through any path, including a highly relevant profile description.

## Explaining the match

Requirement: explain *why* an investigator matches. The explanation must be **rendered
from the criteria that actually matched**, never composed by the model from the profile
text — that is how fabricated qualifications reach a customer.

The tool returns the reasons as data:

```json
{
  "investigatorId": "inv_412",
  "distanceMeters": 8400,
  "matchedOn": {
    "specialties": ["corporate-due-diligence"],
    "languages": ["hy", "en"],
    "serviceArea": "Yerevan +50km",
    "availableFrom": "2026-09-15"
  },
  "notMatched": { "services": ["surveillance"] },
  "verificationStatus": "VERIFIED",
  "rating": 4.7,
  "completedAssignments": 34
}
```

The Assistant renders those fields. It may phrase them naturally and in the user's locale.
It may **not** add a reason that is not in `matchedOn`.

Report `notMatched` too. "Matches on specialty and language, but does not offer
surveillance" is a more useful and more honest answer than silence about the gap.

## Never

- Invent an investigator, location, service, availability window, price or policy.
- Return an unverified, suspended or non-accepting investigator.
- Infer a capability from prose ("their bio mentions fraud, so they do fraud work") —
  capabilities are the structured `services` and `specialties` rows.
- Expose a private profile field, contact details, or a home location.
- State a price the investigator has not published. Pricing is a quote, not an estimate
  the Assistant produces.
- Answer "nearest" without real coordinates. If location is unknown, ask.

## Asking for clarification

Ask only when the answer genuinely depends on it. A question per turn, at most.

Ask when: no location is given and the request is location-dependent; the specialty is
ambiguous across categories; the request may be a prohibited category and intent decides.

Do not ask when: a sensible default exists (search the customer's country); the filter is
optional; the answer is the same either way. Returning results with a stated assumption —
"investigators across Armenia; tell me a city to narrow this" — beats an interrogation.

## Prohibited requests

Discovery is a policy surface. A request for help with stalking, unauthorized tracking,
account access or unlawful recording is refused and routed to the deterministic policy
check (plan.md §10) — not quietly answered with a shorter list. The Assistant classifies;
it never decides policy.

## Checklist

- [ ] Discovery routes to a structured tool, never to RAG
- [ ] Filters typed and closed; free text only ranks
- [ ] Eligibility enforced in SQL; no path lets an ineligible result through
- [ ] `ST_DWithin` filters, `ST_Distance` sorts
- [ ] Match explanation rendered from `matchedOn`, not composed from prose
- [ ] `notMatched` surfaced
- [ ] Results are public projections; no private location or contact data
- [ ] Clarification asked only when it changes the answer
- [ ] Prohibited-category requests routed to policy, not answered
