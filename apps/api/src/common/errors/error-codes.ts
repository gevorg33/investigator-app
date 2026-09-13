/**
 * Stable, machine-readable error codes. Clients branch on these, so renaming one
 * is a breaking change (docs/api/errors.md).
 */
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  STATE_CONFLICT: 'STATE_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Translation keys, never English sentences — the client renders in the user's locale. */
export const ERROR_MESSAGE_KEY: Record<ErrorCodeValue, string> = {
  UNAUTHENTICATED: 'error.auth.unauthenticated',
  FORBIDDEN: 'error.auth.forbidden',
  NOT_FOUND: 'error.common.not_found',
  VALIDATION_FAILED: 'error.common.validation_failed',
  STATE_CONFLICT: 'error.common.state_conflict',
  RATE_LIMITED: 'error.common.rate_limited',
  IDEMPOTENCY_KEY_REUSED: 'error.common.idempotency_key_reused',
  INTERNAL_ERROR: 'error.common.internal',
};

export const ERROR_STATUS: Record<ErrorCodeValue, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  STATE_CONFLICT: 409,
  RATE_LIMITED: 429,
  IDEMPOTENCY_KEY_REUSED: 409,
  INTERNAL_ERROR: 500,
};
