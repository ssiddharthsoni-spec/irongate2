-- =============================================================================
-- Iron Gate — Migration 001: Enable Row-Level Security (RLS)
-- =============================================================================
-- Enforces firm-level data isolation at the PostgreSQL layer.
--
-- How it works:
--   1. The API sets a session variable before every query:
--        SET LOCAL app.current_firm_id = '<uuid>';
--   2. RLS policies on every customer-data table restrict SELECT, INSERT,
--      UPDATE, and DELETE to rows matching that firm_id.
--   3. Even if application code has a bug, one firm can never read another
--      firm's data — the database enforces the boundary.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: session variable accessor
-- ---------------------------------------------------------------------------

-- current_setting() returns '' when the variable is unset.  This wrapper
-- raises an explicit error so a missing firm context is caught immediately.
CREATE OR REPLACE FUNCTION app.current_firm_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF current_setting('app.current_firm_id', true) IS NULL
     OR current_setting('app.current_firm_id', true) = '' THEN
    RAISE EXCEPTION 'app.current_firm_id is not set — cannot execute query without firm context';
  END IF;
  RETURN current_setting('app.current_firm_id')::uuid;
END;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS and create policies for each customer-data table
-- ---------------------------------------------------------------------------

-- 1. events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_events ON events
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 2. pseudonym_maps
ALTER TABLE pseudonym_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE pseudonym_maps FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_pseudonym_maps ON pseudonym_maps
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 3. feedback (entity feedback)
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_feedback ON feedback
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 4. weight_overrides
ALTER TABLE weight_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_weight_overrides ON weight_overrides
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 5. entity_co_occurrences
ALTER TABLE entity_co_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_co_occurrences FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_entity_co_occurrences ON entity_co_occurrences
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 6. inferred_entities
ALTER TABLE inferred_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE inferred_entities FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_inferred_entities ON inferred_entities
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 7. sensitivity_patterns
ALTER TABLE sensitivity_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitivity_patterns FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_sensitivity_patterns ON sensitivity_patterns
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 8. webhook_subscriptions
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_webhook_subscriptions ON webhook_subscriptions
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 9. client_matters
ALTER TABLE client_matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_matters FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_client_matters ON client_matters
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- 10. firm_plugins
ALTER TABLE firm_plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_plugins FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_firm_plugins ON firm_plugins
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- Grant note: The application role should NOT be a superuser (superusers
-- bypass RLS).  Ensure the `irongate_app` role is used for connections.
-- ---------------------------------------------------------------------------

COMMIT;
