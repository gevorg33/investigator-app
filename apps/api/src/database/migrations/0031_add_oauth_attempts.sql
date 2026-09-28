-- T-062: a sign-in with Google, from the redirect to the provider until the callback is believed —
-- and, for an identity with no account yet, until the sign-up completes with the documents accepted.
--
-- Identity class (tenancy.md §7): read before any session or workspace exists, like user_tokens.
-- Only hashes of state, nonce and the sign-up token are stored; the PKCE verifier stays in the
-- browser's httpOnly cookie. The provider email is personal data, kept only while the sign-up is
-- open: rows are deleted a day after they lapse (docs/compliance/retention.md).

CREATE TYPE "public"."oauth_intent" AS ENUM('SIGN_IN', 'LINK');--> statement-breakpoint
CREATE TABLE "oauth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"intent" "oauth_intent" NOT NULL,
	"state_hash" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"user_id" uuid,
	"return_to" text DEFAULT '/' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"signup_token_hash" text,
	"provider_account_id" text,
	"provider_email" text,
	"signup_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "oauth_attempts_link_has_user" CHECK (("oauth_attempts"."intent" = 'LINK') = ("oauth_attempts"."user_id" IS NOT NULL)),
	CONSTRAINT "oauth_attempts_signup_complete" CHECK (("oauth_attempts"."signup_token_hash" IS NULL) = ("oauth_attempts"."provider_account_id" IS NULL)
          AND ("oauth_attempts"."signup_token_hash" IS NULL) = ("oauth_attempts"."signup_expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "oauth_attempts" ADD CONSTRAINT "oauth_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_attempts_state_unique" ON "oauth_attempts" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_attempts_signup_unique" ON "oauth_attempts" USING btree ("signup_token_hash") WHERE signup_token_hash IS NOT NULL;--> statement-breakpoint
CREATE INDEX "oauth_attempts_expires_idx" ON "oauth_attempts" USING btree ("expires_at");
--> statement-breakpoint

-- Stated explicitly, as for user_tokens (0001): the privileges are readable in one place.
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_attempts TO investigator_app;
