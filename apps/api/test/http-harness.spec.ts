import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every spec that drives HTTP with supertest starts its app with `listenOnce` (T-069).
 *
 * `app.init()` leaves the server unbound, and supertest then listens and closes a server around
 * every request — resolving only when `server.close` has seen every socket end. Under load that
 * hung requests for the full 15 s timeout. See `test/http.ts`.
 */
const API = join(__dirname, '..');
const specs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return specs(path);
    return e.name.endsWith('.spec.ts') ? [path] : [];
  });

const httpSpecs = [...specs(join(API, 'src')), ...specs(join(API, 'test'))]
  .map((path) => ({ path: relative(API, path), source: readFileSync(path, 'utf8') }))
  .filter((f) => f.path !== 'test/http-harness.spec.ts') // names supertest; drives no HTTP
  .filter((f) => f.source.includes("from 'supertest'"));

describe('the HTTP test harness', () => {
  it('found the specs that drive HTTP', () => {
    expect(httpSpecs.length).toBeGreaterThanOrEqual(13);
  });

  it('starts every such app with listenOnce, never a bare init', () => {
    const offenders = httpSpecs
      .filter((f) => !f.source.includes('listenOnce(') || /\bapp\.init\(\)/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('closes every such app with closeApp', () => {
    const offenders = httpSpecs
      .filter((f) => !f.source.includes('closeApp(') || /\bapp\??\.close\(\)/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

/**
 * The failure behind the "expected 404 to be 400" flakes, reproduced deterministically.
 *
 * Node's global agent keeps sockets alive. A test server that closes while its response is still
 * in flight spares that socket, so it survives, pooled, attached to the old app. When the next
 * test's app is given the same ephemeral port, the pooled socket is reused — and the OLD app
 * answers. Under load, supertest's per-request listen/close made that window routine: 4 failures
 * in 60 loaded runs, three of them a different app's 404. `test/setup-http.ts` turns keep-alive off.
 */
describe('a request to a new test app', () => {
  const get = (port: number) =>
    new Promise<string>((resolve) => {
      http
        .get({ host: '127.0.0.1', port, path: '/' }, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => resolve(body));
        })
        .on('error', (e: NodeJS.ErrnoException) => resolve(`error ${e.code}`));
    });

  it('is never answered by the previous app on the same port', async () => {
    const old: http.Server = http.createServer((_req, res) => {
      res.end('old');
      old.close(); // closes while the response is in flight, as supertest did under load
    });
    await new Promise<void>((resolve) => old.listen(0, '127.0.0.1', resolve));
    const { port } = old.address() as { port: number };
    await get(port);

    const next = http.createServer((_req, res) => res.end('next'));
    await new Promise<void>((resolve) => next.listen(port, '127.0.0.1', resolve));
    try {
      expect(await get(port)).toBe('next');
    } finally {
      old.closeAllConnections();
      next.closeAllConnections();
      await new Promise((resolve) => next.close(resolve));
    }
  });
});
