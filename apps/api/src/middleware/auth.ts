import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

// Cache dev user ID so we don't query on every request
let devUserId: string | null = null;

/**
 * Authentication middleware.
 * In production, validates JWT via Clerk.
 * In development, looks up the first user in the database.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  // Dev mode: look up real dev user from database
  if (process.env.NODE_ENV === 'development') {
    if (!devUserId) {
      const rows = await db
        .select({ id: users.id, clerkId: users.clerkId })
        .from(users)
        .where(eq(users.clerkId, 'dev-clerk-id'))
        .limit(1);
      if (rows.length > 0) {
        devUserId = rows[0].id;
      }
    }
    c.set('userId', devUserId || 'dev-user-id');
    c.set('clerkId', 'dev-clerk-id');
    await next();
    return;
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing or invalid token' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    // In production, verify with Clerk
    // const { verifyToken } = await import('@clerk/backend');
    // const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    // c.set('userId', payload.sub);
    // c.set('clerkId', payload.sub);

    // Placeholder for development
    c.set('userId', devUserId || 'dev-user-id');
    c.set('clerkId', token);
    await next();
  } catch (error) {
    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }
});
