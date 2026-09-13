# API conventions

Decided once, before the first module, so modules consume these rather than inventing them.
Implemented as shared primitives in `apps/api/src/common/`.

| Concern | Document |
|---|---|
| Error shape and codes | `errors.md` |
| Pagination and filtering | `pagination.md` |
| Idempotency | `idempotency.md` |
| Health endpoint | `health.md` |

## Versioning

URL-versioned: `/api/v1/...`. One version in flight at a time for the MVP.

A breaking change means a new version, not a mutation of the old one. Breaking includes:
removing or renaming a field, narrowing a type, adding a required request field, changing an
error code's meaning, or changing a default.

Additive changes — a new optional request field, a new response field, a new endpoint, a new
enum value the client is told to tolerate — ship in place.

Deprecation: announce, serve both, set a removal date, then remove. `Deprecation` and `Sunset`
headers on the old version. Mobile clients cannot be force-upgraded, so a version stays until
its usage is actually zero, not until the date passes.

## Correlation

Every request carries a correlation ID — accepted from `X-Correlation-Id` if the client sends
one, generated otherwise. It is returned on the response, propagated into logs, into BullMQ
jobs, and into outbound webhook calls.

Without it, reconstructing a multi-step flow during a dispute is guesswork. See
`audit-logging`.

## Content and casing

JSON only. `camelCase` field names. Timestamps are ISO 8601 with an explicit offset, in UTC.
Money is **integer minor units plus an explicit currency code**, never a float and never a
preformatted string — see `payments-webhooks`.

Enums are `SCREAMING_SNAKE_CASE` strings, never integers. Clients must tolerate an unknown
enum value rather than crashing.

## Responses are projections

Endpoints return purpose-built projections, never ORM entities. An entity serialized directly
will eventually leak a field nobody intended — `platform-security-review` treats this as a
finding.

## Authentication

Session cookies, host-only, `SameSite=Strict`, on `app.` and `admin.` separately — see
ADR-0002 and ADR-0004. The API is same-origin with each front-end, so there is no CORS
preflight on normal traffic.

## Rate limiting

Per actor and per IP, applied per endpoint class: authentication, upload, search, export and
AI each have their own budget. `429` carries `Retry-After`. Limits are documented per endpoint
in OpenAPI.
