# Inside an assignment

The investigator's working records, per plan.md §8: sources (T-031), notes and tasks (T-032),
documents and evidence promotion (T-033). All are **assignment-scoped** — never a catalogue shared
across assignments — authorized on assignment participation, audited, and kept rather than deleted.

The investigation-intelligence layer (entities, relationships, confidence, contradictions) is
deferred by ADR-0005. Nothing here grows toward it.

## Sources (T-031)

`investigation_sources` — where information came from, distinct from the evidence obtained from it.

| | |
|---|---|
| Type | `PUBLIC_RECORD` · `REGISTRY` · `WEBSITE` · `WITNESS` · `DOCUMENT` · `OBSERVATION` · `OTHER` |
| Reliability | `HIGH` · `MEDIUM` · `LOW` · `UNKNOWN` (default); any judgement needs a rationale — service and check constraint |
| Locator | a URL or reference, recorded and **never fetched** — the module holds no HTTP client, and a spec keeps it that way |
| Sharing | `shared`, default false; see below |
| Lifecycle | recorded and corrected while the assignment is `ACCEPTED`, `IN_PROGRESS` or `REPORT_SUBMITTED`; **withdrawn**, never deleted; a withdrawal is final |

**Reliability is a property of the source**, not assertion-level confidence (ADR-0005): a reliable
register can still carry a wrong claim, and how sure anyone is of a statement belongs to the
finding that makes it.

### Who sees what

| | Investigator's workspace (supplier) | Customer's workspace | Anyone else |
|---|---|---|---|
| Read | every live source | shared, unwithdrawn sources | nothing — 404 |
| Write | the assignment's investigator, in a live state | nothing | nothing |

Row-level security holds this on its own. Unlike the other two-party tables, the policy is
asymmetric: `supplier_works` (all commands, supplier workspace) and `customer_reads_shared`
(SELECT, customer workspace, `shared AND withdrawn_at IS NULL`). The customer's view is decided
there and **only** there — a filter in the service that repeated it could never be observed by a
test, so it was removed. DELETE is not granted.

Private by default because a source can name a third party. A witness's identity reaches the
customer only if the investigator decides (owner decision, 2026-09-23).

### Integrity

Triggers copy both workspaces from the assignment and forbid changing them; a source stays on its
assignment and with the person who recorded it; `withdrawn_at` cannot be cleared. Writes share-lock
the assignment, so a source cannot be added in the instant the assignment completes.

Audit entries say the source's type and which fields changed, **never** a title or locator — those
can name a person (`audit-logging`).

### Not yet

- **`EvidenceItem.source_id`** — nullable, added with the evidence table itself (T-116).
- **Agency staffing** — inside an agency, access follows assignment staffing once T-089 lands.
- **Dispute review** — staff reading sources during a dispute is T-118's, through PlatformContext.
