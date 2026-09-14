CREATE TYPE "public"."media_category" AS ENUM('PROFILE_IMAGE', 'VERIFICATION_DOCUMENT');--> statement-breakpoint
CREATE TYPE "public"."media_scan_status" AS ENUM('PENDING', 'CLEAN', 'INFECTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."media_upload_status" AS ENUM('AUTHORIZED', 'READY', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."media_visibility" AS ENUM('PUBLIC_PROFILE', 'PARTICIPANT_ONLY', 'EVIDENCE_RESTRICTED', 'STAFF_REVIEW_ONLY');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"category" "media_category" NOT NULL,
	"visibility" "media_visibility" NOT NULL,
	"public_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"delivery_type" text DEFAULT 'authenticated' NOT NULL,
	"declared_mime_type" text NOT NULL,
	"declared_bytes" integer NOT NULL,
	"cloudinary_asset_id" text,
	"version" integer,
	"format" text,
	"bytes" integer,
	"width" integer,
	"height" integer,
	"etag" text,
	"upload_status" "media_upload_status" DEFAULT 'AUTHORIZED' NOT NULL,
	"scan_status" "media_scan_status" DEFAULT 'PENDING' NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"retain_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_public_id_unique" ON "media_assets" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "media_assets_category_status_idx" ON "media_assets" USING btree ("category","upload_status");--> statement-breakpoint

-- Integrity the service must not be the only thing enforcing.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_declared_bytes_positive"
  CHECK ("declared_bytes" > 0);--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_bytes_positive"
  CHECK ("bytes" IS NULL OR "bytes" > 0);--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_public_id_present"
  CHECK (length("public_id") > 0);--> statement-breakpoint
-- A READY row describes an asset the server actually read back. Without these it would be
-- a claim with nothing behind it.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_ready_has_asset"
  CHECK ("upload_status" <> 'READY'
    OR ("cloudinary_asset_id" IS NOT NULL AND "version" IS NOT NULL
        AND "format" IS NOT NULL AND "bytes" IS NOT NULL));--> statement-breakpoint
-- A file is never served before a clean scan, so a clean scan on something never uploaded
-- is a contradiction worth refusing.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_clean_only_when_ready"
  CHECK ("scan_status" <> 'CLEAN' OR "upload_status" = 'READY');--> statement-breakpoint

-- Soft delete only. Default privileges from 0000 grant DELETE on every new table, so it has
-- to be revoked explicitly: removing a row without removing the Cloudinary asset, or the
-- reverse, is exactly the drift cloudinary-media forbids. Hard deletion is a privileged,
-- audited retention job.
GRANT SELECT, INSERT, UPDATE ON media_assets TO investigator_app;--> statement-breakpoint
REVOKE DELETE ON media_assets FROM investigator_app;
