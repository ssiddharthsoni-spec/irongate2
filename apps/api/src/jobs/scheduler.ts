/**
 * Job Scheduler — triggers data retention and maintenance tasks on a schedule.
 *
 * Uses setInterval-based scheduling (no external dependencies needed).
 * Cron-like timing:
 * - Daily at startup + every 24h: retention cleanup, trial expiry sweep
 * - Hourly: pseudonym map expiry
 * - Weekly (every 7 days): digest emails
 */

import { logger } from '../lib/logger';

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_WEEK = 7 * ONE_DAY;

export function startScheduler() {
  // Daily retention cleanup
  setInterval(async () => {
    logger.info('Running scheduled data retention cleanup');
    try {
      const { runRetentionCleanup } = await import('./data-retention');
      const result = await runRetentionCleanup();
      logger.info('Data retention cleanup complete', { result });
    } catch (err) {
      logger.error('Data retention cleanup failed', { error: (err as Error).message });
    }
  }, ONE_DAY);

  // Daily trial expiry sweep — downgrades expired trials in the DB
  setInterval(async () => {
    logger.info('Running trial expiry sweep');
    try {
      const { db } = await import('../db/client');
      const { subscriptions } = await import('../db/schema');
      const { eq, and, lt } = await import('drizzle-orm');

      const result = await db
        .update(subscriptions)
        .set({ tier: 'free', status: 'active', updatedAt: new Date() })
        .where(
          and(
            eq(subscriptions.status, 'trialing'),
            lt(subscriptions.currentPeriodEnd, new Date()),
          ),
        )
        .returning({ id: subscriptions.id, firmId: subscriptions.firmId });

      if (result.length > 0) {
        logger.info('Trial expiry sweep: downgraded firms', { count: result.length, firmIds: result.map(r => r.firmId) });
      }
    } catch (err) {
      logger.error('Trial expiry sweep failed', { error: (err as Error).message });
    }
  }, ONE_DAY);

  // Hourly pseudonym map expiry
  setInterval(async () => {
    logger.info('Running hourly pseudonym map expiry sweep');
    try {
      const { db } = await import('../db/client');
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`DELETE FROM pseudonym_maps WHERE expires_at < NOW()`);
      logger.info('Pseudonym map expiry sweep complete');
    } catch (err) {
      logger.error('Pseudonym map expiry sweep failed', { error: (err as Error).message });
    }
  }, ONE_HOUR);

  // Weekly digest emails
  setInterval(async () => {
    logger.info('Running weekly digest email job');
    try {
      await sendWeeklyDigests();
    } catch (err) {
      logger.error('Weekly digest job failed', { error: (err as Error).message });
    }
  }, ONE_WEEK);

  logger.info('Job scheduler started', {
    dailyRetention: '24h interval',
    trialExpiry: '24h interval',
    pseudonymExpiry: '1h interval',
    weeklyDigest: '7d interval',
  });
}

/**
 * Send weekly digest emails to all firms with the feature enabled.
 */
async function sendWeeklyDigests() {
  const { db } = await import('../db/client');
  const { firms, users, events } = await import('../db/schema');
  const { eq, and, gte, sql, count, avg } = await import('drizzle-orm');
  const { sendWeeklyDigest } = await import('../services/email');

  const oneWeekAgo = new Date(Date.now() - ONE_WEEK);

  // Get all firms
  const allFirms = await db
    .select({ id: firms.id, name: firms.name, config: firms.config })
    .from(firms);

  for (const firm of allFirms) {
    try {
      const config = (firm.config ?? {}) as Record<string, any>;
      const notifications = config.notifications ?? {};

      // Skip firms that haven't enabled weekly digest
      if (!notifications.weeklyDigest) continue;

      // Get stats for the last 7 days
      const [stats] = await db
        .select({
          prompts: count(events.id),
          avgScore: avg(events.sensitivityScore),
        })
        .from(events)
        .where(and(eq(events.firmId, firm.id), gte(events.createdAt, oneWeekAgo)));

      const promptCount = Number(stats?.prompts || 0);
      if (promptCount === 0) continue; // No activity — skip

      // Get top entity types
      const topEntitiesResult = await db.execute(
        sql`SELECT unnest(array_agg(DISTINCT e.type)) as entity_type, count(*) as cnt
            FROM events ev, jsonb_to_recordset(ev.entities) AS e(type text)
            WHERE ev.firm_id = ${firm.id} AND ev.created_at >= ${oneWeekAgo}
            GROUP BY entity_type ORDER BY cnt DESC LIMIT 5`,
      );
      const topEntities = (topEntitiesResult as any[]).map((r: any) => r.entity_type).filter(Boolean);

      // Get admin emails
      const admins = await db
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.firmId, firm.id), eq(users.role, 'admin')));

      for (const admin of admins) {
        await sendWeeklyDigest(admin.email, firm.name, {
          prompts: promptCount,
          entities: 0, // Would need a separate query for entity count
          avgScore: Number(stats?.avgScore || 0),
          topEntities,
        });
      }

      logger.info('Weekly digest sent', { firmId: firm.id, adminCount: admins.length });
    } catch (err) {
      logger.error('Weekly digest failed for firm', { firmId: firm.id, error: (err as Error).message });
    }
  }
}
