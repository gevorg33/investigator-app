-- T-032: the investigator's notes and work plan inside an assignment (plan.md §8). Approved by the
-- owner 2026-09-26. Both private to their author by default — here, in row-level security, not
-- only in the service: a private note is readable by the person who wrote it and nobody else in
-- any workspace, an agency's owner included. The customer's workspace reads what was shared.
CREATE TYPE "public"."investigation_task_status" AS ENUM('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."investigation_visibility" AS ENUM('PRIVATE', 'SHARED');--> statement-breakpoint
CREATE TABLE "investigation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" "investigation_visibility" DEFAULT 'PRIVATE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"supplier_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "investigation_task_status" DEFAULT 'TODO' NOT NULL,
	"due_on" date,
	"position" integer DEFAULT 0 NOT NULL,
	"visibility" "investigation_visibility" DEFAULT 'PRIVATE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"customer_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"supplier_tenant_id" uuid DEFAULT app_current_tenant() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_parties_fk" FOREIGN KEY ("assignment_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."assignments"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_tasks" ADD CONSTRAINT "investigation_tasks_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_tasks" ADD CONSTRAINT "investigation_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_tasks" ADD CONSTRAINT "investigation_tasks_parties_fk" FOREIGN KEY ("assignment_id","customer_tenant_id","supplier_tenant_id") REFERENCES "public"."assignments"("id","customer_tenant_id","supplier_tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investigation_notes_assignment_idx" ON "investigation_notes" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "investigation_notes_supplier_tenant_idx" ON "investigation_notes" USING btree ("supplier_tenant_id");--> statement-breakpoint
CREATE INDEX "investigation_notes_customer_tenant_idx" ON "investigation_notes" USING btree ("customer_tenant_id");--> statement-breakpoint
CREATE INDEX "investigation_tasks_assignment_idx" ON "investigation_tasks" USING btree ("assignment_id","position","created_at");--> statement-breakpoint
CREATE INDEX "investigation_tasks_supplier_tenant_idx" ON "investigation_tasks" USING btree ("supplier_tenant_id");--> statement-breakpoint
CREATE INDEX "investigation_tasks_customer_tenant_idx" ON "investigation_tasks" USING btree ("customer_tenant_id");--> statement-breakpoint
ALTER TABLE "investigation_notes"
  ADD CONSTRAINT "investigation_notes_body_length" CHECK (length(btrim("body")) BETWEEN 1 AND 20000);--> statement-breakpoint
ALTER TABLE "investigation_tasks"
  ADD CONSTRAINT "investigation_tasks_title_length" CHECK (length(btrim("title")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "investigation_tasks_description_length" CHECK ("description" IS NULL OR length("description") <= 4000),
  ADD CONSTRAINT "investigation_tasks_position_non_negative" CHECK ("position" >= 0);--> statement-breakpoint
-- The two workspaces come from the assignment and never change (T-076), as for every two-party row.
CREATE TRIGGER investigation_notes_fill_from_assignment BEFORE INSERT ON investigation_notes
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('assignments', 'assignment_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER investigation_notes_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON investigation_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER investigation_tasks_fill_from_assignment BEFORE INSERT ON investigation_tasks
  FOR EACH ROW EXECUTE FUNCTION fill_party_from_parent('assignments', 'assignment_id', 'customer_tenant_id:customer_tenant_id', 'supplier_tenant_id:supplier_tenant_id');--> statement-breakpoint
CREATE TRIGGER investigation_tasks_tenant_immutable BEFORE UPDATE OF customer_tenant_id, supplier_tenant_id ON investigation_tasks
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change('customer_tenant_id', 'supplier_tenant_id');--> statement-breakpoint
-- A note stays with its assignment and its author — "private" means private to that person, so
-- the author cannot be swapped for someone else — and a deletion is final.
CREATE FUNCTION keep_investigation_note_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'a note stays with its assignment and its author'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'a deleted note stays deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER investigation_notes_record_kept BEFORE UPDATE ON investigation_notes
  FOR EACH ROW EXECUTE FUNCTION keep_investigation_note_record();--> statement-breakpoint
-- The same for a task, plus its status: only the moves in task-transitions.ts, whoever writes.
-- `task-transitions.spec.ts` walks every pair against this function and the map together.
CREATE FUNCTION keep_investigation_task_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a task stays with its assignment and the person who created it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'a deleted task stays deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status::text, NEW.status::text) NOT IN (
    ('TODO', 'IN_PROGRESS'), ('TODO', 'DONE'), ('TODO', 'CANCELLED'),
    ('IN_PROGRESS', 'TODO'), ('IN_PROGRESS', 'DONE'), ('IN_PROGRESS', 'CANCELLED'),
    ('DONE', 'TODO'),
    ('CANCELLED', 'TODO')
  ) THEN
    RAISE EXCEPTION 'a task cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER investigation_tasks_record_kept BEFORE UPDATE ON investigation_tasks
  FOR EACH ROW EXECUTE FUNCTION keep_investigation_task_record();--> statement-breakpoint
-- The REVOKE does the work: migration 0000's default privileges would otherwise include DELETE.
REVOKE ALL ON investigation_notes FROM investigator_app;--> statement-breakpoint
REVOKE ALL ON investigation_tasks FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON investigation_notes TO investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON investigation_tasks TO investigator_app;--> statement-breakpoint
-- Narrower than investigation_sources' supplier_works: the author, in the supplier workspace — as
-- ai_sessions' own_conversation is the user in their workspace. The customer's workspace reads
-- shared, undeleted rows and writes nothing. PlatformContext (audited) is the one way past, for
-- retention and dispute review.
ALTER TABLE investigation_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigation_notes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY author_works ON investigation_notes FOR ALL
  USING ((supplier_tenant_id = app_current_tenant() AND author_id = app_current_user()) OR app_platform_access())
  WITH CHECK ((supplier_tenant_id = app_current_tenant() AND author_id = app_current_user()) OR app_platform_access());--> statement-breakpoint
CREATE POLICY customer_reads_shared ON investigation_notes FOR SELECT
  USING (customer_tenant_id = app_current_tenant() AND visibility = 'SHARED' AND deleted_at IS NULL);--> statement-breakpoint
ALTER TABLE investigation_tasks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE investigation_tasks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY creator_works ON investigation_tasks FOR ALL
  USING ((supplier_tenant_id = app_current_tenant() AND created_by = app_current_user()) OR app_platform_access())
  WITH CHECK ((supplier_tenant_id = app_current_tenant() AND created_by = app_current_user()) OR app_platform_access());--> statement-breakpoint
CREATE POLICY customer_reads_shared ON investigation_tasks FOR SELECT
  USING (customer_tenant_id = app_current_tenant() AND visibility = 'SHARED' AND deleted_at IS NULL);
