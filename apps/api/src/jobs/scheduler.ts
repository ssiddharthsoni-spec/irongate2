/**
 * Job Scheduler — triggers data retention and maintenance tasks on a schedule.
 *
 * Uses setInterval-based scheduling (no external dependencies needed).
 * Cron-like timing:
 * - Daily at startup + every 24h: retention cleanup
 * - Hourly: pseudonym map expiry
 */

import { logger } from '../lib/logger';

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

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

  logger.info('Job scheduler started', { dailyRetention: '24h interval', pseudonymExpiry: '1h interval' });
}
