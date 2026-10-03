import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';

/**
 * The shared taxonomy, and the tag vocabulary refining it: reading both, and staff maintaining
 * them (ADR-0007, T-053, T-055).
 */
@Module({
  controllers: [TaxonomyController, TagsController],
  providers: [TaxonomyService, TagsService],
  exports: [TaxonomyService, TagsService],
})
export class TaxonomyModule {}
