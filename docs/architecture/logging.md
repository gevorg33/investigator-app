# Logging guarantees

What the application will and will not write to its logs. Each rule below is covered by a
test that writes a real payload through the configured logger — not by checking a list of
strings — because a listed-but-ineffective rule looks identical to a working one.

## Never written

| | How |
|---|---|
| Passwords, password hashes | Redacted, top level and one level nested |
| Tokens, refresh tokens, session secrets, generic `secret` fields | Redacted |
| Signed URLs, card numbers | Redacted |
| **Email addresses** | Redacted. Added in T-063: an object carrying an address was written in the clear |
| `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key` headers | Redacted |
| **Query strings** | Dropped. A request is logged by path only — query strings carry personal data |
| **Database server notices** | Swallowed. The driver's default prints them to the console, a notice can quote the statement that raised it, and console output is not redacted |

Redacted values appear as `[redacted]`.

The audit log records who acted **by id**, so an address or name never needs to be in a log
line to reconstruct what happened.

## Always written

- A **correlation id** on every request, echoed back in the `x-correlation-id` response
  header. A client-supplied id is accepted only if it is 8–64 characters of
  `[A-Za-z0-9_-]`; anything else is replaced, so the header cannot inject content into a log
  line.

## Levels

`LOG_LEVEL` sets the level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`), defaulting
to `info`. `NODE_ENV=development` switches to human-readable output; every other environment
writes JSON.

## Adding a field that could carry personal data

Add its path to `REDACT_PATHS` in `apps/api/src/common/logging/logger.options.ts`, **and**
add the value to the real-payload test in `logger.options.spec.ts`. The second step is the one
that proves the first worked.
