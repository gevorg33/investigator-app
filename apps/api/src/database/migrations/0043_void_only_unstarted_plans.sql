-- T-224: a member who leaves a workspace has only their plans there that never started voided. A plan
-- whose worker died part-way still reads CONFIRMED — EXECUTING commits only with the end of a run — and
-- 0042 voided it as if nothing had happened. A plan that did something failed; it says so, and the steps
-- it never reached are skipped. A step left RUNNING stays RUNNING: it may have taken effect.
--
-- Still the one function of its kind that raises platform access (rls.spec.ts bounds its statements).

CREATE OR REPLACE FUNCTION archive_departed_member_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET app.platform_access = 'on' AS $$
BEGIN
  -- Only that person, only in that workspace; a session already archived or deleted is left be.
  UPDATE ai_sessions
     SET archived_at = now(), updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND archived_at IS NULL AND deleted_at IS NULL;
  -- Nothing ran: the plan is void.
  UPDATE ai_plans p
     SET status = 'CANCELLED', confirmation_status = 'VOIDED', reason = 'member_left',
         finished_at = now(), updated_at = now()
   WHERE p.tenant_id = NEW.tenant_id AND p.user_id = NEW.user_id
     AND p.status IN ('PROPOSED', 'CONFIRMED')
     AND NOT EXISTS (SELECT 1 FROM ai_plan_steps s WHERE s.plan_id = p.id AND s.status <> 'PENDING');
  -- Something ran: the plan failed, by way of EXECUTING as check_ai_plan_change requires.
  UPDATE ai_plans p
     SET status = 'EXECUTING', updated_at = now()
   WHERE p.tenant_id = NEW.tenant_id AND p.user_id = NEW.user_id
     AND p.status = 'CONFIRMED'
     AND EXISTS (SELECT 1 FROM ai_plan_steps s WHERE s.plan_id = p.id AND s.status <> 'PENDING');
  UPDATE ai_plans p
     SET status = 'FAILED', reason = 'member_left', finished_at = now(), updated_at = now()
   WHERE p.tenant_id = NEW.tenant_id AND p.user_id = NEW.user_id AND p.status = 'EXECUTING';
  UPDATE ai_plan_steps s
     SET status = 'SKIPPED', finished_at = now()
   WHERE s.status = 'PENDING'
     AND EXISTS (SELECT 1 FROM ai_plans p
                  WHERE p.id = s.plan_id AND p.tenant_id = NEW.tenant_id AND p.user_id = NEW.user_id
                    AND p.status = 'FAILED' AND p.reason = 'member_left');
  RETURN NULL;
END $$;
