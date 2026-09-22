---
name: ci-cd
description: The CI/CD contract — pipeline stages, branch and environment model, coverage gates, migration safety, and production deployment protection. Use when writing or changing a workflow, adding a pipeline stage, deploying, running a migration against a shared environment, or touching branch protection.
---

# CI/CD

```
Code → Tests → Coverage → CI → Review → Staging → Verification → Production
```

No feature is complete until its implementation, tests, documentation, CI behaviour,
deployment behaviour and production considerations are all addressed.

## Branch and environment model

```
feature/*  ──PR──►  dev  ──►  STAGING      (automatic)
hotfix/*   ──PR──►  prod ──►  PRODUCTION   (manual approval)
dev        ──PR──►  prod ──►  PRODUCTION   (manual approval)
```

| Branch | Environment | Deploy |
|---|---|---|
| `feature/*` | none — CI only | never |
| `dev` | staging | automatic on merge |
| `prod` | production | **manual approval, always** |

`hotfix/*` branches from `prod` and merges to `prod`, then is **backported to `dev`
immediately**. Without the backport the next `dev → prod` promotion silently reverts the fix —
this is the most common way a hotfix gets lost.

Promotion to production is a PR from `dev` to `prod`, tagged on merge. Never a direct push,
never a force-push, never from an arbitrary branch.

## Pipeline — every PR, every push to an open PR

```
fresh environment → install → knowledge base → lint → typecheck
  → provision clean database → migrate → fixtures → tests + coverage gate
  → build → no public source maps → dependency audit → image scan → secret scan
  → destroy environment
```

Everything that needs no database runs before one is built, so a lint error fails in seconds.

Rules:

1. **Fresh environment every run.** No cached database, no reused container, no state from a
   previous run. A test that passes only against an already-migrated database is a test that
   will fail on a new machine and pass in CI — the worst combination.
2. **The database is provisioned and migrated from empty**, every relevant run. This is what
   proves migrations actually apply in sequence to a clean database.
3. **Fail fast, but run the whole suite.** Lint failing should not hide twelve test failures.
4. **Destroy the environment**, including volumes. A leaked volume becomes the state the next
   run accidentally depends on.
5. **A step runs something, or it does not exist** (T-042). `--if-present` is banned in the
   workflow: it turns a script no package defines into a green step, and a green step that
   runs nothing is indistinguishable from a passing one. Four steps were in that state —
   `fixtures:load`, `test:integration`, `test:api`, `test:e2e` — as was the coverage gate for
   four tasks (T-063). `pnpm -r <script>` fails by itself when nothing defines the script, and
   `apps/api/test/workspace-scripts.spec.ts` refuses the flag, refuses a script the workflow
   names but nothing defines, and refuses a root script that delegates to nothing.
6. **One test step, not four.** There is one suite; naming a split the suite does not make
   produced three steps that each ran everything or nothing. Coverage runs the tests, so
   `pnpm test:coverage` is the step, and a failure in it names either the test or the number.

## Pinned, scanned, proposed, reviewed (T-028)

- **Actions by commit SHA**, with the version as a comment. A tag is a promise the publisher can
  move; a compromised action tag is how supply-chain attacks on CI have happened.
- **Images by digest**, and the same digest in CI and local development. CI once ran Redis 7 while
  every laptop ran 8.
- **Scanned** with Trivy, run from its own digest-pinned image rather than a third-party action.
  CRITICAL or HIGH blocks when a fix exists. Postgres is scanned as it would be deployed — built
  from its Dockerfile, which upgrades Debian's packages over the pinned base.
- **Exceptions** only by CVE id, on one path, with an expiry, in `.trivyignore.yaml` and the
  register `docs/operations/image-scan-exceptions.md`. An agent never adds or renews one.
- **Dependabot** proposes updates weekly for npm, actions, the Dockerfile and compose, after a
  seven-day cooldown (the pinning policy). Security updates skip the cooldown. Nothing merges by
  itself; `supply-chain.spec.ts` refuses a workflow that auto-merges.
- **No source maps in public bundles**, checked on the build output by
  `scripts/check-no-public-sourcemaps.sh`. The API keeps its maps.

## Secrets and forks

- **Production secrets never appear in PR CI.** Not for any branch, not for any actor.
- **A PR from a fork receives no secrets.** GitHub does not grant them by default — do not
  work around it.
- **Never use `pull_request_target` to give fork PRs access to secrets.** It runs the base
  repository's workflow with write-scoped credentials against untrusted code. This is a
  privilege-escalation vector, not a convenience.
- Staging secrets are separate from production secrets. A staging compromise must not reach
  production.
- CI uses least-privilege tokens. Default `GITHUB_TOKEN` permissions are read-only; a job
  needing more requests exactly what it needs.

## GitHub Environments

| Environment | Branch | Protection |
|---|---|---|
| `staging` | `dev` | Automatic; staging secrets only |
| `production` | `prod` | **Required reviewers**, restricted to the `prod` branch, production secrets only |

Production deployment, production migration, rollback and any production infrastructure
operation are **manual, approval-gated jobs**. They are never triggered by a push.

## Migrations

Migrations are deployable artifacts, not a side effect of a deploy.

CI must verify that migrations apply to a clean database, in sequence, without depending on
manually modified state. See `db-migration`.

| Environment | Execution |
|---|---|
| CI | Automatic, from empty, every run |
| Staging | Automatic as part of deployment |
| Production | **Manual, approval-gated job**, separate from the application deploy |

Before a production migration: verify a **fresh backup exists and is restorable**, run the
migration in a transaction where the operation permits it, capture migration logs as an
artifact, and have the recovery path written down beforehand.

**On rollback, be honest.** `db-migration` mandates expand/contract precisely because a
contract step usually cannot be reversed — the data is gone. The recovery path for a
destructive migration is *restore from backup*, not `migration:revert`. Say which one applies
before running it.

Never modify a production schema by hand. A hand-applied change makes every subsequent
migration's assumptions false.

## Production safety

- `prod` protected: required reviews, required status checks, no force-push, no deletion
- Production environment requires named approvers
- Deployments tagged and recorded; the running version is queryable
- Health checks and smoke tests after deploy, with automatic failure surfacing
- Rollback procedure documented and exercised, not theoretical
- Deployment and migration audit logs retained

**A developer must never be able to deploy to production by pushing to a branch.**

## Designed to grow

The pipeline must not assume one server forever. Keep deployment artifact-based (build once,
promote the same artifact through environments) so the same build can later be deployed to
several instances, behind a load balancer, alongside separate worker and AI-worker processes,
with replicas and a CDN. Environment differences belong in configuration, never in the build.

## Checklist for a workflow change

- [ ] Fresh environment; nothing reused from a previous run
- [ ] Database provisioned and migrated from empty
- [ ] Environment destroyed at the end, volumes included
- [ ] No production secret reachable from PR CI
- [ ] No `pull_request_target` granting secrets to untrusted code
- [ ] Least-privilege token permissions declared
- [ ] Production jobs manual and approval-gated
- [ ] Migration job separate from deploy in production
- [ ] Coverage gate present and blocking
- [ ] Every step runs something — no `--if-present`, no script nothing defines
- [ ] Actions pinned by commit SHA with a version comment; images pinned by digest (T-028)
- [ ] `verify` is a required status check on `dev` and `prod` — without it every gate above
      blocks only by convention
