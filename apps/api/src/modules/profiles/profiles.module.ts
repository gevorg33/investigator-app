import { Module } from '@nestjs/common';
import { LegalModule } from '../legal/legal.module';
import { AgencyInvestigatorsController } from './agency-investigators.controller';
import { AgencyInvestigatorsService } from './agency-investigators.service';
import { InvestigatorProfileStore } from './profile-store';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';

@Module({
  // Registration and role activation record what was accepted, in the same transaction (T-022).
  imports: [LegalModule],
  controllers: [ProfilesController, AgencyInvestigatorsController],
  providers: [
    ProfilesService,
    AgencyInvestigatorsService,
    InvestigatorProfileStore,
    OwnInvestigatorProfileRepository,
    OwnCustomerProfileRepository,
  ],
  exports: [ProfilesService],
})
export class ProfilesModule {}
