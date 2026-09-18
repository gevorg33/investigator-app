import { describe, expect, it } from 'vitest';
import {
  clampLimit,
  decodeQueueCursor,
  DEFAULT_LIMIT,
  encodeQueueCursor,
  MAX_LIMIT,
} from './verification.policy';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

describe('the queue limit', () => {
  it.each([
    [undefined, DEFAULT_LIMIT],
    [0, 1],
    [-5, 1],
    [7.9, 7],
    [MAX_LIMIT + 1, MAX_LIMIT],
  ])('clamps %s to %s rather than refusing it', (requested, expected) => {
    expect(clampLimit(requested)).toBe(expected);
  });
});

describe('the queue cursor', () => {
  it('round-trips the position it encodes', () => {
    const at = { submittedAt: new Date('2026-09-18T10:00:00.123Z'), id: 'r1' };
    expect(decodeQueueCursor(encodeQueueCursor(at))).toEqual(at);
  });

  it.each([
    ['text that is not JSON', b64('not json')],
    ['JSON null', b64('null')],
    ['a bare number', b64('7')],
    ['no id', b64(JSON.stringify({ s: '2026-09-18T10:00:00Z' }))],
    ['an empty id', b64(JSON.stringify({ s: '2026-09-18T10:00:00Z', i: '' }))],
    ['a numeric id', b64(JSON.stringify({ s: '2026-09-18T10:00:00Z', i: 5 }))],
    ['no instant', b64(JSON.stringify({ i: 'r1' }))],
    ['an instant that is not a date', b64(JSON.stringify({ s: 'yesterday', i: 'r1' }))],
  ])('refuses %s the same way', (_label, cursor) => {
    expect(() => decodeQueueCursor(cursor)).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ field: 'cursor', code: 'INVALID' })],
      }),
    );
  });
});
