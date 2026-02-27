// Distributed inference trigger — uses Redis INCR for atomic counting
// across multiple API instances. Replaces the per-process in-memory Map.

import { getRedisClient } from '../lib/redis';
import { enqueueInference } from '../jobs/enqueue';
import { logger } from '../lib/logger';

const THRESHOLD = 100;
const COUNTER_TTL = 3600; // 1 hour — auto-reset if firm goes quiet

/**
 * Increment the event counter for a firm. When the count reaches the
 * threshold (100), reset the counter and enqueue an inference job.
 * Uses Redis INCR for atomic cross-instance counting.
 */
export async function triggerInferenceDistributed(firmId: string): Promise<void> {
  const redis = getRedisClient();

  if (!redis) {
    // No Redis — enqueue directly (BullMQ deduplicates by firmId jobId)
    await enqueueInference({ firmId });
    return;
  }

  try {
    const key = `ig:inference:${firmId}`;
    const count = await redis.incr(key);

    // Set TTL on first increment so counter auto-expires
    if (count === 1) {
      await redis.expire(key, COUNTER_TTL);
    }

    if (count >= THRESHOLD) {
      await redis.del(key);
      await enqueueInference({ firmId });
    }
  } catch (err) {
    logger.warn('Distributed inference trigger failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
