import { lastValueFrom, Observable, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/context';
import { ContextInterceptor } from './context.interceptor';
import { currentContext } from './execution-context';
import { CONTEXT_KEY } from './request-context-key';

describe('the context interceptor', () => {
  const http = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;

  /** A handler that, like Nest's, starts running only when subscribed. */
  const handler = () => ({
    handle: () =>
      new Observable<string | undefined>((sub) => {
        void (async () => {
          await new Promise((r) => setTimeout(r, 1));
          sub.next(currentContext()?.tenantId);
          sub.complete();
        })();
      }),
  });

  it('runs the handler — and what it awaits — inside the context the guard resolved', async () => {
    const ctx = testContext({ userId: 'u1' });
    const out = new ContextInterceptor().intercept(http({ [CONTEXT_KEY]: ctx }), handler());
    expect(await lastValueFrom(out)).toBe(ctx.tenantId);
  });

  it('leaves a route without a resolved context as it was', async () => {
    const out = new ContextInterceptor().intercept(http({}), { handle: () => of('untouched') });
    expect(await lastValueFrom(out)).toBe('untouched');
  });
});
