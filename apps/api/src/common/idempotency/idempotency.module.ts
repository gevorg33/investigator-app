import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Global, because the endpoints that need a key are spread across modules — quote acceptance,
 * assignment creation, payment confirmation, payout initiation, refund issuance — and every
 * one of them must use the same store and the same unique constraint. A second implementation
 * of idempotency is a second set of races.
 */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
