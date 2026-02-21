-- =============================================================================
-- Iron Gate — Migration 003: Security Schema Extensions
-- =============================================================================
-- Adds encryption metadata, admin audit logging, kill-switch, and token
-- revocation tables to support the full security architecture.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend `firms` — encryption & retention settings
-- ---------------------------------------------------------------------------

ALTER TABLE firms
  ADD COLUMN IF NOT EXISTS kms_key_arn          VARCHAR(256),
  ADD COLUMN IF NOT EXISTS retention_days       INTEGER       NOT NULL DEFAULT 365,
  ADD COLUMN IF NOT EXISTS public_key           TEXT,
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN firms.kms_key_arn IS
  'AWS KMS key ARN used for envelope encryption of this firm''s data.';
COMMENT ON COLUMN firms.retention_days IS
  'Number of days to retain event data before automatic purge.';
COMMENT ON COLUMN firms.public_key IS
  'RSA-2048 public key for client-side encryption (optional).';
COMMENT ON COLUMN firms.deletion_requested_at IS
  'Timestamp when the firm requested account/data deletion (GDPR Art. 17).';

-- ---------------------------------------------------------------------------
-- 2. Extend `events` — envelope encryption metadata
-- ---------------------------------------------------------------------------

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS entity_metadata_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_dek             TEXT,
  ADD COLUMN IF NOT EXISTS encryption_iv             VARCHAR(32);

COMMENT ON COLUMN events.entity_metadata_encrypted IS
  'AES-256-GCM encrypted entity metadata blob (entities + context).';
COMMENT ON COLUMN events.encrypted_dek IS
  'Data Encryption Key, itself encrypted with the firm''s KMS key (envelope encryption).';
COMMENT ON COLUMN events.encryption_iv IS
  'Hex-encoded initialization vector for AES-256-GCM.';

-- ---------------------------------------------------------------------------
-- 3. Extend `audit_trail` — if the table exists, add columns.
--    If it does not exist, create it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_trail (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        UUID         NOT NULL REFERENCES firms(id),
  user_id        UUID         REFERENCES users(id),
  action         VARCHAR(100) NOT NULL,
  resource_type  VARCHAR(100) NOT NULL,
  resource_id    UUID,
  details        JSONB        DEFAULT '{}',
  ip_address     INET,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE audit_trail
  ADD COLUMN IF NOT EXISTS actor_type     VARCHAR(50) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS justification  TEXT;

COMMENT ON COLUMN audit_trail.actor_type IS
  'Who performed the action: user | admin | system | api_key.';
COMMENT ON COLUMN audit_trail.justification IS
  'Free-text reason for the action (required for break-glass / override operations).';

-- ---------------------------------------------------------------------------
-- 4. Admin Audit table — tracks Iron Gate employee actions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_audit (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   VARCHAR(255) NOT NULL,
  action        VARCHAR(100) NOT NULL,
  resource      TEXT         NOT NULL,
  ip_address    INET,
  justification TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_audit IS
  'Immutable log of Iron Gate employee actions on customer resources. '
  'Every access requires a justification (break-glass protocol).';

-- ---------------------------------------------------------------------------
-- 5. Kill Switch table — emergency circuit breaker
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kill_switch (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           VARCHAR(50)  NOT NULL,   -- 'global' | 'firm' | 'user' | 'tool'
  firm_id         UUID         REFERENCES firms(id),
  enabled         BOOLEAN      NOT NULL DEFAULT true,
  activated_by    VARCHAR(255) NOT NULL,
  activated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deactivated_at  TIMESTAMPTZ
);

COMMENT ON TABLE kill_switch IS
  'Emergency kill switch. When enabled for a scope, all detection/proxy '
  'activity for that scope is halted and prompts pass through unmodified.';

CREATE INDEX IF NOT EXISTS kill_switch_scope_idx
  ON kill_switch (scope, firm_id) WHERE enabled = true;

-- ---------------------------------------------------------------------------
-- 6. Revoked Tokens table — JWT deny-list
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         VARCHAR(255)  PRIMARY KEY,
  revoked_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ   NOT NULL
);

COMMENT ON TABLE revoked_tokens IS
  'Deny-list for revoked JWTs. Entries are kept until expires_at so the '
  'table can be periodically pruned without re-admitting expired tokens.';

CREATE INDEX IF NOT EXISTS revoked_tokens_expires_idx
  ON revoked_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- 7. Additional indexes for security queries
-- ---------------------------------------------------------------------------

-- Fast lookup: has this firm requested deletion?
CREATE INDEX IF NOT EXISTS firms_deletion_requested_idx
  ON firms (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;

-- Fast lookup: encrypted events for a firm (re-encryption / key rotation)
CREATE INDEX IF NOT EXISTS events_encrypted_dek_idx
  ON events (firm_id) WHERE encrypted_dek IS NOT NULL;

-- Audit trail lookup by firm + action
CREATE INDEX IF NOT EXISTS audit_trail_firm_action_idx
  ON audit_trail (firm_id, action, created_at);

-- Admin audit lookup by employee
CREATE INDEX IF NOT EXISTS admin_audit_employee_idx
  ON admin_audit (employee_id, created_at);

-- Admin audit lookup by action
CREATE INDEX IF NOT EXISTS admin_audit_action_idx
  ON admin_audit (action, created_at);

COMMIT;
