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
| `GET /agencies/current/investigators` | `investigators.read` in an agency | The profiles the agency holds: the owner's view of each, plus `membershipId` and `holderStatus` (T-087) |
| `POST /agencies/current/investigators` `{ membershipId }` | `investigators.create` in an agency | A profile for that member, who holds it (T-087) |
| `GET`, `PATCH /agencies/current/investigators/:id` | `investigators.read`, `investigators.update` | One held profile; its storefront (T-087) |
| `GET`, `POST /agencies/current/investigators/:id/service-areas`, `DELETE …/:areaId` | `investigators.read`, `investigators.update` | A held profile's service areas, the same shapes and limits as `/service-areas/me` (T-087) |

The `…/me` routes answer for the profile the caller holds **in the workspace the request acts in**
(T-087): in their Personal workspace their own, in an agency the one the agency holds for them, and
never one for the other — a published Personal profile is readable from every workspace, so the
repository's scope names the workspace as well as the person.

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

## Profiles under workspaces (T-087)

A profile belongs to a workspace and is held by one membership of it (tenancy.md §2). An independent
investigator's profile is in their Personal workspace; an agency runs several, one per person, and
the same person may hold one in their Personal workspace and one in each agency they work for.
Identity — the legal name, email, phone — is the account's and is never copied onto a profile.

- **Held by a membership.** `investigator_profiles (tenant_id, user_id)` references
  `tenant_memberships (tenant_id, user_id)` (`investigator_profiles_membership_fk`, migration 0037,
  deferred to commit), so a profile cannot be made for someone who is not a member of its workspace,
  whoever writes. `UNIQUE (tenant_id, user_id)` (T-076) is one per person per workspace.
- **Made by the agency.** `POST /agencies/current/investigators` with `investigators.create`, for an
  ACTIVE member (403 otherwise; another agency's membership is 404) who has taken up the
  `INVESTIGATOR` role themself — that role carries the terms an investigator accepts, which an agency
  cannot accept for someone (409 `NOT_AN_INVESTIGATOR`). A second for the same person is 409
  `ALREADY_HELD`. It starts as every profile does: a draft, unverified, not accepting work. Audited
  `agency_investigators.created`, the membership as the reason.
- **A role is taken up in the Personal workspace.** `POST /profiles/roles` outside it is 403
  (`workspace_kind_forbidden`): the profile it creates would otherwise belong to the agency the tab
  was showing, which the agency never decided.
- **What the agency writes is the storefront** (`InvestigatorStorefrontDto`): headline, bio,
  experience, pricing, rate, currency, phone, visibility, accepting work, pseudonym, languages,
  specialties, availability, and service areas. **Not** the legal name, which is the account's, and
  **not** `publicName`, since an agency choosing the legal name for an agent waits for the agent's
  consent (T-183) — the pipe refuses both fields (400 `NOT_ALLOWED`) and the service drops
  `publicName` for in-process callers. The pseudonym is checked against the **holder's** legal name.
  Audited `profile.updated` with reason `agency`.
- **From the agency, the holder cannot rename themself or choose `LEGAL`** on their own route either
  (403 `state_forbids_action`): the legal-name lock reads only the profile in the current workspace,
  and the choice waits for T-183. Both stay available in the Personal workspace.
- **A holder who leaves takes the profile out of the listing.** When a membership leaves ACTIVE
  (suspended or removed), trigger `tenant_memberships_withdraw_profile` sets their profile in that
  workspace back to a draft, not accepting work. It runs with the writer's own rights, never raised:
  only the workspace itself and platform staff can move a membership's status, and both may update
  that workspace's profiles. Reactivating does not republish; while the holder is away the agency
  cannot publish the profile or set it to take work (409 `HOLDER_INACTIVE`).
- **Customers see the agency.** The public projection carries `agency: { id, name } | null` — `null`
  for a Personal workspace; otherwise the published agency profile's display name, else the
  registered name (a draft agency profile's name is never used, so the preview matches). Discovery,
  the assistant's `searchInvestigators` output and the profile page take it from the same projection.
- **Quoting as the agency.** A member holding `investigations.create` quotes with the profile the
  agency holds for them, published, verified and accepting work as discovery requires; the quote's
  supplier party is the agency. Their Personal profile never acts for the agency (404). Naming
  another member's profile as the lead is T-089.

**Not here.** Verification of an agency-held profile uses the holder's own route, which needs
`investigators.update` — today an agent without it cannot apply (T-071 decides per-scope
verification). An invitation naming a profile to take over (tenancy.md §2) is T-184. The agency
console's screens are T-093.

