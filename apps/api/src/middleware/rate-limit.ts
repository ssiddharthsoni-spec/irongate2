import { createMiddleware } from 'hono/factory';

/**
 * Redis-backed sliding window rate limiter with in-memory fallback.
 * Uses ZADD/ZREMRANGEBYSCORE for precise sliding windows when Redis is available.
 * Falls back to in-memory Map when Redis is unavailable.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 300; // 300 requests per minute

// ---------------------------------------------------------------------------
// Redis client (lazy initialization)
// ---------------------------------------------------------------------------

let redis: any = null;
let redisAvailable = false;

async function getRedis() {
  if (redis !== null) return redisAvailable ? redis : null;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    redis = false;
    redisAvailable = false;
    return null;
  }

  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redis.connect();
    redisAvailable = true;
    console.log('[Rate Limit] Redis connected');
    return redis;
  } catch {
    console.warn('[Rate Limit] Redis unavailable, using in-memory fallback');
    redis = false;
    redisAvailable = false;
    return null;
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

const requestCounts = new Map<string, { count: number; resetTime: number }>();
const CLEANUP_INTERVAL = 5 * 60_000;
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

async function checkInMemory(key: string): Promise<{ count: number; remaining: number; resetTime: number }> {
  const now = Date.now();
  evictExpiredEntries();

  let entry = requestCounts.get(key);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + WINDOW_MS };
    requestCounts.set(key, entry);
  }

  entry.count++;
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
  const count = results[2][1] as number;

  return {
    count,
    remaining: Math.max(0, MAX_REQUESTS - count),
    resetTime: now + WINDOW_MS,
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const key = c.get('userId') || c.req.header('x-forwarded-for') || 'anonymous';

  let result: { count: number; remaining: number; resetTime: number };

  try {
    const redisClient = await getRedis();
    if (redisClient) {
      result = await checkRedis(redisClient, key);
    } else {
      result = await checkInMemory(key);
    }
  } catch {
    // On any Redis error, fall back to in-memory
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
