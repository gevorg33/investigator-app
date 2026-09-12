---
description: Add or review an AI assistant tool against the registry contract
argument-hint: "<tool name> [what it does]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

Load the `ai-tool-registry` skill. Tool: $ARGUMENTS

First, answer these before writing anything:

1. Is this read or write? **If it mutates business state, stop — this needs human
   approval** (AGENTS.md). Say what specifically needs approving.
2. Could the model reach data the caller cannot? Trace it.
3. Is it purpose-built? If it takes a table name, a column list, a filter object, a file
   path, or any string that reaches a query, redesign it.
4. Does an existing tool already cover this? Do not add a near-duplicate.

Then implement with all nine declaration fields: name, description, requiredRoles,
resourceScope, operation, confirmation, input schema, output schema, auditEvent,
rateLimit.

Required in the implementation:
- Actor from the authenticated session, never from input
- The six authorization checks re-run inside the tool
- Output as a schema-validated projection, not an entity
- Audit with redacted arguments
- Write tools: confirmation bound to the exact proposed arguments, single-use

Write the tests, including the **prompt injection test**: content containing instructions
addressed to the model must not cause a call.

Report the full declaration, the authorization path, and the injection test result.
