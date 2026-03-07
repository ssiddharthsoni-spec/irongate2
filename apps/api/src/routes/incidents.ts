import { Hono } from 'hono';
import { z } from 'zod';
import { generateNarrative } from '../services/incident-narratives';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';

export const incidentRoutes = new Hono<AppEnv>();

// GET /v1/incidents/:id/narrative — Generate and return an incident narrative
incidentRoutes.get('/:id/narrative', async (c) => {
  const eventId = c.req.param('id');
  const firmId = c.get('firmId');

  // Validate UUID format
  const uuidSchema = z.string().uuid();
  const parsed = uuidSchema.safeParse(eventId);
  if (!parsed.success) {
    return c.json({ error: 'Invalid event ID format — must be a valid UUID' }, 400);
  }

  try {
    const narrative = await generateNarrative(eventId, firmId);
    return c.json(narrative);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('not found')) {
      return c.json({ error: message }, 404);
    }

    if (message.includes('threshold')) {
      return c.json({ error: message }, 422);
    }

    logger.error('Failed to generate incident narrative', {
      eventId,
      firmId,
      error: message,
    });
    throw err;
  }
});
