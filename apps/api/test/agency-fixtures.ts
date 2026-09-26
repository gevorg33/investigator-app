import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

/**
 * An agency's public profile, its settings and its images (T-084). Written as the owner, like every
 * fixture (T-073); each takes the agency it belongs to and overrides for whatever a test varies.
 */

/** A profile row: a draft with a headline unless the test says otherwise. */
export async function agencyProfile(
  owner: postgres.Sql,
  tenantId: string,
  over: {
    displayName?: string | null;
    headline?: string | null;
    about?: string | null;
    logoMediaId?: string | null;
    coverMediaId?: string | null;
    published?: boolean;
  } = {},
): Promise<void> {
  await owner`
    INSERT INTO tenant_profiles (tenant_id, display_name, headline, about, logo_media_id,
                                 cover_media_id, published_at)
    VALUES (${tenantId}, ${over.displayName ?? null},
            ${over.headline === undefined ? 'Due diligence across Armenia' : over.headline},
            ${over.about ?? null}, ${over.logoMediaId ?? null}, ${over.coverMediaId ?? null},
            CASE WHEN ${over.published === true} THEN now() END)`;
}

/** One saved settings section: branding with an accent, unless the test says otherwise. */
export async function agencySettings(
  owner: postgres.Sql,
  tenantId: string,
  over: { section?: string; value?: Record<string, unknown>; version?: number } = {},
): Promise<void> {
  await owner`
    INSERT INTO tenant_settings (tenant_id, section, value, version)
    VALUES (${tenantId}, ${over.section ?? 'branding'},
            ${JSON.stringify(over.value ?? { accentColor: '#1d4ed8' })}::text::jsonb, ${over.version ?? 1})`;
}

/**
 * An agency's logo or cover as a completed upload: READY, and scanned CLEAN unless the test says
 * otherwise — no scanner exists yet (T-065), so a real one would stay PENDING.
 */
export async function agencyImage(
  owner: postgres.Sql,
  opts: {
    tenantId: string;
    uploadedBy: string;
    category?: 'AGENCY_LOGO' | 'AGENCY_COVER' | 'PROFILE_IMAGE';
    scanStatus?: 'PENDING' | 'CLEAN';
    uploadStatus?: 'AUTHORIZED' | 'READY';
  },
): Promise<string> {
  const ready = (opts.uploadStatus ?? 'READY') === 'READY';
  const [row] = await owner<{ id: string }[]>`
    INSERT INTO media_assets (tenant_id, owner_id, category, visibility, public_id, resource_type,
                              declared_mime_type, declared_bytes, authorization_expires_at,
                              upload_status, cloudinary_asset_id, version, format, bytes, scan_status)
    VALUES (${opts.tenantId}, ${opts.uploadedBy}, ${opts.category ?? 'AGENCY_LOGO'}, 'PUBLIC_PROFILE',
            ${`test/agency/${randomUUID()}`}, 'image', 'image/png', 2048, now() + interval '10 minutes',
            ${opts.uploadStatus ?? 'READY'}, ${ready ? `asset-${randomUUID()}` : null},
            ${ready ? 1 : null}, ${ready ? 'png' : null}, ${ready ? 2048 : null},
            ${ready ? (opts.scanStatus ?? 'CLEAN') : 'PENDING'})
    RETURNING id`;
  return row!.id;
}
