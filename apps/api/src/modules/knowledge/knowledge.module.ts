import { Module } from '@nestjs/common';
import { KnowledgeSyncService } from './knowledge-sync.service';

/**
 * The knowledge base, ingested for retrieval (T-016). Retrieval itself is T-017, which will import
 * this module; the sync runs as a command, `knowledge:sync`.
 */
@Module({
  providers: [KnowledgeSyncService],
  exports: [KnowledgeSyncService],
})
export class KnowledgeModule {}
