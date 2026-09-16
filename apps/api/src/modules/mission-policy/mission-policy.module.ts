import { Module } from '@nestjs/common';
import { MissionPolicyService } from './mission-policy.service';

/**
 * Deterministic lawful-use screening. Separate from missions because the moderation queue and
 * its decision service (T-051) belong here too, and because what screening may do — flag, and
 * only flag — is easier to keep true when it is not mixed into the module that owns missions.
 */
@Module({
  providers: [MissionPolicyService],
  exports: [MissionPolicyService],
})
export class MissionPolicyModule {}
