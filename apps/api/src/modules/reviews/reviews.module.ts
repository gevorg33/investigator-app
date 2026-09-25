import { Module } from '@nestjs/common';
import { ReviewModerationController } from './review-moderation.controller';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

/** Reviews of completed assignments, and their moderation (plan.md §8, T-037). */
@Module({
  controllers: [ReviewsController, ReviewModerationController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
