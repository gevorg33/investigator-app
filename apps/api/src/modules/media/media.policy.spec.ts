import { describe, expect, it } from 'vitest';
import {
  DELIVERY_URL_TTL_SECONDS,
  MEDIA_CATEGORIES,
  MEDIA_POLICY,
  UPLOAD_AUTHORIZATION_TTL_SECONDS,
} from './media.policy';

describe('media policy', () => {
  it('lists exactly the categories it has rules for', () => {
    expect([...MEDIA_CATEGORIES].sort()).toEqual(['PROFILE_IMAGE', 'VERIFICATION_DOCUMENT']);
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
