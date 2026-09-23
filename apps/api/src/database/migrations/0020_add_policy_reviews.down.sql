-- Reverses 0020_add_policy_reviews.
DROP TABLE IF EXISTS money_decisions;--> statement-breakpoint
DROP TABLE IF EXISTS policy_reviews;--> statement-breakpoint
DROP FUNCTION IF EXISTS check_money_decision();--> statement-breakpoint
DROP FUNCTION IF EXISTS keep_policy_review_record();--> statement-breakpoint
DROP TYPE IF EXISTS money_decision_kind;--> statement-breakpoint
DROP TYPE IF EXISTS policy_review_disposition;--> statement-breakpoint
DROP TYPE IF EXISTS policy_review_finding;--> statement-breakpoint
DROP TYPE IF EXISTS policy_review_kind;
