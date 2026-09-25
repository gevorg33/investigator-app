import { Module } from '@nestjs/common';
import { EMBEDDER, embedderFromEnv } from './embedder';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeDocumentsService } from './knowledge-documents.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeSyncService } from './knowledge-sync.service';

/**
 * The knowledge base: ingested by the `knowledge:sync` command (T-016), retrieved with the
 * caller's permissions (T-017), and opened article by article through the same gate (T-059). The embedder is null without an OpenAI key, and retrieval then
 * runs on text alone.
 */
@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeSyncService,
    KnowledgeDocumentsService,
    KnowledgeRetrievalService,
    { provide: EMBEDDER, useFactory: () => embedderFromEnv(process.env) },
  ],
  exports: [KnowledgeSyncService, KnowledgeRetrievalService],
})
export class KnowledgeModule {}
