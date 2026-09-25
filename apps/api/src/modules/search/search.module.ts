import { Module } from '@nestjs/common';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { MissionBrowseController } from './mission-browse.controller';
import { MissionBrowseService } from './mission-browse.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Discovery over PostgreSQL and PostGIS — never RAG (`investigator-discovery`), in both directions:
 * customers finding investigators, and investigators browsing the missions they could quote on
 * (T-054). Every fact it filters on is a column, and similarity cannot answer "who speaks
 * Armenian" or "how far".
 *
 * SearchService is exported because the assistant's discovery tools (T-018) must call this same service rather
 * than write their own query: two implementations of an eligibility filter is one too many.
 */
@Module({
  controllers: [SearchController, MissionBrowseController],
  // The repository is stateless; declared here as the quotes module does, so ProfilesModule's
  // exports stay as they are. Mission browse (T-054) asks it for the investigator's own profile.
  providers: [SearchService, MissionBrowseService, OwnInvestigatorProfileRepository],
  exports: [SearchService],
})
export class SearchModule {}
