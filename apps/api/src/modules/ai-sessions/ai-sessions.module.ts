import { Module } from '@nestjs/common';
import { AiSessionsController } from './ai-sessions.controller';
import { AiSessionsService } from './ai-sessions.service';

/**
 * Conversations with the assistant, persisted (ADR-0006, T-045). Exported: the assistant (T-056)
 * appends to them, and the Context Builder (T-046) reads them.
 */
@Module({
  controllers: [AiSessionsController],
  providers: [AiSessionsService],
  exports: [AiSessionsService],
})
export class AiSessionsModule {}
