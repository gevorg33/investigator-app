import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger, LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { CORRELATION_HEADER } from '../correlation/correlation';
import { loggerOptions, REDACT_PATHS } from './logger.options';
import { closeApp, listenOnce } from '../../../test/http';

describe('log redaction', () => {
  // audit-logging forbids these in logs. The logger must be incapable of emitting them.
  it.each([
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    'token',
    'refreshToken',
    'sessionSecret',
    'signedUrl',
    'cardNumber',
    'email',
  ])('redacts %s', (path) => {
    expect(REDACT_PATHS).toContain(path);
  });

  it('redacts nested occurrences, not only top level', () => {
    for (const p of ['*.password', '*.token', '*.secret', '*.signedUrl']) {
      expect(REDACT_PATHS).toContain(p);
    }
  });
});

/**
 * The configured logger, actually writing. The suite above checks the paths are listed;
 * these check the logger is incapable of emitting what they cover — the property that
 * matters, and the one a listed-but-mistyped path would silently lose.
 */
describe('the logger, as configured', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const boot = async (): Promise<{ app: INestApplication; output: () => string }> => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const options = loggerOptions('info', false).pinoHttp;
    const mod = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: [options as never, stream] })],
    }).compile();
    app = mod.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    await listenOnce(app);
    return { app, output: () => lines.join('') };
  };

  it('redacts credentials and personal data from a logged payload', async () => {
    const { app: a, output } = await boot();
    a.get(Logger).log(
      {
        email: 'person@example.test',
        password: 'top-level-password-value',
        refreshToken: 'top-level-refresh-token-value',
        nested: {
          email: 'nested@example.test',
          password: 'nested-password-value',
          refreshToken: 'nested-refresh-token-value',
          token: 'nested-token-value',
          secret: 'nested-secret-value',
        },
      },
      'probe',
    );
    const out = output();

    for (const leaked of [
      'person@example.test',
      'top-level-password-value',
      'top-level-refresh-token-value',
      'nested@example.test',
      'nested-password-value',
      'nested-refresh-token-value',
      'nested-token-value',
      'nested-secret-value',
    ]) {
      expect(out, `logged in the clear: ${leaked}`).not.toContain(leaked);
    }
    expect(out).toContain('[redacted]');
  });

  it('logs a request by its path, never its query string', async () => {
    const { app: a, output } = await boot();
    await request(a.getHttpServer()).get('/api/v1/nowhere?email=leak%40example.test&token=abc');
    await new Promise((r) => setImmediate(r));

    const entry = output()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { req?: { path?: string } })
      .find((e) => e.req);
    expect(entry?.req?.path).toBe('/api/v1/nowhere');
    // Query strings carry personal data; the serializer drops them before they are written.
    expect(output()).not.toContain('leak');
  });

  it('echoes the correlation id and records it against the request', async () => {
    const { app: a, output } = await boot();
    const res = await request(a.getHttpServer())
      .get('/api/v1/nowhere')
      .set(CORRELATION_HEADER, 'corr_ABCDEFG123');
    await new Promise((r) => setImmediate(r));

    expect(res.headers[CORRELATION_HEADER]).toBe('corr_ABCDEFG123');
    expect(output()).toContain('"correlationId":"corr_ABCDEFG123"');
  });

  it('uses the pretty transport only when asked', () => {
    const pretty = loggerOptions('debug', true).pinoHttp as Record<string, unknown>;
    const plain = loggerOptions('info', false).pinoHttp as Record<string, unknown>;
    expect(pretty).toMatchObject({ level: 'debug', transport: { target: 'pino-pretty' } });
    expect(plain).not.toHaveProperty('transport');
  });
});
