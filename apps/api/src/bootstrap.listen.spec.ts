import { afterEach, describe, expect, it, vi } from 'vitest';

// Process startup against a stand-in factory: no port is bound and no module graph is
// built. configureApp's real behaviour is covered in bootstrap.spec.ts.
const mocks = vi.hoisted(() => ({ app: undefined as unknown, create: undefined as unknown }));

vi.mock('@nestjs/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@nestjs/core')>();
  mocks.create = vi.fn(async () => mocks.app);
  return { ...real, NestFactory: { create: mocks.create } };
});
vi.mock('./app.module', () => ({ AppModule: class AppModule {} }));

const fakeApp = () => ({
  get: vi.fn(() => ({ kind: 'pino-logger' })),
  useLogger: vi.fn(),
  getHttpAdapter: vi.fn(() => ({ getInstance: () => ({ disable: vi.fn() }) })),
  use: vi.fn(),
  setGlobalPrefix: vi.fn(),
  useGlobalPipes: vi.fn(),
  useGlobalFilters: vi.fn(),
  listen: vi.fn(async () => undefined),
});

describe('process startup', () => {
  const saved = { NODE_ENV: process.env['NODE_ENV'], PORT: process.env['PORT'] };

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const start = async () => {
    // Production skips OpenAPI, which would need a real application to document.
    process.env['NODE_ENV'] = 'production';
    const app = fakeApp();
    mocks.app = app;
    const { bootstrap } = await import('./bootstrap');
    await bootstrap();
    return app;
  };

  it('listens on 3001 when PORT is unset', async () => {
    delete process.env['PORT'];
    const app = await start();
    expect(app.listen).toHaveBeenCalledWith(3001);
  });

  it('listens on PORT when it is set', async () => {
    process.env['PORT'] = '4555';
    const app = await start();
    expect(app.listen).toHaveBeenCalledWith(4555);
  });

  it('buffers early logs and hands them to the structured logger', async () => {
    const app = await start();
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), { bufferLogs: true });
    expect(app.useLogger).toHaveBeenCalledWith({ kind: 'pino-logger' });
  });

  it('applies the global configuration before listening', async () => {
    const app = await start();
    const configured = app.useGlobalFilters.mock.invocationCallOrder[0] ?? Infinity;
    const listened = app.listen.mock.invocationCallOrder[0] ?? -Infinity;
    expect(configured).toBeLessThan(listened);
  });
});
