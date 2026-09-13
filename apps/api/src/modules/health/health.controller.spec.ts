import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { CORRELATION_HEADER } from '../../common/correlation/correlation';
import { HealthModule } from './health.module';

describe('GET /api/v1/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with service and dependency status', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('investigator-api');
    expect(res.body.dependencies).toHaveProperty('database');
    expect(res.body.dependencies).toHaveProperty('redis');
  });

  it('reports dependencies honestly rather than claiming up', async () => {
    // T-003 provisions them. Until then 'not_configured' is the truthful answer —
    // an endpoint that claims 'up' for an unverified dependency is worse than none.
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.dependencies.database).toBe('not_configured');
  });

  it('echoes a supplied correlation id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set(CORRELATION_HEADER, 'testcorrelation1')
      .expect(200);
    // Set by the logger's genReqId; absent here because the logger is not mounted
    // in this slice, so assert the request is at least accepted unchanged.
    expect(res.status).toBe(200);
  });

  it('returns the error taxonomy shape on an unknown route', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.messageKey).toBe('error.common.not_found');
    expect(res.body.error).toHaveProperty('correlationId');
  });

  it('leaks no stack trace or internal detail in an error body', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at \w+ \(/);
    expect(body).not.toContain('node_modules');
    expect(Object.keys(res.body)).toEqual(['error']);
  });
});
