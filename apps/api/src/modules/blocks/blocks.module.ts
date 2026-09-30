import { Module } from '@nestjs/common';
import { BlockReviewController, BlocksController } from './blocks.controller';
import { BlocksService } from './blocks.service';

/** Blocking another user, and what staff see of it (T-052). */
@Module({
  controllers: [BlocksController, BlockReviewController],
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
