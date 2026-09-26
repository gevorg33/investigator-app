import type { Role } from '../../common/authz/contract';
import type { TenantPermission } from '../../common/authz/permissions';

export type MediaCategory =
  'PROFILE_IMAGE' | 'VERIFICATION_DOCUMENT' | 'AGENCY_LOGO' | 'AGENCY_COVER';
export type MediaVisibility =
  'PUBLIC_PROFILE' | 'PARTICIPANT_ONLY' | 'EVIDENCE_RESTRICTED' | 'STAFF_REVIEW_ONLY';

/**
 * Who may upload into a category. A person's own files are theirs by platform role; an agency's
 * are the agency's, uploaded by a member holding the permission in an agency workspace (T-084).
 */
export type Uploader =
  { readonly role: Role } | { readonly permission: TenantPermission; readonly workspace: 'AGENCY' };

export interface CategoryPolicy {
  uploader: Uploader;
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
    uploader: { role: 'INVESTIGATOR' },
    visibility: 'PUBLIC_PROFILE',
    resourceType: 'image',
    maxBytes: 5 * MB,
    formats: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  },
  VERIFICATION_DOCUMENT: {
    uploader: { role: 'INVESTIGATOR' },
    visibility: 'STAFF_REVIEW_ONLY',
    resourceType: 'image',
    maxBytes: 15 * MB,
    formats: { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' },
  },
  // Shown through the agency's published profile, and only then (migration 0024). Changing the
  // agency's look is a settings change, so it takes `settings.update`.
  AGENCY_LOGO: {
    uploader: { permission: 'settings.update', workspace: 'AGENCY' },
    visibility: 'PUBLIC_PROFILE',
    resourceType: 'image',
    maxBytes: 2 * MB,
    formats: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  },
  AGENCY_COVER: {
    uploader: { permission: 'settings.update', workspace: 'AGENCY' },
    visibility: 'PUBLIC_PROFILE',
    resourceType: 'image',
    maxBytes: 5 * MB,
    formats: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
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
