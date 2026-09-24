import type { ApiError } from '@/lib/api/errors';

/** A translator that accepts any key — errors carry keys the API chose, not ones known here. */
export interface LooseT {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/**
 * The message for an error: a form's own wording for a code where it has one (sign-in says "the
 * email or password is not right", never the API's generic 401), else the API's `messageKey`
 * where the catalog has it, else a generic one. Never the raw key.
 */
export function errorMessageKey(
  error: ApiError,
  t: LooseT,
  overrides: Readonly<Record<string, string>> = {},
): string {
  const own = overrides[error.code];
  if (own !== undefined) return own;
  return t.has(error.messageKey) ? error.messageKey : 'error.common.internal';
}

/** What a refused field should say, when the API's detail is only "this field". */
const FIELD_DEFAULTS: Readonly<Record<string, string>> = {
  email: 'error.validation.email.invalid',
  password: 'error.validation.password.too_short',
  timezone: 'error.validation.timezone.invalid',
};

/**
 * Per-field messages from a validation error. The API's own key when it is specific and
 * translated (the legal gate names each document); a sensible default for the field otherwise.
 */
export function fieldErrorKeys(error: ApiError | null, t: LooseT): Record<string, string> {
  if (error === null || error.code !== 'VALIDATION_FAILED') return {};
  const out: Record<string, string> = {};
  for (const d of error.details) {
    const specific = d.messageKey !== 'error.common.validation_failed' && t.has(d.messageKey);
    const key = specific ? d.messageKey : FIELD_DEFAULTS[d.field];
    if (key !== undefined) out[d.field] = key;
  }
  return out;
}
