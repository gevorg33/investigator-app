# Error taxonomy

One shape for every error, from every module.

```json
{
  "error": {
    "code": "QUOTE_EXPIRED",
    "messageKey": "error.quote.expired",
    "correlationId": "01J8X...",
    "details": [
      { "field": "budgetMaxMinor", "code": "BELOW_MIN", "messageKey": "error.validation.budget.max_below_min" }
    ]
  }
}
```

## Rules

1. **`code` is stable and machine-readable.** Clients branch on it. Renaming one is a breaking
   change.
2. **`messageKey` is a translation key, never an English sentence.** The client renders it in
   the user's locale. The API does not decide wording — see `localization`.
3. **No internal detail in the body.** No stack traces, no SQL, no table or column names, no
   upstream provider errors verbatim. Log those against the correlation ID instead;
   `platform-security-review` treats a leak here as a finding.
4. **`correlationId` is always present**, so a user can quote it to support and it resolves to
   the exact request.
5. **`details` is for field-level validation only.** It is absent otherwise.

## Status codes

| Status | Meaning |
|---|---|
| `400` | Malformed request — unparseable, wrong type |
| `401` | No valid session |
| `403` | Authenticated, not permitted, **and the actor may know the resource exists** |
| `404` | Not found, **or the actor must not learn it exists** |
| `409` | State conflict — the resource is not in a state permitting this |
| `410` | Gone permanently |
| `422` | Well-formed but semantically invalid — validation failures |
| `429` | Rate limited; `Retry-After` set |
| `503` | `SERVICE_UNAVAILABLE`: a dependency (a model provider) is not configured or not answering. Retry later |
| `5xx` | Our fault. Never carries actionable detail |

## Choosing 403 vs 404

This is an information-disclosure decision, not a style one. From the `authorization` skill:

- Actor is a participant but the action is not allowed in this state → **403**
- Actor should not learn the resource exists → **404**

**Be consistent per resource type.** Inconsistency is itself an enumeration oracle — a `403`
for one ID and `404` for another tells an attacker which IDs are real.

## Error codes are owned by their module

Namespaced by domain: `MISSION_*`, `QUOTE_*`, `ASSIGNMENT_*`, `EVIDENCE_*`, `PAYMENT_*`,
`AUTH_*`. Each new code ships with its translation key in en, ru and hy in the same task —
`documentation-first` — and a test refuses one that does not (below).

Codes that must exist before the first module: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_FAILED`, `STATE_CONFLICT`, `RATE_LIMITED`, `IDEMPOTENCY_KEY_REUSED`,
`INTERNAL_ERROR`.

## Every message key has words, in every locale (T-135)

The API sends keys; `packages/i18n` holds their sentences, in `error.*` beside the UI catalogs, so
the typed parity check keeps ru and hy in step with en.

- **A key is written out whole** in the API — `'error.validation.legal.agency_agreement'`, never
  `` `error.validation.legal.${type}` ``. Where a key depends on a value, a map names each one
  (`ACCEPTANCE_REQUIRED_KEY`, a `Record` over the document types, so a new type does not
  compile without its key).
- **A test holds it**: `apps/app-web/src/lib/api/error-catalog.spec.ts` reads every
  `'error.…'` string in the API's source and fails for any without a sentence in en, ru and hy,
  and for any key assembled from parts, which it could not see.
- **A field's own message reaches the reader.** A validation failure's title is generic ("Some
  details need correcting"); `FormError` lists each field's specific message under it — "You can
  have up to 10 service areas" — unless the form shows that field's message beside the field
  (`shown`).

Adding a code or a validation key therefore means adding its sentence in the same change; CI
refuses the change otherwise.
