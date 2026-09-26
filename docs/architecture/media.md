# Media: uploads and delivery

How files get into storage and back out, and who decides. The procedure is
`.claude/skills/cloudinary-media/SKILL.md`; this records what implements it and the storage
constraints that shaped it. Built in T-008.

**Cloudinary stores files. PostgreSQL decides who may touch them.** A public ID is an
identifier, never a capability; folders organise and never authorize.

## Constraints that shaped the design

Verified against Cloudinary's documentation when this was built, because each one closes off
an obvious-looking approach:

| Constraint | Consequence |
|---|---|
| **Signed delivery URLs never expire** | `sign_url` cannot deliver a short-lived link — a leaked one would work forever |
| Expiring token links are an **Advanced-plan** feature | Not assumed |
| `private_download_url` with `expires_at` works on **every plan** | Used for delivery, 5-minute expiry |
| An upload signature is valid for **one hour**, fixed by Cloudinary | The server keeps its own, shorter window (10 minutes) and refuses completion after it |
| **Every posted parameter is signed**, and unsigned ones are rejected | The server fixes the public ID, delivery type, overwrite and formats; the client supplies only the file |
| **File size cannot be constrained by a signature** | Enforced at completion, against what Cloudinary actually holds |

## The flow

```
client ──POST /media/uploads──▶ API: role, category, type & declared size, rate limit
                                     └─ signs {public_id, type=authenticated, overwrite=false,
                                               allowed_formats, timestamp}; writes AUTHORIZED row
client ──upload file──────────▶ Cloudinary (direct)
client ──POST …/:id/complete──▶ API: reads the asset BACK from Cloudinary by the server's ID
                                     └─ checks ID, private type, format vs declared, real size
                                        → READY, or destroy + REJECTED, or destroy + EXPIRED
client ──GET …/:id/delivery-url▶ API: scoped lookup → READY → scan CLEAN → 5-min link, audited
```

The client never sends a public ID. It sends the asset id the server gave it, and the server
looks the public ID up. Nothing the client says about its upload is used at completion.

## Categories

| Category | Uploader | Formats | Max size | Visibility |
|---|---|---|---|---|
| `PROFILE_IMAGE` | Investigator | JPEG, PNG, WebP | 5 MB | `PUBLIC_PROFILE` |
| `VERIFICATION_DOCUMENT` | Investigator | PDF, JPEG, PNG | 15 MB | `STAFF_REVIEW_ONLY` |
| `AGENCY_LOGO` | A member holding `settings.update`, in an agency | JPEG, PNG, WebP | 2 MB | `PUBLIC_PROFILE` |
| `AGENCY_COVER` | A member holding `settings.update`, in an agency | JPEG, PNG, WebP | 5 MB | `PUBLIC_PROFILE` |

An agency's images belong to the agency (`tenant_id`), not to the member who uploaded them: the
uploader is `owner_id`, and completing the upload stays theirs, but any member who may change the
agency's settings can use the file on the profile (T-084).

Size limits are provisional engineering defaults. Mission, evidence and message media arrive
with the entities they attach to.

## Who can obtain a delivery link

| Asset | Owner | Staff with `VERIFICATION` scope | Anyone else |
|---|---|---|---|
| Profile image | Yes | No | **Not yet** — see below |
| Verification document | Yes | Yes, only while acting as staff | No |

Everyone else gets **404**, identical to an id that does not exist.

**An investigator's profile image is still owner-only.** Showing one to other users must respect
the profile's published state — a draft profile's photo must be as invisible as the draft (T-007) —
and that link does not exist yet for investigator profiles.

**An agency's logo and cover have that link (T-084).** They are shown through the agency's
published profile and nowhere else: `MediaService.profileImageLinks` signs them — the one place that
issues media links — for a reader the database lets see them (`public_branding_read`, migration
0024: a file a *published* profile names), and only when READY and scanned CLEAN. The same
five-minute links; not audited, because showing a published logo is not a sensitive access. A draft
profile's images are invisible outside the agency.

## Fails closed

A link is issued only when **both** hold: the upload is `READY`, and the scan status is
`CLEAN`. `PENDING`, `INFECTED` and `FAILED` are all refused, for every caller including the
owner.

**No scanner exists yet (T-065).** Until one does, every asset stays `PENDING` and nothing is
served. That is intentional: marking uploads clean without scanning them would be failing
open, and serving malware to a customer is the failure this gate exists to prevent.

## Never

- A delivery link in a log, audit row, email, push notification or cache. The response field
  is `signedUrl`, which is already on the log-redaction list; the response carries
  `Cache-Control: no-store`; audit rows record who opened which asset, never the link.
- A hard delete from the application role. `media_assets` grants no `DELETE` — removing a row
  without removing the Cloudinary asset, or the reverse, is exactly the drift to avoid.
  Deletion is a privileged, audited retention job that does both.
- A cascade from the owner. The owner key is `restrict`: an account cannot be hard-deleted
  while its files still exist.

## Configuration

`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER`.

- **Local:** optional. Without them, every media operation refuses with an error rather than
  pretending, so a missing account is obvious at the point of use.
- **Staging and production:** all three credentials are required at boot, and the folder must
  end in `/staging` or `/production` respectively — a copied configuration fails loudly rather
  than mixing environments' files.
