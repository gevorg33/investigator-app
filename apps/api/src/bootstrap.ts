import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/errors/http-exception.filter';

/**
 * Everything the running application applies globally.
 *
 * Separate from process startup so it can be tested against a real Nest application.
 * Each line is a security or contract property, and a property nobody asserts is one
 * nobody notices losing.
 */
export function configureApp(app: INestApplication): void {
  // Information disclosure. Caddy strips it at the edge (ADR-0002); removing it here
  // too means the app is safe behind any proxy — launch-hardening.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // Refresh token travels as a host-only cookie (ADR-0002).
  app.use(cookieParser());

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      // Mass assignment protection. A client must never set a field we did not
      // declare — see platform-security-review.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AppExceptionFilter());

  // OpenAPI is a map of the attack surface. Non-production only.
  if (process.env['NODE_ENV'] !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Investigator API')
        .setDescription('Conventions: docs/api/')
        .setVersion('1')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
}

export async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.listen(Number(process.env['PORT'] ?? 3001));
  return app;
}
