# Profiles

The customer and investigator profiles on one account (`apps/api/src/modules/profiles`). Roles
are activated on the account that exists — never a second account (T-007). The investigator's
screen for all of this is app-web's `/account/investigator` (T-123, `app-web.md`). KB:
`kb-investigator-profile-service-areas`.

## Endpoints

| Route | Who | Returns |
|---|---|---|
| `POST /profiles/roles` | Signed in | Activates `CUSTOMER` or `INVESTIGATOR` with the documents that role requires |
| `GET /profiles/investigator/me` | INVESTIGATOR | The own profile: the public fields plus `contactPhone`, `visibility`, `verificationStatus` |
| `GET /profiles/investigator/me/preview` | INVESTIGATOR | The own profile through the **public projection**, published or not (T-123) |
| `PATCH /profiles/investigator/me` | INVESTIGATOR | Updates any of: `displayName`, headline, bio, years, pricing, rate, currency, phone, `visibility`, `acceptingWork`, languages, specialties, availability — the lists are replaced whole |
| `GET /profiles/investigator/:id` | Signed in | Somebody else's profile through the public projection; 404 unless published |
| `GET /profiles/customer/me`, `PATCH /profiles/customer/me` | CUSTOMER | The own customer profile |
| `GET /profiles/customer/:id` | Signed in | Deliberately almost nothing |

## One projection for the public view and the preview

`toPublicInvestigatorProfile` (`profile.projection.ts`) names every public field; nothing else
leaves. The preview route returns that same function's output for the caller's own row, so
"Preview as a customer" is exactly what `GET /profiles/investigator/:id` would return once
published — the test asserts the preview's key set is the public one, and that
`verificationStatus` is visible to its owner and absent from the preview.

## The name, and when it is locked

`displayName` is the account's name (`users.display_name`), so it is the same name on both
sides of the account. It is editable (1–80 characters, not blank, trimmed) **until
verification**: while the profile is `PENDING` or `VERIFIED` a change is refused whole with 422
`LOCKED` / `error.validation.display_name.locked`, because reviewers checked the documents against
that name (owner decision, 2026-09-25). Sending the unchanged name is not a change and is
accepted, so a form that posts every field still saves. A rename writes its own audit event,
`profile.display_name_changed`, alongside `profile.updated` — the names themselves are not copied
into the log.

Changing a verified name needs a support path that re-verifies; it is not built (T-148).
