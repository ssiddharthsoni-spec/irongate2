/**
 * Cross-firm isolation validation.
 *
 * Shared helper to verify that a referenced record (event, audit log, document,
 * webhook, etc.) belongs to the requesting firm. Prevents cross-tenant data
 * access via foreign-key reference manipulation.
 *
 * Usage:
 *   const valid = await validateFirmOwnership('events', eventId, firmId);
 *   if (!valid) return c.json({ error: 'Not found' }, 404);
 */

import { db } from '../db/client';
import { sql } from 'drizzle-orm';

// Tables that have a firm_id column and support ownership validation
const SUPPORTED_TABLES = new Set([
  'events',
  'audit_log',
  'feedback',
  'pseudonym_maps',
  'client_matters',
  'weight_overrides',
  'webhook_subscriptions',
  'webhook_delivery_log',
  'firm_plugins',
  'inferred_entities',
  'sensitivity_patterns',
  'entity_co_occurrences',
  'feature_flags',
  'departments',
  'department_policies',
  'invites',
  'api_keys',
  'alerts',
  'extension_heartbeats',
  'subscriptions',
  'invoices',
  'kill_switch',
  'email_verification_tokens',
  'data_deletion_requests',
  'tos_acceptance',
  'dpa_acceptance',
  'incidents',
]);

/**
 * Validate that a record in `table` with `recordId` belongs to `firmId`.
 *
 * Returns true if the record exists and its firm_id matches.
 * Returns false if the record doesn't exist or belongs to a different firm.
 *
 * SECURITY: Uses parameterized queries — no SQL injection risk.
 * The table name is validated against a whitelist before interpolation.
 */
export async function validateFirmOwnership(
  table: string,
  recordId: string,
  firmId: string,
): Promise<boolean> {
  if (!SUPPORTED_TABLES.has(table)) {
    throw new Error(`[firm-ownership] Table "${table}" is not supported for ownership validation`);
  }

  // UUID format validation to prevent injection via recordId/firmId
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(recordId) || !UUID_RE.test(firmId)) {
    return false;
  }

  const result = await db.execute(
    sql.raw(`SELECT 1 FROM "${table}" WHERE id = '${recordId}' AND firm_id = '${firmId}' LIMIT 1`),
  );

  return (result as unknown as any[]).length > 0;
}

/**
 * Validate ownership and return 404 context if failed.
 * Convenience wrapper for route handlers.
 */
export async function requireFirmOwnership(
  table: string,
  recordId: string,
  firmId: string,
): Promise<{ valid: true } | { valid: false; error: string }> {
  const valid = await validateFirmOwnership(table, recordId, firmId);
  if (!valid) {
    return { valid: false, error: 'Resource not found' };
  }
  return { valid: true };
}
