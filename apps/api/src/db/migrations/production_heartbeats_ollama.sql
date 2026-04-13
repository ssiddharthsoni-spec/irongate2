-- =============================================================================
-- Production migration: add Ollama status + device platform columns to
-- extension_heartbeats. Enables the deployment wizard's device status table
-- to show which laptops have Ollama installed, running, and model-pulled.
--
-- Run this ONCE against production Supabase.
--
-- Apply via: Supabase SQL Editor (paste + Run) OR psql pipeline.
--
-- Safe to re-run: uses IF NOT EXISTS guards.
-- =============================================================================

ALTER TABLE "extension_heartbeats"
  ADD COLUMN IF NOT EXISTS "device_platform" varchar(100);

ALTER TABLE "extension_heartbeats"
  ADD COLUMN IF NOT EXISTS "ollama_reachable" boolean;

ALTER TABLE "extension_heartbeats"
  ADD COLUMN IF NOT EXISTS "ollama_model" varchar(100);

ALTER TABLE "extension_heartbeats"
  ADD COLUMN IF NOT EXISTS "ollama_model_pulled" boolean;
