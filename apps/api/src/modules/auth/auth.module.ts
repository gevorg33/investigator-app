import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import {
  MemoryRateLimitStore,
  RATE_LIMIT_STORE,
  RateLimitService,
} from './rate-limit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService } from './user-token.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    SessionService,
    UserTokenService,
    RateLimitService,
    // In-memory for now. A per-instance counter is not a limit across replicas —
    // swapped for a Redis-backed store when Redis is wired (plan.md §19).
    { provide: RATE_LIMIT_STORE, useClass: MemoryRateLimitStore },
  ],
  exports: [AuthService],
})
export class AuthModule {}
