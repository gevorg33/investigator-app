import { Module } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';

@Module({
  controllers: [ProfilesController],
  providers: [ProfilesService, OwnInvestigatorProfileRepository, OwnCustomerProfileRepository],
  exports: [ProfilesService],
})
export class ProfilesModule {}
