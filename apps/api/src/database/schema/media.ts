import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * What a file is for. Each category has its own formats, size limit, visibility and
 * retention (common/media/media.policy.ts). Only categories with an owning feature exist:
 * mission, evidence and message media arrive with the entities they attach to.
 */
export const mediaCategory = pgEnum('media_category', ['PROFILE_IMAGE', 'VERIFICATION_DOCUMENT']);

/** Who may be shown a file, from the cloudinary-media skill. The database authorizes; folders do not. */
export const mediaVisibility = pgEnum('media_visibility', [
  'PUBLIC_PROFILE',
  'PARTICIPANT_ONLY',
  'EVIDENCE_RESTRICTED',
  'STAFF_REVIEW_ONLY',
]);

/**
 * AUTHORIZED — a signature was issued and the upload has not been confirmed.
 * READY      — the server read the asset back from Cloudinary and it matched what was authorized.
 * REJECTED   — it did not match (format, size, delivery type), and the asset was destroyed.
 * EXPIRED    — the authorization window closed before completion.
 */
export const mediaUploadStatus = pgEnum('media_upload_status', [
  'AUTHORIZED',
  'READY',
  'REJECTED',
  'EXPIRED',
]);

/** PENDING until a scanner reports. Only CLEAN is ever served — failing closed. */
export const mediaScanStatus = pgEnum('media_scan_status', ['PENDING', 'CLEAN', 'INFECTED', 'FAILED']);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // restrict, not cascade: a file outlives nothing silently. Deleting an account must go
    // through the retention workflow, which removes the Cloudinary asset and marks the row.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    category: mediaCategory('category').notNull(),
    visibility: mediaVisibility('visibility').notNull(),

    /** Assigned by the server when authorizing. A client never names a path. */
    publicId: text('public_id').notNull(),
    resourceType: text('resource_type').notNull(),
    deliveryType: text('delivery_type').notNull().default('authenticated'),

    /** What the client claimed. Compared against what Cloudinary actually holds. */
    declaredMimeType: text('declared_mime_type').notNull(),
    declaredBytes: integer('declared_bytes').notNull(),

    /** What Cloudinary actually holds, read back by the server — never taken from the client. */
    cloudinaryAssetId: text('cloudinary_asset_id'),
    version: integer('version'),
    format: text('format'),
    bytes: integer('bytes'),
    width: integer('width'),
    height: integer('height'),
    etag: text('etag'),

    uploadStatus: mediaUploadStatus('upload_status').notNull().default('AUTHORIZED'),
    scanStatus: mediaScanStatus('scan_status').notNull().default('PENDING'),

    /** The server's own window. Cloudinary's signature lives an hour; this is much shorter. */
    authorizationExpiresAt: timestamp('authorization_expires_at', { withTimezone: true }).notNull(),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('media_assets_public_id_unique').on(t.publicId),
    index('media_assets_owner_idx').on(t.ownerId),
    // Staff review queues list by category and state.
    index('media_assets_category_status_idx').on(t.category, t.uploadStatus),
  ],
);
