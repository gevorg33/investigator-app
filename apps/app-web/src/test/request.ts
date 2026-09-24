import { vi } from 'vitest';

/**
 * A stand-in for the incoming request, for specs that render server components. Each spec mocks
 * `next/headers` with `nextHeaders` and sets what the reader's browser would have sent.
 */
export const request = {
  cookies: new Map<string, string>(),
  acceptLanguage: null as string | null,
  /** Headers the middleware adds, such as `x-pathname`. */
  headers: new Map<string, string>(),
  set: vi.fn(),
  delete: vi.fn(),
  reset() {
    this.cookies.clear();
    this.headers.clear();
    this.acceptLanguage = null;
    this.set.mockReset();
    this.delete.mockReset();
  },
};

export const nextHeaders = {
  cookies: async () => ({
    get: (name: string) =>
      request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined,
    set: request.set,
    delete: request.delete,
  }),
  headers: async () =>
    new Headers([
      ...(request.acceptLanguage === null
        ? []
        : [['accept-language', request.acceptLanguage] as [string, string]]),
      ...request.headers,
    ]),
};
