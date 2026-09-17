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
import { MissionPolicyModule } from './modules/mission-policy/mission-policy.module';
import { MissionsModule } from './modules/missions/missions.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { SearchModule } from './modules/search/search.module';
import { ServiceAreasModule } from './modules/service-areas/service-areas.module';
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
    IdempotencyModule,
    AuthModule,
    ProfilesModule,
    MediaModule,
    ServiceAreasModule,
    SearchModule,
    MissionPolicyModule,
    MissionsModule,
    QuotesModule,
    AssignmentsModule,
    HealthModule,
  ],
})
export class AppModule {}
