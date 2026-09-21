-- Reverses 0015_add_legal_consent.
DROP TABLE IF EXISTS "user_consents";--> statement-breakpoint
DROP FUNCTION IF EXISTS assert_consent_matches_document();--> statement-breakpoint
DROP TABLE IF EXISTS "legal_documents";--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_published_document_change();--> statement-breakpoint
DROP FUNCTION IF EXISTS legal_document_hash();--> statement-breakpoint
DROP TYPE IF EXISTS "public"."consent_context";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."consent_action";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."legal_document_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."legal_document_type";
