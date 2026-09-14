export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/** What the client needs to upload directly to storage: where to post, and the signed form fields. */
export interface SignedUpload {
  url: string;
  fields: Record<string, string>;
}

/** An asset as storage actually holds it — read back by the server, never reported by the client. */
export interface StoredAsset {
  assetId: string;
  publicId: string;
  version: number;
  format: string;
  bytes: number;
  resourceType: string;
  /** Delivery type. Anything other than `authenticated` means it is not private. */
  type: string;
  width?: number | undefined;
  height?: number | undefined;
  etag?: string | undefined;
}

/**
 * The storage port. Cloudinary is the only implementation; the port exists so the
 * authorization rules can be tested without an account, and so the service depends on what
 * it needs rather than on an SDK.
 */
export interface MediaStorage {
  signUpload(input: { publicId: string; resourceType: string; allowedFormats: string[] }): SignedUpload;
  findAsset(publicId: string, resourceType: string): Promise<StoredAsset | undefined>;
  destroy(publicId: string, resourceType: string): Promise<void>;
  signedDownloadUrl(input: {
    publicId: string;
    format: string;
    resourceType: string;
    expiresAt: Date;
  }): string;
}
