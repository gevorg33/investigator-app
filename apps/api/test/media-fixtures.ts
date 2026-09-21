import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { vi } from 'vitest';
import type { Actor, Role, StaffScope } from '../src/common/authz/contract';
import { currentContext } from '../src/common/context/execution-context';
import * as schema from '../src/database/schema';
import type { MediaStorage, StoredAsset } from '../src/modules/media/media.storage';
import { testActor } from './actor';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** Records what the service asked of storage, and answers as told. */
export class FakeStorage implements MediaStorage {
  assets = new Map<string, StoredAsset>();
  destroyed: string[] = [];
  failDestroy = false;
  onFind: (() => Promise<void>) | undefined;

  /** The real adapter derives this from the execution context (T-080); so does this one. */
  publicIdFor = vi.fn((category: string) => {
    const tenantId = currentContext()?.tenantId;
    if (tenantId === undefined) throw new Error('no workspace context: nothing to derive a path from');
    return `test/tenant/${tenantId}/${category.toLowerCase().replace(/_/g, '-')}/${randomUUID()}`;
  });

  signUpload = vi.fn((input: { publicId: string; resourceType: string; allowedFormats: string[] }) => ({
    url: `https://storage.test/${input.resourceType}/upload`,
    fields: { public_id: input.publicId, allowed_formats: input.allowedFormats.join(','), signature: 'sig' },
  }));

  async findAsset(publicId: string): Promise<StoredAsset | undefined> {
    await this.onFind?.();
    return this.assets.get(publicId);
  }

  async destroy(publicId: string): Promise<void> {
    if (this.failDestroy) throw new Error('storage unavailable');
    this.destroyed.push(publicId);
    this.assets.delete(publicId);
  }

  signedDownloadUrl = vi.fn(
    (input: { publicId: string; expiresAt: Date }) =>
      `https://storage.test/download?id=${encodeURIComponent(input.publicId)}&expires_at=${Math.floor(input.expiresAt.getTime() / 1000)}&signature=sig`,
  );

  /** Simulate the client's direct upload landing in storage. */
  put(publicId: string, over: Partial<StoredAsset> = {}): void {
    this.assets.set(publicId, {
      assetId: `asset-${randomUUID()}`,
      publicId,
      version: 1,
      format: 'pdf',
      bytes: 1000,
      resourceType: 'image',
      type: 'authenticated',
      width: 100,
      height: 200,
      etag: 'etag-1',
      ...over,
    });
  }
}

/** A real user row (media_assets.owner_id restricts), and the Actor for it. */
export async function person(
  db: TestDb,
  opts: { roles?: Role[]; staffScopes?: StaffScope[]; status?: Actor['status']; activeRole?: Role } = {},
): Promise<Actor> {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `media-${randomUUID()}@example.test`, status: 'ACTIVE' })
    .returning();
  return testActor({
    userId: user?.id ?? '',
    roles: opts.roles ?? ['INVESTIGATOR'],
    staffScopes: opts.staffScopes ?? [],
    status: opts.status ?? 'ACTIVE',
    activeRole: opts.activeRole,
  });
}

/** Moves an asset to READY with storage-reported fields, and optionally sets its scan status. */
export async function makeReady(
  db: TestDb,
  assetId: string,
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED' = 'CLEAN',
): Promise<void> {
  await db
    .update(schema.mediaAssets)
    .set({
      uploadStatus: 'READY',
      cloudinaryAssetId: `asset-${randomUUID()}`,
      version: 1,
      format: 'pdf',
      bytes: 1000,
      scanStatus,
    })
    .where(eq(schema.mediaAssets.id, assetId));
}
