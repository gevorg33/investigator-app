import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  // MissionsModule for the transition service: accepting a quote moves the mission, and the
  // mission's status has exactly one writer.
  imports: [MissionsModule],
  controllers: [QuotesController],
  // The repository is stateless; declaring it here avoids widening ProfilesModule's exports,
  // as ServiceAreasModule does.
  providers: [QuotesService, OwnInvestigatorProfileRepository],
  // The assignments module reads the accepted quote when a payment is authorized.
  exports: [QuotesService],
})
export class QuotesModule {}
