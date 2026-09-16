import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MissionPolicyModule } from '../mission-policy/mission-policy.module';
import { MissionTransitionService } from './mission-transition.service';
import { MissionsController } from './missions.controller';
import { OwnMissionRepository } from './missions.repository';
import { MissionsService } from './missions.service';

@Module({
  // AuthModule for the shared rate limiter.
  imports: [AuthModule, MissionPolicyModule],
  controllers: [MissionsController],
  providers: [MissionsService, OwnMissionRepository, MissionTransitionService],
  // Quotes, assignments and the moderation queue all move missions, and they do it through
  // the transition service rather than by writing the column themselves.
  exports: [MissionTransitionService],
})
export class MissionsModule {}
