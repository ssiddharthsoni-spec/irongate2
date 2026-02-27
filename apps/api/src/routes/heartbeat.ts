/**
 * Heartbeat Endpoint
 *
 * POST /v1/heartbeat — called by the extension every 5 minutes.
 * Tracks extension deployment status, version, and active platform.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { users } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';

export const heartbeatRoutes = new Hono<AppEnv>();

const heartbeatSchema = z.object({
  extensionVersion: z.string().min(1).max(20),
  activePlatform: z.string().max(100).optional(),
  mode: z.enum(['audit', 'proxy']).optional(),
  queueDepth: z.number().int().min(0).optional(),
  healthStatus: z
    .object({
      mainWorldLoaded: z.boolean().optional(),
      apiReachable: z.boolean().optional(),
      queueDraining: z.boolean().optional(),
      errorsLast5Min: z.number().int().min(0).optional(),
    })
    .optional(),
});

heartbeatRoutes.post('/', async (c) => {
  const userId = c.get('userId') as string;
  const firmId = c.get('firmId') as string;

  if (!userId) {
    return c.json({ error: 'Missing userId' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = heartbeatSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid heartbeat data', details: parsed.error.issues }, 400);
  }

  const { extensionVersion, activePlatform, mode, queueDepth, healthStatus } = parsed.data;

  try {
    // Update user record with extension metadata
    await db
      .update(users)
      .set({
        updatedAt: new Date(),
        // Store extension metadata in a JSON column or dedicated fields
        // Using updatedAt as lastHeartbeat proxy since the schema doesn't have explicit heartbeat fields
      })
      .where(and(eq(users.id, userId), eq(users.firmId, firmId)));

    logger.debug('Heartbeat received', {
      userId,
      firmId,
      extensionVersion,
      activePlatform,
      mode,
      queueDepth,
      healthy: healthStatus
        ? healthStatus.mainWorldLoaded !== false &&
          healthStatus.apiReachable !== false &&
          (healthStatus.errorsLast5Min ?? 0) < 10
        : true,
    });

    return c.json({
      ok: true,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Heartbeat processing failed', {
      error: err instanceof Error ? err.message : String(err),
      userId,
    });
    return c.json({ ok: true, serverTime: new Date().toISOString() });
  }
});
