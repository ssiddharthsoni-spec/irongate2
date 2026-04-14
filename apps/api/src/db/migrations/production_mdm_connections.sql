-- =============================================================================
-- Production migration: mdm_connections table
--
-- Stores OAuth credentials per-firm for direct MDM API integration (Google
-- Workspace, Microsoft Intune, Jamf Pro). Tokens are encrypted at rest using
-- AES-256-GCM with per-firm keys derived from IRON_GATE_ENCRYPTION_SECRET.
--
-- Run this ONCE against production Supabase.
-- Safe to re-run: uses IF NOT EXISTS guards.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "mdm_connection_provider" AS ENUM ('google_workspace', 'microsoft_intune', 'jamf_pro');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "mdm_connections" (
  "id"                         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id"                    uuid NOT NULL,
  "provider"                   "mdm_connection_provider" NOT NULL,
  "encrypted_tokens"           text NOT NULL,
  "encryption_iv"              varchar(64) NOT NULL,
  "encryption_auth_tag"        varchar(64) NOT NULL,
  "authorized_by_email"        varchar(255) NOT NULL,
  "scopes"                     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "access_token_expires_at"    timestamp,
  "provider_account_id"        varchar(255),
  "provider_domain"            varchar(255),
  "last_verified_at"           timestamp,
  "created_at"                 timestamp DEFAULT now() NOT NULL,
  "updated_at"                 timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mdm_connections_firm_provider_uniq" UNIQUE("firm_id", "provider")
);

DO $$ BEGIN
  ALTER TABLE "mdm_connections"
    ADD CONSTRAINT "mdm_connections_firm_id_firms_id_fk"
    FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "mdm_connections_firm_idx" ON "mdm_connections" USING btree ("firm_id");
