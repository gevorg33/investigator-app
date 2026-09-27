-- T-156: what is in force for a person and a legal document is their last consent written, not
-- the one with the latest clock.
--
-- `occurred_at` defaults to now(), its transaction's start time: two consents close together can
-- tie, and a wall-clock step (seen in the Docker VM under load, T-155) can date a later write
-- before an earlier one. LegalService.consentState() read the latest by time, so a withdrawal
-- and a re-acceptance could be read in the wrong order — and the consent gate say the wrong thing.
--
-- `seq` is an identity: assigned at insert, strictly increasing, never written by a caller.
-- Existing rows are numbered as the table is scanned. The table is append-only by grant (no UPDATE,
-- no DELETE for the application) and consents are never erased, so no tuple has moved and scan order
-- is insertion order. Adding the column rewrites the table under a lock; it is small before launch.
--
-- The (user_id, document_type, occurred_at DESC) index served only consentState(); it is replaced.

DROP INDEX "user_consents_user_document_idx";--> statement-breakpoint
ALTER TABLE "user_consents" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "user_consents_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "user_consents_user_document_seq_idx" ON "user_consents" USING btree ("user_id","document_type","seq" DESC NULLS LAST);