import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Discovery over PostgreSQL and PostGIS — never RAG (`investigator-discovery`). Every fact it
 * filters on is a column, and similarity cannot answer "who speaks Armenian" or "how far".
 *
 * Exported because the assistant's discovery tools (T-018) must call this same service rather
 * than write their own query: two implementations of an eligibility filter is one too many.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
