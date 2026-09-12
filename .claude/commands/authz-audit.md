---
description: Audit authorization coverage across endpoints and find IDOR gaps
argument-hint: "[module or path to focus on]"
allowed-tools: Read, Grep, Glob, Bash
---

Load the `authorization` skill. Scope: $ARGUMENTS (if empty, the whole API).

Read-only. Report findings; do not fix them.

For every endpoint in scope, build a table:

| Endpoint | Method | Role check | Resource check | State check | Staff scope | IDOR test |
|---|---|---|---|---|---|---|

Then find the gaps that matter:

1. **Fetch-then-compare** — `findOneById` followed by an ownership comparison. Grep for
   repository calls not scoped by actor.
2. **Guard-only authorization** — a controller decorated but the service unprotected. The
   service is reachable from jobs, events and AI tools.
3. **Missing state checks** — ownership verified but mission/assignment state ignored.
4. **`isStaff` used where a specific scope is required.**
5. **Endpoints with no `*.authz.spec.ts`**, or whose authz test only exercises the owner.
6. **Inconsistent 403/404** for the same resource type — an enumeration oracle.
7. **AI tools** that accept an actor ID as input rather than taking it from the session.

For each finding: severity, the concrete failing scenario (which actor, which inputs,
what leaks), file and line, and the smallest correct fix.

End with a coverage count: endpoints audited, endpoints with a real IDOR test, gaps found.
