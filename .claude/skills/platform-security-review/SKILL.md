---
name: platform-security-review
description: The pre-merge security checklist for this platform — IDOR, signed-URL misuse, upload bypass, prompt injection, PII in logs, retention. Use before merging anything touching authentication, authorization, evidence, media, payments or AI, and when running a threat model.
---

# Security review

Review against the platform's actual threat model: a marketplace holding private evidence
about real people, with money moving through it, and two mutually untrusting user classes
in the same conversation.

## Threat model, briefly

| Adversary | Wants | Primary defence |
|---|---|---|
| Curious customer | Another customer's mission or evidence | Resource-level authorization |
| Hostile investigator | Missions or evidence they were not assigned | Assignment-scoped queries |
| Compromised account | Lateral movement, bulk export | Rate limits, audit, export gating |
| Malicious uploader | Malware to another user; storage abuse | Scan gate, type/size limits, quotas |
| Prompt injector | The assistant acting outside caller scope | Retrieved content as data; tool re-auth |
| Insider / over-broad staff | Unlogged evidence access | Explicit grants, audited, customer-visible |
| Payment fraud | Free work, double payout | Webhook verification, idempotency, ledger |

## The checklist

### Authorization
- [ ] Resource-level check, not only a role check
- [ ] Check in the service, not only a guard or decorator
- [ ] Queries actor-scoped, not fetch-then-compare
- [ ] Resource state validated, not only ownership
- [ ] Staff scope specific, never `isStaff`
- [ ] IDOR test asserts on a *different* actor of the same role
- [ ] Enumeration: consistent 403/404, no timing or message oracle

### Media & evidence
- [ ] No Cloudinary URL reachable without a backend grant
- [ ] Delivery URLs short-lived, never logged, cached, emailed or pushed
- [ ] Client-supplied public IDs never trusted
- [ ] Upload result validated against what was authorized
- [ ] Scan status gates visibility; failing closed
- [ ] Type, size and count enforced server-side
- [ ] Evidence access needs an explicit grant, checked for expiry and revocation

### Input
- [ ] Every boundary validated with a schema
- [ ] No `any` crossing a controller, job or tool boundary
- [ ] Path, SQL and command injection surfaces absent
- [ ] Pagination bounded — no unbounded `limit`

### Data exposure
- [ ] No tokens, passwords, signed URLs, card data, evidence bytes or message bodies in
      logs, error responses, Sentry breadcrumbs or analytics
- [ ] Error responses do not confirm existence of resources the actor cannot see
- [ ] No PII in URLs or query strings
- [ ] API responses are projections, not raw entities

### AI
- [ ] The model cannot see data the caller cannot
- [ ] Retrieved content delimited and treated as data
- [ ] Injection test exists and passes
- [ ] Write tools require confirmation bound to exact arguments
- [ ] Actor identity from session, never from model input
- [ ] Tool calls audited with redacted arguments

### Payments
- [ ] Signature verified on the raw body before parsing
- [ ] Replay produces exactly one effect
- [ ] No client-supplied amount, currency or status trusted
- [ ] Every movement has a ledger entry and an audit event

### Injection and content handling
- [ ] Every query parameterized — ORM or bound parameters. No string-built SQL, ever
- [ ] **Mass assignment blocked.** DTOs whitelist fields and reject unknown ones
      (`forbidNonWhitelisted`, Zod `.strict()`). A client must never be able to set
      `role`, `verificationStatus`, `status`, `price`, `platformFee` or any ID by posting it
- [ ] **User content escaped at render.** Mission descriptions, messages, profile text and
      report bodies are attacker-controlled and are rendered in the admin console. No
      `dangerouslySetInnerHTML` on user content; if rich text is needed, sanitize with an
      allowlist on the server, not the client
- [ ] **CSRF**: state-changing requests are not reachable cross-site. `SameSite=Strict` plus
      a same-origin API covers most of it (ADR-0002); any cookie-authenticated endpoint that
      cannot use `SameSite=Strict` needs a token
- [ ] **Path traversal**: no user-supplied value reaches a filesystem path, an export
      filename, or an archive entry name without normalization and an allowlist. Applies to
      report exports and evidence bundle names
- [ ] **SSRF**: no user-supplied URL is fetched server-side without an allowlist. Relevant
      surfaces — webhook callbacks, media validation, report generation pulling remote
      assets, and anything the AI gateway is given. Block private ranges, link-local, and
      redirects into them; resolve then validate, and re-validate after each redirect

### Tokens and sessions
- [ ] **JWT algorithm pinned.** Verify with an explicit algorithm; reject `none` and reject
      an algorithm the token itself asserts. Asymmetric keys verify with the public key only
- [ ] Signing secrets are per-environment, rotatable, and never in code or a repo
- [ ] Password-reset tokens are single-use, short-lived, bound to the account, invalidated on
      use and on password change, and compared in constant time
- [ ] Reset and verification tokens are never logged, never in a URL that reaches an analytics
      referrer, and never reused across purposes

### Automated abuse
- [ ] Bot protection on registration, login, password reset and mission submission. Rate
      limiting alone does not stop distributed automated signup
- [ ] Enumeration resistant: registration, reset and login reveal nothing about whether an
      account exists, by body, status or timing

### Operational
- [ ] New data has a retention rule and a deletion path
- [ ] Rate limits on authentication, upload, search, export and AI
- [ ] Secrets not in code, images, compose files or CI logs
- [ ] New table's delete semantics deliberate; evidence and audit never cascade
- [ ] Registration and role activation gated on consent server-side, not by client checkbox
- [ ] Consent rows carry the content hash of the text actually shown, and survive account deletion

## Two common checklist items that do not apply here

**"Use the public/anon database key"** and **"enable row-level security"** are patterns from
client-direct-to-database stacks. This platform has **no client-to-database path at all** —
every request goes through the NestJS API, which holds the only credentials. There is no
anon key to get right.

Postgres RLS remains available as defence in depth, and was considered. It is deferred:
authorization here is resource-level and state-dependent (see `authorization`), which is
awkward to express as row policies, and duplicating the rules in two places invites them to
disagree. If it is adopted later it is an addition to the service-layer checks, never a
replacement — and that is an ADR, not a patch.

## Reporting

Per finding: severity, the **concrete failing scenario** (specific actor, inputs, state →
what leaks), file and line, and the smallest correct fix.

If you cannot state the failing scenario, it is not a finding. Do not pad.

Severity: CRITICAL (auth bypass, evidence leak, money loss) · HIGH (PII exposure, IDOR on
non-evidence data) · MEDIUM (missing audit, weak validation) · LOW (hardening).

End with **safe to merge** or **blocked** plus the minimum unblocking fixes.
