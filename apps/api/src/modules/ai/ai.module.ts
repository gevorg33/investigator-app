import { Module } from '@nestjs/common';
import { AiSessionsModule } from '../ai-sessions/ai-sessions.module';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { SearchModule } from '../search/search.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { AssistantTurnController } from './assistant-turn.controller';
import { AssistantTurnService } from './assistant-turn.service';
import { AssistantController } from './assistant.controller';
import { CHAT_MODEL, chatModelFromEnv } from './chat-model';
import { DiscoveryAnswerController } from './discovery/discovery-answer.controller';
import { DiscoveryAnswerService } from './discovery/discovery-answer.service';
import { KnowledgeAnswerService } from './knowledge-answer.service';
import { AiPlansController } from './plans/ai-plans.controller';
import { AiPlansService } from './plans/ai-plans.service';
import { WRITE_TOOLS } from './plans/write-tools';
import { ToolResultStore } from './results/tool-result-store';
import { ASSISTANT_TOOLS, type AssistantTool } from './tools/assistant-tool';
import { ListTaxonomyTool } from './tools/discovery/list-taxonomy.tool';
import { SearchInvestigatorsTool } from './tools/discovery/search-investigators.tool';
import { ToolRunner } from './tools/tool-runner';

/**
 * The assistant (plan §16). T-017: answering from the knowledge base. T-018: finding
 * investigators through registered tools over live data. T-056: conversations — a turn in the
 * caller's session, answered from the knowledge base and streamed as it forms. The chat model is
 * null until `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` are set, and every endpoint that needs it
 * answers 503 until then. T-048: plans — a write is proposed, confirmed by its person, and run by the
 * worker — and the store that keeps large tool results out of a prompt.
 */
@Module({
  // AuthModule for the shared rate limiter. Search and taxonomy are the services the discovery
  // tools call — the same ones the HTTP API calls, never a second implementation.
  imports: [AiSessionsModule, AuthModule, KnowledgeModule, SearchModule, TaxonomyModule],
  controllers: [
    AssistantController,
    AssistantTurnController,
    DiscoveryAnswerController,
    AiPlansController,
  ],
  providers: [
    KnowledgeAnswerService,
    AssistantTurnService,
    DiscoveryAnswerService,
    ListTaxonomyTool,
    SearchInvestigatorsTool,
    ...WRITE_TOOLS,
    {
      provide: ASSISTANT_TOOLS,
      useFactory: (...tools: AssistantTool[]) => tools,
      inject: [ListTaxonomyTool, SearchInvestigatorsTool, ...WRITE_TOOLS],
    },
    ToolRunner,
    AiPlansService,
    ToolResultStore,
    { provide: CHAT_MODEL, useFactory: () => chatModelFromEnv(process.env) },
  ],
})
export class AiModule {}
