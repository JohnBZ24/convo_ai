-- HAND-EDITED after generation. drizzle-kit emitted
--   ALTER TABLE "account" ADD COLUMN "issuer" text NOT NULL;
-- which cannot run against a populated table: the existing rows have no value
-- for it. The `convo` database was created under Better Auth 1.6, before an
-- account identity was scoped by its issuer, and it still holds six credential
-- accounts - so the column is added nullable, backfilled, and only then made
-- NOT NULL. On an empty database the UPDATE simply matches nothing.
--
-- 'local:' || provider_id reproduces createLocalAccountIssuer() exactly. Every
-- surviving row is provider_id='credential', giving 'local:credential', which
-- is what Better Auth 1.7 writes for email+password accounts.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account" SET "issuer" = 'local:' || "provider_id" WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_uq" ON "account" USING btree ("issuer","account_id");
