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
- **Agency staffing** — inside an agency, access follows assignment staffing once T-089 lands;
  it extends notes and tasks too (shared rows only — a private one stays its author's).
- **Dispute review** — staff reading sources during a dispute is T-118's, through PlatformContext.

## Notes and tasks (T-032)

`investigation_notes` — the investigator's working material; `investigation_tasks` — the work
plan behind the Planning stage. Module `apps/api/src/modules/investigation-workspace`.

| | Notes | Tasks |
|---|---|---|
| Fields | body (1–20,000), visibility | title (1–200), description (≤ 4,000), status, due day, position, visibility |
| Visibility | `PRIVATE` (default) · `SHARED` | the same |
| Written by | `author_id`, fixed | `created_by`, fixed |
| Lifecycle | edited freely while live; soft-deleted, final | the same, plus the status moves below |

Routes, all under `/assignments/:assignmentId`: `GET/POST notes`, `PATCH/DELETE notes/:noteId`;
`GET/POST tasks`, `PATCH/DELETE tasks/:taskId`, `POST tasks/:taskId/transition { to }`. `DELETE` is
a soft delete (204). A blank body or title is a 422 field error
(`error.validation.investigation_workspace.blank`), not the database's CHECK as a 500.

### Who sees what

| | The author / creator | Anyone else in the supplier workspace | Customer's workspace | Anyone else |
|---|---|---|---|---|
| Private | reads and writes | nothing | nothing | nothing — 404 |
| Shared | reads and writes | nothing | reads, until deleted | nothing — 404 |

**Private means the author alone, in the database.** The policies are narrower than sources'
`supplier_works`: `author_works` / `creator_works` admit the supplier workspace **and**
`author_id = app_current_user()` (as `ai_sessions`' `own_conversation`), so no colleague, agency
admin or owner reads a private note through any query. `customer_reads_shared` gives the customer's
workspace `SHARED AND deleted_at IS NULL`, SELECT only. PlatformContext is the one way past —
audited, for retention and dispute review (T-118). As for sources, the service does not repeat the
policy's filter. The specs were seen failing with the policies loosened (ten cases).

`SHARED` means the assignment's parties. Colleagues in an agency are not parties; staffing (T-089)
decides whether assigned staff read shared rows.

Writes need the assignment's investigator (role `INVESTIGATOR`, `investigations.update`) while the
assignment is `ACCEPTED`, `IN_PROGRESS` or `REPORT_SUBMITTED` — the sources rule (owner decision
2026-09-23), kept equal by a spec. Afterwards both parties still read what they could.

### Task status

```
TODO        → IN_PROGRESS · DONE · CANCELLED
IN_PROGRESS → TODO · DONE · CANCELLED
DONE        → TODO        (reopen)
CANCELLED   → TODO        (reopen)
```

`task-transitions.ts` is the map. `keep_investigation_task_record()` holds the same edges in the
database, and `task-transitions.spec.ts` walks every ordered pair against both. A task's edit
shape has no status — the validation pipe refuses one — and a move that is not an edge is a 403,
audited as `authz.denied.investigation_task.transition`.

### Not evidence

Notes carry no checksum, custody or grant, and a spec refuses such columns. Nothing in a note is a
finding; the report is where a conclusion goes, with what it rests on (`evidence-integrity`).

### Audit

`investigation_note.created | updated | visibility_changed | deleted`,
`investigation_task.created | updated | visibility_changed | moved | deleted`. Reasons are field
names, `PRIVATE -> SHARED`, or `TODO -> DONE` — **never** a body, title or description: those name
people. A change of visibility is its own entry, with the actor, even when made with an edit.

### Retention

Neither cascades with the assignment (`ON DELETE RESTRICT`), and the runtime role holds no DELETE.
They follow the assignment's retention rule, enforced by a job (plan.md §8) — not built yet.
