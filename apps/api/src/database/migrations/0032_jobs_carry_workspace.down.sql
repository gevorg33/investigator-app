-- Reverses 0032_jobs_carry_workspace.
DROP POLICY IF EXISTS producer_insert ON outbox_events;--> statement-breakpoint
DROP POLICY IF EXISTS dispatcher_read ON outbox_events;--> statement-breakpoint
DROP POLICY IF EXISTS dispatcher_mark ON outbox_events;--> statement-breakpoint
ALTER TABLE outbox_events NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outbox_events DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outbox_events DROP COLUMN IF EXISTS membership_id;--> statement-breakpoint
ALTER TABLE outbox_events DROP COLUMN IF EXISTS user_id;--> statement-breakpoint
ALTER TABLE outbox_events DROP COLUMN IF EXISTS tenant_id;--> statement-breakpoint
DROP TABLE IF EXISTS job_dead_letters;--> statement-breakpoint
DROP TABLE IF EXISTS job_runs;
