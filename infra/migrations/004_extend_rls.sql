-- =============================================================================
-- Iron Gate — Migration 004: Extend Row-Level Security to ALL firm-scoped tables
-- =============================================================================
-- Migration 001 enabled RLS on 10 customer-data tables. This migration extends
-- RLS to the remaining tables that have a firm_id column, closing the gap
-- where cross-firm data leakage could occur via direct DB queries.
--
-- Tables covered:
--   users, api_keys, departments, department_policies, subscriptions,
--   invoices, alerts, audit_log, invites, extension_heartbeats,
--   feature_flags, kill_switch (with special handling for global scope)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. users
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_users ON users
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 2. api_keys
-- ---------------------------------------------------------------------------
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_api_keys ON api_keys
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 3. departments
-- ---------------------------------------------------------------------------
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_departments ON departments
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 4. department_policies
-- ---------------------------------------------------------------------------
ALTER TABLE department_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_department_policies ON department_policies
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 5. subscriptions
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_subscriptions ON subscriptions
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 6. invoices
-- ---------------------------------------------------------------------------
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_invoices ON invoices
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 7. alerts
-- ---------------------------------------------------------------------------
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_alerts ON alerts
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 8. audit_log
-- ---------------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_audit_log ON audit_log
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 9. invites
-- ---------------------------------------------------------------------------
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_invites ON invites
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 10. extension_heartbeats
-- ---------------------------------------------------------------------------
ALTER TABLE extension_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_heartbeats FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_extension_heartbeats ON extension_heartbeats
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 11. feature_flags
-- ---------------------------------------------------------------------------
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_feature_flags ON feature_flags
  USING (firm_id = app.current_firm_id())
  WITH CHECK (firm_id = app.current_firm_id());

-- ---------------------------------------------------------------------------
-- 12. kill_switch (special: global records have NULL firm_id)
--     Global records (scope='global', firm_id IS NULL) are visible to all.
--     Firm-scoped records are isolated to the owning firm.
-- ---------------------------------------------------------------------------
ALTER TABLE kill_switch ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_switch FORCE ROW LEVEL SECURITY;

CREATE POLICY firm_isolation_kill_switch ON kill_switch
  USING (firm_id IS NULL OR firm_id = app.current_firm_id())
  WITH CHECK (firm_id IS NULL OR firm_id = app.current_firm_id());

COMMIT;
