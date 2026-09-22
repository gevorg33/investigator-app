# Coverage exclusions

<!-- not-for-ingestion -->

The project enforces **100%** across statements, branches, functions and lines, per package,
as a blocking CI gate.

This register is the only legitimate way to exclude code. An inline ignore comment with no
entry here is uncovered code made invisible — strictly worse than uncovered code the report
shows. `qa-reviewer` flags those specifically.

## Rules

1. Every exclusion is a **path**, never a blanket pattern like `**/*.config.ts`.
2. Every exclusion has a **reason** that says why testing it is inappropriate, not merely hard.
3. Exclusions are reviewed like code. An agent may never add one unilaterally.
4. "Hard to test" is not a reason. It is usually a design signal.
5. Lowering the threshold is not an exclusion — it requires a documented maintainer exception.

## Register

| Path | Reason | Added | Approved by |
|---|---|---|---|
| `apps/api/vitest.config.mts` → compiler-emitted `typeof X === "undefined" ? Object : X` decorator-metadata guards in `apps/api/src/**` | With `emitDecoratorMetadata`, oxc guards every typed constructor/method parameter against a circular import. The `Object` side runs only if the imported class is undefined at decoration time, so no test can reach it without breaking the module graph it protects — every decorated class with a typed parameter carries one permanently uncovered branch, making 100% branches unreachable by construction. Marked by a test-only transform that matches the exact compiler shape (same identifier both sides) and nothing a person writes; Vitest applies the broader equivalent for SWC. Verified: removes exactly those guards (branch paths 184→180, uncovered 41→39, lines and functions unchanged). Fails safe — if the emitted shape changes, nothing matches and the gate goes red | 2026-09-14 | gevorg33 — ACTIONS-FOR-ME #12, option 1 |

## Typically appropriate

Framework bootstrap that only wires the container · generated code (OpenAPI clients, DB
types) · type-only declaration files · migration files, which are verified by applying to a
clean database in CI rather than by unit test.

## Never appropriate

Business rules · authorization logic · state transitions · payment or fee calculation ·
evidence handling · anything in an error branch that a user can actually reach.

An error branch reachable by a real input is the branch most worth testing, because it is the
one least likely to have been exercised by hand.
