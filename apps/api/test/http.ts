import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';

/**
 * Start a test app listening once, on an ephemeral loopback port (T-069).
 *
 * Without this, `request(app.getHttpServer())` hands supertest a server that is not listening,
 * so supertest starts one for **every request** and resolves the request only inside
 * `server.close(callback)`. `close` waits for every open connection to end, and under load the
 * response socket can still be active when it is called — the request then waits on socket
 * teardown instead of the response. That hung two different controller specs for exactly the
 * 15 s test timeout under CPU saturation, with no database involved.
 *
 * Listening once means supertest finds an address and skips its per-request listen/close.
 */
export async function listenOnce(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}

/** The counterpart: drop keep-alive sockets first, so shutdown cannot wait on them either. */
export async function closeApp(app: INestApplication | undefined): Promise<void> {
  if (app === undefined) return;
  (app.getHttpServer() as Server).closeAllConnections();
  await app.close();
}
