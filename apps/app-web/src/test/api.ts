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

type Reply = { status: number; body?: unknown; stream?: ReadableStream<Uint8Array> };

/** A turn's event stream, open until the spec closes it — or the page aborts it. */
export interface EventStream {
  /** Writes one server-sent event, framed as the API frames it. */
  send(event: { type: string } & Record<string, unknown>): void;
  /** Writes raw text — half an event, say. */
  write(text: string): void;
  close(): void;
  /** Whether the page gave up on it (Stop). */
  readonly aborted: boolean;
}

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
  /**
   * A `text/event-stream` reply the spec writes to as it goes (T-056). Aborting the request — the
   * page's Stop — errors the body with an `AbortError`, as a browser does.
   */
  stream(route: string): EventStream {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;
    const state = { aborted: false };
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    this.routes.set(route, async () => ({ status: 200, stream: body }));
    streams.set(body, () => {
      state.aborted = true;
      if (!closed) controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      closed = true;
    });
    return {
      send: ({ type, ...data }) =>
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)),
      write: (text) => controller.enqueue(encoder.encode(text)),
      close: () => {
        closed = true;
        controller.close();
      },
      get aborted() {
        return state.aborted;
      },
    };
  },
  /** A whole stream at once: these events, then the end. */
  streamed(route: string, events: Array<{ type: string } & Record<string, unknown>>) {
    const s = this.stream(route);
    for (const e of events) s.send(e);
    s.close();
    return this;
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

/** How to abort each stream's body, found by the body the reply carries. */
const streams = new WeakMap<ReadableStream<Uint8Array>, () => void>();

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
  const { status, body, stream } = typeof route === 'function' ? await route() : route;
  if (stream !== undefined) {
    const abort = streams.get(stream)!;
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener('abort', abort);
    return new Response(stream, {
      status,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  }
  return body === undefined
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
}
