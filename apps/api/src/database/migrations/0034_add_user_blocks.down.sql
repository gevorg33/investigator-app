-- Reverses 0034_add_user_blocks.
DROP POLICY IF EXISTS not_blocked ON quotes;--> statement-breakpoint
DROP POLICY IF EXISTS quoted_read ON missions;--> statement-breakpoint
CREATE POLICY quoted_read ON missions FOR SELECT
  USING (app_current_tenant() IS NOT NULL AND status = 'QUOTED');--> statement-breakpoint
DROP FUNCTION IF EXISTS app_blocked_users();--> statement-breakpoint
DROP TABLE IF EXISTS "user_blocks";
