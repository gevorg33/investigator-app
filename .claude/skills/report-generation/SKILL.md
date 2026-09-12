---
name: report-generation
description: Building investigation reports — required sections, versioning, evidence citations, marking AI-generated text as unverified, surfacing contradictions and open questions. Use when implementing report drafting, revision, review or export.
---

# Report generation

The report is the deliverable. It must be defensible: a reader should be able to tell what
is established, what is asserted, what is inferred, and what is unknown.

## Required sections

1. Executive summary
2. Scope — what was asked, what was agreed, what was excluded
3. Methodology — what was done, lawfully, and how
4. Findings — each with an assertion class and evidence references
5. Evidence index — every item, with checksum and capture time
6. Timeline — events with dates and evidence references
7. Contradictions — unresolved conflicts, with both positions
8. Limitations — what could not be determined and why
9. Open questions — the `UNKNOWN` set
10. Confidence assessment
11. Attribution — the investigator, their verification status, the date

Sections 7, 8 and 9 are not optional. A report with no limitations section is a report
that overstates itself.

## Composition

The generator **consumes** verified findings, evidence, timeline entries, contradictions
and confidence; it composes them. It never originates a claim.

If a finding has no evidence reference, it does not enter the report — it enters the open
questions. There is no path by which prose invents a fact.

## Assertion classes

Carry `FACT / CLAIM / INFERENCE / HYPOTHESIS / UNKNOWN` from the data model into the
rendered report (see `evidence-integrity`). Render the class; do not flatten everything
into declarative prose.

- `CLAIM` renders with its attribution.
- `INFERENCE` renders with what it rests on.
- `HYPOTHESIS` renders only inside a section explicitly marked as such.

## AI-generated text

Marked `ai_generated: true` and `review_status: UNREVIEWED` in the data model — not only
in the UI. It cannot be exported, sent to a customer, or marked final while unreviewed.

A human investigator reviews and approves, and the approval records who and when. Approval
changes `review_status`; it does not erase `ai_generated`.

The assistant may draft scope, methodology and summary prose. It may **not** originate a
finding, assign a confidence, resolve a contradiction, or make a legal characterization.

## Contradictions

Surface both positions with their sources and the recommended resolving action. Never
average, never silently pick the most recent or most frequent. Resolution is a human
decision, recorded with a reason and the evidence that settled it.

## Versioning

Every revision is a new immutable version with an author, timestamp, change summary and
reason. The customer sees which version they are reading. Superseded versions are retained
— a dispute is about what was said at the time.

Finalization is a distinct, audited transition: investigator signs, report locks, customer
review opens.

## Export

Exports are backend-generated, authorized per request, watermarked with the recipient and
timestamp, short-lived, and audited. No client-side PDF assembly from raw evidence URLs.

## Never

- Present an inference as a fact
- Include an unreferenced finding
- Export unreviewed AI text
- Resolve a contradiction by picking
- Make a legal determination ("this constitutes fraud")
- Omit the limitations section

## Checklist

- [ ] All eleven sections present, including limitations and open questions
- [ ] Every finding cites evidence
- [ ] Assertion classes rendered, not flattened
- [ ] AI text flagged in the data model and blocked from export until reviewed
- [ ] Contradictions shown with both positions
- [ ] Versions immutable; finalization audited
- [ ] Export authorized, watermarked, short-lived, audited
