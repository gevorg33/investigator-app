CREATE TYPE "public"."staff_scope" AS ENUM('VERIFICATION', 'MODERATION', 'DISPUTES', 'PAYMENTS', 'TAXONOMY', 'ENFORCEMENT');--> statement-breakpoint
CREATE TABLE "user_staff_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" "staff_scope" NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "user_staff_scopes" ADD CONSTRAINT "user_staff_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_staff_scopes" ADD CONSTRAINT "user_staff_scopes_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_staff_scopes" ADD CONSTRAINT "user_staff_scopes_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_staff_scopes_user_scope_unique" ON "user_staff_scopes" USING btree ("user_id","scope");--> statement-breakpoint
CREATE INDEX "user_staff_scopes_user_idx" ON "user_staff_scopes" USING btree ("user_id");--> statement-breakpoint

-- Stated explicitly, as with the other tables, so the privileges are readable in one
-- place rather than inherited from the default privileges set in 0000.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_staff_scopes TO investigator_app;
