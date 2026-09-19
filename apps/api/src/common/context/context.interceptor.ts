import { Injectable, type CallHandler, type NestInterceptor } from '@nestjs/common';
import type { ExecutionContext as NestExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CONTEXT_KEY, type RequestWithContext } from './request-context-key';
import { runInContext } from './execution-context';

/**
 * Runs the handler inside the execution context the guard resolved (T-075).
 *
 * Guards cannot wrap what runs after them, so ActorGuard leaves the context on the request and
 * this interceptor enters it. The handler starts when the inner observable is subscribed — which
 * happens inside `runInContext` — so the handler and everything it awaits see the context, and
 * the scoped client sets it on every query.
 *
 * A route without ActorGuard (sign-in, registration) has no context and runs as it did.
 */
@Injectable()
export class ContextInterceptor implements NestInterceptor {
  intercept(context: NestExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const resolved = req[CONTEXT_KEY];
    if (resolved === undefined) return next.handle();
    return new Observable((subscriber) =>
      runInContext(resolved, () => next.handle().subscribe(subscriber)),
    );
  }
}
