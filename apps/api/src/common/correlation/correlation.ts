import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Accept a client-supplied id, or generate one. Returned on the response and carried
 * into logs, jobs and outbound webhooks — without it, reconstructing a multi-step flow
 * during a dispute is guesswork (docs/api/README.md).
 */
export function resolveCorrelationId(req: IncomingMessage): string {
  const supplied = req.headers[CORRELATION_HEADER];
  const value = Array.isArray(supplied) ? supplied[0] : supplied;
  // Bound and sanitise: this reaches logs, so it must not carry injected content.
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)) return value;
  return randomUUID();
}
