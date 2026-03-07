import { createMiddleware } from 'hono/factory';
import { getRedisClient } from '../lib/redis';
import { logger } from '../lib/logger';

/**
 * Redis-backed sliding window rate limiter with in-memory fallback.
 * Uses ZADD/ZREMRANGEBYSCORE for precise sliding windows when Redis is available.
 * Falls back to in-memory Map when Redis is unavailable.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 300; // 300 requests per minute

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

const requestCounts = new Map<string, { count: number; resetTime: number; lastAccess: number }>();
const MAX_MAP_ENTRIES = 10_000;
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function evictExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, entry] of requestCounts) {
    if (now > entry.resetTime) {
      requestCounts.delete(key);
    }
  }
}

function evictLRU() {
  // Evict entries with the oldest lastAccess time
  const entries = Array.from(requestCounts.entries());
  entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  const toDelete = entries.length - MAX_MAP_ENTRIES + 1000;
  for (let i = 0; i < toDelete && i < entries.length; i++) {
    requestCounts.delete(entries[i][0]);
  }
  logger.warn('Rate limiter in-memory fallback: evicted LRU entries', { evicted: toDelete, remaining: requestCounts.size });
}

async function checkInMemory(key: string): Promise<{ count: number; remaining: number; resetTime: number }> {
  const now = Date.now();
  evictExpiredEntries();

  // Hard cap: evict least recently used entries if map grows too large
  if (requestCounts.size > MAX_MAP_ENTRIES) {
    evictLRU();
  }

  let entry = requestCounts.get(key);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + WINDOW_MS, lastAccess: now };
    requestCounts.set(key, entry);
  }

  entry.count++;
  entry.lastAccess = now;
  return {
    count: entry.count,
    remaining: Math.max(0, MAX_REQUESTS - entry.count),
    resetTime: entry.resetTime,
  };
}

// ---------------------------------------------------------------------------
// Redis sliding window
// ---------------------------------------------------------------------------

async function checkRedis(redisClient: any, key: string): Promise<{ count: number; remaining: number; resetTime: number }> {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const rKey = `rl:${key}`;

  const pipeline = redisClient.pipeline();
  pipeline.zremrangebyscore(rKey, 0, windowStart);
  pipeline.zadd(rKey, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
  pipeline.zcard(rKey);
  pipeline.pexpire(rKey, WINDOW_MS);

  const results = await pipeline.exec();
  if (!results || results[2][0]) {
    throw results?.[2]?.[0] || new Error('Redis pipeline error');
  }
  const count = (results[2][1] as number) || 0;

  return {
    count,
    remaining: Math.max(0, MAX_REQUESTS - count),
    resetTime: now + WINDOW_MS,
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Create a rate limit middleware with custom limits.
 * Useful for per-route or per-firm rate limiting.
 */
export function createRateLimiter(opts: {
  maxRequests?: number;
  windowMs?: number;
  keyPrefix?: string;
  /** Use firmId as the rate limit key instead of userId/IP */
  perFirm?: boolean;
} = {}) {
  const max = opts.maxRequests ?? MAX_REQUESTS;
  const window = opts.windowMs ?? WINDOW_MS;
  const prefix = opts.keyPrefix ?? 'rl';

  return createMiddleware(async (c, next) => {
    const baseKey = opts.perFirm
      ? (c.get('firmId') || 'unknown-firm')
      : (c.get('userId')
        || c.req.header('cf-connecting-ip')
        || c.req.header('x-render-client-ip')
        || (c.req.header('x-forwarded-for') || '').split(',')[0].trim()
        || 'anonymous');

    const key = `${prefix}:${baseKey}`;
    let result: { count: number; remaining: number; resetTime: number };

    try {
      const redisClient = getRedisClient();
      if (redisClient) {
        result = await checkRedis(redisClient, key);
      } else {
        result = await checkInMemory(key);
      }
    } catch (err) {
      logger.warn('Redis rate-limit failed, using in-memory fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      result = await checkInMemory(key);
    }

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - result.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));

    if (result.count > max) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    await next();
  });
}

/** Per-firm proxy rate limiter: 100 requests per firm per minute */
export const proxyRateLimitMiddleware = createRateLimiter({
  maxRequests: 100,
  keyPrefix: 'rl:proxy',
  perFirm: true,
});

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  // Prefer authenticated userId. For unauthenticated requests, use the
  // most trustworthy client IP header available (CF > Render > XFF last hop).
  const key = c.get('userId')
    || c.req.header('cf-connecting-ip')
    || c.req.header('x-render-client-ip')
    || (c.req.header('x-forwarded-for') || '').split(',')[0].trim()
    || 'anonymous';

  let result: { count: number; remaining: number; resetTime: number };

  try {
    const redisClient = getRedisClient();
    if (redisClient) {
      result = await checkRedis(redisClient, key);
    } else {
      result = await checkInMemory(key);
    }
  } catch (err) {
    // On any Redis error, fall back to in-memory
    logger.warn('Redis rate-limit failed, using in-memory fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
    result = await checkInMemory(key);
  }

  // Set rate limit headers
  c.header('X-RateLimit-Limit', String(MAX_REQUESTS));
  c.header('X-RateLimit-Remaining', String(result.remaining));
  c.header('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));

  if (result.count > MAX_REQUESTS) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  await next();
});
