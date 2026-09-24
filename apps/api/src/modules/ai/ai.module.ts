import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AssistantController } from './assistant.controller';
import { CHAT_MODEL, chatModelFromEnv } from './chat-model';
import { KnowledgeAnswerService } from './knowledge-answer.service';

/**
 * The assistant (plan §16). T-017: answering from the knowledge base. The chat model is null until
 * `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` are set, and the endpoint answers 503 until then.
 */
@Module({
  // AuthModule for the shared rate limiter.
  imports: [AuthModule, KnowledgeModule],
  controllers: [AssistantController],
  providers: [
    KnowledgeAnswerService,
    { provide: CHAT_MODEL, useFactory: () => chatModelFromEnv(process.env) },
  ],
})
export class AiModule {}
