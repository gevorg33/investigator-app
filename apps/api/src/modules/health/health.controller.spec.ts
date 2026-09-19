import { Global, Module, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORRELATION_HEADER } from '../../common/correlation/correlation';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { DB } from '../../database/database.module';
import { DATABASE_CHECK_TIMEOUT_MS, HealthController } from './health.controller';
import { HealthModule } from './health.module';
import { closeApp, listenOnce } from '../../../test/http';

/** A stand-in database whose one query behaves as told. Decorators as calls (T-064). */
const databaseThat = (execute: () => Promise<unknown>) => {
  class StubDatabaseModule {}
  Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })(StubDatabaseModule);
  Global()(StubDatabaseModule);
  return StubDatabaseModule;
};

describe('GET /api/v1/health', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
    vi.useRealTimers();
  });

  const make = async (execute: () => Promise<unknown>): Promise<INestApplication> => {
    const mod = await Test.createTestingModule({
      imports: [databaseThat(execute), HealthModule],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
    return app;
  };

  it('returns 200 with service and dependency status', async () => {
    const a = await make(async () => []);
    const res = await request(a.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.service).toBe('investigator-api');
    expect(res.body.dependencies).toHaveProperty('database');
    expect(res.body.dependencies).toHaveProperty('redis');
  });

  it('reports the database up only after a real round trip', async () => {
    const execute = vi.fn(async () => []);
    const a = await make(execute);
    const res = await request(a.getHttpServer()).get('/api/v1/health').expect(200);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ status: 'ok', dependencies: { database: 'up' } });
  });

  it('reports degraded, still with 200, when the database query fails', async () => {
    const a = await make(async () => {
      throw new Error('connection refused');
    });
    const res = await request(a.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'degraded', dependencies: { database: 'down' } });
    // The failure reason stays in the logs, not in a public response.
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });

  it('keeps Redis honest: not_configured, because nothing uses it yet', async () => {
    const a = await make(async () => []);
    const res = await request(a.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.dependencies.redis).toBe('not_configured');
  });

  it('accepts a supplied correlation id', async () => {
    const a = await make(async () => []);
    await request(a.getHttpServer())
      .get('/api/v1/health')
      .set(CORRELATION_HEADER, 'testcorrelation1')
      .expect(200);
  });

  it('returns the error taxonomy shape on an unknown route', async () => {
    const a = await make(async () => []);
    const res = await request(a.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.messageKey).toBe('error.common.not_found');
    expect(res.body.error).toHaveProperty('correlationId');
  });

  it('leaks no stack trace or internal detail in an error body', async () => {
    const a = await make(async () => []);
    const res = await request(a.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at \w+ \(/);
    expect(body).not.toContain('node_modules');
    expect(Object.keys(res.body)).toEqual(['error']);
  });
});

describe('health check internals', () => {
  const saved = process.env['npm_package_version'];

  afterEach(() => {
    vi.useRealTimers();
    if (saved === undefined) delete process.env['npm_package_version'];
    else process.env['npm_package_version'] = saved;
  });

  it('counts a database that does not answer in time as down', async () => {
    vi.useFakeTimers();
    const hanging = { execute: () => new Promise(() => undefined) };
    const pending = new HealthController(hanging as never).check();
    await vi.advanceTimersByTimeAsync(DATABASE_CHECK_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({
      status: 'degraded',
      dependencies: { database: 'down' },
    });
  });

  it('reports the package version when it is known, and a placeholder when not', async () => {
    const db = { execute: async () => [] };
    process.env['npm_package_version'] = '9.9.9';
    expect((await new HealthController(db as never).check()).version).toBe('9.9.9');
    delete process.env['npm_package_version'];
    expect((await new HealthController(db as never).check()).version).toBe('0.0.0');
  });
});
