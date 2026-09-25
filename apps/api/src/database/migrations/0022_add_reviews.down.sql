-- Reverses 0022_add_reviews. Dropping the tables drops their triggers and policies with them.
DROP TABLE IF EXISTS review_texts;--> statement-breakpoint
DROP TABLE IF EXISTS reviews;--> statement-breakpoint
DROP FUNCTION IF EXISTS check_review_text();--> statement-breakpoint
DROP FUNCTION IF EXISTS check_review();--> statement-breakpoint
DROP TYPE IF EXISTS review_text_status;--> statement-breakpoint
DROP TYPE IF EXISTS review_text_kind;
