---
name: launch-hardening
description: Pre-launch and build-time security — secrets in git history, dependency and image scanning, source maps, default credentials, exposed debug surfaces, TLS and header verification. Use before a production deploy, when setting up CI, or when auditing what the build and infrastructure expose. Distinct from per-PR review.
---

# Launch hardening

Per-PR review (`platform-security-review`) catches what a change introduces. This catches
what the **build, the repository and the infrastructure** expose — different cadence,
different owner, and the items here are the ones that are invisible in a diff.

Run before first production deploy, then on a schedule.

## Secrets

- [ ] **Scan the full git history**, not the working tree. A key removed in a later commit is
      still in the history and still compromised. Use `gitleaks detect --no-git` for the tree
      and `gitleaks detect` for history, or `trufflehog git file://.`
- [ ] **Any secret ever committed is burned.** Rotate it. Rewriting history does not
      un-publish it — assume it was cloned
- [ ] Secret scanning runs in CI on every push, and blocks the merge
- [ ] No secret in an image layer, a compose file, a CI log, a build arg, or a client bundle
- [ ] `NEXT_PUBLIC_*` and equivalents audited — everything so prefixed is public by design,
      so confirm nothing sensitive is there
- [ ] Per-environment secrets; production values never reach a developer machine, a preview
      deploy, or an agent

## Dependencies and images

- [ ] `pnpm audit` (or equivalent SCA) in CI, failing the build on known-exploitable severity
- [ ] Lockfile committed and CI installs with `--frozen-lockfile`
- [ ] Container base images pinned by digest, not a floating tag, and scanned
- [ ] Automated update PRs enabled, with a human reviewing them — an auto-merged dependency
      bump is a supply-chain path
- [ ] Postinstall scripts reviewed for anything newly added

## What the build ships

- [ ] **Source maps not publicly served in production.** They reconstruct your source,
      including comments and internal route names. Upload them to the error tracker and
      exclude them from the public bundle
- [ ] No debug flags, verbose errors or stack traces in production responses
- [ ] OpenAPI/Swagger served in non-production only (already required by T-002)
- [ ] No `.env`, `.git`, `.map`, backup or editor files reachable over HTTP — verify by
      request, not by inspecting the build
- [ ] Bundle audited for leaked internal hostnames, test credentials or commented-out keys

## Default credentials and exposure

- [ ] **Every default credential changed** before anything is reachable: PostgreSQL, Redis,
      Grafana, Prometheus, Uptime Kuma, and any admin UI shipped in compose
- [ ] PostgreSQL, Redis, and metrics endpoints are **not reachable from the public internet**.
      Verify by scanning from outside the host, not by reading the compose file
- [ ] Monitoring and dashboard UIs are authenticated, even on a private network
- [ ] No management port exposed by a container's default `EXPOSE` that the host then
      publishes unintentionally

## Transport and headers

Verify against the running deployment; configuration existing is not evidence it is applied.

- [ ] HTTPS enforced; HTTP redirects permanently; HSTS present with a long max-age
- [ ] `curl -I https://app.<domain>/` shows `X-Robots-Tag: noindex, nofollow`
- [ ] `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`
      present on every origin
- [ ] CSP set per application and actually blocking — test it, a CSP with a syntax error
      fails open silently
- [ ] `Server` and `X-Powered-By` removed
- [ ] Certificate chain valid, renewal automated and alerting on failure

## Data and recovery

- [ ] Encryption at rest on the database volume **and** field-level encryption for the most
      sensitive columns where the threat model warrants it — disk encryption does not protect
      against a compromised application
- [ ] Backups encrypted, stored off the primary host, and **a restore actually performed**.
      An untested backup is not a backup
- [ ] Retention jobs run and are audited
- [ ] A credential-rotation procedure exists and has been exercised once

## Before declaring launch-ready

- [ ] Every item above checked against the **running** environment
- [ ] Findings recorded with an owner, not just noted
- [ ] Anything deferred is written down with the accepted risk and who accepted it

A checklist run once and not recorded is a checklist that will be argued about later.
