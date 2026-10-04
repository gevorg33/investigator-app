import { Module } from '@nestjs/common';
import { LegalHoldController } from './legal-hold.controller';
import { LegalHoldService } from './legal-hold.service';

/**
 * Legal holds: placing, releasing and reading them (T-035). The guard every retention deletion goes
 * through, and the sweeps that use it, run in the worker (T-204), which provides them itself.
 */
@Module({
  controllers: [LegalHoldController],
  providers: [LegalHoldService],
})
export class LegalHoldModule {}
