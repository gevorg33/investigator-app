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
the platform facts and **34 numbered questions** (26–31 added for agencies, ADR-0011; 32–33 for the hiring experience, plan.md §30; 34 for policy refusal, T-050), written so they can start without a discovery
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

**Why:** T-131 seeds the taxonomy and cannot start without it. T-053 built everything else —
labels, the staff write path, the rules — and closed on 2026-09-23 without seeding, because slugs
become permanent ids the moment they are written. Until this is answered there is nothing for a
customer to file a mission under. ADR-0009 raised the bar:
verification must now establish a **surveillance-specific** licence in the jurisdiction of the
work, not merely that someone is licensed.

**What's needed:** For each launch country — which taxonomy nodes require a licence, which
licence, and how to verify one is genuine. Six open questions are listed at the bottom of
[`docs/product/taxonomy-draft.md`](docs/product/taxonomy-draft.md).

**Verify:** Every `high` and `restricted` node has a stated licensing requirement per country.

**A lead for Armenia, found in T-128 — a CLAIM, not a verified fact.** A Hraparak article,
[«Մասնավոր խուզարկուներն արգելված են Հայաստանում, բայց գործում են»](https://hraparak.am/post/e1754420828e46e64d08b287d2fcaf51)
("Private investigators are banned in Armenia, but they operate"), states that Armenian law makes
following another person to uncover things "a criminally punishable act, unlawful interference in a
person's private life". It reports that the one registered detective bureau does corporate security
and fraud work and refuses private-life and romantic cases as illegal, and cites a 2012 conviction
of a former security officer who revealed affairs for money. It names no article of the Criminal
Code and the publication date was not visible. **What it does not establish:** which law, whether
licensed surveillance exists at all, or whether records and OSINT work is affected. **Why it
matters:** ADR-0009 puts surveillance and partner investigation in scope, and Armenia is a launch
locale. Counsel (#0) should answer this before T-068's jurisdiction gate is designed and before
the first launch market is chosen (#18). Nothing in the product was changed on the strength of it.

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

**Where it goes:** `.env.local` → `OPENAI_API_KEY`. Optional: `OPENAI_EMBEDDING_MODEL`
(default `text-embedding-3-small`, at 1536 dimensions).

**Also choose the chat model: `OPENAI_CHAT_MODEL` (T-017).** This one has no default on purpose.
The model you pick answers users' questions about the platform, which is a trade-off between cost
and quality, and it should be your call rather than something an unset variable decides. Until it
is set, `POST /api/v1/ai/knowledge/answer` answers 503 — and so does
`POST /api/v1/ai/discovery/answer` (T-018), which uses the same model to turn a request to find
investigators into search filters.

**Before you set a key in production:** the assistant sends each question, together with the
guidance it retrieved, to this provider. A request to find investigators is sent too, with any
purpose the customer states and the list of taxonomy categories — never their location, and never
any investigator's profile. The privacy policy must name the provider as a processor
before that happens. That is a counsel item (#0, #20), and the help article on the assistant already
defers to the privacy policy on this point.

**What is waiting on it (T-016):** the knowledge base is ingested, but its 360 chunks have no
embeddings. They are searchable by text only. With the key set, the next
`pnpm --filter api knowledge:sync` embeds them. The whole knowledge base is a few hundred short
chunks, so it costs cents. Knowledge-base text is written by the platform and contains no personal
data.

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

Created while verifying migrations apply to an empty database. Safe to delete whenever.

**No more will appear.** T-042 gives each test worker a database of its own, cloned from a
migrated template, so "does this apply to an empty database?" is answered by the harness on
every run rather than by hand. The harness's own databases — `investigator_dev_tmpl` and
`investigator_dev_w1` … `_w4` — are not in this list: they are rebuilt as needed, they hold
nothing but test data, and dropping them only makes the next run slower.

```
migrate_probe · migrate_probe2 · migrate_probe3 · ci_probe · ci_probe_t8_1789346201
ci_probe_t9_1789347652 · ci_probe_t10_1789596168 · ci_probe_t10b_1789596197
ci_probe_t10c_1789596252 · ci_probe_t10d_1789596273 · ci_probe_t10e_1789596294
ci_probe_t11_1789674197 · ci_probe_t12_1789679229 · ci_probe_t13_1789760505
ci_probe_t73_1789820244 · t074_backfill_probe_1789825455 · t074_backfill_probe2_1789837264
t076_backfill_probe_1789843576 · ci_probe_t76_1789844659 · t077_probe_1789911432
t077_probe2_1789911612 · t077_probe3_1789912288 · t080_probe_1789943500
t021_probe_1789989096 · t083_probe_1789992920
```

```bash
psql "postgres://postgres:postgres@localhost:5433/postgres" -Atc "SELECT 'DROP DATABASE ' || quote_ident(datname) || ';' FROM pg_database WHERE datname LIKE 'ci\_probe%' OR datname LIKE 'migrate\_probe%' OR datname LIKE 't0__\_backfill%' OR datname LIKE 't077\_probe%' OR datname LIKE 't080\_probe%' OR datname LIKE 't021\_probe%' OR datname LIKE 't083\_probe%'"
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

### 19. Mark four PostGIS functions leakproof in production — for the T-077 deploy

**Why:** a table with row-level security evaluates its security quals before any predicate that
is not `LEAKPROOF`, so such a predicate can no longer be an index condition. PostGIS does not
mark `ST_DWithin` leakproof, and discovery stopped reaching its GIST index: measured on 10,000
published profiles, **392 ms instead of 5 ms**. Marked leakproof it is 3 ms.

Migration 0013 does it automatically **where the migration role is a superuser** — locally and in
CI it is, so nothing is needed there. Where the production owner is not a superuser the migration
warns and carries on, and `apps/api/src/database/rls.spec.ts` fails against that database until
someone with the right to do it runs:

```bash
psql "$PRODUCTION_SUPERUSER_URL" -c "ALTER FUNCTION st_dwithin(geography, geography, double precision, boolean) LEAKPROOF; ALTER FUNCTION _st_dwithin(geography, geography, double precision, boolean) LEAKPROOF; ALTER FUNCTION geography_overlaps(geography, geography) LEAKPROOF; ALTER FUNCTION overlaps_geog(geography, gidx) LEAKPROOF;"
```

**What it costs:** an error raised inside one of those functions, or the time it takes, could in
principle say something about a row a policy hides — here, the coordinates of an **unpublished**
profile's service area. A published one's are public by design. Approved 2026-09-20.

**Status:** ⬜ Pending — only when the production database exists (#9), and only if its owner is
not a superuser

---

### 20. Publish the first legal documents — the mechanism is waiting for the text

**Why:** T-021 built the store and the gate machinery, and deliberately published nothing. The
application role holds `SELECT` on `legal_documents` and no more: versions are data a compliance
owner puts in, not something the product can write. Until a version is published,
`GET /api/v1/legal/documents/:type` answers 404 for that type — which is correct, because "no
terms exist" must never read as "these terms were accepted".

**What is needed**, per document type (`PRIVACY_POLICY`, `TERMS_OF_SERVICE`,
`TERMS_AND_CONDITIONS`, `LAWFUL_USE_POLICY`, `INVESTIGATOR_AGREEMENT`, `AGENCY_AGREEMENT`):

- the text, from counsel (#0), in the authoritative locale — one locale per version governs
- whether the version is **material** (`requires_reacceptance`): a compliance decision, never
  inferred from a diff
- the date it takes effect

The hash is computed by the database from the text, so nothing needs to be calculated by hand.
Translations are added as further rows of the same version with `is_authoritative_locale = false`.

**Also needed: which documents bind whom.** T-022 records a first answer in
`apps/api/src/modules/legal/legal.policy.ts` — registration asks for the privacy policy and the
terms of service, an investigator additionally for the investigator agreement and the lawful-use
policy, a customer for the terms and conditions. **Counsel confirms or corrects that**; it is a
legal position, not an engineering one, and changing it is a one-line change with a test.

**Status:** ⬜ Pending — blocked on counsel (#0). The gates are built and require nothing until
a version is published: registration behaves exactly as it always has (T-022) — the sign-up screen
(T-127) shows whatever is published, in full, and records its acceptance — while **creating
an agency is refused until `AGENCY_AGREEMENT` is published** (T-083) — the gate working as
intended, but it does mean that endpoint is unusable in production until this is done

---

### 21. Confirm three knowledge-base overlaps the agent reviewed — for T-016

**Why:** The knowledge sync flags two current documents that answer the same question for the
same readers, because it cannot tell agreement from contradiction. It found three, all between
`customer/privacy-and-data.en.md` and `policies/privacy-summary.en.md`: who can see my evidence,
what data you hold, and how long it is kept. I read both documents and found them consistent, so I
recorded that in `docs/knowledge-base/overlaps-reviewed.yml` so CI does not fail. The entries are
marked `by: Claude (agent), for the owner's confirmation`. A privacy answer is exactly where two
subtly different statements would matter.

**What is needed:** read the three pairs (about ten minutes). If each pair agrees, change `by:` to
your name. If one pair disagrees, delete its entry and say which document is right. CI will then
flag it until the other document is corrected.

**Status:** ⬜ Pending — not blocking. CI passes on the agent's review.

---

### 22. Native-speaker review of the Russian and Armenian knowledge base — for T-026

**Why:** The whole knowledge base (36 documents) is translated into Russian and Armenian — 72 files,
all `status: draft`. Drafts are not ingested, so today the Assistant still answers Russian and
Armenian users from the English and tells them so. A translation reaches users only after a native
speaker has read it: the Assistant reads these pages to customers as the platform's own word, and an
agent's Armenian in particular will have phrasing a native speaker would not use.

**What is needed:** one native Russian and one native Armenian reviewer, ideally familiar with
private-investigation or legal vocabulary. For each file, check that it says what the English says and
reads naturally. The glossary used throughout is worth confirming first, because it repeats in every
file: mission — задание / առաջադրանք, quote — предложение / գնառաջարկ, investigator — детектив /
խուզարկու, assignment — заказ / պատվեր, payout — выплата / վճարահանում. Corrections can be made in the
files directly. Priority order if time is short: `policies/` (public), then `customer/`, then
`investigator/`, `agency/`, `staff/`.

The app's words, and the two places they still differ from these, are in
[`docs/product/translation-glossary.md`](docs/product/translation-glossary.md) — settle them with #23.

**Then (agent work, no longer yours):** flip reviewed files to `current` and run the sync — see
"Promoting a reviewed translation" in `docs/knowledge-base/README.md`. The three privacy overlaps from
#21 will need recording again in each language.

**Status:** ⬜ Pending — not blocking launch in English; blocks serving ru/hy knowledge.

---

### 23. Native-speaker review of the app's Russian and Armenian text — before launch (T-128)

**Why:** Every word the application shows is now in `packages/i18n/src/messages/` — `ru.ts` and
`hy.ts` beside the English source. I wrote both translations. They are complete (the build fails
if a key is missing) and read correctly to me, but an agent's Armenian in particular is not
something to launch on: it reads as unfinished software to exactly the market this is for.

**What is needed:** a native speaker of each language reads their file — about 150 strings since
T-127 added sign-in, sign-up and the account page (`auth`, `account`, `legal` and `error`), half an
hour — with [`docs/product/translation-glossary.md`](docs/product/translation-glossary.md)
beside it: every product term, the word chosen, the alternatives and why. **Do it with #22** — the
app and the knowledge base must use the same words, and the glossary lists the two places they
still differ. Word choices to confirm, two of them made so the labels fit a 75px phone tab:

- Russian navigation says **«Чаты»** for Messages (the full «Сообщения» is clipped on a phone)
  and **«Задания»** for Missions — the knowledge base's word; «заказ» means an assignment.
- Armenian navigation says **«Գործեր»** (cases) for Missions, where «Պատվերներ» and the knowledge
  base's «Առաջադրանքներ» do not fit — **open conflict**: pick one word for both, or a short
  navigation label beside the knowledge base's term.
- Armenian says **«դետեկտիվ»** for investigator where the knowledge base says «խուզարկու» — **open
  conflict**. The evidence favours «դետեկտիվ»: the lawful registered business in Armenia calls
  itself «դետեկտիվ բյուրո», and the press uses «մասնավոր խուզարկու» for unlicensed private
  surveillance. Russian says «детектив» in both, as its law does.

A change is an edit to the file; the build checks the keys and a test checks every message is
valid. A nav label longer than about 60px at 12px will clip — check a replacement at 375px wide.

**Status:** ⬜ Pending — not blocking development; blocking launch.

---

### 24. Move the repository off iCloud Desktop — recurring breakage (T-011, T-128)

**Why:** The repository lives in `~/Desktop`, which iCloud syncs. iCloud keeps making conflict
copies — `css.spec 2.ts`, `package 2.json`, a whole `src/app 2/`, and three inside `.git/`
(`index 2`, `index 3`, `index 4`). They are gitignored, so they never reach a commit, but
TypeScript and Vitest see them: T-011 quarantined 135, T-128 another 50 and T-127 eleven
knowledge-base articles, each time because `tsc`, the test run or the knowledge-base validator
broke. Copies inside `.git/` are the worrying ones — iCloud is syncing a live git
index.

**What is needed:** move the folder somewhere iCloud does not sync, e.g.
`mv ~/Desktop/Investigator-app ~/code/Investigator-app`, then reopen it there. Nothing in the
repository depends on its path. The quarantined copies are in the agent's session scratchpad and
can be discarded.

**Status:** ⬜ Pending — not blocking, but it will keep breaking builds until done.

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
