import { Body, Controller, Get, Global, Module, Patch, Req, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from './bootstrap';
import { DB } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { UpdateInvestigatorProfileDto } from './modules/profiles/profiles.dto';
import { closeApp, listenOnce } from '../test/http';

// configureApp never touches AppModule, and importing the real one validates the
// environment at import time. Stand it in so this file tests configuration only.
vi.mock('./app.module', () => ({ AppModule: class AppModule {} }));

@Global()
@Module({ providers: [{ provide: DB, useValue: { execute: async () => [] } }], exports: [DB] })
class StubDatabaseModule {}

/** A route taking a real DTO, so a refusal is the one a client of the profile endpoint gets. */
@Controller('probe')
class ProbeController {
  @Patch()
  update(@Body() dto: UpdateInvestigatorProfileDto): UpdateInvestigatorProfileDto {
    return dto;
  }

  /** The address every rate limit, audit row and consent record is given (`requestContext`). */
  @Get('ip')
  ip(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }
}

describe('global application configuration', () => {
  const originalEnv = process.env['NODE_ENV'];
  const originalProxies = process.env['TRUSTED_PROXIES'];
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
    if (originalEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalEnv;
    if (originalProxies === undefined) delete process.env['TRUSTED_PROXIES'];
    else process.env['TRUSTED_PROXIES'] = originalProxies;
  });

  const make = async (
    nodeEnv: string,
    beforeConfigure?: (a: INestApplication) => void,
  ): Promise<INestApplication> => {
    process.env['NODE_ENV'] = nodeEnv;
    const mod = await Test.createTestingModule({
      imports: [StubDatabaseModule, HealthModule],
      controllers: [ProbeController],
    }).compile();
    app = mod.createNestApplication();
    beforeConfigure?.(app);
    await configureApp(app);
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

  it('names the refused field, and carries the message its DTO wrote for it (T-157)', async () => {
    const a = await make('test');
    const blank = await request(a.getHttpServer())
      .patch('/api/v1/probe')
      .send({ displayName: '   ' })
      .expect(400);
    expect(blank.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [
        {
          field: 'displayName',
          code: 'INVALID',
          messageKey: 'error.validation.display_name.blank',
        },
      ],
    });
    const undeclared = await request(a.getHttpServer())
      .patch('/api/v1/probe')
      .send({ status: 'VERIFIED' })
      .expect(400);
    expect(undeclared.body.error.details).toEqual([
      { field: 'status', code: 'NOT_ALLOWED', messageKey: 'error.common.validation_failed' },
    ]);
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

  describe('writes from another origin (T-025)', () => {
    const patch = (headers: Record<string, string>) =>
      request(app!.getHttpServer()).patch('/api/v1/probe').set(headers).send({});

    it('lets the app’s own pages write, and anything no browser sent', async () => {
      await make('test');
      await patch({ 'Sec-Fetch-Site': 'same-origin' }).expect(200);
      await patch({}).expect(200);
    });

    it('refuses a write from a sibling subdomain, though the session cookie would ride along', async () => {
      await make('test');
      const res = await patch({ 'Sec-Fetch-Site': 'same-site' }).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await patch({ 'Sec-Fetch-Site': 'cross-site' }).expect(403);
    });

    it('lets another origin read, and answers none of them with CORS', async () => {
      await make('test');
      const read = await request(app!.getHttpServer())
        .get('/api/v1/health')
        .set({ 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example.test' })
        .expect(200);
      expect(read.headers['access-control-allow-origin']).toBeUndefined();
      const preflight = await request(app!.getHttpServer())
        .options('/api/v1/probe')
        .set({ Origin: 'https://example.test', 'Access-Control-Request-Method': 'PATCH' });
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('the client’s address behind the proxies (T-138)', () => {
    const ipWith = async (forwardedFor?: string) => {
      const call = request(app!.getHttpServer()).get('/api/v1/probe/ip');
      return (await (forwardedFor === undefined ? call : call.set('X-Forwarded-For', forwardedFor)))
        .body.ip as string;
    };
    const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

    it('believes no forwarded address when no proxy is trusted — the socket’s address is the client', async () => {
      delete process.env['TRUSTED_PROXIES'];
      await make('test');
      expect(await ipWith('203.0.113.7')).toMatch(LOOPBACK);
    });

    it('takes the client from a trusted hop, and never an address the client wrote itself', async () => {
      // The test client connects over loopback: here, loopback is the proxy.
      process.env['TRUSTED_PROXIES'] = 'loopback';
      await make('test');
      expect(await ipWith()).toMatch(LOOPBACK);
      expect(await ipWith('203.0.113.7')).toBe('203.0.113.7');
      // A client that sends its own X-Forwarded-For gets it prepended to: the proxy appends the
      // address it saw, and that — the nearest untrusted entry — is the one believed.
      expect(await ipWith('198.51.100.9, 203.0.113.7')).toBe('203.0.113.7');
    });

    it('walks back over every trusted hop — Caddy, then the app’s server — and no further', async () => {
      process.env['TRUSTED_PROXIES'] = 'loopback, 10.20.0.2';
      await make('test');
      // client → Caddy (10.20.0.2 as the app's server saw it) → app server (loopback here)
      expect(await ipWith('203.0.113.7, 10.20.0.2')).toBe('203.0.113.7');
    });
  });
});
