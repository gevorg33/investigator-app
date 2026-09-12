# DNS and email sending domains

Companion to `docs/architecture/ADR-0002-domain-architecture.md`. Records are illustrative;
exact values come from the DNS and email providers.

## Web records

| Name | Type | Points to |
|---|---|---|
| `mydomain.com` | A / AAAA | Edge host |
| `www` | CNAME | `mydomain.com` |
| `app` | A / AAAA | Edge host |
| `news` | A / AAAA | Edge host |

Caddy obtains and renews certificates per name automatically.

## Email — two sending domains, deliberately

**Transactional and newsletter mail must not share a sending domain.** Newsletters accrue
complaints and unsubscribes; transactional mail must reach the inbox. Shared reputation means
a bad campaign degrades password-reset and verification delivery — an account-recovery
problem, not a marketing one.

| Purpose | Sending domain | Sends |
|---|---|---|
| Transactional | `mail.mydomain.com` | Verification, password reset, notifications, assignment and evidence updates |
| Newsletter | a distinct newsletter sending domain | Campaigns, digests |

The apex domain should send no mail, keeping its reputation clean for future use.

## Required records, per sending domain

- **SPF** — one TXT record per domain. Multiple SPF records is a common misconfiguration and
  causes a permanent failure, not a merge.
- **DKIM** — a separate key pair per sending domain. Do not reuse one key across both; the
  point of separation is independent reputation.
- **DMARC** — on the organisational domain. Start at `p=none` with aggregate reporting,
  review reports, then move to `quarantine` and `reject` once both streams pass.
- **MX** — only if inbound mail is actually received on that name. A sending-only subdomain
  needs no MX.
- **Return-Path / bounce domain** — as the provider requires, aligned with the sending domain
  so DMARC alignment passes.

## Before launch

- [ ] Both sending domains verified with the provider; DKIM published and passing
- [ ] SPF is a single record per domain and within the DNS lookup limit
- [ ] DMARC at `p=none` with `rua` reporting, reviewed before tightening
- [ ] Transactional and newsletter reputations monitored separately
- [ ] A test message from each domain passes SPF, DKIM and DMARC at a major provider
- [ ] Bounce and complaint handling wired to suppression, per stream
