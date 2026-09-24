import { Module } from '@nestjs/common';
import { EMBEDDER, embedderFromEnv } from './embedder';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeSyncService } from './knowledge-sync.service';

/**
 * The knowledge base: ingested by the `knowledge:sync` command (T-016), retrieved with the
 * caller's permissions (T-017). The embedder is null without an OpenAI key, and retrieval then
 * runs on text alone.
 */
@Module({
  providers: [
    KnowledgeSyncService,
    KnowledgeRetrievalService,
    { provide: EMBEDDER, useFactory: () => embedderFromEnv(process.env) },
  ],
  exports: [KnowledgeSyncService, KnowledgeRetrievalService],
})
export class KnowledgeModule {}
