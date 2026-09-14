import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { requestContext } from './request-context';

const req = (id: unknown, headers: Record<string, string> = {}) =>
  ({
    id,
    ip: '198.51.100.30',
    get: (name: string) => headers[name.toLowerCase()],
  }) as unknown as Request;

describe('request context', () => {
  it('carries the caller address and user agent', () => {
    expect(requestContext(req('abc', { 'user-agent': 'vitest' }))).toEqual({
      ip: '198.51.100.30',
      userAgent: 'vitest',
      correlationId: 'abc',
    });
  });

  it('stringifies a numeric request id, so the id has one shape downstream', () => {
    expect(requestContext(req(42)).correlationId).toBe('42');
  });

  it('leaves the id undefined when the request has none', () => {
    expect(requestContext(req(undefined)).correlationId).toBeUndefined();
  });

  it('drops an id of an unexpected type rather than coercing it', () => {
    // String({}) is "[object Object]" — a correlation id that correlates nothing.
    expect(requestContext(req({ nested: true })).correlationId).toBeUndefined();
  });

  it('leaves the user agent undefined when the header is absent', () => {
    expect(requestContext(req('abc')).userAgent).toBeUndefined();
  });
});
