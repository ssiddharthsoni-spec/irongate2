import { Hono } from 'hono';
import { z } from 'zod';
import { db, dbRead } from '../db/client';
import { events } from '../db/schema';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { appendEvent } from '../services/audit-chain';
import { enqueueCoOccurrences, enqueueWebhook, enqueueSIEM } from '../jobs/enqueue';
import { triggerInferenceDistributed } from '../services/inference-trigger';
import { sha256 } from '@iron-gate/crypto';
import type { AppEnv } from '../types';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Data Minimization: strip raw PII text from entities before storage.
// Store only a one-way hash + length so Iron Gate can prove it found
// sensitive data without ever being able to reconstruct it.
// ---------------------------------------------------------------------------

interface RawEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: string;
}

interface MinimizedEntity {
  type: string;
  textHash: string;
  start: number;
  end: number;
  confidence: number;
  source: string;
  length: number;
}

/** Check if an entity is already minimized (has textHash, no raw text) */
function isMinimized(e: any): e is MinimizedEntity {
  return typeof e.textHash === 'string' && !('text' in e);
}

/**
 * Ensure all entities are minimized. Pre-minimized entities (from new clients)
 * pass through unchanged. Raw entities (from legacy clients) get hashed server-side.
 */
async function minimizeEntities(entities: any[]): Promise<MinimizedEntity[]> {
  return Promise.all(
    entities.map(async (e) => {
      if (isMinimized(e)) return e;
      return {
        type: e.type,
        textHash: await sha256(e.text),
        start: e.start,
        end: e.end,
        confidence: e.confidence,
        source: e.source,
        length: e.text.length,
      };
    }),
  );
}

export const eventsRoutes = new Hono<AppEnv>();

// Entity schema: accepts either pre-minimized (textHash+length) or raw (text) format.
// New clients send pre-minimized entities — raw PII never leaves the browser.
// Legacy clients may still send raw text — server-side minimization handles those.
const minimizedEntitySchema = z.object({
  type: z.string().min(1).max(50),
  textHash: z.string().length(64),
  length: z.number().int().min(0),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  source: z.string().min(1).max(20),
});

const rawEntitySchema = z.object({
  type: z.string().min(1).max(50),
  text: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  source: z.string().min(1).max(20),
});

const entitySchema = z.union([minimizedEntitySchema, rawEntitySchema]);

// Event validation schema
const eventSchema = z.object({
  aiToolId: z.string().min(1),
  aiToolUrl: z.string().optional(),
  promptHash: z.string().length(64),
  promptLength: z.number().int().min(0),
  sensitivityScore: z.number().min(0).max(100),
  sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']),
  entities: z.array(entitySchema).max(100).optional().default([]),
  action: z.enum(['pass', 'warn', 'block', 'proxy', 'override']),
  overrideReason: z.string().optional(),
  captureMethod: z.string().min(1).max(20),
  sessionId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(100),
  batchId: z.string(),
});

// POST /v1/events — Single event ingestion
eventsRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = eventSchema.parse(body);
    const firmId = c.get('firmId');
    const userId = c.get('userId');

    // Data minimization: strip raw PII text, store only hashes + lengths
    const minimizedEntities = await minimizeEntities(parsed.entities as RawEntity[]);

    // Insert via audit chain for cryptographic trail
    const inserted = await appendEvent({
      firmId,
      userId,
      aiToolId: parsed.aiToolId,
      aiToolUrl: parsed.aiToolUrl,
      promptHash: parsed.promptHash,
      promptLength: parsed.promptLength,
      sensitivityScore: parsed.sensitivityScore,
      sensitivityLevel: parsed.sensitivityLevel,
      entities: minimizedEntities,
      action: parsed.action,
      overrideReason: parsed.overrideReason,
      captureMethod: parsed.captureMethod,
      sessionId: parsed.sessionId,
      metadata: parsed.metadata || {},
    });

    // Enqueue background work via BullMQ (falls back to fire-and-forget if Redis unavailable)
    if (parsed.entities.length >= 2) {
      enqueueCoOccurrences({ firmId, entities: parsed.entities, sensitivityScore: parsed.sensitivityScore }).catch((err) =>
        logger.warn('Failed to enqueue co-occurrences', { error: err instanceof Error ? err.message : String(err) }),
      );
    }

    if (parsed.sensitivityScore >= 60) {
      enqueueWebhook({
        firmId,
        eventType: 'high_risk_detected',
        payload: {
          eventId: inserted.id,
          aiToolId: parsed.aiToolId,
          sensitivityScore: parsed.sensitivityScore,
          sensitivityLevel: parsed.sensitivityLevel,
          action: parsed.action,
          entityCount: parsed.entities.length,
        },
      }).catch((err) =>
        logger.warn('Failed to enqueue webhook', { error: err instanceof Error ? err.message : String(err) }),
      );
    }

    enqueueSIEM({
      firmId,
      event: {
        eventId: inserted.id,
        firmId,
        aiToolId: parsed.aiToolId,
        sensitivityScore: parsed.sensitivityScore,
        sensitivityLevel: parsed.sensitivityLevel,
        action: parsed.action,
        entityCount: parsed.entities.length,
        captureMethod: parsed.captureMethod,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) =>
      logger.warn('Failed to enqueue SIEM forward', { error: err instanceof Error ? err.message : String(err) }),
    );

    // Distributed inference trigger (Redis INCR counter, threshold = 100)
    triggerInferenceDistributed(firmId);

    return c.json({
      eventId: inserted.id,
      actionRequired: parsed.action,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
    }
    if ((error as any)?.retryExhausted) {
      c.header('Retry-After', '1');
      return c.json({ error: 'Service temporarily unavailable — high contention, retry shortly' }, 503);
    }
    throw error;
  }
});

// POST /v1/events/batch — Batch event ingestion
eventsRoutes.post('/batch', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = batchSchema.parse(body);
    const firmId = c.get('firmId');
    const userId = c.get('userId');

    // Insert each event via audit chain (sequential for chain integrity).
    // Partial failure returns succeeded + failed arrays so the client
    // knows exactly which events were committed.
    const succeeded: { id: string; eventHash: string; chainPosition: number; index: number }[] = [];
    const failed: { index: number; error: string }[] = [];

    for (let i = 0; i < parsed.events.length; i++) {
      const event = parsed.events[i];
      try {
        const minimizedEntities = await minimizeEntities(event.entities as RawEntity[]);

        const inserted = await appendEvent({
          firmId,
          userId,
          aiToolId: event.aiToolId,
          aiToolUrl: event.aiToolUrl,
          promptHash: event.promptHash,
          promptLength: event.promptLength,
          sensitivityScore: event.sensitivityScore,
          sensitivityLevel: event.sensitivityLevel as any,
          entities: minimizedEntities,
          action: event.action as any,
          overrideReason: event.overrideReason,
          captureMethod: event.captureMethod,
          sessionId: event.sessionId,
          metadata: event.metadata || {},
        });
        succeeded.push({ ...inserted, index: i });
      } catch (err) {
        logger.warn('Batch event insert failed', {
          batchId: parsed.batchId,
          index: i,
          error: err instanceof Error ? err.message : String(err),
        });
        failed.push({ index: i, error: err instanceof Error ? err.message : 'Insert failed' });
      }
    }

    // Enqueue background work for successfully inserted events
    for (const item of succeeded) {
      const event = parsed.events[item.index];

      if (event.entities.length >= 2) {
        enqueueCoOccurrences({ firmId, entities: event.entities, sensitivityScore: event.sensitivityScore }).catch((err) =>
          logger.warn('Failed to enqueue batch co-occurrences', { error: err instanceof Error ? err.message : String(err) }),
        );
      }
      if (event.sensitivityScore >= 60) {
        enqueueWebhook({
          firmId,
          eventType: 'high_risk_detected',
          payload: {
            eventId: item.id,
            aiToolId: event.aiToolId,
            sensitivityScore: event.sensitivityScore,
            sensitivityLevel: event.sensitivityLevel,
            action: event.action,
            entityCount: event.entities.length,
          },
        }).catch((err) =>
          logger.warn('Failed to enqueue batch webhook', { error: err instanceof Error ? err.message : String(err) }),
        );
      }
      enqueueSIEM({
        firmId,
        event: {
          eventId: item.id,
          firmId,
          aiToolId: event.aiToolId,
          sensitivityScore: event.sensitivityScore,
          sensitivityLevel: event.sensitivityLevel,
          action: event.action,
          entityCount: event.entities.length,
          captureMethod: event.captureMethod,
          timestamp: new Date().toISOString(),
        },
      }).catch((err) =>
        logger.warn('Failed to enqueue batch SIEM forward', { error: err instanceof Error ? err.message : String(err) }),
      );
    }

    // Distributed inference trigger for batch
    if (succeeded.length > 0) {
      triggerInferenceDistributed(firmId);
    }

    const statusCode = failed.length === 0 ? 200 : succeeded.length > 0 ? 207 : 500;

    return c.json({
      batchId: parsed.batchId,
      eventIds: succeeded.map((r) => r.id),
      count: succeeded.length,
      ...(failed.length > 0 && { failed }),
    }, statusCode);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
    }
    throw error;
  }
});

// GET /v1/events — List events with pagination and filters (uses read replica)
eventsRoutes.get('/', async (c) => {
  const firmId = c.get('firmId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const minScore = c.req.query('minScore');
  const aiToolId = c.req.query('aiToolId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const conditions = [eq(events.firmId, firmId)];

  if (minScore) {
    conditions.push(gte(events.sensitivityScore, parseFloat(minScore)));
  }
  if (aiToolId) {
    conditions.push(eq(events.aiToolId, aiToolId));
  }
  if (startDate) {
    conditions.push(gte(events.createdAt, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(events.createdAt, new Date(endDate)));
  }

  const results = await dbRead
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await dbRead
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(...conditions));

  return c.json({
    events: results,
    total: Number(countResult?.count || 0),
    limit,
    offset,
  });
});

// GET /v1/events/:id — Single event (uses read replica)
eventsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const firmId = c.get('firmId');

  const [event] = await dbRead
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.firmId, firmId)))
    .limit(1);

  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }

  return c.json(event);
});
