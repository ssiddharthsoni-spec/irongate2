/**
 * MFA Enforcement Middleware
 *
 * Checks whether the firm requires MFA and whether the current session
 * has a second factor verified. Uses Clerk session claims when available.
 *
 * Enforcement is opt-in per firm via firms.config.mfaRequired = true.
 * API key auth is exempt (keys are already a separate credential).
 */
import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger';

// Cache firm MFA settings (5 min TTL)
const mfaConfigCache = new Map<string, { required: boolean; expiresAt: number }>();
const MFA_CACHE_TTL = 5 * 60_000;

export const mfaEnforcementMiddleware = createMiddleware(async (c, next) => {
  // Skip MFA check for API key auth (already a separate credential)
  const clerkId = c.get('clerkId');
  if (clerkId === 'api-key') {
    await next();
    return;
  }

  const firmId = c.get('firmId');
  if (!firmId) {
    await next();
    return;
  }

  // Check if firm requires MFA
  const now = Date.now();
  let cached = mfaConfigCache.get(firmId);
  if (!cached || now > cached.expiresAt) {
    try {
      const [firm] = await db
        .select({ config: firms.config })
        .from(firms)
        .where(eq(firms.id, firmId))
        .limit(1);

      const cfg = (firm?.config as Record<string, unknown>) || {};
      const required = cfg.mfaRequired === true;
      cached = { required, expiresAt: now + MFA_CACHE_TTL };
      mfaConfigCache.set(firmId, cached);
    } catch {
      // If DB lookup fails, don't block — proceed without MFA check
      await next();
      return;
    }
  }

  if (!cached.required) {
    await next();
    return;
  }

  // BUG-15: Guard against auth middleware being bypassed — if userId isn't set,
  // the token hasn't been verified and we can't trust the JWT claims.
  const userId = c.get('userId');
  if (!userId) {
    logger.warn('MFA enforcement: auth middleware did not set userId — blocking');
    return c.json({ error: 'Authentication required' }, 401);
  }

  // MFA is required — check the Authorization header JWT claims
  // Clerk JWTs include `amr` (Authentication Methods References) claim
  // which lists authentication methods used. If MFA was completed,
  // it includes 'mfa' or 'totp' or 'sms'.
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.replace('Bearer ', '');
      // Decode JWT payload without verification (already verified by auth middleware)
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        const amr = payload.amr as string[] | undefined;
        const hasMfa = amr && (amr.includes('mfa') || amr.includes('totp') || amr.includes('sms'));

        if (hasMfa) {
          await next();
          return;
        }
      }
    } catch {
      // If JWT parsing fails, enforce MFA requirement
    }
  }

  logger.warn('MFA required but not verified', { firmId, clerkId });
  return c.json({
    error: 'MFA required',
    message: 'Your organization requires multi-factor authentication. Please enable MFA in your account settings.',
    code: 'MFA_REQUIRED',
  }, 403);
});
