-- Reverses 0043_void_only_unstarted_plans: back to 0042's body, which voids every PROPOSED or CONFIRMED
-- plan of a departing member, started or not. Plans already ended by 0043 are left as they ended.
CREATE OR REPLACE FUNCTION archive_departed_member_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET app.platform_access = 'on' AS $$
BEGIN
  -- Only that person, only in that workspace; a session already archived or deleted is left be.
  UPDATE ai_sessions
     SET archived_at = now(), updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND archived_at IS NULL AND deleted_at IS NULL;
  UPDATE ai_plans
     SET status = 'CANCELLED', confirmation_status = 'VOIDED', reason = 'member_left',
         finished_at = now(), updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND status IN ('PROPOSED', 'CONFIRMED');
  RETURN NULL;
END $$;
