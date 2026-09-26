-- T-155: "the latest move" of a mission is the last one written, not the one with the latest clock.
--
-- `occurred_at` defaults to now(), which is its transaction's start time: the moves one transaction
-- writes (submission writes two) share a time, and a wall-clock step — seen once in the Docker VM
-- under load — can put a later transaction's move before an earlier one's. OwnMissionRepository.
-- reviewsOf() read the latest by time, and once told a customer nothing about a request for changes.
--
-- `seq` is an identity: assigned at insert, strictly increasing, never written by a caller.
-- Existing rows are numbered as the table is scanned. The table is append-only by grant (no UPDATE,
-- no DELETE), so no tuple has moved and scan order is insertion order.
--
-- The (mission_id, occurred_at) index served only reviewsOf(); it is replaced, not kept.

DROP INDEX "mission_status_history_mission_idx";--> statement-breakpoint
ALTER TABLE "mission_status_history" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "mission_status_history_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "mission_status_history_mission_seq_idx" ON "mission_status_history" USING btree ("mission_id","seq");
