# Investigator Platform

Global, multilingual private-investigation marketplace. Customers post missions;
verified investigators quote, get assigned, and deliver evidence and reports.

Full specification: `plan.md`. Current work queue: `TODO.md`.

## Core principle

```
AI proposes → Backend validates → Backend authorizes → Human confirms if required → Backend executes → Audit
```

The AI assistant never writes to the database, never generates SQL, never decides
authorization. It calls registered tools; the backend does the rest.

## Non-negotiables

1. **PostgreSQL is the only source of truth.** Search indexes, vector stores, caches,
   and Cloudinary metadata are derived data. Never authorize from derived data.
2. **Private by default.** No permanent public URLs for evidence, reports, verification
   documents, or message attachments. Access is a short-lived, backend-authorized grant.
3. **Authorization is resource-level.** A role check alone is never sufficient — see
   the `authorization` skill.
4. **Lawful use only.** The platform must not enable hacking, spyware, unauthorized
   tracking, account takeover, unlawful recording, stalking, or harassment. Mission
   policy enforcement is deterministic and auditable; AI may classify but never decide.
5. **Never fabricate findings.** AI-generated report or evidence text is marked as
   unverified until a human investigator approves it.
6. **Documentation-first.** Every feature, business rule, workflow, API behaviour and AI
   capability is documented **in the same task that implements it**, in a form the
   Assistant can retrieve through RAG. A task that changes documented behaviour without
   updating its documentation is incomplete. See the `documentation-first` skill.
7. **Source of truth, never hardcoded knowledge.** Business facts live in documentation or
   the database, never baked into prompts or assistant code. Prose knowledge is retrieved
   by RAG; investigators, locations, services, availability and pricing are queried from
   PostgreSQL. The flow is always:
   `Documentation / Database → Retrieval → AI Reasoning → Validated Response`.
8. **Domain model first, UI last.** `Domain Model → Application Capability → UI →
   Visualisation`, never the reverse. Do not design UI against data that does not exist, and
   never create a table to satisfy a visual component. The investigation intelligence layer
   (entities, relationships, confidence, contradictions, graph) is **deferred** — see
   ADR-0005 before proposing any of it.
9. **Reuse before building.** Before creating any component, animation, card, modal,
   navigation element, loading state or effect: search the registries (`@shadcn` →
   `@cult-ui` → `@react-bits`), then check whether an existing project component adapts.
   Build custom only when nothing fits, and record it in the component inventory. See
   `component-discovery`.
10. **Mobile-first, always.** Every web surface is authored for the phone first and expands
    with `min-width` queries — never desktop shrunk down. **The responsive web app is the only
    phone experience this product has** (ADR-0009). Adapt the interaction, not just the layout:
    tables become card lists, modals become sheets. Feature parity is required; visual parity
    is not. No horizontal page scroll, tap targets ≥ 44px, every hover affordance has a tap
    path. See `responsive-design`.
11. **One visual language, and as little of it as possible.** Every adopted component is
    re-tokenised before merge — no raw colours, spacing, radii or durations in feature code.
    Before adding any control, field, step or setting, apply the subtraction test: can it be
    removed, defaulted, or inferred? The application prioritises
    `clarity > performance > usability > visual effect`; marketing may be expressive but never
    at the cost of Core Web Vitals, accessibility or mobile performance. Nothing ships because
    it looks impressive. See `interaction-design` and `design-system`.
12. **Nothing ships untested, and nothing ships unverified.** Every feature, fix, endpoint,
    service, database operation, AI workflow and business rule carries automated tests.
    **100% coverage is a blocking CI gate**, per package — but coverage is the floor, not the
    bar: a test that touches a line without asserting on its effect fails review regardless of
    the number. Every bug fix carries a regression test seen to fail first. Never weaken, skip
    or disable a test to get green. See `testing` and `ci-cd`.
13. **The mobile companion is deferred** (ADR-0009) — surveillance is in scope, which
    conflicts with Play's monitoring policy. Do not start mobile work; the phone experience is
    the responsive web app. If scope ever narrows and mobile resumes, `mobile-store-compliance`
    holds the requirements and ADR-0009 holds the reasoning.
14. **A session is not a context window.** Conversations persist in PostgreSQL and may be
    effectively unlimited; the model's window is a temporary working set that the Context
    Builder fills under a token budget. Never delete messages to fit. Never let critical
    state — ids, plan hash, confirmation or authorization status — exist only inside a
    summary. **Always refresh dynamic state from the database before a decision**, and
    re-validate a confirmation before executing it. See `ai-session-context`.
15. **Legal text is authoritative; summaries defer to it.** Published legal documents govern.
   Knowledge-base articles, in-app copy and assistant answers explain them and say so.
   Engineering changes the plumbing of legal pages, never their substance. Acceptance is
   recorded per document, per version, with the exact text shown — see the `legal-consent`
   skill.

## Stack

| Layer | Choice |
|---|---|
| Web **(primary)** | Next.js, Tailwind, shadcn/ui + design tokens — customer, investigator, admin (ADR-0003, ADR-0004) |
| Mobile *(companion)* | React Native, Expo — capture, notifications, messaging, quick updates only |
| Marketing | Next.js, Tailwind, shadcn/ui on the apex domain |
| UI stack | shadcn/ui → Cult UI → React Bits → Motion → custom (ADR-0003). React Flow **not** v1 |
| API | NestJS, REST, WebSocket gateway, OpenAPI, modular monolith |
| Data | PostgreSQL + PostGIS + pgvector; Redis |
| Jobs | BullMQ |
| Media | Cloudinary (private/authenticated resources only) |
| Payments | Stripe Connect (pending country/licensing confirmation) |
| AI | OpenAI behind a provider abstraction; NestJS AI gateway + tool registry |
| Infra | Hetzner VPS, Docker Compose, Caddy, Sentry, Prometheus/Grafana/Loki |

Domains (ADR-0002): `mydomain.com` marketing (indexable) · `app.` application + API at
`/api` (never indexed) · `news.` newsletter · `mail.` transactional sending domain, not a
website. Session cookies are **host-only on `app.`** — never scoped to the parent domain.

Monorepo layout is defined in `plan.md` §4. Package manager: **pnpm**.

## Working agreement

- Read `TODO.md` before starting. Work one task at a time.
- Do not implement work outside the selected task. File out-of-scope findings in `TODO.md`.
- A task is done only when its validation commands pass. Not when the code "looks right".
- Prefer small, reversible changes. Prefer extending a module over crossing its boundary.
- Update `TODO.md` status only after validation passes.
- Never invent a library, env var, table, or endpoint. Check that it exists first.

## Evidence discipline

Applies to reports, evidence records, and every AI-written sentence that reaches a user:

| Class | Meaning | Allowed in a final report |
|---|---|---|
| `FACT` | Backed by a stored, hashed artifact or a verified record | Yes |
| `CLAIM` | Asserted by a source, not independently confirmed | Yes, attributed |
| `INFERENCE` | Derived by reasoning from facts/claims | Yes, labeled |
| `HYPOTHESIS` | Working theory | Only in an explicitly marked section |
| `UNKNOWN` | No reliable source | Must be listed as an open question |

Never promote a class silently. Conflicting sources surface as a contradiction, not as
an averaged answer. The same applies to documentation: two current documents that
contradict each other are a conflict to resolve, not a tie to break — see the `evidence-integrity` and `report-generation` skills.

## Boundaries for agents

Agents may: read and modify source, run local tests/lint/typecheck/build, create branches
and commits, update `TODO.md`, write docs.

Agents may **not** without explicit human approval: touch production secrets or data,
run destructive migrations, deploy, change auth/authorization rules, change payment or
payout logic, change evidence access rules, disable a security control, or make a
legal/compliance decision. These are enumerated in `AGENTS.md`.

## Validation

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Per-task validation commands are listed on the task in `TODO.md` and override this default.

## Delivery flow

```
Code → Tests → Coverage → CI → Review → Staging → Verification → Production
```

`feature/*` → PR → `dev` → staging (automatic). `dev` → PR → `prod` → production (**manual
approval, always**). `hotfix/*` branches from `prod` and is backported to `dev` immediately.

A push never deploys to production. Production deploy, migration and rollback are manual,
approval-gated jobs. See `ci-cd`.

## Pointers

- Agent roster and delegation rules: `AGENTS.md`
- Skills (repeatable procedures): `.claude/skills/`
- Slash commands: `.claude/commands/`
- Harness explanation: `.claude/README.md`
