import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.schema';
import { loggerOptions } from './common/logging/logger.options';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Fails the process at boot with a readable message rather than starting
      // half-configured and failing later under load.
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      useFactory: () =>
        loggerOptions(
          process.env['LOG_LEVEL'] ?? 'info',
          process.env['NODE_ENV'] === 'development',
        ),
    }),
    HealthModule,
  ],
})
export class AppModule {}
