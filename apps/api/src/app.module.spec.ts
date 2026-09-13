import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LOCAL = 'postgres://postgres:postgres@localhost:5433/investigator_dev';

/**
 * The real module graph, booted. Every other suite assembles a slice by hand; this is the
 * only place that proves the modules as declared actually fit together.
 */
describe('the application module', () => {
  const saved = { ...process.env };

  beforeAll(() => {
    process.env['DATABASE_URL'] ??= LOCAL;
    process.env['REDIS_URL'] ??= 'redis://localhost:6380';
    process.env['SESSION_SECRET'] ??= 'x'.repeat(48);
    process.env['NODE_ENV'] = 'test';
  });

  afterAll(() => {
    process.env = saved;
  });

  const boot = async (nodeEnv: string, logLevel?: string): Promise<INestApplication> => {
    process.env['NODE_ENV'] = nodeEnv;
    if (logLevel === undefined) delete process.env['LOG_LEVEL'];
    else process.env['LOG_LEVEL'] = logLevel;
    // Imported after the environment is set: ConfigModule validates it on import.
    const { AppModule } = await import('./app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = mod.createNestApplication({ logger: false });
    await app.init();
    return app;
  };

  it('wires every module together', async () => {
    const app = await boot('test');
    const { AuditService } = await import('./common/audit/audit.service');
    const { AuthService } = await import('./modules/auth/auth.service');
    expect(app.get(AuditService)).toBeInstanceOf(AuditService);
    expect(app.get(AuthService)).toBeInstanceOf(AuthService);
    await app.close();
  });

  it('boots with human-readable logs in development', async () => {
    const app = await boot('development');
    expect(app.getHttpServer()).toBeDefined();
    await app.close();
  });

  it('honours an explicit LOG_LEVEL', async () => {
    // The factory reads LOG_LEVEL at boot, falling back to info. Booting with it set is the
    // only way to see the configured value, rather than the default, reach the logger.
    // PinoLogger.root, not an instance's `.logger`: nestjs-pino caches its out-of-request
    // logger module-wide, so every boot in this file after the first would report the first
    // boot's level. `root` is the public handle reassigned on each boot.
    const { PinoLogger } = await import('nestjs-pino');
    const app = await boot('test', 'warn');
    expect(PinoLogger.root.level).toBe('warn');
    await app.close();
  });

  it('defaults to info when LOG_LEVEL is unset', async () => {
    const { PinoLogger } = await import('nestjs-pino');
    const app = await boot('test');
    expect(PinoLogger.root.level).toBe('info');
    await app.close();
  });
});
