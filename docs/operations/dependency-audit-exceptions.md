# Dependency-audit exceptions

<!-- not-for-ingestion -->

The dependency audit in CI (`.github/workflows/pr.yml`) runs `pnpm audit --audit-level=high` and
blocks on any HIGH or CRITICAL advisory in the dependency tree. This register is the only legitimate
way to accept one, and the audit step's `--ignore` list must match it entry for entry. The rules are
the image scan's (`image-scan-exceptions.md`):

1. An exception names **one advisory id and the path it arrives by**, never a package or severity.
2. Every exception **expires**, enforced by the CI step itself: past the date the advisory is no
   longer ignored, CI goes red, and someone looks again. Renewing one is a decision, recorded here.
3. The reason says why the advisory cannot be fixed *and* why it does not matter here.
4. An agent may never add, widen or renew an exception unilaterally.
5. **Never in `pnpm-workspace.yaml`.** `pnpm audit --ignore <id>` run locally also writes the id into
   the workspace file's `auditConfig.ignoreGhsas`, where it would never expire. The CI step refuses a
   workspace file that carries one; discard that change before committing.

## Register

| Advisory | Path | Why it cannot be fixed | Why it does not matter here | Expires | Approved by |
|---|---|---|---|---|---|
| `GHSA-vfj7-8cjw-p6xm` (HIGH: `braces` stack exhaustion on deeply nested patterns) | `@next/eslint-plugin-next > fast-glob > micromatch > braces` | `braces` 3.0.3 is the newest release and every version is affected — the advisory lists no patched version. `micromatch` 4 depends on `braces` ^3, so no override or bump reaches a fix | Lint-time only: the ESLint plugin never ships in a bundle or runs in a server. The patterns it expands are the repository's own lint configuration, never input from a user | 2026-11-03 | gevorg33, 2026-10-03 |

## When an exception expires

1. Run `pnpm audit --audit-level=high`. If `braces` (or the path) has a fix, bump or override to it,
   delete the entry and its `--ignore`.
2. If not, and the reasoning still holds, renew with a new expiry here and in the CI step.
3. A new advisory is not covered by an entry made before it: assess it on its own.
