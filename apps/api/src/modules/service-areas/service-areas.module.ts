import { Module } from '@nestjs/common';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { AgencyServiceAreasController, ServiceAreasController } from './service-areas.controller';
import { ServiceAreasService } from './service-areas.service';

@Module({
  controllers: [ServiceAreasController, AgencyServiceAreasController],
  // The repository is stateless; declaring it here avoids widening ProfilesModule's exports.
  providers: [ServiceAreasService, OwnInvestigatorProfileRepository],
  // Discovery (T-011) composes coverage into its results.
  exports: [ServiceAreasService],
})
export class ServiceAreasModule {}
