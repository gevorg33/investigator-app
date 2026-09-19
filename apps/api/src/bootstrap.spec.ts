import { Global, Module, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from './bootstrap';
import { DB } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { closeApp, listenOnce } from '../test/http';

// configureApp never touches AppModule, and importing the real one validates the
// environment at import time. Stand it in so this file tests configuration only.
vi.mock('./app.module', () => ({ AppModule: class AppModule {} }));

// Applied as calls: specs are excluded from tsconfig, so decorator syntax does not parse
// here (T-064).
class StubDatabaseModule {}
Module({ providers: [{ provide: DB, useValue: { execute: async () => [] } }], exports: [DB] })(
  StubDatabaseModule,
);
Global()(StubDatabaseModule);

describe('global application configuration', () => {
  const originalEnv = process.env['NODE_ENV'];
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
    if (originalEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalEnv;
  });

  const make = async (
    nodeEnv: string,
    beforeConfigure?: (a: INestApplication) => void,
  ): Promise<INestApplication> => {
    process.env['NODE_ENV'] = nodeEnv;
    const mod = await Test.createTestingModule({
      imports: [StubDatabaseModule, HealthModule],
    }).compile();
    app = mod.createNestApplication();
    beforeConfigure?.(app);
    configureApp(app);
    await listenOnce(app);
    return app;
  };

  it('serves everything under /api/v1', async () => {
    const a = await make('test');
    await request(a.getHttpServer()).get('/api/v1/health').expect(200);
    await request(a.getHttpServer()).get('/health').expect(404);
  });

  it('does not announce the framework', async () => {
    const a = await make('test');
    const res = await request(a.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('shapes every error through the platform error filter', async () => {
    const a = await make('test');
    const res = await request(a.getHttpServer()).get('/api/v1/nothing-here').expect(404);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('installs a validation pipe that rejects undeclared fields', async () => {
    let pipe: unknown;
    await make('test', (a) => {
      const real = a.useGlobalPipes.bind(a);
      vi.spyOn(a, 'useGlobalPipes').mockImplementation((...pipes) => {
        pipe = pipes[0];
        return real(...pipes);
      });
    });
    expect(pipe).toBeInstanceOf(ValidationPipe);
    const options = (pipe as { validatorOptions: Record<string, unknown> }).validatorOptions;
    // Mass assignment: an undeclared field is an error, not something silently dropped.
    expect(options).toMatchObject({ whitelist: true, forbidNonWhitelisted: true });
  });

  it('parses cookies, which carry the refresh token', async () => {
    const used: unknown[] = [];
    await make('test', (a) => {
      const real = a.use.bind(a);
      vi.spyOn(a, 'use').mockImplementation((...args: unknown[]) => {
        used.push(args[0]);
        return (real as (...x: unknown[]) => INestApplication)(...args);
      });
    });
    expect(used.some((fn) => typeof fn === 'function' && fn.name === 'cookieParser')).toBe(true);
  });

  it('publishes the OpenAPI document outside production', async () => {
    const a = await make('development');
    const res = await request(a.getHttpServer()).get('/api/docs-json').expect(200);
    expect(res.body.openapi).toBeDefined();
  });

  it('does not publish the OpenAPI document in production', async () => {
    // A map of the attack surface. It must not exist on a production host at all.
    const a = await make('production');
    await request(a.getHttpServer()).get('/api/docs-json').expect(404);
    await request(a.getHttpServer()).get('/api/docs').expect(404);
  });
});
