import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import metadata from './metadata';
import { AppExceptionFilter } from './common/errors/http-exception.filter';
import { addValidationBounds } from './common/openapi/validation-bounds';
import { validationPipe } from './common/validation/pipe';

/**
 * Everything the running application applies globally.
 *
 * Separate from process startup so it can be tested against a real Nest application.
 * Each line is a security or contract property, and a property nobody asserts is one
 * nobody notices losing.
 */
export async function configureApp(app: INestApplication): Promise<void> {
  // Information disclosure. Caddy strips it at the edge (ADR-0002); removing it here
  // too means the app is safe behind any proxy — launch-hardening.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // Refresh token travels as a host-only cookie (ADR-0002).
  app.use(cookieParser());

  app.setGlobalPrefix('api/v1');

  // Mass assignment protection, transformation and the shape of a refusal: one pipe, shared with
  // every route spec (`common/validation/pipe.ts`).
  app.useGlobalPipes(validationPipe());

  app.useGlobalFilters(new AppExceptionFilter());

  // OpenAPI is a map of the attack surface. Non-production only.
  if (process.env['NODE_ENV'] !== 'production') {
    // What each request takes (T-136): the swagger plugin's metadata, generated into
    // `metadata.ts` because the build is plain tsc, then every validation bound as the running
    // API enforces it.
    await SwaggerModule.loadPluginMetadata(metadata);
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Investigator API')
        .setDescription('Conventions: docs/api/')
        .setVersion('1')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, addValidationBounds(doc));
  }
}

export async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await configureApp(app);
  await app.listen(Number(process.env['PORT'] ?? 3001));
  return app;
}
