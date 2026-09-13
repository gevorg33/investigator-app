import { describe, expect, it } from 'vitest';
import { AppError } from './app-error';
import { ErrorCode, ERROR_MESSAGE_KEY, ERROR_STATUS } from './error-codes';

describe('error taxonomy', () => {
  it('defines every code the conventions require', () => {
    // docs/api/errors.md — codes that must exist before the first module.
    for (const c of [
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'STATE_CONFLICT',
      'RATE_LIMITED',
      'IDEMPOTENCY_KEY_REUSED',
      'INTERNAL_ERROR',
    ]) {
      expect(ErrorCode).toHaveProperty(c);
    }
  });

  it('maps every code to a translation key, never an English sentence', () => {
    for (const key of Object.values(ERROR_MESSAGE_KEY)) {
      expect(key).toMatch(/^error\.[a-z_]+\.[a-z_]+$/);
    }
  });

  it('maps every code to a status', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it('carries the status on the thrown error', () => {
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.stateConflict().status).toBe(409);
  });

  it('distinguishes 403 from 404 — an enumeration oracle otherwise', () => {
    expect(ERROR_STATUS.FORBIDDEN).not.toBe(ERROR_STATUS.NOT_FOUND);
  });
});
