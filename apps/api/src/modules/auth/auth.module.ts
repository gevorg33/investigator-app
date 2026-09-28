import { Module } from '@nestjs/common';
import { LegalModule } from '../legal/legal.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleAuthService } from './google-auth.service';
import { GOOGLE_OAUTH, googleFromEnv } from './google-oauth.client';
import { PasswordService } from './password.service';
import { MemoryRateLimitStore, RATE_LIMIT_STORE, RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService } from './user-token.service';
import { SessionRepository } from './session.repository';

@Module({
  // Registration and role activation record what was accepted, in the same transaction (T-022).
  imports: [LegalModule],
  // AuthzModule is @Global and must not be imported here: it would make the two modules
  // mutually dependent and Nest cannot build that graph.
  controllers: [AuthController, GoogleAuthController],
  providers: [
    AuthService,
    GoogleAuthService,
    // Google sign-in (T-062): null without its three settings, and the routes answer 404.
    { provide: GOOGLE_OAUTH, useFactory: () => googleFromEnv(process.env) },
    PasswordService,
    TokenService,
    SessionService,
    UserTokenService,
    SessionRepository,
    RateLimitService,
    // In-memory for now. A per-instance counter is not a limit across replicas —
    // swapped for a Redis-backed store when Redis is wired (plan.md §19).
    { provide: RATE_LIMIT_STORE, useClass: MemoryRateLimitStore },
  ],
  // RateLimitService is shared: other modules budget their own endpoint classes with it.
  exports: [AuthService, RateLimitService, TokenService],
})
export class AuthModule {}
