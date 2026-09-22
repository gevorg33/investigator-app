-- Reverses 0017_add_taxonomy_labels. Labels are dropped with their table; the tree is untouched.
DROP POLICY IF EXISTS staff_update ON taxonomy_nodes;--> statement-breakpoint
DROP POLICY IF EXISTS staff_insert ON taxonomy_nodes;--> statement-breakpoint
DROP POLICY IF EXISTS everyone_reads ON taxonomy_nodes;--> statement-breakpoint
ALTER TABLE taxonomy_nodes NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE taxonomy_nodes DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE INSERT, UPDATE ON taxonomy_nodes FROM investigator_app;--> statement-breakpoint
DROP TRIGGER IF EXISTS taxonomy_active_under_active ON taxonomy_nodes;--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_active_nodes_under_active_parents();--> statement-breakpoint
DROP TRIGGER IF EXISTS taxonomy_no_child_of_deprecated ON taxonomy_nodes;--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_child_of_deprecated();--> statement-breakpoint
DROP TRIGGER IF EXISTS taxonomy_identity_fixed ON taxonomy_nodes;--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_taxonomy_identity_change();--> statement-breakpoint
ALTER TABLE taxonomy_nodes DROP CONSTRAINT IF EXISTS taxonomy_nodes_slug_shape;--> statement-breakpoint
DROP TABLE IF EXISTS taxonomy_node_labels;
