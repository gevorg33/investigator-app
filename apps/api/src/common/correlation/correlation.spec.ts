import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { CORRELATION_HEADER, resolveCorrelationId } from './correlation';

const req = (headers: Record<string, string | string[]>) =>
  ({ headers }) as unknown as IncomingMessage;

describe('correlation id', () => {
  it('accepts a well-formed client-supplied id', () => {
    expect(resolveCorrelationId(req({ [CORRELATION_HEADER]: 'abc123XY_-' }))).toBe('abc123XY_-');
  });

  it('generates one when absent', () => {
    expect(resolveCorrelationId(req({}))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an injected value rather than logging it', () => {
    const injected = 'a\nFATAL fake log line';
    expect(resolveCorrelationId(req({ [CORRELATION_HEADER]: injected }))).not.toBe(injected);
  });

  it('rejects an over-long id', () => {
    expect(resolveCorrelationId(req({ [CORRELATION_HEADER]: 'a'.repeat(200) }))).toHaveLength(36);
  });

  it('takes the first value when the header is repeated', () => {
    expect(
      resolveCorrelationId(req({ [CORRELATION_HEADER]: ['first_value_1', 'second_value_2'] })),
    ).toBe('first_value_1');
  });
});
