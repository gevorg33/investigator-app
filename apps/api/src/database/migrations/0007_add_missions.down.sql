-- Reverse of 0007. db-migration requires every migration to have a working down path.
REVOKE ALL ON outbox_events FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON mission_screenings FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON mission_status_history FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON missions FROM investigator_app;--> statement-breakpoint

DROP TABLE IF EXISTS "outbox_events";--> statement-breakpoint
DROP TABLE IF EXISTS "mission_screenings";--> statement-breakpoint
DROP TABLE IF EXISTS "mission_status_history";--> statement-breakpoint
DROP TABLE IF EXISTS "missions";--> statement-breakpoint

ALTER TABLE "taxonomy_nodes" DROP COLUMN IF EXISTS "risk_band";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."subject_relationship";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mission_actor_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mission_screening_outcome";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mission_status";--> statement-breakpoint
-- Last: the risk_band column above depends on this type.
DROP TYPE IF EXISTS "public"."risk_band";
