# Agents

This file defines *who does what*. The agent definitions themselves live in
`.claude/agents/`. Procedures live in `.claude/skills/`.

Design rule: **agents specialize, skills encode procedure.** An agent that needs a
procedure loads the skill; it does not re-derive the procedure from scratch, and it does
not silently take over another agent's responsibility.

## Roster

| Agent | Writes code? | Owns |
|---|---|---|
| `planner` | No | Task decomposition, sequencing, acceptance criteria, `TODO.md` |
| `backend-domain` | Yes | NestJS modules, services, controllers, domain rules, state machines |
| `database` | Yes | Schema, migrations, indexes, PostGIS, query performance |
| `mobile` | Yes | Expo app: screens, navigation, forms, offline/query state |
| `admin-web` | Yes | Next.js admin + marketing web |
| `ai-rag` | Yes | AI gateway, tool registry, embeddings, permission-aware retrieval |
| `payments` | Yes | Stripe Connect, webhooks, ledger, fees, payouts, refunds |
| `security-privacy` | Review only | Authorization boundaries, data exposure, retention, threat modeling |
| `qa-reviewer` | Review only | Correctness review, test adequacy, regression risk |
| `infra-devops` | Yes | Docker, Compose, Caddy, CI, monitoring, backups |
| `localization` | Yes | Translation keys, locale plumbing, `en`/`ru`/`hy` parity |
| `docs-writer` | Yes | `docs/`, the RAG knowledge base and FAQ, runbooks, ADRs, OpenAPI |

`security-privacy` and `qa-reviewer` are deliberately **read-only**. They report
findings; the owning agent applies fixes. This keeps review independent of authorship.

## Delegation

The main session is the orchestrator. It does not need a subagent for small, local work.

Delegate when:
- The task needs a genuinely different specialization than the current thread.
- Two independent subtrees can proceed in parallel **on disjoint files**.
- A review must be independent of the author.

Do not delegate when:
- The work is a few files in one module.
- Two agents would edit the same files. Never run concurrent writers on one file.

## Concurrency rule

For the MVP: **one primary implementation agent at a time.** Use additional agents for
review or for isolated, non-overlapping subtrees only. Concurrent edits to the same
NestJS module, the same migration chain, or the same translation catalog are forbidden.

## Approval gates

The following require explicit human approval before an agent proceeds. An agent that
reaches one of these stops and asks; it does not proceed on assumption.

- Authentication or authorization logic
- Evidence, report, or verification-document access rules
- Payment, fee, payout, refund, or ledger logic
- Account suspension or deletion; data-retention rules
- Destructive or non-reversible migrations
- Production deployment or infrastructure change
- Adding an AI tool that mutates business state
- Disabling, weakening, or bypassing any security control
- Anything with legal or compliance consequence

## Handoff contract

When an agent finishes, it reports:

1. Task ID and what changed (files).
2. Validation commands run, and their actual output status.
3. Documentation updated in this task, and whether it is RAG-ingestible.
4. What it did **not** do, and why.
5. Anything it found that is out of scope — as a proposed `TODO.md` entry.
6. Any assumption it made that a human should confirm.

Do not report success on partial work. If a validation step failed, say so with the
output. A task whose documentation was deferred is not complete — see the
`documentation-first` skill.
