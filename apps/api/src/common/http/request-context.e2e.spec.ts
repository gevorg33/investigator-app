import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, testPool } from '../../../test/db';
import { closeApp, listenOnce } from '../../../test/http';

/**
 * The client's address through the whole stack, behind a trusted proxy (T-138). Before, every
 * request behind Caddy carried Caddy's address: one per-IP sign-in limit shared by everybody, and
 * the same address on every audit row. The test client connects over loopback, so loopback plays
 * the proxy, and X-Forwarded-For carries the client it saw.
 */
describe('the client’s address, end to end', () => {
  const saved = { ...process.env };
  let app: INestApplication;
  let owner: postgres.Sql;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['REDIS_URL'] ??= 'redis://localhost:6380';
    process.env['SESSION_SECRET'] ??= 'x'.repeat(48);
    process.env['NODE_ENV'] = 'test';
    process.env['TRUSTED_PROXIES'] = 'loopback';
    owner = testPool({ role: 'owner' });
    // Imported only now: AppModule validates the environment the moment it is loaded.
    const { AppModule } = await import('../../app.module');
    const { configureApp } = await import('../../bootstrap');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await configureApp(app);
    await listenOnce(app);
  });

  afterAll(async () => {
    await closeApp(app);
    await owner.end();
    process.env = saved;
  });

  /** A failed sign-in from `client`, for an address nobody holds — the per-account limit never bites. */
  const signIn = (client: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', client)
      .send({ email: `nobody-${randomUUID()}@example.test`, password: 'not the password' });

  it('limits sign-ins per client, not per proxy: one client spraying does not lock out another', async () => {
    const spraying = '203.0.113.7';
    for (let i = 0; i < 20; i += 1) expect((await signIn(spraying)).status).toBe(401);
    const limited = await signIn(spraying);
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({ code: 'RATE_LIMITED' });

    // Behind the same proxy, from another client: before T-138 this was the same key, and refused.
    expect((await signIn('203.0.113.8')).status).toBe(401);
  });

  it('records the client’s address on the audit row, not the proxy’s', async () => {
    const res = await signIn('198.51.100.23');
    expect(res.status).toBe(401);
    const [row] = await owner<{ ip_address: string | null }[]>`
      SELECT ip_address FROM audit_logs
       WHERE correlation_id = ${res.headers['x-correlation-id'] as string}
         AND action = 'auth.login.failed'`;
    expect(row?.ip_address).toBe('198.51.100.23');
  });
});
