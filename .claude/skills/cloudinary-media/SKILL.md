---
name: cloudinary-media
description: The signed-upload and authorized-delivery flow for Cloudinary — profile images, verification documents, mission attachments, evidence and report media. Use whenever code uploads, stores, serves, or deletes a file, or issues a delivery URL.
---

# Cloudinary media

Cloudinary is a media platform, **not** the authorization layer. PostgreSQL decides who
may access a file. A public ID is an identifier, never a capability.

## Upload flow (plan.md §14)

1. Client asks the API for upload authorization, declaring category, MIME type, size.
2. Backend verifies actor, role, relationship to the mission/assignment, the category's
   rules, and the size/type allowlist.
3. Backend returns a **restricted, short-lived** upload signature — scoped to a folder,
   a resource type, and constrained parameters.
4. Client uploads directly to Cloudinary.
5. Backend validates the result (the asset exists, matches what was authorized, and the
   returned public ID is inside the folder the signature scoped).
6. Backend writes the `media_assets` row with ownership metadata.
7. Access is granted only after backend authorization.
8. Delivery is a short-lived signed URL or an authenticated proxy response.
9. Every sensitive access is audited.

Step 5 is the one that gets skipped. Without it, a client can upload anything anywhere
within the signature's scope and tell you it did something else.

## Never

- Store sensitive media as a public resource type. Evidence, verification documents and
  message attachments are private/authenticated resources.
- Trust a client-supplied public ID. Look it up in `media_assets` and verify ownership.
- Return a long-lived delivery URL, put one in a push notification, an email, a log, or a
  client-side cache.
- Use folder naming as an access control. Folders organize; the database authorizes.
- Delete from Cloudinary without marking the database row deleted, or vice versa.

## `media_assets`

Owner, resource category, related entity type and ID, Cloudinary asset ID and public ID,
resource type, delivery type, version, format, MIME type, size, dimensions/duration,
checksum, upload status, virus-scan status, visibility classification, retention date,
deleted timestamp, timestamps.

Visibility classification drives policy: `PUBLIC_PROFILE`, `PARTICIPANT_ONLY`,
`EVIDENCE_RESTRICTED`, `STAFF_REVIEW_ONLY`.

## Delivery

```ts
async getDeliveryUrl(actor: Actor, assetId: string): Promise<{ url: string; expiresAt: Date }> {
  const asset = await this.repo.findForActor(assetId, actor);   // scoped
  if (!asset) throw new NotFoundException();
  if (asset.uploadStatus !== 'READY') throw new ConflictException();
  if (asset.virusScanStatus !== 'CLEAN') throw new ForbiddenException();

  await this.grants.assertAccess(actor, asset);   // evidence needs an explicit grant
  await this.audit.record({ actor, action: 'media.access', resource: asset });

  return this.cloudinary.signedUrl(asset, { ttlSeconds: 300 });
}
```

Short TTL. Audited. Scoped query. Scan status checked before serving.

## Scanning

Uploads are not visible to another user until the virus scan reports clean. Scanning is a
BullMQ job; the asset sits in `PENDING_SCAN` until it finishes. Failing open here means
serving malware to a customer.

## Environments

Separate Cloudinary folders or sub-accounts per environment. A staging job must never be
able to reach production evidence. Validate webhook signatures if webhooks are used.

## Retention

Every media category has a retention rule written down before the category ships:
verification documents, evidence, reports, message attachments, deleted-account data.
Deletion removes the Cloudinary asset *and* marks the row — and is audited.

## Checklist

- [ ] Upload authorized server-side before the signature is issued
- [ ] Signature is scoped and short-lived
- [ ] Upload result validated against what was authorized
- [ ] Private resource type for anything sensitive
- [ ] Delivery URL short-lived, audited, never logged or cached
- [ ] Scan status gates visibility
- [ ] Retention rule defined
