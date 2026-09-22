-- T-053: per-locale labels for taxonomy nodes, and a staff write path for the tree.
--
-- The taxonomy is platform data: every workspace reads it and none owns it (T-076). Until now
-- the runtime role could only SELECT it, so the tree could only change by migration. Staff with
-- the TAXONOMY scope now maintain it (ADR-0007 rule 3), which means the runtime role needs
-- INSERT and UPDATE — and so these tables get row-level security for the first time: anyone
-- may read, and only a connection inside PlatformContext may write. DELETE is never granted.
-- Approved by the owner, 2026-09-23.

CREATE TABLE "taxonomy_node_labels" (
	"node_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomy_node_labels_node_id_locale_pk" PRIMARY KEY("node_id","locale")
);
--> statement-breakpoint
ALTER TABLE "taxonomy_node_labels" ADD CONSTRAINT "taxonomy_node_labels_node_id_taxonomy_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "taxonomy_node_labels"
  ADD CONSTRAINT "taxonomy_node_labels_locale_known" CHECK ("locale" IN ('en', 'ru', 'hy')),
  ADD CONSTRAINT "taxonomy_node_labels_label_length" CHECK (length(btrim("label")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "taxonomy_node_labels_description_length"
    CHECK ("description" IS NULL OR length("description") <= 500);--> statement-breakpoint

-- Slugs are permanent names (ADR-0007 rule 1), so they are held to one shape from the start:
-- lowercase words joined by single hyphens. Every existing slug already has it.
ALTER TABLE "taxonomy_nodes"
  ADD CONSTRAINT "taxonomy_nodes_slug_shape" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint

-- A node's identity never changes. The slug is what it is called in every locale's absence;
-- the parent is what matching walks, and moving a node would change which investigators every
-- historical mission under it reached, with nothing on the mission to say so.
CREATE FUNCTION forbid_taxonomy_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'a taxonomy node keeps its slug and parent for good (ADR-0007)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER taxonomy_identity_fixed BEFORE UPDATE ON taxonomy_nodes
  FOR EACH ROW EXECUTE FUNCTION forbid_taxonomy_identity_change();--> statement-breakpoint

-- Nothing new grows under a retired branch. Existing children stay as they are.
CREATE FUNCTION forbid_child_of_deprecated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM taxonomy_nodes WHERE id = NEW.parent_id AND status = 'DEPRECATED') THEN
    RAISE EXCEPTION 'a deprecated taxonomy node takes no new children'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER taxonomy_no_child_of_deprecated BEFORE INSERT ON taxonomy_nodes
  FOR EACH ROW EXECUTE FUNCTION forbid_child_of_deprecated();--> statement-breakpoint

-- And nothing retired keeps live children, or comes back under a retired parent: every ACTIVE
-- node sits under an ACTIVE parent, so a picker never shows a choice whose parent it hides.
-- Staff retire a branch leaf-first. Existing references to a retired node are untouched.
CREATE FUNCTION keep_active_nodes_under_active_parents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DEPRECATED' AND OLD.status = 'ACTIVE'
     AND EXISTS (SELECT 1 FROM taxonomy_nodes WHERE parent_id = NEW.id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'retire this node''s active children first'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ACTIVE' AND OLD.status = 'DEPRECATED' AND NEW.parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM taxonomy_nodes WHERE id = NEW.parent_id AND status = 'DEPRECATED') THEN
    RAISE EXCEPTION 'a node cannot return under a deprecated parent'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER taxonomy_active_under_active BEFORE UPDATE OF status ON taxonomy_nodes
  FOR EACH ROW EXECUTE FUNCTION keep_active_nodes_under_active_parents();--> statement-breakpoint

-- The REVOKE does the work: migration 0000's default privileges hand every new table full DML
-- to the runtime role, DELETE included. A GRANT on its own would have left DELETE in place.
REVOKE ALL ON taxonomy_node_labels FROM investigator_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON taxonomy_node_labels TO investigator_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON taxonomy_nodes TO investigator_app;--> statement-breakpoint

ALTER TABLE taxonomy_nodes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE taxonomy_nodes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY everyone_reads ON taxonomy_nodes FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY staff_insert ON taxonomy_nodes FOR INSERT WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY staff_update ON taxonomy_nodes FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());--> statement-breakpoint

ALTER TABLE taxonomy_node_labels ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE taxonomy_node_labels FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY everyone_reads ON taxonomy_node_labels FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY staff_insert ON taxonomy_node_labels FOR INSERT WITH CHECK (app_platform_access());--> statement-breakpoint
CREATE POLICY staff_update ON taxonomy_node_labels FOR UPDATE
  USING (app_platform_access()) WITH CHECK (app_platform_access());
