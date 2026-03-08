import { Hono } from 'hono';
import { db } from '../db/client';
import { users, events, feedback, apiKeys } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const userDataRoutes = new Hono<AppEnv>();

/**
 * GET /v1/user/export — GDPR Article 20 data portability.
 * Returns all data associated with the authenticated user as JSON.
 * Accessible to any authenticated user (no RBAC restriction).
 */
userDataRoutes.get('/export', async (c) => {
  const userId = c.get('userId');
  const firmId = c.get('firmId');

  // Fetch user profile
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Fetch user's events (sensitivity scores, metadata — no raw PII)
  const userEvents = await db
    .select({
      id: events.id,
      aiToolId: events.aiToolId,
      sensitivityScore: events.sensitivityScore,
      sensitivityLevel: events.sensitivityLevel,
      action: events.action,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.firmId, firmId)))
    .limit(50000);

  // Fetch user's feedback submissions
  const userFeedback = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.userId, userId), eq(feedback.firmId, firmId)));

  // Fetch user's API keys (metadata only — never expose hashes)
  const userApiKeys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scope: apiKeys.scope,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.createdBy, userId), eq(apiKeys.firmId, firmId)));

  return c.json({
    exportedAt: new Date().toISOString(),
    format: 'iron-gate-gdpr-export-v1',
    user: user || null,
    events: userEvents,
    feedback: userFeedback,
    apiKeys: userApiKeys,
  });
});
