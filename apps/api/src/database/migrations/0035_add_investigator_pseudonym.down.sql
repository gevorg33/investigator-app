-- Reverses 0035 (T-181). Drops the chosen names; customers then see the fallback name again, never
-- the legal one — the code that reads the column must be rolled back first.
ALTER TABLE "investigator_profiles" DROP CONSTRAINT IF EXISTS "investigator_profiles_pseudonym_length";--> statement-breakpoint
DROP INDEX IF EXISTS "investigator_profiles_pseudonym_unique";--> statement-breakpoint
ALTER TABLE "investigator_profiles" DROP COLUMN IF EXISTS "pseudonym";
