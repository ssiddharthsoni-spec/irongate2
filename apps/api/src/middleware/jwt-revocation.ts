import { createMiddleware } from 'hono/factory';
import { getRedisClient } from '../lib/redis';
import { logger } from '../lib/logger';

const REVOKED_KEY_PREFIX = 'ig:revoked:';
const REVOKED_TTL = 3600; // 1 hour — matches typical JWT expiry

// ---------------------------------------------------------------------------
// In-memory fallback — ensures revoked tokens stay rejected even if Redis
// goes down after the revocation was issued. Bounded to prevent memory leaks.
// ---------------------------------------------------------------------------
const LOCAL_REVOKED = new Map<string, number>(); // tokenHash → expiresAt (epoch ms)
const LOCAL_REVOKED_MAX = 5_000;

function localRevoke(tokenHash: string): void {
  // Evict expired entries if map is full
  if (LOCAL_REVOKED.size >= LOCAL_REVOKED_MAX) {
    const now = Date.now();
    for (const [k, exp] of LOCAL_REVOKED) {
      if (now > exp) LOCAL_REVOKED.delete(k);
    }
    // Still full after cleanup — drop oldest 20%
    if (LOCAL_REVOKED.size >= LOCAL_REVOKED_MAX) {
      const keys = Array.from(LOCAL_REVOKED.keys());
      const toDelete = Math.floor(keys.length * 0.2);
      for (let i = 0; i < toDelete; i++) LOCAL_REVOKED.delete(keys[i]);
    }
  }
  LOCAL_REVOKED.set(tokenHash, Date.now() + REVOKED_TTL * 1000);
}

function isLocallyRevoked(tokenHash: string): boolean {
  const exp = LOCAL_REVOKED.get(tokenHash);
  if (!exp) return false;
  if (Date.now() > exp) {
    LOCAL_REVOKED.delete(tokenHash);
    return false;
  }
  return true;
}

/**
 * Revoke a JWT by its token hash. The token will be rejected by
 * the middleware until the TTL expires (matching JWT max lifetime).
 */
export async function revokeToken(tokenHash: string): Promise<boolean> {
  // Always store locally so the token is rejected even if Redis goes down later
  localRevoke(tokenHash);

  const redis = getRedisClient();
  if (!redis) {
    logger.warn('Cannot revoke token in Redis (unavailable) — using in-memory fallback only');
    return true;
  }

  await redis.set(`${REVOKED_KEY_PREFIX}${tokenHash}`, '1', 'EX', REVOKED_TTL);
  return true;
}

/**
 * Check if a token hash has been revoked.
 * Checks both Redis and the in-memory fallback.
 */
export async function isTokenRevoked(tokenHash: string): Promise<boolean> {
  // Always check local first — instant and works during Redis outages
  if (isLocallyRevoked(tokenHash)) return true;

  const redis = getRedisClient();
  if (!redis) return false; // No Redis + not in local = allow through

  const result = await redis.get(`${REVOKED_KEY_PREFIX}${tokenHash}`);
  return result !== null;
}

/**
 * JWT revocation middleware. Checks Bearer tokens against the Redis
 * blacklist before allowing the request to proceed.
 *
 * Must run AFTER the auth middleware extracts the token.
 * Only applies to Bearer token auth (not API keys).
 */
export const jwtRevocationMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    // Not a JWT request — skip
    await next();
    return;
  }

  const redis = getRedisClient();
  if (!redis) {
    // No Redis — can't check revocation list, allow through (fail-open for availability)
    logger.warn('JWT revocation check skipped: Redis unavailable — revoked tokens will NOT be rejected');
    await next();
    return;
  }

  // Hash the token for the blacklist lookup (don't store raw JWTs in Redis)
  const token = authHeader.slice(7);
  const crypto = await import('crypto');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const revoked = await isTokenRevoked(tokenHash);
    if (revoked) {
      return c.json({ error: 'Unauthorized: token has been revoked' }, 401);
    }
  } catch (err) {
    // Redis error — allow through (fail open for availability)
    logger.warn('JWT revocation check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await next();
});
