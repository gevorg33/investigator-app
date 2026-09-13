import { describe, expect, it } from 'vitest';
import { SessionService, type SessionRecord } from './session.service';
import { TokenService } from './token.service';

const svc = new SessionService(new TokenService());
const rec = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  userId: 'u1',
  familyId: 'f1',
  refreshTokenHash: 'h',
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  ...over,
});

describe('refresh rotation', () => {
  it('issues a token that is never stored in the clear', () => {
    const s = svc.create('u1');
    expect(s.refreshToken).not.toBe(s.refreshTokenHash);
    expect(s.refreshTokenHash).toHaveLength(64); // sha-256 hex
  });

  it('issues unique tokens', () => {
    const seen = new Set(Array.from({ length: 50 }, () => svc.create('u1').refreshToken));
    expect(seen.size).toBe(50);
  });

  it('keeps the family across rotation, so reuse anywhere is detectable', () => {
    const first = svc.create('u1');
    const next = svc.rotate(rec({ familyId: first.familyId }));
    expect(next.familyId).toBe(first.familyId);
    expect(next.refreshToken).not.toBe(first.refreshToken);
  });
});

describe('revocation is immediate, not at next expiry', () => {
  it('rejects a revoked session even though it has not expired', () => {
    // The criterion that ruled out stateless JWTs — a JWT would still validate here.
    expect(svc.isUsable(rec({ revokedAt: new Date() }))).toBe(false);
  });

  it('accepts a live session', () => {
    expect(svc.isUsable(rec())).toBe(true);
  });

  it('rejects an expired session', () => {
    expect(svc.isUsable(rec({ expiresAt: new Date(Date.now() - 1000) }))).toBe(false);
  });
});

describe('reuse detection', () => {
  it('flags a revoked-but-unexpired token as reuse', () => {
    expect(svc.isReuse(rec({ revokedAt: new Date() }))).toBe(true);
  });

  it('does not flag an ordinary expired session as an attack', () => {
    expect(
      svc.isReuse(rec({ revokedAt: new Date(), expiresAt: new Date(Date.now() - 1000) })),
    ).toBe(false);
  });

  it('does not flag a live session', () => {
    expect(svc.isReuse(rec())).toBe(false);
  });
});

describe('time is injectable, so expiry is testable without the wall clock', () => {
  const expiresAt = new Date('2026-01-01T00:00:00Z');
  const before = new Date('2025-12-31T23:59:59Z');
  const after = new Date('2026-01-01T00:00:01Z');

  it('treats a session as live just before its expiry', () => {
    expect(svc.isUsable(rec({ expiresAt }), before)).toBe(true);
  });

  it('treats it as expired just after', () => {
    expect(svc.isUsable(rec({ expiresAt }), after)).toBe(false);
  });

  it('is exclusive at the boundary — expiresAt is the first instant it is dead', () => {
    expect(svc.isUsable(rec({ expiresAt }), expiresAt)).toBe(false);
  });

  it('reads a revoked but unexpired token as reuse at the given time', () => {
    expect(svc.isReuse(rec({ expiresAt, revokedAt: new Date() }), before)).toBe(true);
  });

  it('stops calling it reuse once that time is past expiry', () => {
    // The same row is an attack before expiry and ordinary rubbish after it.
    expect(svc.isReuse(rec({ expiresAt, revokedAt: new Date() }), after)).toBe(false);
  });
});
