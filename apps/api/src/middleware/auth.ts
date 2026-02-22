import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { users, firms, apiKeys } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';

// Cache user lookups to avoid querying on every request
const userCache = new Map<string, { userId: string; firmId: string } | null>();
// Cache API key lookups (hash → { firmId, userId })
const apiKeyCache = new Map<string, { firmId: string; userId: string }>();

/** Invalidate a cached user so the next request re-fetches from DB. */
export function invalidateUserCache(clerkId: string) {
  userCache.delete(clerkId);
}

/**
 * Authentication middleware.
 * Supports three auth methods (checked in order):
 * 1. API Key (X-API-Key header) — for Chrome extension and programmatic access
 * 2. JWT Bearer token (Clerk) — for dashboard
 * 3. Dev mode fallback — auto-resolves to dev user
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  // ── API Key Authentication ──────────────────────────────────────────────
  const apiKeyHeader = c.req.header('X-API-Key');
  if (apiKeyHeader) {
    const keyHash = crypto.createHash('sha256').update(apiKeyHeader).digest('hex');

    // Check cache first
    const cached = apiKeyCache.get(keyHash);
    if (cached) {
      c.set('userId', cached.userId);
      c.set('clerkId', 'api-key');
      c.set('firmId', cached.firmId);
      db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.keyHash, keyHash)).catch(() => {});
      await next();
      return;
    }

    // Look up API key in database
    const [keyRecord] = await db
      .select({
        id: apiKeys.id,
        firmId: apiKeys.firmId,
        createdBy: apiKeys.createdBy,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);

    if (keyRecord) {
      apiKeyCache.set(keyHash, { firmId: keyRecord.firmId, userId: keyRecord.createdBy });
      c.set('userId', keyRecord.createdBy);
      c.set('clerkId', 'api-key');
      c.set('firmId', keyRecord.firmId);
      db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyRecord.id)).catch(() => {});
      await next();
      return;
    }

    return c.json({ error: 'Unauthorized: Invalid API key' }, 401);
  }

  // ── Dev Mode ────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'development') {
    const cached = userCache.get('dev-clerk-id');
    if (cached) {
      c.set('userId', cached.userId);
      c.set('clerkId', 'dev-clerk-id');
      c.set('firmId', cached.firmId);
      await next();
      return;
    }

    const rows = await db
      .select({ id: users.id, clerkId: users.clerkId, firmId: users.firmId })
      .from(users)
      .where(eq(users.clerkId, 'dev-clerk-id'))
      .limit(1);

    if (rows.length > 0) {
      userCache.set('dev-clerk-id', { userId: rows[0].id, firmId: rows[0].firmId });
      c.set('userId', rows[0].id);
      c.set('clerkId', 'dev-clerk-id');
      c.set('firmId', rows[0].firmId);
    } else {
      c.set('userId', 'dev-user-id');
      c.set('clerkId', 'dev-clerk-id');
      c.set('firmId', process.env.DEFAULT_FIRM_ID || 'dev-firm-id');
    }
    await next();
    return;
  }

  // ── JWT Bearer Token (Clerk) ────────────────────────────────────────────
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Provide Authorization: Bearer <jwt> or X-API-Key: <key>' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    // Verify JWT with Clerk
    const { verifyToken } = await import('@clerk/backend');
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    const clerkId = payload.sub;
    if (!clerkId) {
      return c.json({ error: 'Unauthorized: Invalid token claims' }, 401);
    }

    // Check cache for this Clerk user
    const cached = userCache.get(clerkId);
    if (cached) {
      c.set('userId', cached.userId);
      c.set('clerkId', clerkId);
      c.set('firmId', cached.firmId);
      await next();
      return;
    }

    // Look up internal user by Clerk ID
    const rows = await db
      .select({ id: users.id, firmId: users.firmId })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (rows.length > 0) {
      // Existing user — cache and proceed
      userCache.set(clerkId, { userId: rows[0].id, firmId: rows[0].firmId });
      c.set('userId', rows[0].id);
      c.set('clerkId', clerkId);
      c.set('firmId', rows[0].firmId);
      await next();
      return;
    }

    // --- Auto-provision new Clerk user ---
    // Extract email from JWT claims (Clerk includes it in the token)
    const email = (payload as any).email
      || (payload as any).email_addresses?.[0]?.email_address
      || `${clerkId}@irongate.app`;

    // Assign to default firm (user will create their own during onboarding)
    const defaultFirmId = process.env.DEFAULT_FIRM_ID;
    if (!defaultFirmId) {
      console.error('[Iron Gate Auth] DEFAULT_FIRM_ID not set — cannot auto-provision user');
      return c.json({ error: 'Server configuration error' }, 500);
    }

    // Create user record
    const [newUser] = await db
      .insert(users)
      .values({
        clerkId,
        firmId: defaultFirmId,
        email,
        displayName: email.split('@')[0],
        role: 'admin',
      })
      .returning({ id: users.id, firmId: users.firmId });

    console.log(`[Iron Gate Auth] Auto-provisioned user ${newUser.id} for Clerk ID ${clerkId}`);

    userCache.set(clerkId, { userId: newUser.id, firmId: newUser.firmId });
    c.set('userId', newUser.id);
    c.set('clerkId', clerkId);
    c.set('firmId', newUser.firmId);
    await next();
  } catch (error) {
    console.error('[Iron Gate Auth] Token verification failed:', error);
    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }
});
