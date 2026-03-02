import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { users, firms, apiKeys } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// TTL Cache — entries auto-expire to prevent stale auth data
// ---------------------------------------------------------------------------

const MAX_CACHE_ENTRIES = 5_000;

class TTLMap<K, V> {
  private map = new Map<K, { value: V; expiresAt: number }>();
  constructor(private ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    // Evict expired entries if map grows too large
    if (this.map.size >= MAX_CACHE_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.map) {
        if (now > v.expiresAt) this.map.delete(k);
      }
      // If still too large after expiry sweep, drop oldest 20%
      if (this.map.size >= MAX_CACHE_ENTRIES) {
        const keys = Array.from(this.map.keys());
        const toDelete = Math.floor(keys.length * 0.2);
        for (let i = 0; i < toDelete; i++) this.map.delete(keys[i]);
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }
}

const USER_CACHE_TTL = 5 * 60_000;  // 5 minutes
const API_KEY_CACHE_TTL = 5 * 60_000;  // 5 minutes

// Cache user lookups with TTL to avoid querying on every request
const userCache = new TTLMap<string, { userId: string; firmId: string; role: string } | null>(USER_CACHE_TTL);
// Cache API key lookups (hash → { firmId, userId, role }) with TTL
const apiKeyCache = new TTLMap<string, { firmId: string; userId: string; role: string }>(API_KEY_CACHE_TTL);

/** Invalidate a cached user so the next request re-fetches from DB. */
export function invalidateUserCache(clerkId: string) {
  userCache.delete(clerkId);
}

/** Invalidate a cached API key so the next request re-fetches from DB. */
export function invalidateApiKeyCache(keyHash: string) {
  apiKeyCache.delete(keyHash);
}

/**
 * Authentication middleware.
 * Supports three auth methods (checked in order):
 * 1. API Key (X-API-Key header) — for Chrome extension and programmatic access
 * 2. JWT Bearer token (Clerk) — for dashboard
 * 3. Dev mode fallback — auto-resolves to dev user (requires explicit IRON_GATE_DEV_AUTH=true)
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
      c.set('userRole', (cached.role as 'admin' | 'user') || 'user');
      db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.keyHash, keyHash)).catch(err => logger.warn('Failed to update API key lastUsedAt (cached path)', { error: err instanceof Error ? err.message : String(err) }));
      await next();
      return;
    }

    // Look up API key in database (wrapped in try-catch for resilience —
    // if the api_keys table doesn't exist yet, fall through to other auth methods)
    try {
      const [keyRecord] = await db
        .select({
          id: apiKeys.id,
          firmId: apiKeys.firmId,
          createdBy: apiKeys.createdBy,
          revokedAt: apiKeys.revokedAt,
          expiresAt: apiKeys.expiresAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
        .limit(1);

      if (keyRecord) {
        // Check if key has expired
        if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
          return c.json({ error: 'Unauthorized: API key has expired' }, 401);
        }

        // Look up the creating user's role
        const [creator] = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, keyRecord.createdBy))
          .limit(1);
        const role = creator?.role || 'user';

        apiKeyCache.set(keyHash, { firmId: keyRecord.firmId, userId: keyRecord.createdBy, role });
        c.set('userId', keyRecord.createdBy);
        c.set('clerkId', 'api-key');
        c.set('firmId', keyRecord.firmId);
        c.set('userRole', (role as 'admin' | 'user') || 'user');
        db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyRecord.id)).catch(err => logger.warn('Failed to update API key lastUsedAt', { error: err instanceof Error ? err.message : String(err) }));
        await next();
        return;
      }

      // In dev mode, fall through to dev auth instead of rejecting
      if (process.env.NODE_ENV === 'development' && process.env.IRON_GATE_DEV_AUTH === 'true') {
        logger.warn('API key not found in DB, falling through to dev auth');
      } else {
        return c.json({ error: 'Unauthorized: Invalid API key' }, 401);
      }
    } catch (dbError) {
      // Database error (e.g., api_keys table doesn't exist) — log and fall through
      // to dev auth or JWT auth instead of crashing with 500
      logger.warn('API key lookup failed (DB error), falling through to other auth methods', {
        error: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }
  }

  // ── Dev Mode (requires explicit opt-in via IRON_GATE_DEV_AUTH=true) ────
  if (process.env.NODE_ENV === 'development' && process.env.IRON_GATE_DEV_AUTH === 'true') {
    const cached = userCache.get('dev-clerk-id');
    if (cached) {
      c.set('userId', cached.userId);
      c.set('clerkId', 'dev-clerk-id');
      c.set('firmId', cached.firmId);
      c.set('userRole', (cached.role as 'admin' | 'user') || 'admin');
      await next();
      return;
    }

    try {
      const rows = await db
        .select({ id: users.id, clerkId: users.clerkId, firmId: users.firmId, role: users.role })
        .from(users)
        .where(eq(users.clerkId, 'dev-clerk-id'))
        .limit(1);

      if (rows.length > 0) {
        userCache.set('dev-clerk-id', { userId: rows[0].id, firmId: rows[0].firmId, role: rows[0].role || 'admin' });
        c.set('userId', rows[0].id);
        c.set('clerkId', 'dev-clerk-id');
        c.set('firmId', rows[0].firmId);
        c.set('userRole', (rows[0].role as 'admin' | 'user') || 'admin');
        await next();
        return;
      }
    } catch (dbError) {
      logger.warn('Dev auth user lookup failed (DB error), using fallback dev identity', {
        error: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }

    // Fallback: no DB user found or DB error — use hardcoded dev identity
    c.set('userId', 'dev-user-id');
    c.set('clerkId', 'dev-clerk-id');
    c.set('firmId', process.env.DEFAULT_FIRM_ID || 'dev-firm-id');
    c.set('userRole', 'admin');
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
      c.set('userRole', (cached.role as 'admin' | 'user') || 'user');
      await next();
      return;
    }

    // Look up internal user by Clerk ID
    const rows = await db
      .select({ id: users.id, firmId: users.firmId, role: users.role })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (rows.length > 0) {
      // Existing user — cache and proceed
      userCache.set(clerkId, { userId: rows[0].id, firmId: rows[0].firmId, role: rows[0].role || 'user' });
      c.set('userId', rows[0].id);
      c.set('clerkId', clerkId);
      c.set('firmId', rows[0].firmId);
      c.set('userRole', (rows[0].role as 'admin' | 'user') || 'user');
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
      logger.error('DEFAULT_FIRM_ID not set — cannot auto-provision user');
      return c.json({ error: 'Server configuration error' }, 500);
    }

    // Create user record (ON CONFLICT handles race condition if two requests
    // arrive simultaneously for the same new Clerk user)
    const [newUser] = await db
      .insert(users)
      .values({
        clerkId,
        firmId: defaultFirmId,
        email,
        displayName: email.split('@')[0],
        role: 'user',
      })
      .onConflictDoUpdate({
        target: users.clerkId,
        set: { email }, // no-op update to return the existing row
      })
      .returning({ id: users.id, firmId: users.firmId });

    logger.info('Auto-provisioned user', { userId: newUser.id, clerkId });

    userCache.set(clerkId, { userId: newUser.id, firmId: newUser.firmId, role: 'user' });
    c.set('userId', newUser.id);
    c.set('clerkId', clerkId);
    c.set('firmId', newUser.firmId);
    c.set('userRole', 'user');
    await next();
  } catch (error) {
    logger.error('Token verification failed', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }
});
