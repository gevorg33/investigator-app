import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module';
import { AssignmentTransitionService } from './assignment-transition.service';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { PolicyRefusalService } from './policy-refusal.service';
import { PolicyReviewsController } from './policy-reviews.controller';

@Module({
  // MissionsModule for the mission transition service: creating an assignment moves the
  // mission through PAID to ASSIGNED, and the mission's status has exactly one writer.
  imports: [MissionsModule],
  controllers: [AssignmentsController, PolicyReviewsController],
  providers: [AssignmentsService, AssignmentTransitionService, PolicyRefusalService],
  // Exported for the payments module (Phase 5), which calls createForAuthorizedPayment once a
  // verified webhook establishes that money was authorized. Nothing else may create one.
  exports: [AssignmentsService, AssignmentTransitionService],
})
export class AssignmentsModule {}
