import type { Request } from 'express';

/** What a service needs to know about the request that reached it, and nothing more. */
export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  correlationId?: string | undefined;
}

/**
 * The request context every controller hands to its service.
 *
 * One definition. The auth and profiles controllers each carried an identical private copy,
 * and only one copy was fully tested — duplicated logic drifts, and a test on one copy says
 * nothing about the other.
 */
export function requestContext(req: Request): RequestContext {
  // pino-http sets req.id, typed as string | number. Normalised to a string here so the
  // correlation id has one shape everywhere it travels; anything else is dropped rather
  // than coerced into a misleading value.
  const id: unknown = (req as unknown as { id?: unknown }).id;
  return {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    correlationId: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined,
  };
}
