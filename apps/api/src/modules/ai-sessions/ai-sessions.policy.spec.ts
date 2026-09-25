import { describe, expect, it } from 'vitest';
import {
  clampLimit,
  decodeMessageCursor,
  decodeSessionCursor,
  encodeMessageCursor,
  encodeSessionCursor,
  TITLE_FROM_MESSAGE_MAX,
  titleFrom,
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

  it('binds a message cursor to its direction, and refuses it read the other way (T-057)', () => {
    expect(decodeMessageCursor(encodeMessageCursor(40, 'newest'), 'newest')).toBe(40);
    expect(decodeMessageCursor(encodeMessageCursor(40, 'oldest'), 'oldest')).toBe(40);
    // A cursor from before T-057 carries no direction, and is what it always was: oldest first.
    expect(decodeMessageCursor(b64({ s: 40 }), 'oldest')).toBe(40);
    for (const [cursor, order] of [
      [encodeMessageCursor(40, 'newest'), 'oldest'],
      [encodeMessageCursor(40, 'oldest'), 'newest'],
      [b64({ s: 40, o: 'sideways' }), 'newest'],
      [b64({ s: 40, o: 'sideways' }), 'oldest'],
    ] as const) {
      expect(() => decodeMessageCursor(cursor, order)).toThrow(
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

describe('a title from a first message (T-056)', () => {
  it('keeps a short message whole, with its whitespace collapsed', () => {
    expect(titleFrom('  Is my\n\tpayment   held?  ')).toBe('Is my payment held?');
    expect(titleFrom('x'.repeat(TITLE_FROM_MESSAGE_MAX))).toBe('x'.repeat(TITLE_FROM_MESSAGE_MAX));
  });

  it('has no title for a message with no words', () => {
    expect(titleFrom(' \n\t ')).toBeNull();
  });

  it('cuts a long one at a word boundary, and says it was cut', () => {
    const title = titleFrom(
      'How long does a quote stay valid after the investigator sends it to me, and can they change it?',
    )!;
    expect(title).toBe('How long does a quote stay valid after the investigator…');
    expect([...title].length).toBeLessThanOrEqual(TITLE_FROM_MESSAGE_MAX);
  });

  it('cuts a word that runs past half the limit where it stands', () => {
    const title = titleFrom(`Hi ${'a'.repeat(80)}`)!;
    expect(title).toBe(`Hi ${'a'.repeat(TITLE_FROM_MESSAGE_MAX - 4)}…`);
    expect([...title]).toHaveLength(TITLE_FROM_MESSAGE_MAX);
  });

  it('counts characters, not UTF-16 units, so Armenian and emoji are never split in half', () => {
    const title = titleFrom('😀'.repeat(70))!;
    expect([...title]).toHaveLength(TITLE_FROM_MESSAGE_MAX);
    expect(title.endsWith('😀…')).toBe(true);
  });
});
