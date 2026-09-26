import type { Role } from '../../common/authz/contract';

export type MediaCategory = 'PROFILE_IMAGE' | 'VERIFICATION_DOCUMENT';
export type MediaVisibility =
  'PUBLIC_PROFILE' | 'PARTICIPANT_ONLY' | 'EVIDENCE_RESTRICTED' | 'STAFF_REVIEW_ONLY';

export interface CategoryPolicy {
  /** The role that may upload into this category. */
  uploaderRole: Role;
  visibility: MediaVisibility;
  resourceType: 'image';
  maxBytes: number;
  /**
   * The allowlist, as declared MIME type → the format Cloudinary reports. Anything absent
   * is refused. PDFs are an `image` resource in Cloudinary, which is why both categories
   * share one resource type.
   */
  formats: Readonly<Record<string, string>>;
}

const MB = 1024 * 1024;

/**
 * Per-category rules. Size limits are PROVISIONAL engineering defaults — large enough for a
 * phone photo or a scanned licence, small enough that an upload is not a way to fill the
 * account.
 */
export const MEDIA_POLICY: Readonly<Record<MediaCategory, CategoryPolicy>> = {
  PROFILE_IMAGE: {
    uploaderRole: 'INVESTIGATOR',
    visibility: 'PUBLIC_PROFILE',
    resourceType: 'image',
    maxBytes: 5 * MB,
    formats: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  },
  VERIFICATION_DOCUMENT: {
    uploaderRole: 'INVESTIGATOR',
    visibility: 'STAFF_REVIEW_ONLY',
    resourceType: 'image',
    maxBytes: 15 * MB,
    formats: { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' },
  },
};

export const MEDIA_CATEGORIES = Object.keys(MEDIA_POLICY) as MediaCategory[];

/**
 * How long the server honours an upload authorization. Cloudinary fixes its own signature at
 * one hour and that cannot be shortened, so this window is the one that actually limits
 * how long an authorization is good for: completion after it is refused and the asset
 * destroyed.
 */
export const UPLOAD_AUTHORIZATION_TTL_SECONDS = 10 * 60;

/** Lifetime of a delivery link. Short enough that a leaked link is close to useless. */
export const DELIVERY_URL_TTL_SECONDS = 5 * 60;
