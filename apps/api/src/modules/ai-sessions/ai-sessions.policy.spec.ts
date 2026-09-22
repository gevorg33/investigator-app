import { describe, expect, it } from 'vitest';
import {
  clampLimit,
  decodeMessageCursor,
  decodeSessionCursor,
  encodeMessageCursor,
  encodeSessionCursor,
} from './ai-sessions.policy';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const ID = '00000000-0000-4000-8000-000000000045';

/** Cursors are opaque and refused, never guessed at (docs/api/pagination.md). */
describe('session and message cursors', () => {
  it('round-trips a session cursor for the list it came from', () => {
    const at = new Date('2026-09-23T12:00:00.123Z');
    const cursor = encodeSessionCursor({ archived: false, lastActivityAt: at, id: ID });
    expect(decodeSessionCursor(cursor, false)).toEqual({
      archived: false,
      lastActivityAt: at,
      id: ID,
    });
  });

  it.each([
    ['one from the other list', b64({ a: true, t: '2026-09-23T12:00:00.000Z', i: ID })],
    ['one with no time', b64({ a: false, i: ID })],
    ['one with a time that is not one', b64({ a: false, t: 'yesterday', i: ID })],
    ['one with no id', b64({ a: false, t: '2026-09-23T12:00:00.000Z' })],
    ['the value null', b64(null)],
    ['something that is not JSON', 'not-a-cursor'],
  ])('refuses %s', (_what, cursor) => {
    expect(() => decodeSessionCursor(cursor, false)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('round-trips a message cursor, and refuses anything but a whole, non-negative sequence', () => {
    expect(decodeMessageCursor(encodeMessageCursor(7))).toBe(7);
    for (const bad of [b64(null), b64({ s: -1 }), b64({ s: 1.5 }), b64({ s: '3' }), 'garbage']) {
      expect(() => decodeMessageCursor(bad)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      );
    }
  });

  it('clamps a page to between one and a hundred, defaulting to twenty-five', () => {
    expect([clampLimit(undefined), clampLimit(0), clampLimit(250), clampLimit(10.7)]).toEqual([
      25, 1, 100, 10,
    ]);
  });
});
