import { createMiddleware } from 'hono/factory';
import { getRedisClient } from '../lib/redis';
import { logger } from '../lib/logger';

const REVOKED_KEY_PREFIX = 'ig:revoked:';
const REVOKED_TTL = 3600; // 1 hour — matches typical JWT expiry

/**
 * Revoke a JWT by its token hash. The token will be rejected by
 * the middleware until the TTL expires (matching JWT max lifetime).
 */
export async function revokeToken(tokenHash: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn('Cannot revoke token: Redis not available');
    return false;
  }

  await redis.set(`${REVOKED_KEY_PREFIX}${tokenHash}`, '1', 'EX', REVOKED_TTL);
  return true;
}

/**
 * Check if a token hash has been revoked.
 */
export async function isTokenRevoked(tokenHash: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false; // No Redis = can't check revocations, allow through

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
