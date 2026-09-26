import { vi } from 'vitest';

/** One request a spec's code made to the API. */
export interface ApiCall {
  method: string;
  /** The path under `/api/v1`, with its query. */
  path: string;
  /** Where it was sent: `''` from the browser (same-origin), the API's origin from the server. */
  origin: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit;
}

type Reply = { status: number; body?: unknown };

/**
 * A stand-in for the API behind `fetch`. A spec says what each route answers
 * (`api.on('GET /me', 200, account)`), then reads what was asked of it in `api.calls`. A route no
 * spec expected fails the call loudly rather than answering something plausible.
 */
export const api = {
  calls: [] as ApiCall[],
  routes: new Map<string, Reply | (() => Promise<Reply>)>(),
  on(route: string, status: number, body?: unknown) {
    this.routes.set(route, { status, body });
    return this;
  },
  /** A reply the spec releases itself — for what the screen shows while a request is in flight. */
  hold(route: string, status: number, body?: unknown): () => void {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    this.routes.set(route, async () => {
      await released;
      return { status, body };
    });
    return release;
  },
  /** No response at all — the connection dropped, or the API is down. */
  down(route: string) {
    this.routes.set(route, async () => {
      throw new TypeError('Failed to fetch');
    });
    return this;
  },
  install() {
    this.calls = [];
    this.routes.clear();
    vi.stubGlobal('fetch', vi.fn(fetchStub));
  },
};

/** An API error body, in the contract's shape (docs/api/errors.md). */
export const apiError = (
  code: string,
  messageKey: string,
  extra: { details?: unknown[]; correlationId?: string } = {},
) => ({ error: { code, messageKey, ...extra } });

async function fetchStub(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const at = url.indexOf('/api/v1');
  const origin = url.slice(0, at);
  const path = url.slice(at + '/api/v1'.length);
  const method = init.method ?? 'GET';
  api.calls.push({
    method,
    path,
    origin,
    headers: { ...(init.headers as Record<string, string>) },
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    init,
  });
  const route = api.routes.get(`${method} ${path}`);
  if (route === undefined) throw new Error(`No reply set for ${method} ${path}`);
  const { status, body } = typeof route === 'function' ? await route() : route;
  return body === undefined
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
}
