import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.schema';
import { loggerOptions } from './common/logging/logger.options';
import { AuditModule } from './common/audit/audit.module';
import { MailModule } from './common/mail/mail.module';
import { DatabaseModule } from './database/database.module';
import { AuthzModule } from './common/authz/authz.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { ProfilesModule } from './modules/profiles/profiles.module';

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
    DatabaseModule,
    AuditModule,
    MailModule,
    AuthzModule,
    AuthModule,
    ProfilesModule,
    MediaModule,
    HealthModule,
  ],
})
export class AppModule {}
