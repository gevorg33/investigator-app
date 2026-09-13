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
the platform facts and **25 numbered questions**, written so they can start without a discovery
call. Plus the three drafts in `docs/compliance/`.

**Flag when you brief them:**
- §3 and questions 8–11 — evidence contains personal data about **people who are not users**.
  The most significant issue in the whole brief.
- §2 — how far the marketplace framing holds, given we verify investigators, hold funds and
  adjudicate disputes.
- §19a — the lawful basis for retaining a ban hash after account deletion.
- ADR-0009 put surveillance back in scope, which makes several answers harder.

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

**What to ask, before building anything:** whether they will process a marketplace for private
investigation services including surveillance, under their acceptable use policy — and whether
Connect-style split payouts are available in your countries.

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

**Verify:** After T-008, an uploaded file is **not** reachable by its public URL and only
opens through a signed link.

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
