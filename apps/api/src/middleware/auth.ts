import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { users } from '../db/schema';
import { eq, and } from 'drizzle-orm';

// Cache user lookups to avoid querying on every request
const userCache = new Map<string, { userId: string; firmId: string } | null>();

/**
 * Authentication middleware.
 * In production, validates JWT via Clerk and resolves the internal user.
 * In development, looks up the dev user from the database.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  // Dev mode: look up real dev user from database
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

  // Production: require and validate JWT
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing or invalid token' }, 401);
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

    if (rows.length === 0) {
      return c.json({ error: 'Unauthorized: User not found' }, 401);
    }

    // Cache and set context
    userCache.set(clerkId, { userId: rows[0].id, firmId: rows[0].firmId });
    c.set('userId', rows[0].id);
    c.set('clerkId', clerkId);
    c.set('firmId', rows[0].firmId);
    await next();
  } catch (error) {
    console.error('[Iron Gate Auth] Token verification failed:', error);
    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }
});
