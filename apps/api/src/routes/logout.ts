import { Hono } from 'hono';
import crypto from 'crypto';
import { revokeToken } from '../middleware/jwt-revocation';
import { invalidateUserCache } from '../middleware/auth';
import type { AppEnv } from '../types';
import { logger } from '../lib/logger';

export const logoutRoutes = new Hono<AppEnv>();

// POST /v1/logout — Revoke the current JWT and clear caches
logoutRoutes.post('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'No token to revoke' }, 400);
  }

  const token = authHeader.slice(7);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const revoked = await revokeToken(tokenHash);

  // Also clear the user from the auth cache so re-auth is required
  const clerkId = c.get('clerkId');
  if (clerkId && clerkId !== 'api-key') {
    invalidateUserCache(clerkId);
  }

  logger.info('User logged out', { userId: c.get('userId') });

  return c.json({
    success: true,
    revoked,
    message: revoked
      ? 'Token revoked — it will be rejected for 1 hour'
      : 'Token invalidated locally (Redis unavailable for full revocation)',
  });
});
