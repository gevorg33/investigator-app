import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { idempotencyKey } from './idempotency-key';

const withHeader = (value: string | undefined): Request =>
  ({
    get: (name: string) => (name.toLowerCase() === 'idempotency-key' ? value : undefined),
  }) as Request;

describe('the Idempotency-Key header', () => {
  it.each([
    ['a UUID', '018f2c9a-4c2b-7000-8000-9f3a2b1c4d5e'],
    ['a ULID', '01J8XQ7M2K4NQ8Z9V3B7C1D2E3'],
    ['dots, colons and underscores', 'checkout:2026-09-18_attempt.1'],
  ])('accepts %s', (_label, value) => {
    expect(idempotencyKey(withHeader(value))).toBe(value);
  });

  it.each([
    ['it is absent', undefined],
    ['it is empty', ''],
    ['it contains a space', 'key with space'],
    ['it contains a slash', 'key/with/slash'],
    ['it is absurdly long', 'x'.repeat(201)],
  ])('refuses the request when %s', (_label, value) => {
    // Absent is a validation error rather than a generated key: generating one server-side
    // would make every retry a new operation, which is the bug the header exists to prevent.
    expect(() => idempotencyKey(withHeader(value))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('names the header in the error, not a body field', () => {
    try {
      idempotencyKey(withHeader(undefined));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as { details?: Array<{ field: string }> }).details?.[0]?.field).toBe(
        'Idempotency-Key',
      );
    }
  });
});
