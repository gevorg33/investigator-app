import { describe, expect, it } from 'vitest';
import {
  clampLimit,
  decodeHoldCursor,
  DEFAULT_LIMIT,
  encodeHoldCursor,
  MAX_LIMIT,
} from './legal-hold.policy';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

describe('legal hold paging (T-035)', () => {
  it('reads back exactly the cursor it wrote', () => {
    const cursor = { at: new Date('2026-10-05T09:30:00.123Z'), id: 'a-hold' };
    expect(decodeHoldCursor(encodeHoldCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['not base64 JSON', '%%%'],
    ['JSON null', encode(null)],
    ['a number', encode(7)],
    ['no instant', encode({ i: 'a-hold' })],
    ['no id', encode({ t: '2026-10-05T09:30:00.000Z' })],
    ['an empty id', encode({ t: '2026-10-05T09:30:00.000Z', i: '' })],
    ['an instant that is not one', encode({ t: 'yesterday', i: 'a-hold' })],
  ])('refuses a cursor that is %s, the same way every time', (_, cursor) => {
    expect(() => decodeHoldCursor(cursor)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('defaults the page size, and clamps it into bounds', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10.7)).toBe(10);
    expect(clampLimit(MAX_LIMIT + 1)).toBe(MAX_LIMIT);
  });
});
