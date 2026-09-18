-- Reverse of 0010. db-migration requires every migration to have a working down path.
REVOKE ALL ON verification_decisions FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON verification_request_documents FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON verification_requests FROM investigator_app;--> statement-breakpoint

-- Children first: decisions and documents reference requests.
DROP TABLE IF EXISTS "verification_decisions";--> statement-breakpoint
DROP TABLE IF EXISTS "verification_request_documents";--> statement-breakpoint
DROP TABLE IF EXISTS "verification_requests";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."verification_outcome";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."verification_request_status";
