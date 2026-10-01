-- Reverses 0036 (T-182). Every investigator goes back to the pseudonym-only rule of T-181: customers
-- see a pseudonym or the stand-in code, never a legal name. Roll back the reading code first.
ALTER TABLE "investigator_profiles" DROP COLUMN IF EXISTS "public_name";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."public_name_choice";
