/**
 * Auto-migration script that runs on startup to ensure the production
 * database has all required columns and tables. Uses IF NOT EXISTS / IF NOT
 * to be idempotent — safe to run on every deploy.
 */
import { db } from './client';
import { sql } from 'drizzle-orm';

const migrations: string[] = [
  // --- firms table additions ---
  `ALTER TABLE firms ADD COLUMN IF NOT EXISTS encryption_salt VARCHAR(64)`,
  `ALTER TABLE firms ADD COLUMN IF NOT EXISTS enrollment_code VARCHAR(50) UNIQUE`,

  // --- api_keys table ---
  `CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    name VARCHAR(255) NOT NULL DEFAULT 'Default',
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL DEFAULT '',
    scope VARCHAR(20) NOT NULL DEFAULT 'write',
    created_by UUID NOT NULL REFERENCES users(id),
    revoked_at TIMESTAMP,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // --- subscriptions table (ensure it exists) ---
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    stripe_customer_id VARCHAR(255) NOT NULL,
    stripe_subscription_id VARCHAR(255),
    tier VARCHAR(50) NOT NULL DEFAULT 'free',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    cancel_at_period_end BOOLEAN DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // --- departments table ---
  `CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(firm_id, name)
  )`,

  // --- department_policies table ---
  `CREATE TABLE IF NOT EXISTS department_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES departments(id),
    firm_id UUID NOT NULL REFERENCES firms(id),
    policy_type VARCHAR(50) NOT NULL,
    policy_value JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(department_id, policy_type)
  )`,

  // --- users.department_id column ---
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id)`,

  // --- feature_flags table ---
  `CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    key VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(firm_id, key)
  )`,

  // --- email_verification_tokens table ---
  `CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    firm_id UUID NOT NULL REFERENCES firms(id),
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // --- data_deletion_requests table ---
  `CREATE TABLE IF NOT EXISTS data_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    requested_by UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reason TEXT,
    scheduled_at TIMESTAMP NOT NULL,
    executed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // --- tos_acceptance table ---
  `CREATE TABLE IF NOT EXISTS tos_acceptance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    accepted_by UUID NOT NULL REFERENCES users(id),
    tos_version VARCHAR(20) NOT NULL,
    accepted_at TIMESTAMP NOT NULL DEFAULT now(),
    ip_address VARCHAR(45),
    user_agent TEXT
  )`,

  // --- dpa_acceptance table ---
  `CREATE TABLE IF NOT EXISTS dpa_acceptance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    accepted_by UUID NOT NULL REFERENCES users(id),
    signer_name VARCHAR(255) NOT NULL,
    signer_title VARCHAR(255),
    signer_email VARCHAR(255) NOT NULL,
    dpa_version VARCHAR(20) NOT NULL,
    accepted_at TIMESTAMP NOT NULL DEFAULT now(),
    ip_address VARCHAR(45)
  )`,

  // --- webhook_delivery_log table ---
  `CREATE TABLE IF NOT EXISTS webhook_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
    firm_id UUID NOT NULL REFERENCES firms(id),
    event_type VARCHAR(100) NOT NULL,
    payload JSONB DEFAULT '{}',
    status_code INTEGER,
    response_body TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    success BOOLEAN NOT NULL DEFAULT false,
    error TEXT,
    delivered_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // --- users.email_verified column ---
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`,

  // --- firms.config additions for SSO and ToS ---
  // (config is already JSONB — no schema change needed, just application logic)

  // --- RLS for new tables ---
  `ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE data_deletion_requests ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE tos_acceptance ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE dpa_acceptance ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE webhook_delivery_log ENABLE ROW LEVEL SECURITY`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'email_verify_isolation' AND tablename = 'email_verification_tokens') THEN
      EXECUTE 'CREATE POLICY email_verify_isolation ON email_verification_tokens FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'data_deletion_isolation' AND tablename = 'data_deletion_requests') THEN
      EXECUTE 'CREATE POLICY data_deletion_isolation ON data_deletion_requests FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tos_acceptance_isolation' AND tablename = 'tos_acceptance') THEN
      EXECUTE 'CREATE POLICY tos_acceptance_isolation ON tos_acceptance FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dpa_acceptance_isolation' AND tablename = 'dpa_acceptance') THEN
      EXECUTE 'CREATE POLICY dpa_acceptance_isolation ON dpa_acceptance FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webhook_delivery_isolation' AND tablename = 'webhook_delivery_log') THEN
      EXECUTE 'CREATE POLICY webhook_delivery_isolation ON webhook_delivery_log FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: Ensure app.current_firm_id() helper exists ---
  `CREATE SCHEMA IF NOT EXISTS app`,
  `CREATE OR REPLACE FUNCTION app.current_firm_id()
    RETURNS uuid LANGUAGE plpgsql STABLE AS $$
    BEGIN
      IF current_setting('app.current_firm_id', true) IS NULL
         OR current_setting('app.current_firm_id', true) = '' THEN
        RAISE EXCEPTION 'app.current_firm_id is not set';
      END IF;
      RETURN current_setting('app.current_firm_id')::uuid;
    END; $$`,

  // --- RLS: Enable on tables not covered by migration 001 ---
  `ALTER TABLE users ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE departments ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE department_policies ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE invoices ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE alerts ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE invites ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE extension_heartbeats ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE kill_switch ENABLE ROW LEVEL SECURITY`,

  // --- RLS: Enable on firms and audit tables ---
  `ALTER TABLE firms ENABLE ROW LEVEL SECURITY`,

  // --- RLS: policies for firms (service role = full access, app role = own firm only) ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'firms_isolation' AND tablename = 'firms') THEN
      EXECUTE 'CREATE POLICY firms_isolation ON firms FOR ALL USING (id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for users ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'users_isolation' AND tablename = 'users') THEN
      EXECUTE 'CREATE POLICY users_isolation ON users FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for events ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'events_isolation' AND tablename = 'events') THEN
      EXECUTE 'CREATE POLICY events_isolation ON events FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for api_keys ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'api_keys_isolation' AND tablename = 'api_keys') THEN
      EXECUTE 'CREATE POLICY api_keys_isolation ON api_keys FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for alerts ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'alerts_isolation' AND tablename = 'alerts') THEN
      EXECUTE 'CREATE POLICY alerts_isolation ON alerts FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for audit_log (admin audit trail) ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'audit_log_isolation' AND tablename = 'audit_log') THEN
      EXECUTE 'CREATE POLICY audit_log_isolation ON audit_log FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for departments ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'departments_isolation' AND tablename = 'departments') THEN
      EXECUTE 'CREATE POLICY departments_isolation ON departments FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for department_policies ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dept_policies_isolation' AND tablename = 'department_policies') THEN
      EXECUTE 'CREATE POLICY dept_policies_isolation ON department_policies FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for feature_flags ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'feature_flags_isolation' AND tablename = 'feature_flags') THEN
      EXECUTE 'CREATE POLICY feature_flags_isolation ON feature_flags FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for subscriptions ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'subscriptions_isolation' AND tablename = 'subscriptions') THEN
      EXECUTE 'CREATE POLICY subscriptions_isolation ON subscriptions FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for invites ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'invites_isolation' AND tablename = 'invites') THEN
      EXECUTE 'CREATE POLICY invites_isolation ON invites FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for extension_heartbeats ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'heartbeats_isolation' AND tablename = 'extension_heartbeats') THEN
      EXECUTE 'CREATE POLICY heartbeats_isolation ON extension_heartbeats FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS: policies for kill_switch ---
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kill_switch_isolation' AND tablename = 'kill_switch') THEN
      EXECUTE 'CREATE POLICY kill_switch_isolation ON kill_switch FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- events.encryption_key_version column (for key rotation re-encryption) ---
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS encryption_key_version INTEGER DEFAULT 1`,

  // --- breach_log table (SOC 2 / HIPAA breach tracking) ---
  `CREATE TABLE IF NOT EXISTS breach_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    trigger_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'high',
    description TEXT NOT NULL,
    affected_records INTEGER,
    notified_at TIMESTAMP,
    notified_emails JSONB DEFAULT '[]',
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // --- RLS for breach_log ---
  `ALTER TABLE breach_log ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'breach_log_isolation' AND tablename = 'breach_log') THEN
      EXECUTE 'CREATE POLICY breach_log_isolation ON breach_log FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS for missing tables: pseudonym_maps, feedback, client_matters, weight_overrides ---
  `ALTER TABLE pseudonym_maps ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pseudonym_maps_isolation' AND tablename = 'pseudonym_maps') THEN
      EXECUTE 'CREATE POLICY pseudonym_maps_isolation ON pseudonym_maps FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `ALTER TABLE feedback ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'feedback_isolation' AND tablename = 'feedback') THEN
      EXECUTE 'CREATE POLICY feedback_isolation ON feedback FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `ALTER TABLE client_matters ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'client_matters_isolation' AND tablename = 'client_matters') THEN
      EXECUTE 'CREATE POLICY client_matters_isolation ON client_matters FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `ALTER TABLE weight_overrides ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'weight_overrides_isolation' AND tablename = 'weight_overrides') THEN
      EXECUTE 'CREATE POLICY weight_overrides_isolation ON weight_overrides FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS for MOAT tables: entity_co_occurrences, inferred_entities, sensitivity_patterns, firm_plugins ---
  `ALTER TABLE entity_co_occurrences ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'entity_co_occ_isolation' AND tablename = 'entity_co_occurrences') THEN
      EXECUTE 'CREATE POLICY entity_co_occ_isolation ON entity_co_occurrences FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `ALTER TABLE inferred_entities ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'inferred_entities_isolation' AND tablename = 'inferred_entities') THEN
      EXECUTE 'CREATE POLICY inferred_entities_isolation ON inferred_entities FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `ALTER TABLE sensitivity_patterns ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sensitivity_patterns_isolation' AND tablename = 'sensitivity_patterns') THEN
      EXECUTE 'CREATE POLICY sensitivity_patterns_isolation ON sensitivity_patterns FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  `ALTER TABLE firm_plugins ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'firm_plugins_isolation' AND tablename = 'firm_plugins') THEN
      EXECUTE 'CREATE POLICY firm_plugins_isolation ON firm_plugins FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- RLS for webhook_subscriptions ---
  `ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webhook_subs_isolation' AND tablename = 'webhook_subscriptions') THEN
      EXECUTE 'CREATE POLICY webhook_subs_isolation ON webhook_subscriptions FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- entity_dictionaries table (Tier 3 detection) ---
  `CREATE TABLE IF NOT EXISTS entity_dictionaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    category VARCHAR(50) NOT NULL,
    name VARCHAR(500) NOT NULL,
    aliases JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(firm_id, category, name)
  )`,

  // --- RLS for entity_dictionaries ---
  `ALTER TABLE entity_dictionaries ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'entity_dict_isolation' AND tablename = 'entity_dictionaries') THEN
      EXECUTE 'CREATE POLICY entity_dict_isolation ON entity_dictionaries FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,

  // --- incidents table ---
  `CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id UUID NOT NULL REFERENCES firms(id),
    title TEXT NOT NULL,
    description TEXT,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    reported_by UUID REFERENCES users(id),
    assigned_to UUID REFERENCES users(id),
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP,
    root_cause TEXT,
    remediation TEXT,
    affected_users INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`,

  // --- RLS for incidents ---
  `ALTER TABLE incidents ENABLE ROW LEVEL SECURITY`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'incidents_isolation' AND tablename = 'incidents') THEN
      EXECUTE 'CREATE POLICY incidents_isolation ON incidents FOR ALL USING (firm_id = app.current_firm_id())';
    END IF;
  END $$`,
];

/** Arbitrary but consistent advisory lock ID for migration coordination */
const MIGRATION_LOCK_ID = 741852963;

export async function runAutoMigrations(): Promise<void> {
  // Acquire a PostgreSQL advisory lock to prevent concurrent migration runs
  // across multiple API replicas. Non-blocking — if another instance holds
  // the lock, this one skips (migrations are idempotent).
  let acquired = false;
  try {
    const lockResult = await db.execute(
      sql.raw(`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_ID}) AS acquired`),
    );
    acquired = (lockResult as unknown as Array<{ acquired: boolean }>)[0]?.acquired === true;
  } catch {
    // If we can't even query the lock, fall through and try migrations anyway
    acquired = true;
  }

  if (!acquired) {
    console.log('[auto-migrate] Another instance is running migrations — skipping');
    return;
  }

  try {
    for (const migration of migrations) {
      try {
        await db.execute(sql.raw(migration));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already exists')) {
          console.warn(`[auto-migrate] Warning: ${msg}`);
        }
      }
    }
    console.log('[auto-migrate] Schema check complete');
  } finally {
    // Release the advisory lock
    try {
      await db.execute(sql.raw(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`));
    } catch {
      // Lock will auto-release when session ends
    }
  }
}
