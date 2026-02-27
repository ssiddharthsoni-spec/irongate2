// Shared Redis singleton — used by rate limiter, BullMQ, and distributed counters.
// Single connection avoids multiple ioredis instances competing for the same server.

import Redis from 'ioredis';
import { logger } from './logger';

let _instance: Redis | null = null;
let _attempted = false;

/**
 * Get the shared Redis client. Returns null if REDIS_URL is not set.
 * BullMQ requires `maxRetriesPerRequest: null` — this is set here so all
 * consumers (rate limiter, queues, counters) share the same connection config.
 */
export function getRedisClient(): Redis | null {
  if (_instance) return _instance;
  if (_attempted) return null; // Already tried and failed or no URL

  _attempted = true;
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL not set — Redis-dependent features disabled');
    return null;
  }

  try {
    _instance = new Redis(url, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      lazyConnect: false,
    });

    _instance.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });

    logger.info('Redis client initialized');
    return _instance;
  } catch (err) {
    logger.error('Failed to create Redis client', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Close the shared Redis connection. Called during graceful shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (_instance) {
    await _instance.quit();
    _instance = null;
    _attempted = false;
  }
}
