import { createHash } from 'node:crypto';

/**
 * A short, stable hash of a JSON-shaped value.
 *
 * Two callers need exactly this: search cursors, which must be rejected when replayed against
 * a different filter set, and idempotency keys, where "a key bound to one request must never
 * execute a different one" (docs/api/idempotency.md). Both answer the same question — is this
 * the same request as before — so they share one implementation rather than drifting apart.
 */
export function stableFingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);
}

/**
 * Stable JSON. Key order must not change the hash, or a reordered request body would read as
 * a different request and paging would break at random.
 */
function canonical(value: unknown): string {
  // JSON.stringify returns undefined for undefined, functions and symbols. The fallback must
  // not be 'null', which is what null itself produces: the two hashing identically was a real
  // collision, caught by a test.
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    // `a < b ? -1 : 1` rather than a three-way compare: `Object.entries` cannot yield the same
    // key twice, so an "equal" arm would be a branch no input can reach.
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
