-- Reverses 0041_add_legal_holds. Dropping the table drops its triggers and policy with it.
-- Destructive once a hold exists: run it only where none has been placed (db-migration).
DROP TABLE IF EXISTS legal_holds;--> statement-breakpoint
DROP FUNCTION IF EXISTS check_legal_hold();--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_legal_hold_delete();--> statement-breakpoint
DROP TYPE IF EXISTS legal_hold_resource;
