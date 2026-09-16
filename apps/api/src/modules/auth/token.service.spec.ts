import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TokenService } from './token.service';

const svc = new TokenService();

describe('token issuance', () => {
  it('carries 256 bits of entropy', () => {
    // base64url of 32 bytes, unpadded.
    expect(Buffer.from(svc.issue(), 'base64url')).toHaveLength(32);
  });

  it('is url-safe, so it survives a cookie round trip unescaped', () => {
    for (let i = 0; i < 50; i++) expect(svc.issue()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 500 }, () => svc.issue()));
    expect(seen.size).toBe(500);
  });
});

describe('fingerprint', () => {
  it('is sha-256 of the token', () => {
    const t = svc.issue();
    expect(svc.fingerprint(t)).toBe(createHash('sha256').update(t).digest('hex'));
  });

  it('is stable for the same token and different for another', () => {
    const a = svc.issue();
    expect(svc.fingerprint(a)).toBe(svc.fingerprint(a));
    expect(svc.fingerprint(a)).not.toBe(svc.fingerprint(svc.issue()));
  });

  it('does not contain the token it was derived from', () => {
    const t = svc.issue();
    expect(svc.fingerprint(t)).not.toContain(t);
  });
});

describe('constant-time comparison', () => {
  it('matches a fingerprint against itself', () => {
    const f = svc.fingerprint('anything');
    expect(svc.matches(f, f)).toBe(true);
  });

  it('rejects a different fingerprint of the same length', () => {
    expect(svc.matches(svc.fingerprint('a'), svc.fingerprint('b'))).toBe(false);
  });

  it('rejects unequal lengths rather than throwing', () => {
    // timingSafeEqual throws on a length mismatch; the guard turns that into a
    // plain false so a malformed cookie is a failed match, not a 500.
    expect(svc.matches('ab', svc.fingerprint('a'))).toBe(false);
    expect(svc.matches(svc.fingerprint('a'), 'ab')).toBe(false);
  });

  it('treats a non-hex string as a failed match, not an error', () => {
    expect(() => svc.matches('zzzz', svc.fingerprint('a'))).not.toThrow();
    expect(svc.matches('zzzz', svc.fingerprint('a'))).toBe(false);
  });

  it('rejects the empty string against a real fingerprint', () => {
    expect(svc.matches('', svc.fingerprint('a'))).toBe(false);
  });
});
