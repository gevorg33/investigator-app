import { Module } from '@nestjs/common';
import { LegalModule } from '../legal/legal.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';

@Module({
  // Registration and role activation record what was accepted, in the same transaction (T-022).
  imports: [LegalModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, OwnInvestigatorProfileRepository, OwnCustomerProfileRepository],
  exports: [ProfilesService],
})
export class ProfilesModule {}
