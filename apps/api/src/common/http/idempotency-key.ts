import type { Request } from 'express';
import { AppError } from '../errors/app-error';

/** Long enough for a UUID or ULID, short enough that it cannot be used as storage. */
const MAX_LENGTH = 200;
const VALID = /^[A-Za-z0-9._:-]+$/;

/**
 * The `Idempotency-Key` header, required on the endpoints that create something
 * (docs/api/idempotency.md).
 *
 * A header rather than a body field, deliberately: the body is fingerprinted to detect a key
 * being reused for a *different* request, so the key cannot be part of what is hashed.
 *
 * Absent or malformed is a validation error, not a silently generated key — generating one
 * server-side would make every retry a new operation, which is the bug the header exists to
 * prevent.
 */
export function idempotencyKey(req: Request): string {
  const raw = req.get('idempotency-key');
  if (raw === undefined || raw.length === 0 || raw.length > MAX_LENGTH || !VALID.test(raw)) {
    throw AppError.validation([
      {
        field: 'Idempotency-Key',
        code: 'REQUIRED',
        messageKey: 'error.validation.idempotency_key.required',
      },
    ]);
  }
  return raw;
}
