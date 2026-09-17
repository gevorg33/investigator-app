-- Reverse of 0009. db-migration requires every migration to have a working down path.
REVOKE ALL ON assignment_status_history FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON assignments FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON quotes FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON idempotency_keys FROM investigator_app;--> statement-breakpoint

-- Children first: assignment_status_history references assignments, which references quotes.
DROP TABLE IF EXISTS "assignment_status_history";--> statement-breakpoint
DROP TABLE IF EXISTS "assignments";--> statement-breakpoint
DROP TABLE IF EXISTS "quotes";--> statement-breakpoint
DROP TABLE IF EXISTS "idempotency_keys";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."assignment_actor_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."assignment_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."quote_status";
