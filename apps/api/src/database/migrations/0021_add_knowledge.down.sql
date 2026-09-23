-- Reverses 0021_add_knowledge. Everything here is derived from docs/knowledge-base and rebuilt by a sync.
DROP TABLE IF EXISTS knowledge_conflicts;--> statement-breakpoint
DROP TABLE IF EXISTS knowledge_chunks;--> statement-breakpoint
DROP TABLE IF EXISTS knowledge_documents;--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_knowledge_chunk();--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_knowledge_document_lifecycle();--> statement-breakpoint
DROP TYPE IF EXISTS knowledge_conflict_status;--> statement-breakpoint
DROP TYPE IF EXISTS knowledge_document_status;--> statement-breakpoint
DROP TYPE IF EXISTS knowledge_visibility;--> statement-breakpoint
DROP TYPE IF EXISTS knowledge_audience;
