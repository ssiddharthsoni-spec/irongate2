-- =============================================================================
-- Production migration: enrollment_codes table
-- Run this ONCE against production Supabase.
--
-- Apply via: Supabase SQL Editor (paste + Run) OR psql pipeline:
--   psql "$SUPABASE_DB_URL" -f production_enrollment_codes.sql
--
-- Safe to re-run: uses IF NOT EXISTS guards.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "enrollment_codes" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id"     uuid NOT NULL,
  "code"        varchar(12) NOT NULL,
  "label"       varchar(100),
  "max_uses"    integer,
  "used_count"  integer DEFAULT 0 NOT NULL,
  "expires_at"  timestamp,
  "revoked"     boolean DEFAULT false NOT NULL,
  "created_by"  uuid NOT NULL,
  "created_at"  timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "enrollment_codes_code_unique" UNIQUE("code")
);

-- Foreign keys (wrapped so re-runs don't error if already applied)
DO $$ BEGIN
  ALTER TABLE "enrollment_codes"
    ADD CONSTRAINT "enrollment_codes_firm_id_firms_id_fk"
    FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "enrollment_codes"
    ADD CONSTRAINT "enrollment_codes_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "enrollment_codes_firm_idx" ON "enrollment_codes" USING btree ("firm_id");
CREATE INDEX IF NOT EXISTS "enrollment_codes_code_idx" ON "enrollment_codes" USING btree ("code");
