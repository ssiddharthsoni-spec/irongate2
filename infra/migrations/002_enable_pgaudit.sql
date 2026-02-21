-- =============================================================================
-- Iron Gate — Migration 002: Enable pgAudit Extension
-- =============================================================================
-- pgAudit provides detailed session and object-level audit logging for
-- PostgreSQL.  This satisfies SOC 2 / ISO 27001 requirements for database
-- activity monitoring.
--
-- Prerequisites:
--   - pgaudit must be listed in shared_preload_libraries in postgresql.conf
--     (or in the RDS/Aurora parameter group).
--   - The migration must be run by a superuser or rds_superuser role.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Install the extension
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgaudit;

-- ---------------------------------------------------------------------------
-- 2. Configure audit logging scope
-- ---------------------------------------------------------------------------

-- Log all DDL statements (CREATE, ALTER, DROP) so schema changes are tracked.
-- Log all DML write statements (INSERT, UPDATE, DELETE) for compliance.
-- Read (SELECT) logging is intentionally omitted at the global level to avoid
-- excessive log volume; it can be enabled per-role if needed.

ALTER SYSTEM SET pgaudit.log = 'ddl, write';

-- Log the statement parameters so auditors can see the actual values.
ALTER SYSTEM SET pgaudit.log_parameter = on;

-- Include the originating relation (table) name for easier filtering.
ALTER SYSTEM SET pgaudit.log_relation = on;

-- Do not log statements that affect zero rows (reduces noise).
ALTER SYSTEM SET pgaudit.log_statement_once = on;

-- ---------------------------------------------------------------------------
-- 3. Role-based audit for sensitive tables
-- ---------------------------------------------------------------------------
-- Create a dedicated audit role.  Any tables granted to this role will have
-- SELECT, INSERT, UPDATE, DELETE logged at the object level regardless of the
-- global pgaudit.log setting.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'irongate_auditor') THEN
    CREATE ROLE irongate_auditor NOLOGIN;
  END IF;
END;
$$;

ALTER SYSTEM SET pgaudit.role = 'irongate_auditor';

-- Grant the auditor role access to the most sensitive tables so every access
-- is logged — even SELECTs.
GRANT SELECT, INSERT, UPDATE, DELETE ON events          TO irongate_auditor;
GRANT SELECT, INSERT, UPDATE, DELETE ON pseudonym_maps  TO irongate_auditor;
GRANT SELECT, INSERT, UPDATE, DELETE ON firms           TO irongate_auditor;
GRANT SELECT, INSERT, UPDATE, DELETE ON users           TO irongate_auditor;

-- ---------------------------------------------------------------------------
-- 4. Reload configuration
-- ---------------------------------------------------------------------------
-- On RDS/Aurora this is a no-op (parameter group changes take effect
-- automatically).  On self-managed Postgres, a config reload is needed.

SELECT pg_reload_conf();

COMMIT;
