import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * Legal documents and consent records (T-021). Exported, because the gates that require an
 * acceptance live in other modules: registration and role activation (T-022), agency terms
 * (T-083).
 */
@Module({
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
