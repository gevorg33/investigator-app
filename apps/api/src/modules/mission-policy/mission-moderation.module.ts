import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module';
import { MissionModerationController } from './mission-moderation.controller';
import { MissionModerationService } from './mission-moderation.service';

/**
 * The moderation queue and its decisions (T-051). Its own module rather than part of
 * MissionPolicyModule: decisions move missions through MissionsModule's transition service, and
 * MissionsModule already imports MissionPolicyModule for screening — one module doing both would
 * import itself.
 */
@Module({
  imports: [MissionsModule],
  controllers: [MissionModerationController],
  providers: [MissionModerationService],
})
export class MissionModerationModule {}
