import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudinaryStorage, storageFromEnv, UnconfiguredStorage } from './cloudinary.storage';

const creds = { cloudName: 'demo-cloud', apiKey: '123456789', apiSecret: 'not-a-real-secret' };

/** Cloudinary's documented scheme, computed independently of the SDK. */
const expectedSignature = (params: Record<string, string>, secret: string): string => {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + secret).digest('hex');
};

describe('Cloudinary storage adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upload signature', () => {
    const signed = () =>
      new CloudinaryStorage(creds).signUpload({
        publicId: 'investigator/test/verification-document/abc',
        resourceType: 'image',
        allowedFormats: ['pdf', 'jpg'],
      });

    it('fixes every parameter a client might want to choose', () => {
      const { fields } = signed();
      expect(fields).toMatchObject({
        public_id: 'investigator/test/verification-document/abc',
        type: 'authenticated',
        overwrite: 'false',
        allowed_formats: 'pdf,jpg',
        api_key: creds.apiKey,
      });
    });

    it('signs those parameters as Cloudinary specifies', () => {
      const { fields } = signed();
      const { signature, api_key: _key, ...params } = fields;
      expect(signature).toBe(expectedSignature(params, creds.apiSecret));
    });

    it('produces a signature that no longer matches if the public ID is changed', () => {
      // Cloudinary rejects a request whose parameters do not match the signature, so a client
      // cannot re-aim the upload at another path.
      const { fields } = signed();
      const { signature, api_key: _key, ...params } = fields;
      expect(expectedSignature({ ...params, public_id: 'someone/else' }, creds.apiSecret)).not.toBe(
        signature,
      );
    });

    it('posts to the account and resource type the file belongs to', () => {
      expect(signed().url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    });

    it('never puts the secret in what it returns', () => {
      expect(JSON.stringify(signed())).not.toContain(creds.apiSecret);
    });
  });

  describe('delivery link', () => {
    it('is a private download link that carries its expiry', () => {
      const expiresAt = new Date('2030-01-01T00:05:00Z');
      const url = new URL(
        new CloudinaryStorage(creds).signedDownloadUrl({
          publicId: 'investigator/test/verification-document/abc',
          format: 'pdf',
          resourceType: 'image',
          expiresAt,
        }),
      );
      expect(url.hostname).toBe('api.cloudinary.com');
      expect(url.searchParams.get('expires_at')).toBe(String(expiresAt.getTime() / 1000));
      expect(url.searchParams.get('type')).toBe('authenticated');
      expect(url.searchParams.get('signature')).toBeTruthy();
      expect(url.toString()).not.toContain(creds.apiSecret);
    });
  });

  describe('reading an asset back', () => {
    it('maps what storage reports', async () => {
      vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({
        asset_id: 'a1',
        public_id: 'p1',
        version: 7,
        format: 'pdf',
        bytes: 1234,
        resource_type: 'image',
        type: 'authenticated',
        width: 10,
        height: 20,
        etag: 'e1',
      });
      await expect(new CloudinaryStorage(creds).findAsset('p1', 'image')).resolves.toEqual({
        assetId: 'a1',
        publicId: 'p1',
        version: 7,
        format: 'pdf',
        bytes: 1234,
        resourceType: 'image',
        type: 'authenticated',
        width: 10,
        height: 20,
        etag: 'e1',
      });
    });

    it('leaves optional dimensions undefined when storage omits them', async () => {
      vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({
        asset_id: 'a1',
        public_id: 'p1',
        version: 1,
        format: 'pdf',
        bytes: 5,
        resource_type: 'image',
        type: 'authenticated',
      });
      const asset = await new CloudinaryStorage(creds).findAsset('p1', 'image');
      expect([asset?.width, asset?.height, asset?.etag]).toEqual([undefined, undefined, undefined]);
    });

    it('looks the asset up as private, by the server-assigned ID', async () => {
      const spy = vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({});
      await new CloudinaryStorage(creds).findAsset('p1', 'image');
      expect(spy).toHaveBeenCalledWith('p1', { resource_type: 'image', type: 'authenticated' });
    });

    it('treats not-found as not uploaded yet', async () => {
      vi.spyOn(cloudinary.api, 'resource').mockRejectedValue({ error: { http_code: 404 } });
      await expect(new CloudinaryStorage(creds).findAsset('p1', 'image')).resolves.toBeUndefined();
    });

    it('surfaces any other failure rather than calling it not uploaded', async () => {
      vi.spyOn(cloudinary.api, 'resource').mockRejectedValue({ error: { http_code: 401 } });
      await expect(new CloudinaryStorage(creds).findAsset('p1', 'image')).rejects.toEqual({
        error: { http_code: 401 },
      });
    });
  });

  it('destroys the private asset and invalidates cached copies', async () => {
    const spy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    await new CloudinaryStorage(creds).destroy('p1', 'image');
    expect(spy).toHaveBeenCalledWith('p1', {
      resource_type: 'image',
      type: 'authenticated',
      invalidate: true,
    });
  });
});

describe('without credentials', () => {
  it.each([
    ['signUpload', (s: UnconfiguredStorage) => s.signUpload()],
    ['findAsset', (s: UnconfiguredStorage) => s.findAsset()],
    ['destroy', (s: UnconfiguredStorage) => s.destroy()],
    ['signedDownloadUrl', (s: UnconfiguredStorage) => s.signedDownloadUrl()],
  ] as const)('%s refuses and names the missing configuration', (_name, call) => {
    expect(() => call(new UnconfiguredStorage())).toThrow(/CLOUDINARY_\*/);
  });

  it('uses Cloudinary only when all three credentials are present', () => {
    const full = {
      CLOUDINARY_CLOUD_NAME: 'c',
      CLOUDINARY_API_KEY: 'k',
      CLOUDINARY_API_SECRET: 's',
    };
    expect(storageFromEnv(full)).toBeInstanceOf(CloudinaryStorage);
    for (const missing of Object.keys(full)) {
      expect(storageFromEnv({ ...full, [missing]: '' })).toBeInstanceOf(UnconfiguredStorage);
      expect(storageFromEnv({ ...full, [missing]: undefined })).toBeInstanceOf(UnconfiguredStorage);
    }
  });
});
