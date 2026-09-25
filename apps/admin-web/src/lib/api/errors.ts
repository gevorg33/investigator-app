/** One field the API refused, in the shape every module returns (docs/api/errors.md). */
export interface FieldIssue {
  field: string;
  code: string;
  messageKey: string;
}

/**
 * An error from the API, as its contract describes it: a stable `code` to branch on, a
 * `messageKey` to translate (never an English sentence), and the correlation id a user can quote
 * to support. Field issues only for validation.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly details: readonly FieldIssue[] = [],
    readonly correlationId: string | null = null,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

/**
 * The error a failed response carries. A body that is not the contract's shape — a proxy's HTML
 * page, an empty 502 — becomes `INTERNAL_ERROR`, so callers always get something they can render.
 */
export async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: unknown; messageKey?: unknown; details?: unknown; correlationId?: unknown };
  } | null;
  const e = body?.error;
  if (typeof e?.code !== 'string' || typeof e.messageKey !== 'string') {
    return new ApiError(res.status, 'INTERNAL_ERROR', 'error.common.internal');
  }
  return new ApiError(
    res.status,
    e.code,
    e.messageKey,
    Array.isArray(e.details) ? (e.details as FieldIssue[]) : [],
    typeof e.correlationId === 'string' ? e.correlationId : null,
  );
}

/** The response body as JSON, or null when there is none (202 and 204 carry nothing needed). */
export async function bodyOf<T>(res: Response): Promise<T | null> {
  return res.headers.get('content-type')?.includes('application/json')
    ? ((await res.json()) as T)
    : null;
}
