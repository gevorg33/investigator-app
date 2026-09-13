# Health endpoint

`GET /api/v1/health` — unauthenticated, for load balancers and uptime monitors.

## Response

Always **200**. The body says whether the service is healthy; a status code that flips on a
dependency outage makes a monitor restart a process that is not the problem.

```json
{
  "status": "ok",
  "service": "investigator-api",
  "version": "0.0.0",
  "uptimeSeconds": 1234,
  "dependencies": { "database": "up", "redis": "not_configured" }
}
```

| Field | Meaning |
|---|---|
| `status` | `ok`, or `degraded` when any dependency is `down` |
| `dependencies.database` | `up` only after a real `select 1` round trip; `down` if it fails **or takes longer than 2 seconds** |
| `dependencies.redis` | `not_configured` — nothing in the application talks to Redis yet, so there is nothing to check |

## Rules

- **A dependency is never reported `up` without being checked.** Until T-063 the database was
  hard-coded `not_configured` — a leftover from before it was provisioned, while the
  application was using it. Reporting an unchecked state is wrong in either direction.
- **The check is bounded.** The driver's connect timeout is thirty seconds; a health check
  that hangs that long is no use to whatever polls it.
- **No failure detail in the body.** A connection error stays in the logs against the
  correlation id. This endpoint is public.

Implemented in `apps/api/src/modules/health/health.controller.ts`; behaviour covered by
`health.controller.spec.ts`.
