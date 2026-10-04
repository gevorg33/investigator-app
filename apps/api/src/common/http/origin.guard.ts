import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { domains, type DomainEnv } from '@investigator/config';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';

/** Methods that change nothing, and so carry nothing a forged request could do. */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

type Headers = Pick<Request, 'method'> & { get(name: string): string | undefined };

/**
 * Whether a request that changes something came from a page of another origin — refused.
 *
 * `SameSite=Strict` keeps the session cookie off requests from other *sites*, but `app.`, `admin.`,
 * `news.` and the apex are one site: a page on `news.` — the most third-party-heavy origin we
 * have — could post a form to `app./api` and the browser would send the cookie. CORS does not stop
 * that either; it hides the response, not the request. So the browser's own account of where a
 * request comes from decides:
 *
 * - `Sec-Fetch-Site`, which every current browser sends and no page can set: only `same-origin`,
 *   or `none` (the reader's own navigation), may change anything.
 * - Without it, `Origin`: one of the sites the domain map says serves the API, and the very host
 *   the request arrived on — `app.`'s pages never write to `admin.`'s API.
 * - With neither, no browser sent it: app-web's own server, a mail provider's one-click
 *   unsubscribe, a test. None of those is a page another origin controls.
 */
export function crossOrigin(req: Headers, env: DomainEnv = process.env): boolean {
  if (SAFE.has(req.method)) return false;
  const site = req.get('sec-fetch-site');
  if (site !== undefined) return site !== 'same-origin' && site !== 'none';
  const origin = req.get('origin');
  if (origin === undefined) return false;
  const { app, admin } = domains(env);
  const arrivedOn = req.get('x-forwarded-host') ?? req.get('host');
  return !([app, admin].includes(origin) && new URL(origin).host === arrivedOn);
}

/** Every route, before its own guards: a cross-origin write never reaches a handler (T-025). */
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (crossOrigin(context.switchToHttp().getRequest<Request>())) throw AppError.forbidden();
    return true;
  }
}
