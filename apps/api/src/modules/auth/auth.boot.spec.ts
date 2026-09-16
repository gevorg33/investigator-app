import { Global, Module, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { MAILER } from '../../common/mail/mailer';
import { DB } from '../../database/database.module';
import { AuthController } from './auth.controller';
import { AuthModule } from './auth.module';
import { AuthzModule } from '../../common/authz/authz.module';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

/**
 * DatabaseModule and AuditModule are @Global() in the running app. This stands in for
 * both, so AuthModule is exercised exactly as it is declared rather than through a
 * hand-rolled copy of its provider list -- a copy would keep passing after the real
 * module broke.
 *
 * The boundary under test is decorator metadata, not persistence: a request that
 * reaches either stub has already proven DI and validation ran.
 */
class StubInfrastructureModule {}

// Applied as plain calls rather than `@Global()` / `@Module()` syntax: tsconfig.json
// excludes **/*.spec.ts, so the transformer does not enable experimentalDecorators for
// this file and decorator syntax fails to parse here. A decorator is just a function,
// so calling it directly is equivalent and needs no build configuration.
Module({
  providers: [
    { provide: DB, useValue: {} },
    { provide: AuditService, useValue: { record: async () => undefined } },
    { provide: MAILER, useValue: { send: async () => undefined } },
  ],
  exports: [DB, AuditService, MAILER],
})(StubInfrastructureModule);
Global()(StubInfrastructureModule);

/**
 * Guards the interaction between `emitDecoratorMetadata` and type-only imports.
 *
 * Nest reads constructor parameter types at runtime from `design:paramtypes`.
 * Rewriting any import in this module to `import type` erases the value and the
 * metadata degrades to `[Function]` — DI stops resolving, and a `@Body()` DTO
 * loses the class metatype that ValidationPipe needs, so the DTO is skipped
 * entirely and `forbidNonWhitelisted` stops rejecting unknown fields.
 *
 * Neither failure shows up in the other suites, which build services with `new`.
 * These cases go through the real container instead, so the regression is loud.
 * See the scoped `consistent-type-imports` override in eslint.config.js.
 */
describe('auth wiring survives the container', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubInfrastructureModule, AuthzModule, AuthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    // Optional-chained: if the container failed to build, that is the failure worth
    // reading — not a secondary TypeError on top of it.
    await app?.close();
  });

  it('resolves every injected dependency', () => {
    // Throws UnknownDependenciesException if design:paramtypes lost a class.
    expect(app.get(AuthController)).toBeInstanceOf(AuthController);
    expect(app.get(AuthService)).toBeInstanceOf(AuthService);
    expect(app.get(SessionService)).toBeInstanceOf(SessionService);
  });

  it('still rejects an unknown field on the body', async () => {
    // Passes with a 201/202 rather than 400 if the DTO metatype was erased —
    // the silent mass-assignment hole.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'probe@example.test',
        password: 'a-sufficiently-long-password',
        role: 'admin',
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('role');
  });

  it('still enforces the DTO constraints', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
  });
});
