import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from './logger.options';

describe('log redaction', () => {
  // audit-logging forbids these in logs. The logger must be incapable of emitting them.
  it.each([
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    'token',
    'refreshToken',
    'sessionSecret',
    'signedUrl',
    'cardNumber',
  ])('redacts %s', (path) => {
    expect(REDACT_PATHS).toContain(path);
  });

  it('redacts nested occurrences, not only top level', () => {
    for (const p of ['*.password', '*.token', '*.secret', '*.signedUrl']) {
      expect(REDACT_PATHS).toContain(p);
    }
  });
});
