---
description: Scaffold a new NestJS domain module following repo conventions
argument-hint: "<module-name> [brief purpose]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

Load the `nest-module` skill. Scaffold the module: $ARGUMENTS

Before creating files:

1. Confirm the module is in `plan.md` §5's module list, or explain why a new one is
   justified.
2. Read an existing module to match its conventions. Do not invent a parallel structure.
3. State which other modules this one will need, and whether it will reach them via
   injected service or domain event.

Create the full structure: `domain/` (entity, pure rules, events), `application/`
(service with authorization and transactions), `infrastructure/` (repository — the only
DB caller), `api/` (thin controller, DTOs), `__tests__/` including `*.authz.spec.ts`.

Define the Zod schema in `packages/validation` and reuse it — do not declare shapes twice.

Then:
- Register the module
- Run `pnpm typecheck`
- Report what is scaffolded versus what still needs implementing, and whether a migration
  is needed (hand that to the `database` agent — do not write it here).
