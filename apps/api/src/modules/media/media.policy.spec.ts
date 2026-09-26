import { describe, expect, it } from 'vitest';
import {
  DELIVERY_URL_TTL_SECONDS,
  MEDIA_CATEGORIES,
  MEDIA_POLICY,
  UPLOAD_AUTHORIZATION_TTL_SECONDS,
} from './media.policy';

describe('media policy', () => {
  it('lists exactly the categories it has rules for', () => {
    expect([...MEDIA_CATEGORIES].sort()).toEqual([
      'AGENCY_COVER',
      'AGENCY_LOGO',
      'PROFILE_IMAGE',
      'VERIFICATION_DOCUMENT',
    ]);
  });

  it('lets an agency’s look be uploaded by whoever may change its settings, in the agency (T-084)', () => {
    for (const category of ['AGENCY_LOGO', 'AGENCY_COVER'] as const) {
      expect(MEDIA_POLICY[category]).toMatchObject({
        uploader: { permission: 'settings.update', workspace: 'AGENCY' },
        visibility: 'PUBLIC_PROFILE',
      });
      expect(Object.keys(MEDIA_POLICY[category].formats).sort()).toEqual([
        'image/jpeg',
        'image/png',
        'image/webp',
      ]);
    }
    expect(MEDIA_POLICY.AGENCY_LOGO.maxBytes).toBeLessThan(MEDIA_POLICY.AGENCY_COVER.maxBytes);
  });

  it('keeps verification documents for staff review, never on a public profile', () => {
    expect(MEDIA_POLICY.VERIFICATION_DOCUMENT.visibility).toBe('STAFF_REVIEW_ONLY');
  });

  it('accepts PDFs only where a document is expected', () => {
    expect(MEDIA_POLICY.VERIFICATION_DOCUMENT.formats['application/pdf']).toBe('pdf');
    expect(MEDIA_POLICY.PROFILE_IMAGE.formats['application/pdf']).toBeUndefined();
  });

  it('refuses types that can carry script or executable content', () => {
    for (const policy of Object.values(MEDIA_POLICY)) {
      for (const mime of [
        'image/svg+xml',
        'text/html',
        'application/x-msdownload',
        'application/zip',
      ]) {
        expect(policy.formats[mime]).toBeUndefined();
      }
    }
  });

  it('keeps the server window inside the one-hour signature Cloudinary enforces', () => {
    expect(UPLOAD_AUTHORIZATION_TTL_SECONDS).toBeLessThan(3600);
    expect(DELIVERY_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
  });
});
