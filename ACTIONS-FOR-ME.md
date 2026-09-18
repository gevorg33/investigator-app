# Actions for you

Only things that genuinely need **your** accounts, your money, or your signature. Everything
automatable has been automated — see "Already handled" at the bottom.

`TODO.md` holds implementation tasks. This file holds only what Claude cannot do.

**To get running locally right now:**

```bash
./scripts/setup.sh
```

That installs Node 24, enables pnpm, installs dependencies, creates `.env.local` with a
generated `SESSION_SECRET`, starts Docker services if Docker is running, and verifies the
build. Nothing below is needed for the API to boot.

---

## Blocking launch

### 0. Engage counsel — the longest pole

**Why:** Gates T-020 → T-027 → T-022 → registration → most of the product. Weeks of calendar
time regardless of engineering pace.

**Where:** A lawyer in your launch jurisdictions with data-protection and platform-liability
experience.

**What to give them:** [`docs/compliance/counsel-brief.md`](docs/compliance/counsel-brief.md) —
the platform facts and **33 numbered questions** (26–31 added for agencies, ADR-0011; 32–33 for the hiring experience, plan.md §30), written so they can start without a discovery
call. Plus the three drafts in `docs/compliance/`.

**Flag when you brief them:**
- §3 and questions 8–11 — evidence contains personal data about **people who are not users**.
  The most significant issue in the whole brief.
- §2 — how far the marketplace framing holds, given we verify investigators, hold funds and
  adjudicate disputes.
- §19a — the lawful basis for retaining a ban hash after account deletion.
- ADR-0009 put surveillance back in scope, which makes several answers harder.
- Questions 26–31 — agencies (ADR-0011): who the customer contracts with, agency terms, employee
  data, responsibility for members' conduct, agency licensing, principals and ban evasion.

**Verify:** Retention periods decided, jurisdictions fixed, liability limits drafted,
authoritative locale designated.

> **One caution:** this repository is **public**. Once counsel engages, their advice must not be
> committed here — publishing attorney-client communications can waive privilege. Questions in
> the repo, answers in a private channel.

**Status:** ⬜ Pending

---

### 1. Payment provider acceptance

**Why:** ADR-0009 made this a **launch blocker**, not a later detail. Most major processors
restrict surveillance-related services in their acceptable-use policies. If they decline, the
business model changes regardless of what the code does.

**Where:** Stripe, or a regional marketplace processor for your launch countries.

**Changed 2026-09-19: this is now a go-live gate, not a build gate.** You chose to build against
Stripe Connect now (plan.md §12). Engineering proceeds (T-109 to T-115); **no real money moves
until this is answered in writing.** If Stripe declines, only the provider adapter changes.

**What to ask Stripe:** whether they will process a marketplace for private investigation
services including surveillance, under their acceptable use policy, in your launch market
(#18) — and whether Connect payouts to investigators are available there.

**Then obtain:** secret key, publishable key, webhook signing secret.

**Where they go:** `.env.local` → `PAYMENT_PROVIDER_SECRET_KEY`,
`PAYMENT_PROVIDER_PUBLISHABLE_KEY`, `PAYMENT_PROVIDER_WEBHOOK_SECRET`.

**Verify:** Written confirmation from the provider, not an assumption from their public docs.

**Status:** ⬜ Pending

---

### 2. Investigator licensing research

**Why:** T-053 seeds the taxonomy and cannot be completed without it. ADR-0009 raised the bar:
verification must now establish a **surveillance-specific** licence in the jurisdiction of the
work, not merely that someone is licensed.

**What's needed:** For each launch country — which taxonomy nodes require a licence, which
licence, and how to verify one is genuine. Six open questions are listed at the bottom of
[`docs/product/taxonomy-draft.md`](docs/product/taxonomy-draft.md).

**Verify:** Every `high` and `restricted` node has a stated licensing requirement per country.

**Status:** ⬜ Pending

---

## Needed before the relevant task

### 3. Google OAuth client — for T-062

**Why:** Sign in with Google. Only the client creation needs you; the integration is code.

**Where:** [Google Cloud Console](https://console.cloud.google.com/apis/credentials)

**Steps:**
1. Create a project (or pick one).
2. **APIs & Services → OAuth consent screen** — External. App name, support email, developer
   email. Scopes: `email`, `profile`, `openid`. Nothing more — we only need identity.
3. **Credentials → Create credentials → OAuth client ID → Web application**
4. Authorised redirect URIs:
   - `http://localhost:3001/api/v1/auth/google/callback`
   - `https://app.<yourdomain>/api/v1/auth/google/callback`
5. Copy the client ID and secret.

**Where they go:** `.env.local` → `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

**Verify:** After T-062 ships, the sign-in flow completes and a session cookie is set.

**Status:** ⬜ Pending

---

### 4. Cloudinary account — for T-008

**Why:** Private storage for evidence, verification documents and attachments. Only the account
and its settings need you.

**Where:** [cloudinary.com](https://cloudinary.com/users/register_free)

**Steps:**
1. Create the account. Note the **cloud name**.
2. **Settings → Security** — set default delivery type to **authenticated** so nothing is
   public by accident. `cloudinary-media` requires private resources for evidence.
3. **Settings → Upload** — create folder `investigator/development`.
4. Copy API key and secret from the dashboard.
5. Confirm the **data region** — it affects the privacy policy and counsel's transfer analysis.

**Where they go:** `.env.local` → `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`.

**Plan:** the free plan is enough. T-008 deliberately does not rely on expiring token links,
which need the Advanced plan; it uses time-limited private download links, available on every
plan.

**Verify:** After T-008 (built), an uploaded file is **not** reachable by its public URL, and
the link the API issues stops working after five minutes. Note that nothing is served until a
malware scanner exists (T-065) — until then, check that the upload completes and that asking
for a link is refused while the scan is pending.

**Status:** ⬜ Pending

---

### 5. Transactional email domain — for T-036

**Why:** Verification, password reset and notifications. ADR-0002 requires **separate sending
domains** for transactional and newsletter mail — a newsletter with high complaints must not
degrade password-reset delivery.

**Where:** Any transactional provider (Postmark, Resend, SES), plus your DNS host.

**Steps:**
1. Create the account and add `mail.<yourdomain>` as a sending domain.
2. Add the SPF, DKIM and DMARC records they give you. Start DMARC at `p=none` with `rua`
   reporting.
3. Add a **separate** sending domain for the newsletter, with its **own DKIM key**.
4. Leave the apex domain sending nothing.
5. Copy the API key.

**Where they go:** `.env.local` → `MAIL_PROVIDER_API_KEY`, `MAIL_FROM_ADDRESS`.
Full checklist: [`infrastructure/caddy/dns-and-email.md`](infrastructure/caddy/dns-and-email.md)

**Verify:** A test message from each domain passes SPF, DKIM and DMARC at a major provider.

**Status:** ⬜ Pending

---

### 6. OpenAI API key — for Phase 7

**Why:** The AI assistant and embeddings.

**Where:** [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

**Steps:** Create a key scoped to this project. Set a usage limit — embedding backfills can be
larger than expected.

**Where it goes:** `.env.local` → `OPENAI_API_KEY`.

**Status:** ⬜ Pending

---

### 7. Sentry — for T-028 onward

**Why:** Error tracking (plan.md §20). Optional until staging exists.

**Where:** [sentry.io](https://sentry.io/signup/)

**Steps:** Create an org and a Node project. Copy the DSN. A DSN is not a secret, but keep it
out of the repo anyway.

**Where it goes:** `.env.local` → `SENTRY_DSN`.

**Status:** ⬜ Pending

---

## Needed before staging and production

### 8. Domain registration and DNS

**Why:** ADR-0002 needs five names: apex, `www`, `app.`, `admin.`, `news.`, plus `mail.` as a
sending domain.

**Steps:** Register the domain. Point A/AAAA records for apex, `app.`, `admin.`, `news.` at the
server from #9; `www` as CNAME to apex. Caddy obtains certificates automatically.

**Verify:** All five resolve; `curl -I https://app.<domain>/` shows
`X-Robots-Tag: noindex, nofollow` once deployed.

**Status:** ⬜ Pending

---

### 9. Server (Hetzner or equivalent)

**Why:** plan.md §24 — one VPS running Docker Compose. Needed for T-040 and T-041.

**Steps:** Provision a VPS. Add your SSH key, disable password auth, enable a firewall
permitting only 22/80/443. **PostgreSQL, Redis and metrics ports must not be publicly
reachable** — `launch-hardening` requires verifying this by scanning from off-host.

**Status:** ⬜ Pending

---

### 10. GitHub environment secrets

**Why:** The workflows exist and are gated, but have no credentials. I cannot add secrets —
they would pass through me in plain text.

**Where:** Settings → Environments → `staging` / `production` → Environment secrets.

**Add to each:** `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` (a **different** value per
environment), plus provider keys once you have them.

**Non-negotiable:** production secrets appear **only** in the `production` environment. Never
in `staging`, never in repository-level secrets, never in PR CI (ADR-0002, `ci-cd`).

**Verify:** A `staging` job can read its secrets; a PR workflow cannot.

**Status:** ⬜ Pending

---

### 11. Required status checks on branch protection

**Why:** `prod` is protected, but required status checks are **deliberately not set** — a check
name that has never reported blocks every merge. Add them once `pr.yml` has run successfully
once (T-028).

**Where:** Settings → Branches → `prod` → Require status checks → select `verify`.

**Status:** ⬜ Pending — waits on T-028

---

### 12. Coverage exclusion for decorator metadata — ✅ decided

**Decision (2026-09-14): option 1.** Exclude the compiler-generated branches; every threshold
stays at 100%. Recorded in `docs/operations/coverage-exclusions.md`.

**What it actually excludes.** An earlier version of this item attributed the branch to a
`__decorateClass` helper's `kind ? … : …` ternary. That was wrong. Inspecting oxc's real
output shows it is the parameter-type guard `emitDecoratorMetadata` writes:

```js
_decorateMetadata("design:paramtypes", [typeof TokenService === "undefined" ? Object : TokenService])
```

The `Object` side runs only on a circular import, so no test can reach it. The exclusion
marks that exact expression — same identifier on both sides — and nothing else, including
decorator arguments, which are user code. It is narrower than Vitest's own rule for SWC,
which ignores the whole decorate statement.

**Status:** ✅ Resolved — applied on PR #1 and carried up the stack. Nothing further needed.

---

### 13. Mission policy decisions — for T-010, needs your confirmation

T-010 is the lawful-use gate, so these were built to the **most conservative** reading of the
policy documents. Each is reversible, and each is a policy decision rather than an engineering
one. Confirm or change them.

1. **Screening never rejects, and never publishes.** A prohibited-phrase match flags the
   mission and moves it up the queue; a person decides. The alternative — automatic rejection
   on a match — was not taken, because the same phrase is written by victims describing what
   happened to them. **Confirm: no automatic rejection.**
2. **A declared protective order does not auto-refuse.** The Lawful Use Policy says partner
   work is not available to someone subject to one. It is flagged as `RESTRICTED` and refused
   by a moderator rather than by the system, for the same reason. **Confirm.**
3. **The relationship vocabulary.** The customer picks one of: self or own organisation,
   employer, business relationship, legal representative, family member, partner or spouse,
   former partner, no personal relationship, other. This is a new list, not one taken from a
   policy document. **Confirm the options.**
4. **The protective-order question is asked only for personal relationships** — family member,
   partner or spouse, former partner — and required before submission there.
5. **Submission rate limit: 10 per account per day**, provisional. Every submission costs a
   moderator's attention. Raise it if that is too tight for a real customer.
6. **Seven years' retention for missions** after they close (provisional, in
   `docs/compliance/retention.md`, for counsel).
7. **The phrase ruleset covers English and Russian only.** Armenian needs a native speaker with
   domain knowledge rather than my guess — filed as T-067. Armenian missions are still reviewed;
   they are just not prioritised by their text.

**Two documents disagree, and T-053 should settle it, not me:**
`docs/product/taxonomy-draft.md` still lists partner and relationship investigation under
"Deliberately absent", while ADR-0009 and the Lawful Use Policy put it **in scope with
controls**. The ADR is the later decision and the code follows it. The taxonomy draft's section
needs correcting when the tree is reviewed.

Also: T-053 lists three risk bands (`standard`/`elevated`/`high`); the taxonomy draft defines a
fourth, `restricted`, for surveillance of a private individual in a personal matter. The schema
has all four, because ADR-0009's controls need the distinction.

**Status:** ⬜ Pending — your confirmation. Nothing blocks on it; the defaults are the safe ones.

---

### 14. Probe databases to drop

Created while verifying migrations apply to an empty database. Safe to delete whenever:

```
migrate_probe · migrate_probe2 · migrate_probe3 · ci_probe · ci_probe_t8_1789346201
ci_probe_t9_1789347652 · ci_probe_t10_1789596168 · ci_probe_t10b_1789596197
ci_probe_t10c_1789596252 · ci_probe_t10d_1789596273 · ci_probe_t10e_1789596294
ci_probe_t11_1789674197 · ci_probe_t12_1789679229 · ci_probe_t13_1789760505
```

```bash
psql "postgres://postgres:postgres@localhost:5433/postgres" -Atc "SELECT 'DROP DATABASE ' || quote_ident(datname) || ';' FROM pg_database WHERE datname LIKE 'ci\_probe%' OR datname LIKE 'migrate\_probe%'"
```

**Status:** ⬜ Pending — cosmetic

---

### 15. Quote and assignment defaults — for T-012, needs your confirmation

Engineering bounds chosen so nothing shipped undefined. None is a product decision, and each
is a constant to change rather than a redesign.

1. **An investigator has 48 hours to accept an assignment.** `kb-investigator-quoting` promises
   a window and says failing to accept "releases the customer and counts against your response
   record", but no document sets its length.
2. **A quote's expiry must be at least 1 hour and at most 90 days out.** The investigator picks
   inside that; the platform refuses an expiry already past or absurdly far away.
3. **Estimated duration is capped at 365 days**, and quote text fields at 5,000 characters for
   scope and 2,000 for deliverables, assumptions, exclusions and cancellation terms.

**Status:** ⬜ Pending — your confirmation. Nothing blocks on it.

---

### 16. Where T-012 stops, and what Stripe still needs

You said the Stripe account exists, so I built the **whole chain**: quote → acceptance →
payment authorization → assignment, with the assignment created only once an authorization
exists. What T-012 does **not** contain is the Stripe integration itself — payment intents,
webhook signature verification, the ledger, fee splits, refunds, payouts and reconciliation.

That is deliberate, not an oversight:

- `.claude/agents/backend-domain.md` — the owning agent for this task — says in as many words:
  *"Do not touch Stripe, ledger, fee or payout logic — that is `payments`."*
- `payments-webhooks` forbids moving money **without a ledger entry and an audit event in the
  same transaction**, and no ledger exists yet.
- Fee and refund policy "must not change without explicit human approval", and those decisions
  have not been made.

So the chain ends at one named boundary, `PaymentAuthorizer`. Today its only implementation
refuses, which means **no assignment can be created in production until the payments module
lands** — the same fail-closed shape verification has in discovery. Wiring Stripe behind that
boundary is a Phase 5 task with its own approval.

**Still unanswered, and it is the gating question for Phase 5:** ACTIONS-FOR-ME #1 asks whether
the provider *accepts this business category* in your launch countries, with licensing, tax and
payout support. An account existing is not the same answer. `plan.md` §12 and the payments
skill both say to settle that before building against a provider.

**Status:** ⬜ Pending — confirm the boundary is where you want it, and answer #1 before Phase 5

---

### 17. Agency pricing — decide before T-099

Agencies are now planned (ADR-0011). You chose to **plan billing but decide later**, so nothing
is built. Before T-099 can start, decide:

1. **Do agencies pay a subscription** on top of marketplace fees, or only marketplace fees?
2. **If subscriptions:** per agency, per seat (member) or per investigator profile, and whether
   there is a free tier (a small agency should not pay to try the product).
3. **Usage-based charges** — AI usage, storage, anything else — or none.

This is genuinely manual: it is a pricing decision, not an engineering one. The permission
catalog already reserves `billing.read` and `billing.manage`, so no migration waits on it.

**Status:** ⬜ Pending — nothing blocks on it until Phase 5

---

### 18. Choose the first launch market

**Why:** The delivery order (plan.md §26) builds the core loop for **one market** first. A
marketplace is won on liquidity: enough verified investigators in one place that customers get a
good match fast. That market decides:

- the licensing rules verification must check (#2)
- the payment provider's answer (#1)
- counsel's jurisdiction (#0)
- which languages the app launches in (T-128)

**What to decide:** one country (ideally one city to start), and whether surveillance is lawful
and licensable there on the terms ADR-0009 requires.

**Status:** ⬜ Pending — the most leveraged decision on this list

---

## Already handled — do not do these

| | |
|---|---|
| Git repository, branches, remote | Done — `dev` and `prod` pushed |
| Branch protection | Applied: `prod` 1 review + no force-push; `dev` no force-push |
| GitHub Environments | `staging` and `production` created; `production` requires your review |
| Node 24 LTS | Installed and set as nvm default |
| pnpm | Enabled via corepack, pinned in `packageManager` |
| Monorepo, TypeScript, ESLint, Prettier | T-001 |
| NestJS API, health, config validation, error taxonomy | T-002 |
| `.env.example` and `SESSION_SECRET` | Generated by `scripts/setup.sh` |
| shadcn + Playwright MCPs | Installed and smoke-tested |
| React Bits registry | Configured, 684 components resolving |
| Refero MCP | **No longer required** — declined on cost |
| CI workflows | Written; T-028 makes them green |
| Caddy config | Written; needs the server from #9 |
| Container runtime | **No longer required** — Colima installed and started; chosen over Docker Desktop to avoid its commercial licence |
| Local database stack | T-003 — PostGIS + pgvector + Redis running and verified |

---

## Keeping this accurate

Reviewed at the start and end of every task. A new manual action gets added here immediately,
not left in a conversation. An action that becomes automatable is marked **No longer required**
rather than deleted, so it is clear it was considered.
