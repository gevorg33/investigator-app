# Image-scan exceptions

<!-- not-for-ingestion -->

The image scan in CI (`.github/workflows/pr.yml`, T-028) blocks on any CRITICAL or HIGH finding
that has a fix available. This register is the only legitimate way to accept one, and
`.trivyignore.yaml` must match it entry for entry.

## Rules

1. An exception names **CVE ids and a path**, never a whole image, package or severity.
2. Every exception **expires**. When it does, CI goes red and someone looks again — which is the
   point. Renewing one is a decision, recorded here with the date and who made it.
3. The reason says why the finding cannot be fixed *and* why it does not matter here. "The scanner
   is noisy" is not a reason.
4. An agent may never add, widen or renew an exception unilaterally.

## Register

| Path | Findings | Why it cannot be fixed | Why it does not matter here | Expires | Approved by |
|---|---|---|---|---|---|
| `usr/local/bin/gosu` in `infrastructure/docker/postgres` (base `pgvector/pgvector:0.8.6-pg17`) | 22 Go standard-library CVEs, 1 CRITICAL (`CVE-2025-68121`, crypto/tls), the rest HIGH — listed individually in `.trivyignore.yaml` | gosu 1.19 is the newest release, built with Go 1.24.6; no gosu built with a fixed Go exists. The Debian bookworm and trixie variants of the image ship the same binary, and trixie adds 64 findings of its own | gosu runs once at container start to switch to the `postgres` user and exec PostgreSQL. It makes no network connection and parses no URL or certificate, which is where every one of these CVEs lives | 2026-12-22 | gevorg33, 2026-09-23 |

## When an exception expires

1. Rebuild the image and rescan. If upstream has shipped a gosu built with a fixed Go, bump the
   base digest and delete the entry — the best outcome.
2. If not, and the reasoning still holds, renew with a new expiry and a new line in this table.
3. If a new gosu CVE appears that is not on the list, the scan fails on it. Assess it on its own;
   it is not covered by the entries that came before it.
