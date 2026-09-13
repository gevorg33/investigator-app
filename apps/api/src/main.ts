import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/errors/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Information disclosure. Caddy strips it at the edge (ADR-0002); removing it here
  // too means the app is safe behind any proxy — launch-hardening.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

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

  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen(port);
}

void bootstrap();
