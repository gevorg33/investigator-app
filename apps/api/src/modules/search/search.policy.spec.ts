import { describe, expect, it } from 'vitest';
import {
  clampLimit,
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  fingerprint,
  MAX_LIMIT,
} from './search.policy';

const filters = { countryCode: 'AM', languages: ['hy', 'en'] };

describe('limits', () => {
  it('defaults when the client asks for nothing', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it('clamps rather than rejects, as the pagination contract requires', () => {
    // docs/api/pagination.md: "A request above the maximum is clamped, not rejected."
    expect(clampLimit(1000)).toBe(MAX_LIMIT);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it('keeps a sensible request as it is', () => {
    expect(clampLimit(10)).toBe(10);
  });

  it('never returns a fractional limit', () => {
    expect(clampLimit(10.7)).toBe(10);
  });
});

describe('the filter fingerprint', () => {
  it('ignores key order, so paging does not break on a reordered request body', () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it('ignores absent fields', () => {
    expect(fingerprint({ a: 1, b: undefined })).toBe(fingerprint({ a: 1 }));
  });

  it('changes when a filter changes', () => {
    expect(fingerprint({ countryCode: 'AM' })).not.toBe(fingerprint({ countryCode: 'GE' }));
  });

  it('handles a value JSON cannot represent', () => {
    // JSON.stringify returns undefined for undefined, functions and symbols. Concatenating that
    // would produce the string "undefined" and make two different filter sets collide.
    expect(fingerprint(undefined)).toBe(fingerprint(undefined));
    expect(fingerprint(undefined)).not.toBe(fingerprint(null));
    expect(fingerprint({ a: [undefined] })).toBe(fingerprint({ a: [undefined] }));
  });

  it('distinguishes array order, which changes nothing semantically but must not collide silently', () => {
    expect(fingerprint({ l: ['a', 'b'] })).not.toBe(fingerprint({ l: ['b', 'a'] }));
  });

  it('does not put the filters themselves in the cursor', () => {
    // A cursor is opaque. Echoing the filter set back inside it would make it readable.
    const cursor = encodeCursor({ countryCode: 'AM' }, { distanceM: 1000, profileId: 'p1' });
    expect(Buffer.from(cursor, 'base64url').toString('utf8')).not.toContain('AM');
  });
});

describe('cursors', () => {
  it('round-trips a position', () => {
    const cursor = encodeCursor(filters, { distanceM: 8400, profileId: 'p1' });
    expect(decodeCursor(filters, cursor)).toEqual({ distanceM: 8400, profileId: 'p1' });
  });

  it('round-trips a search with no location, where there is no distance', () => {
    const cursor = encodeCursor(filters, { distanceM: null, profileId: 'p1' });
    expect(decodeCursor(filters, cursor)).toEqual({ distanceM: null, profileId: 'p1' });
  });

  it('refuses a cursor from a different set of filters', () => {
    // Page two of one search silently becoming page two of another skips rows nobody can
    // account for, which is why the contract says reject rather than reinterpret.
    const cursor = encodeCursor(filters, { distanceM: 10, profileId: 'p1' });
    expect(() => decodeCursor({ ...filters, countryCode: 'GE' }, cursor)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it.each([
    ['not base64', '!!!!'],
    ['base64 of nothing useful', Buffer.from('hello').toString('base64url')],
    ['valid JSON of the wrong shape', Buffer.from(JSON.stringify({ x: 1 })).toString('base64url')],
    [
      'a missing id',
      Buffer.from(JSON.stringify({ f: fingerprint(filters), d: 1 })).toString('base64url'),
    ],
    [
      'an empty id',
      Buffer.from(JSON.stringify({ f: fingerprint(filters), d: 1, i: '' })).toString('base64url'),
    ],
    [
      'a distance that is not a number',
      Buffer.from(JSON.stringify({ f: fingerprint(filters), d: 'near', i: 'p1' })).toString(
        'base64url',
      ),
    ],
    [
      // Written as JSON text rather than through JSON.stringify, which turns Infinity into
      // null — a legal value here, so the first version of this case proved nothing. JSON.parse
      // does produce Infinity from 1e400, which is what the finiteness check is for.
      'an infinite distance',
      Buffer.from(`{"f":"${fingerprint(filters)}","d":1e400,"i":"p1"}`).toString('base64url'),
    ],
    ['an array', Buffer.from(JSON.stringify([1, 2])).toString('base64url')],
    ['null', Buffer.from('null').toString('base64url')],
  ])('refuses %s', (_label, cursor) => {
    // Every failure is the same error. A cursor is not a capability, and distinguishing
    // "malformed" from "not yours" would make it one.
    expect(() => decodeCursor(filters, cursor)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('cannot be forged into another query by editing the fingerprint', () => {
    const forged = Buffer.from(
      JSON.stringify({ f: 'deadbeefdeadbeef', d: 0, i: 'p1' }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeCursor(filters, forged)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});
