import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_WINDOW_HOURS, acceptanceDeadline, isExpired } from './quotes.policy';

describe('expiry', () => {
  it('treats a past expiry as expired', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
  });

  it('treats a future expiry as live', () => {
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });

  it('treats the exact instant of expiry as expired', () => {
    // The boundary decides a real case: "once a quote expires it cannot be accepted or
    // reinstated", so the moment it lapses it is already too late.
    const at = new Date('2026-09-18T12:00:00Z');
    expect(isExpired(at, at)).toBe(true);
    expect(isExpired(at, new Date(at.getTime() - 1))).toBe(false);
  });
});

describe('the acceptance window', () => {
  it('runs from when payment was authorized, not from when the quote was written', () => {
    // The investigator's window starts when the assignment exists, which is when the money
    // was authorized — not when they submitted the offer days earlier.
    const authorizedAt = new Date('2026-09-18T12:00:00Z');
    expect(acceptanceDeadline(authorizedAt).toISOString()).toBe('2026-09-20T12:00:00.000Z');
  });

  it('is the documented number of hours long', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const hours = (acceptanceDeadline(at).getTime() - at.getTime()) / 3_600_000;
    expect(hours).toBe(ACCEPTANCE_WINDOW_HOURS);
  });
});
