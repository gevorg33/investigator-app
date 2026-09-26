import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { mediaAssets } from '../../database/schema';
import { RateLimitService } from '../auth/rate-limit.service';
import {
  DELIVERY_URL_TTL_SECONDS,
  MEDIA_POLICY,
  UPLOAD_AUTHORIZATION_TTL_SECONDS,
  type MediaCategory,
} from './media.policy';
import {
  OwnMediaRepository,
  reviewsVerification,
  ViewableMediaRepository,
  type MediaAssetRow,
} from './media.repository';
import { MEDIA_STORAGE, type MediaStorage, type SignedUpload } from './media.storage';

export interface UploadAuthorization {
  assetId: string;
  expiresAt: Date;
  upload: SignedUpload;
}

export interface CompletedUpload {
  assetId: string;
  uploadStatus: 'READY';
  scanStatus: string;
}

export interface DeliveryUrl {
  /** Named to match an existing log-redaction path: this value must never reach a log. */
  signedUrl: string;
  expiresAt: Date;
}

/**
 * The upload and delivery flow from the cloudinary-media skill. PostgreSQL decides who may
 * touch a file; Cloudinary only stores it.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly own: OwnMediaRepository,
    private readonly viewable: ViewableMediaRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    private readonly platform: PlatformContext,
  ) {}

  /**
   * Steps 1–3: decide, then sign.
   *
   * The public ID is generated here and signed. A client never names a path, so it cannot
   * aim an upload at somebody else's file or outside its category.
   */
  async authorizeUpload(
    actor: Actor,
    input: { category: MediaCategory; mimeType: string; bytes: number },
    req: RequestContext,
  ): Promise<UploadAuthorization> {
    const policy = MEDIA_POLICY[input.category];
    const c = this.ctx('media.upload.authorize', req);
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, policy.uploaderRole, c);

    if (!policy.formats[input.mimeType]) {
      throw AppError.validation([
        {
          field: 'mimeType',
          code: 'TYPE_NOT_ALLOWED',
          messageKey: 'error.validation.media.type_not_allowed',
        },
      ]);
    }
    if (input.bytes > policy.maxBytes) {
      throw AppError.validation([
        { field: 'bytes', code: 'TOO_LARGE', messageKey: 'error.validation.media.too_large' },
      ]);
    }
    await this.limits.consume('mediaUploadPerAccount', actor.userId);

    // The storage layer derives the path from the context; nothing here builds one (T-080).
    const publicId = this.storage.publicIdFor(input.category);
    // Signed before the row exists: if storage refuses, no orphan authorization is left behind.
    const upload = this.storage.signUpload({
      publicId,
      resourceType: policy.resourceType,
      allowedFormats: Object.values(policy.formats),
    });

    const expiresAt = new Date(Date.now() + UPLOAD_AUTHORIZATION_TTL_SECONDS * 1000);
    const [row] = await this.db
      .insert(mediaAssets)
      .values({
        ownerId: actor.userId,
        category: input.category,
        visibility: policy.visibility,
        publicId,
        resourceType: policy.resourceType,
        declaredMimeType: input.mimeType,
        declaredBytes: input.bytes,
        authorizationExpiresAt: expiresAt,
      })
      .returning();
    // RETURNING on a single-row insert always yields the row; this is an invariant, and
    // failing loudly beats handing back a signature for a file nothing records.
    if (!row) throw new AppError('INTERNAL_ERROR');

    await this.record(actor, req, 'media.upload.authorized', row.id, input.category);
    return { assetId: row.id, expiresAt, upload };
  }

  /**
   * Step 5 — the one that gets skipped.
   *
   * The server reads the asset back from storage by the ID it assigned and checks it against
   * what it authorized. Nothing the client says about its upload is used.
   */
  async completeUpload(
    actor: Actor,
    assetId: string,
    req: RequestContext,
  ): Promise<CompletedUpload> {
    const c = this.ctx('media.upload.complete', req, assetId);
    await this.authz.requireActive(actor, c);
    const row = await this.authz.visible(actor, await this.own.findOneForActor(actor, assetId), c);
    await this.authz.stateAllows(actor, row.uploadStatus === 'AUTHORIZED', c);

    if (row.authorizationExpiresAt <= new Date()) {
      // The asset may or may not exist; either way nothing should be left behind.
      await this.storage.destroy(row.publicId, row.resourceType);
      await this.setStatus(row.id, 'EXPIRED');
      await this.record(actor, req, 'media.upload.expired', row.id, row.category);
      throw AppError.stateConflict();
    }

    const asset = await this.storage.findAsset(row.publicId, row.resourceType);
    // Not uploaded yet. The authorization stands until it expires, so the client may retry.
    if (!asset) throw AppError.stateConflict();

    const policy = MEDIA_POLICY[row.category];
    const problem =
      asset.publicId !== row.publicId
        ? 'PUBLIC_ID_MISMATCH'
        : asset.type !== 'authenticated'
          ? 'NOT_PRIVATE'
          : asset.format !== policy.formats[row.declaredMimeType]
            ? 'FORMAT_MISMATCH'
            : asset.bytes > policy.maxBytes
              ? 'TOO_LARGE'
              : undefined;

    if (problem) {
      // Destroy first. If that fails the row stays AUTHORIZED and the error surfaces, rather
      // than a REJECTED row describing a file that is still sitting in storage.
      await this.storage.destroy(row.publicId, row.resourceType);
      await this.setStatus(row.id, 'REJECTED');
      await this.record(actor, req, 'media.upload.rejected', row.id, problem);
      throw AppError.validation([
        { field: 'file', code: problem, messageKey: 'error.validation.media.rejected' },
      ]);
    }

    const [updated] = await this.db
      .update(mediaAssets)
      .set({
        uploadStatus: 'READY',
        cloudinaryAssetId: asset.assetId,
        version: asset.version,
        format: asset.format,
        bytes: asset.bytes,
        width: asset.width ?? null,
        height: asset.height ?? null,
        etag: asset.etag ?? null,
        updatedAt: new Date(),
      })
      // The status in the predicate makes a concurrent second completion match nothing.
      .where(and(eq(mediaAssets.id, row.id), eq(mediaAssets.uploadStatus, 'AUTHORIZED')))
      .returning();
    await this.authz.stateAllows(actor, updated !== undefined, c);

    await this.record(actor, req, 'media.upload.completed', row.id, row.category);
    return { assetId: row.id, uploadStatus: 'READY', scanStatus: row.scanStatus };
  }

  /**
   * Steps 7–9: authorize, then a five-minute link, then an audit row.
   *
   * Scan status is checked after state and fails closed: PENDING, INFECTED and FAILED are all
   * refused. Until a scanner reports, nothing is served — to anyone, the owner included.
   */
  async getDeliveryUrl(actor: Actor, assetId: string, req: RequestContext): Promise<DeliveryUrl> {
    const c = this.ctx('media.deliver', req, assetId);
    await this.authz.requireActive(actor, c);
    const row = await this.authz.visible(actor, await this.findViewable(actor, assetId, req), c);
    await this.authz.stateAllows(actor, row.uploadStatus === 'READY', c);
    await this.authz.stateAllows(actor, row.scanStatus === 'CLEAN', c);

    const expiresAt = new Date(Date.now() + DELIVERY_URL_TTL_SECONDS * 1000);
    const signedUrl = this.storage.signedDownloadUrl({
      publicId: row.publicId,
      // A READY row always has a format: enforced by media_assets_ready_has_asset.
      format: row.format!,
      resourceType: row.resourceType,
      expiresAt,
    });

    // Who opened what, and when — never the link itself.
    await this.record(actor, req, 'media.delivered', row.id, row.category);
    return { signedUrl, expiresAt };
  }

  /**
   * A verification document belongs to the applicant's workspace, so a reviewer finds it only
   * across workspaces (T-077). The repository's rules still decide which rows count: platform
   * access widens where the database looks, never what the reviewer may see.
   */
  private async findViewable(
    actor: Actor,
    assetId: string,
    req: RequestContext,
  ): Promise<MediaAssetRow | undefined> {
    const find = async () => {
      const row = await this.viewable.findOneForActor(actor, assetId);
      return row;
    };
    return reviewsVerification(actor)
      ? this.platform.asStaff(actor, { scope: 'VERIFICATION', purpose: 'media.deliver' }, req, find)
      : find();
  }

  private async setStatus(id: string, uploadStatus: 'EXPIRED' | 'REJECTED'): Promise<void> {
    await this.db
      .update(mediaAssets)
      .set({ uploadStatus, updatedAt: new Date() })
      .where(eq(mediaAssets.id, id));
  }

  private async record(
    actor: Actor,
    req: RequestContext,
    action: string,
    resourceId: string,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorId: actor.userId,
      action,
      resourceType: 'media_asset',
      resourceId,
      reason,
    });
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'media_asset',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}
