// ============================================================================
// Iron Gate — Data Retention Cleanup Job
// ============================================================================
// Automated data retention cleanup:
// - Deletes events older than the firm's configured retention period
// - Cleans expired pseudonym_maps (24h lifetime)
// - Cleans expired audit_trail entries beyond retention window
// - Supports GDPR right to erasure (full firm data deletion)
// ============================================================================

import { db } from '../db/client';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default retention period in days if not configured per-firm */
const DEFAULT_RETENTION_DAYS = 90;

/** Pseudonym maps expire after 24 hours */
const PSEUDONYM_MAP_LIFETIME_HOURS = 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetentionCleanupResult {
  eventsDeleted: number;
  pseudonymMapsDeleted: number;
  auditEntriesDeleted: number;
}

export interface FirmDataDeletionResult {
  auditTrailDeleted: number;
  entityFeedbackDeleted: number;
  pseudonymMapsDeleted: number;
  entityCoOccurrencesDeleted: number;
  inferredEntitiesDeleted: number;
  sensitivityPatternsDeleted: number;
  weightOverridesDeleted: number;
  webhookSubscriptionsDeleted: number;
  eventsDeleted: number;
}

// ---------------------------------------------------------------------------
// Retention Cleanup
// ---------------------------------------------------------------------------

/**
 * Run the full retention cleanup across all firms.
 *
 * For each firm, deletes:
 * 1. Events older than the firm's retention period (default: 90 days)
 * 2. Expired pseudonym_maps (entries past their expires_at timestamp)
 * 3. Audit-related event entries beyond the retention window
 *
 * This should be invoked from a cron job or scheduled task.
 */
export async function runRetentionCleanup(): Promise<RetentionCleanupResult> {
  const result: RetentionCleanupResult = {
    eventsDeleted: 0,
    pseudonymMapsDeleted: 0,
    auditEntriesDeleted: 0,
  };

  // -------------------------------------------------------------------------
  // 1. Delete expired pseudonym maps (24h lifetime, based on expires_at)
  // -------------------------------------------------------------------------
  const pseudonymResult = await db.execute(sql`
    DELETE FROM pseudonym_maps
    WHERE expires_at < NOW()
  `);
  result.pseudonymMapsDeleted = extractRowCount(pseudonymResult);

  // -------------------------------------------------------------------------
  // 2. Get all firms with their retention configuration
  // -------------------------------------------------------------------------
  const firms = await db.execute(sql`
    SELECT id, config FROM firms
  `);

  for (const firm of firms) {
    const firmId = firm.id as string;
    const config = firm.config as Record<string, unknown> | null;
    const retentionDays = getRetentionDays(config);

    // -----------------------------------------------------------------------
    // 3. Delete events older than retention period for this firm
    // -----------------------------------------------------------------------
    const eventsResult = await db.execute(sql`
      DELETE FROM events
      WHERE firm_id = ${firmId}
        AND created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
    `);
    result.eventsDeleted += extractRowCount(eventsResult);

    // -----------------------------------------------------------------------
    // 4. Delete feedback entries whose parent events no longer exist
    //    (orphaned by event deletion above)
    // -----------------------------------------------------------------------
    const auditResult = await db.execute(sql`
      DELETE FROM feedback
      WHERE firm_id = ${firmId}
        AND created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
    `);
    result.auditEntriesDeleted += extractRowCount(auditResult);
  }

  console.log(
    `[Data Retention] Cleanup complete: ${result.eventsDeleted} events, ` +
    `${result.pseudonymMapsDeleted} pseudonym maps, ` +
    `${result.auditEntriesDeleted} audit entries deleted`
  );

  return result;
}

// ---------------------------------------------------------------------------
// GDPR Right to Erasure — Delete All Firm Data
// ---------------------------------------------------------------------------

/**
 * Delete ALL data belonging to a specific firm.
 *
 * This implements GDPR Article 17 (Right to Erasure). Tables are deleted
 * in dependency order to respect foreign key constraints:
 *
 *   1. feedback (references events)
 *   2. pseudonym_maps (references firms)
 *   3. entity_co_occurrences (references firms)
 *   4. inferred_entities (references firms)
 *   5. sensitivity_patterns (references firms)
 *   6. weight_overrides (references firms)
 *   7. webhook_subscriptions (references firms)
 *   8. events (references firms, users)
 *   9. (firm record itself is NOT deleted — caller must handle that separately)
 *
 * Returns a count of deleted rows per table.
 */
export async function deleteAllFirmData(firmId: string): Promise<FirmDataDeletionResult> {
  if (!firmId || typeof firmId !== 'string') {
    throw new Error('deleteAllFirmData requires a valid firmId');
  }

  const result: FirmDataDeletionResult = {
    auditTrailDeleted: 0,
    entityFeedbackDeleted: 0,
    pseudonymMapsDeleted: 0,
    entityCoOccurrencesDeleted: 0,
    inferredEntitiesDeleted: 0,
    sensitivityPatternsDeleted: 0,
    weightOverridesDeleted: 0,
    webhookSubscriptionsDeleted: 0,
    eventsDeleted: 0,
  };

  // Execute deletions in dependency order within a transaction
  await db.execute(sql`BEGIN`);

  try {
    // 1. feedback (audit_trail / entity_feedback equivalent — FK to events)
    const feedbackResult = await db.execute(sql`
      DELETE FROM feedback WHERE firm_id = ${firmId}
    `);
    result.entityFeedbackDeleted = extractRowCount(feedbackResult);
    result.auditTrailDeleted = result.entityFeedbackDeleted;

    // 2. pseudonym_maps
    const pseudonymResult = await db.execute(sql`
      DELETE FROM pseudonym_maps WHERE firm_id = ${firmId}
    `);
    result.pseudonymMapsDeleted = extractRowCount(pseudonymResult);

    // 3. entity_co_occurrences
    const coOccResult = await db.execute(sql`
      DELETE FROM entity_co_occurrences WHERE firm_id = ${firmId}
    `);
    result.entityCoOccurrencesDeleted = extractRowCount(coOccResult);

    // 4. inferred_entities
    const inferredResult = await db.execute(sql`
      DELETE FROM inferred_entities WHERE firm_id = ${firmId}
    `);
    result.inferredEntitiesDeleted = extractRowCount(inferredResult);

    // 5. sensitivity_patterns
    const patternResult = await db.execute(sql`
      DELETE FROM sensitivity_patterns WHERE firm_id = ${firmId}
    `);
    result.sensitivityPatternsDeleted = extractRowCount(patternResult);

    // 6. weight_overrides
    const weightResult = await db.execute(sql`
      DELETE FROM weight_overrides WHERE firm_id = ${firmId}
    `);
    result.weightOverridesDeleted = extractRowCount(weightResult);

    // 7. webhook_subscriptions
    const webhookResult = await db.execute(sql`
      DELETE FROM webhook_subscriptions WHERE firm_id = ${firmId}
    `);
    result.webhookSubscriptionsDeleted = extractRowCount(webhookResult);

    // 8. events (last — everything else referenced these)
    const eventsResult = await db.execute(sql`
      DELETE FROM events WHERE firm_id = ${firmId}
    `);
    result.eventsDeleted = extractRowCount(eventsResult);

    await db.execute(sql`COMMIT`);
  } catch (error) {
    await db.execute(sql`ROLLBACK`);
    console.error(`[Data Retention] GDPR erasure failed for firm ${firmId}:`, error);
    throw error;
  }

  console.log(
    `[Data Retention] GDPR erasure complete for firm ${firmId}:`,
    JSON.stringify(result)
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the retention period (in days) from a firm's config JSON.
 * Falls back to DEFAULT_RETENTION_DAYS (90) if not configured.
 */
function getRetentionDays(config: Record<string, unknown> | null): number {
  if (!config) return DEFAULT_RETENTION_DAYS;

  const retention = config.retentionDays ?? config.retention_days;
  if (typeof retention === 'number' && retention > 0) {
    return Math.floor(retention);
  }

  return DEFAULT_RETENTION_DAYS;
}

/**
 * Extract the row count from a raw SQL execution result.
 * Drizzle + postgres.js returns rowCount on the result object.
 */
function extractRowCount(result: unknown): number {
  if (result && typeof result === 'object') {
    // postgres.js returns rowCount on the result array
    const r = result as { rowCount?: number; rows?: unknown[] };
    if (typeof r.rowCount === 'number') return r.rowCount;
    // Fallback: drizzle may wrap it differently
    if (Array.isArray(result)) {
      const arr = result as unknown as { count?: number };
      if (typeof arr.count === 'number') return arr.count;
      return (result as unknown[]).length;
    }
  }
  return 0;
}
