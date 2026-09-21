import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { currentContext } from '../../common/context/execution-context';
import { AppError } from '../../common/errors/app-error';
import type { MediaStorage, SignedUpload, StoredAsset } from './media.storage';

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Every asset is `authenticated`: neither the original nor any derived version is reachable
 * without a signature.
 */
const DELIVERY_TYPE = 'authenticated';

export class CloudinaryStorage implements MediaStorage {
  constructor(private readonly creds: CloudinaryCredentials) {
    cloudinary.config({
      cloud_name: creds.cloudName,
      api_key: creds.apiKey,
      api_secret: creds.apiSecret,
      secure: true,
    });
  }

  /**
   * Cloudinary signs every posted parameter and rejects any the signature does not cover, so
   * the server fixes all of them: the exact public ID, the private delivery type, no
   * overwriting, and the format allowlist. The client supplies only the file.
   *
   * What a signature cannot constrain is size. That is checked when the upload completes,
   * against the asset as Cloudinary actually holds it.
   */
  publicIdFor(category: string): string {
    // No workspace means no path: an upload happens inside a request, and a request has one.
    const tenantId = currentContext()?.tenantId;
    if (tenantId === undefined) throw new AppError('INTERNAL_ERROR');
    const folder = process.env['CLOUDINARY_FOLDER'] ?? 'investigator/development';
    return `${folder}/tenant/${tenantId}/${category.toLowerCase().replace(/_/g, '-')}/${randomUUID()}`;
  }

  signUpload(input: { publicId: string; resourceType: string; allowedFormats: string[] }): SignedUpload {
    const params = {
      allowed_formats: input.allowedFormats.join(','),
      overwrite: 'false',
      public_id: input.publicId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: DELIVERY_TYPE,
    };
    const signature = cloudinary.utils.api_sign_request(params, this.creds.apiSecret);
    return {
      url: `https://api.cloudinary.com/v1_1/${this.creds.cloudName}/${input.resourceType}/upload`,
      fields: { ...params, api_key: this.creds.apiKey, signature },
    };
  }

  async findAsset(publicId: string, resourceType: string): Promise<StoredAsset | undefined> {
    let res: Record<string, unknown>;
    try {
      res = (await cloudinary.api.resource(publicId, {
        resource_type: resourceType,
        type: DELIVERY_TYPE,
      })) as Record<string, unknown>;
    } catch (e) {
      // Not uploaded yet is an ordinary answer. Anything else is a real failure.
      if ((e as { error?: { http_code?: number } }).error?.http_code === 404) return undefined;
      throw e;
    }
    return {
      assetId: String(res['asset_id']),
      publicId: String(res['public_id']),
      version: Number(res['version']),
      format: String(res['format']),
      bytes: Number(res['bytes']),
      resourceType: String(res['resource_type']),
      type: String(res['type']),
      width: typeof res['width'] === 'number' ? res['width'] : undefined,
      height: typeof res['height'] === 'number' ? res['height'] : undefined,
      etag: typeof res['etag'] === 'string' ? res['etag'] : undefined,
    };
  }

  async destroy(publicId: string, resourceType: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: DELIVERY_TYPE,
      invalidate: true,
    });
  }

  /**
   * A time-limited link. Deliberately not `sign_url`: Cloudinary's signed delivery URLs never
   * expire, so a leaked one would work forever. Expiring tokens are an Advanced-plan feature;
   * `private_download_url` with `expires_at` is available on every plan.
   */
  signedDownloadUrl(input: {
    publicId: string;
    format: string;
    resourceType: string;
    expiresAt: Date;
  }): string {
    return cloudinary.utils.private_download_url(input.publicId, input.format, {
      resource_type: input.resourceType as 'image',
      type: DELIVERY_TYPE,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
    });
  }
}

/**
 * Used when no Cloudinary credentials are configured, which is allowed only outside staging
 * and production (config/env.schema.ts). It refuses every operation instead of pretending, so
 * a missing account is an error at the point of use rather than a file that silently went
 * nowhere.
 */
export class UnconfiguredStorage implements MediaStorage {
  private refuse(): never {
    throw new Error('Media storage is not configured: set the CLOUDINARY_* variables (ACTIONS-FOR-ME #4).');
  }
  publicIdFor(): string {
    return this.refuse();
  }
  signUpload(): SignedUpload {
    return this.refuse();
  }
  findAsset(): Promise<StoredAsset | undefined> {
    return this.refuse();
  }
  destroy(): Promise<void> {
    return this.refuse();
  }
  signedDownloadUrl(): string {
    return this.refuse();
  }
}

export function storageFromEnv(env: Record<string, string | undefined>): MediaStorage {
  const cloudName = env['CLOUDINARY_CLOUD_NAME'];
  const apiKey = env['CLOUDINARY_API_KEY'];
  const apiSecret = env['CLOUDINARY_API_SECRET'];
  return cloudName && apiKey && apiSecret
    ? new CloudinaryStorage({ cloudName, apiKey, apiSecret })
    : new UnconfiguredStorage();
}
