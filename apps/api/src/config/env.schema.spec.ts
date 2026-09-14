import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('env validation', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
  });

  it('fails fast when a required variable is missing', () => {
    const { DATABASE_URL: _omitted, ...missing } = valid;
    expect(() => validateEnv(missing)).toThrow(/DATABASE_URL/);
  });

  it('names every problem, not just the first', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('rejects a too-short SESSION_SECRET', () => {
    expect(() => validateEnv({ ...valid, SESSION_SECRET: 'short' })).toThrow(/32 characters/);
  });

  it('never includes the offending value in the message', () => {
    const secret = 'super-secret-value-that-must-not-leak';
    try {
      validateEnv({ ...valid, PORT: secret });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('labels a problem with no field path as the root rather than a blank name', () => {
    expect(() => validateEnv(null as unknown as Record<string, unknown>)).toThrow(/\(root\)/);
  });
});
