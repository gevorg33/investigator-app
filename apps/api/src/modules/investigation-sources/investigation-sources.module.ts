import { Module } from '@nestjs/common';
import { InvestigationSourcesController } from './investigation-sources.controller';
import { InvestigationSourcesService } from './investigation-sources.service';

/** Where information in an assignment came from (plan.md §8, T-031). */
@Module({
  controllers: [InvestigationSourcesController],
  providers: [InvestigationSourcesService],
})
export class InvestigationSourcesModule {}
