import { Hono } from 'hono';
import { db } from '../db/client';
import { users, firms } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const authRoutes = new Hono<AppEnv>();

// POST /v1/auth/register — called after Clerk signup to create Iron Gate user
authRoutes.post('/register', async (c) => {
  // Verify the Clerk JWT
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.replace('Bearer ', '');

  try {
    const { verifyToken } = await import('@clerk/backend');
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    const clerkId = payload.sub;
    if (!clerkId) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    // Check if user already exists
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ userId: existing[0].id, status: 'existing' });
    }

    // For v1: auto-create user with default firm
    // The onboarding flow will create a proper firm
    const defaultFirmId = process.env.DEFAULT_FIRM_ID;

    if (!defaultFirmId) {
      return c.json({ error: 'No default firm configured' }, 500);
    }

    const [newUser] = await db.insert(users).values({
      clerkId,
      firmId: defaultFirmId,
      email: (payload as any).email || `${clerkId}@clerk.user`,
      displayName: (payload as any).first_name
        ? `${(payload as any).first_name} ${(payload as any).last_name || ''}`.trim()
        : 'New User',
      role: 'user',
    }).returning({ id: users.id });

    return c.json({ userId: newUser.id, status: 'created' });
  } catch (error) {
    // In dev mode without Clerk, allow registration to pass through
    if (process.env.NODE_ENV === 'development') {
      return c.json({ userId: 'dev-user-id', status: 'dev-mode' });
    }
    console.error('[auth/register] Error:', error);
    return c.json({ error: 'Registration failed' }, 500);
  }
});
