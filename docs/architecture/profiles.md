# Profiles

The customer and investigator profiles on one account (`apps/api/src/modules/profiles`). Roles
are activated on the account that exists — never a second account (T-007). The investigator's
screen for all of this is app-web's `/account/investigator` (T-123, `app-web.md`). KB:
`kb-investigator-profile-service-areas`.

## Endpoints

| Route | Who | Returns |
|---|---|---|
| `POST /profiles/roles` | Signed in | Activates `CUSTOMER` or `INVESTIGATOR` with the documents that role requires |
| `GET /profiles/investigator/me` | INVESTIGATOR | The own profile: the public fields plus `displayName`, `pseudonym`, `publicName`, `contactPhone`, `visibility`, `verificationStatus` |
| `GET /profiles/investigator/me/preview` | INVESTIGATOR | The own profile through the **public projection**, published or not (T-123) |
| `PATCH /profiles/investigator/me` | INVESTIGATOR | Updates any of: `displayName`, headline, bio, years, pricing, rate, currency, phone, `visibility`, `acceptingWork`, languages, specialties, availability — the lists are replaced whole |
| `GET /profiles/investigator/:id` | Signed in | Somebody else's profile through the public projection; 404 unless published |
| `GET /profiles/customer/me`, `PATCH /profiles/customer/me` | CUSTOMER | The own customer profile |
| `PATCH /profiles/investigator/me` `pseudonym`, `publicName` | INVESTIGATOR | The pseudonym, `null` clears it (T-181); which name customers see, `PSEUDONYM` or `LEGAL` (T-182) |
| `GET /profiles/customer/:id` | Signed in | Deliberately almost nothing: `{ id, displayName }`, and `displayName` is `null` unless the caller is that customer or an investigator they hired — an assignment between them, not cancelled (T-100) |

## One projection for the public view and the preview

`toPublicInvestigatorProfile` (`profile.projection.ts`) names every public field; nothing else
leaves. The preview route returns that same function's output for the caller's own row, so
"Preview as a customer" is exactly what `GET /profiles/investigator/:id` would return once
published — the test asserts the preview's key set is the public one, and that
`verificationStatus` is visible to its owner and absent from the preview.

**Verified, and nothing more** (T-120, owner decision 2026-09-26). The projection carries
`verified: boolean` — `verificationStatus === 'VERIFIED'` — so a customer's profile page and the
investigator's own preview can say so. Only the yes or no is public: `PENDING` and `REJECTED` both
read as `false`, so an applicant's standing is never shown, and the status itself never leaves in
the public view (tested for each status). Discovery results carry it too; they are always `true`,
because only verified investigators are eligible (`discovery.md`).

## Two names: the legal one, and the one customers see (T-181, T-182)

Owner decisions, 2026-10-01: customers know an investigator by a pseudonym the investigator chooses,
not their legal name — before hire or after (T-181). The investigator may instead choose to be known
by their legal name (T-182): `investigator_profiles.public_name`, enum `public_name_choice`
(`PSEUDONYM` | `LEGAL`, migration 0036), `PSEUDONYM` by default for new and existing profiles. The
public projection's `name` is the chosen one — `pseudonym`, or `users.display_name` when `LEGAL` — and
search, the assistant's tool output and block labels take it from the same rule. Choosing `LEGAL`
keeps the stored pseudonym, so switching back restores it; the details form hides the pseudonym field
while `LEGAL` is chosen and does not send it.

| | Legal name | Pseudonym |
|---|---|---|
| Column | `users.display_name` | `investigator_profiles.pseudonym` (migration 0035) |
| Who sees it | The investigator (`OwnInvestigatorProfile.displayName`), staff; everyone, as `name`, only when `publicName` is `LEGAL` | Everyone, as `name`, while `publicName` is `PSEUDONYM`; the owner always (`OwnInvestigatorProfile.pseudonym`) |
| Rules | Below | 2–60 characters (CHECK); unique without case (`investigator_profiles_pseudonym_unique` on `lower(pseudonym)`); may not share a word of three letters or more with the legal name — even a first name, since free text does not say which word is which — nor carry an email, a web address or six digits (`pseudonym.ts`). Refusals: `OWN_NAME`, `CONTACT`, `TAKEN` on field `pseudonym` |
| Unset | `name` is `null` and `nameCode` stands in | `null`; the public projection's `nameCode` (`opaqueCode('investigator-name', profileId)`) stands in, and the app shows "Investigator {code}" in the reader's language |

`PublicInvestigatorProfile` has no `displayName` at all: it is an allowlist, and its one `name` takes
the legal name only on the investigator's choice, so the legal name cannot reach a customer by being
forgotten. When a save changes either name the pair is checked again, so a
rename cannot make an existing pseudonym reveal the new legal name. **Held by**
`test/identity-masking.spec.ts`, which walks every read as a customer who has hired the investigator
and fails on their first name, surname, email, phone or user id; with `LEGAL` chosen it expects the
legal name as `name` and still fails on email, phone or user id.

## The legal name, and when it is locked

`displayName` is the account's name (`users.display_name`), so it is the same name on both
sides of the account. It is editable (1–80 characters, not blank, trimmed) **until
verification**: while the profile is `PENDING` or `VERIFIED` a change is refused whole with 422
`LOCKED` / `error.validation.display_name.locked`, because reviewers checked the documents against
that name (owner decision, 2026-09-25). Sending the unchanged name is not a change and is
accepted, so a form that posts every field still saves. A rename writes its own audit event,
`profile.display_name_changed`, alongside `profile.updated` — the names themselves are not copied
into the log.

Changing a verified name needs a support path that re-verifies; it is not built (T-148).
