# Coverage exclusions

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
| _(none yet)_ | | | |

## Typically appropriate

Framework bootstrap that only wires the container · generated code (OpenAPI clients, DB
types) · type-only declaration files · migration files, which are verified by applying to a
clean database in CI rather than by unit test.

## Never appropriate

Business rules · authorization logic · state transitions · payment or fee calculation ·
evidence handling · anything in an error branch that a user can actually reach.

An error branch reachable by a real input is the branch most worth testing, because it is the
one least likely to have been exercised by hand.
