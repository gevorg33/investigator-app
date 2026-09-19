import http from 'node:http';

/**
 * No HTTP keep-alive for the test suite's clients (T-069).
 *
 * Node's global agent keeps sockets alive. A pooled socket can outlive the test server it was
 * opened to, and when the next test's server is given the same ephemeral port, that socket is
 * reused and the OLD app answers — which is how requests failed with another app's 404.
 * `http-harness.spec.ts` reproduces it deterministically. A fresh connection per request costs
 * nothing measurable here, and every request then reaches the server it was sent to.
 *
 * Test-only: loaded by `vitest.config.mts`. Production clients are browsers and are unaffected.
 */
http.globalAgent = new http.Agent({ keepAlive: false });
