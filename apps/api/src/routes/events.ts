import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { events } from '../db/schema';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { appendEvent } from '../services/audit-chain';
import { recordCoOccurrences } from '../services/sensitivity-graph';
import { dispatch as webhookDispatch } from '../services/webhook-dispatcher';
import { forward as siemForward } from '../services/siem-forwarder';
import { analyzePatterns } from '../services/inference-engine';
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

async function minimizeEntities(entities: RawEntity[]): Promise<MinimizedEntity[]> {
  return Promise.all(
    entities.map(async (e) => ({
      type: e.type,
      textHash: await sha256(e.text),
      start: e.start,
      end: e.end,
      confidence: e.confidence,
      source: e.source,
      length: e.text.length,
    })),
  );
}

// Track event counts per firm for inference engine auto-trigger
const firmEventCounters = new Map<string, number>();
const INFERENCE_TRIGGER_THRESHOLD = 100;

export const eventsRoutes = new Hono<AppEnv>();

// Event validation schema
const eventSchema = z.object({
  aiToolId: z.string().min(1),
  aiToolUrl: z.string().optional(),
  promptHash: z.string().length(64),
  promptLength: z.number().int().min(0),
  sensitivityScore: z.number().min(0).max(100),
  sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']),
  entities: z.array(z.object({
    type: z.string().min(1).max(50),
    text: z.string().min(1),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    confidence: z.number().min(0).max(1),
    source: z.string().min(1).max(20),
  })).optional().default([]),
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

    // Fire-and-forget: record co-occurrences for sensitivity graph
    if (parsed.entities.length >= 2) {
      recordCoOccurrences(firmId, parsed.entities as any, parsed.sensitivityScore).catch(err => logger.warn('Failed to record co-occurrences', { error: err instanceof Error ? err.message : String(err) }));
    }

    // Fire-and-forget: webhook dispatch for high-risk events
    if (parsed.sensitivityScore >= 60) {
      webhookDispatch(firmId, 'high_risk_detected', {
        eventId: inserted.id,
        aiToolId: parsed.aiToolId,
        sensitivityScore: parsed.sensitivityScore,
        sensitivityLevel: parsed.sensitivityLevel,
        action: parsed.action,
        entityCount: parsed.entities.length,
      }).catch(err => logger.warn('Failed to dispatch webhook for high-risk event', { error: err instanceof Error ? err.message : String(err) }));
    }

    // Fire-and-forget: SIEM forwarding
    siemForward(firmId, {
      eventId: inserted.id,
      firmId,
      aiToolId: parsed.aiToolId,
      sensitivityScore: parsed.sensitivityScore,
      sensitivityLevel: parsed.sensitivityLevel,
      action: parsed.action,
      entityCount: parsed.entities.length,
      captureMethod: parsed.captureMethod,
      timestamp: new Date().toISOString(),
    }).catch(err => logger.warn('Failed to forward event to SIEM', { error: err instanceof Error ? err.message : String(err) }));

    // Fire-and-forget: inference engine auto-trigger every N events
    triggerInferenceIfNeeded(firmId);

    return c.json({
      eventId: inserted.id,
      actionRequired: 'pass' as const,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
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

    // Insert each event via audit chain (sequential for chain integrity)
    const results = [];
    for (const event of parsed.events) {
      // Data minimization: strip raw PII text, store only hashes + lengths
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
      results.push(inserted);
    }

    // Fire-and-forget: co-occurrences, webhooks, SIEM for batch
    for (let i = 0; i < results.length; i++) {
      const event = parsed.events[i];
      const inserted = results[i];

      if (event.entities.length >= 2) {
        recordCoOccurrences(firmId, event.entities as any, event.sensitivityScore).catch(err => logger.warn('Failed to record batch co-occurrences', { error: err instanceof Error ? err.message : String(err) }));
      }
      if (event.sensitivityScore >= 60) {
        webhookDispatch(firmId, 'high_risk_detected', {
          eventId: inserted.id,
          aiToolId: event.aiToolId,
          sensitivityScore: event.sensitivityScore,
          sensitivityLevel: event.sensitivityLevel,
          action: event.action,
          entityCount: event.entities.length,
        }).catch(err => logger.warn('Failed to dispatch webhook for batch high-risk event', { error: err instanceof Error ? err.message : String(err) }));
      }
      siemForward(firmId, {
        eventId: inserted.id,
        firmId,
        aiToolId: event.aiToolId,
        sensitivityScore: event.sensitivityScore,
        sensitivityLevel: event.sensitivityLevel,
        action: event.action,
        entityCount: event.entities.length,
        captureMethod: event.captureMethod,
        timestamp: new Date().toISOString(),
      }).catch(err => logger.warn('Failed to forward batch event to SIEM', { error: err instanceof Error ? err.message : String(err) }));
    }

    // Trigger inference engine for batch events (same as single-event path)
    triggerInferenceIfNeeded(firmId);

    return c.json({
      batchId: parsed.batchId,
      eventIds: results.map((r) => r.id),
      count: results.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
    }
    throw error;
  }
});

// GET /v1/events — List events with pagination and filters
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

  const results = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
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

// GET /v1/events/:id — Single event
eventsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const firmId = c.get('firmId');

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.firmId, firmId)))
    .limit(1);

  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }

  return c.json(event);
});

// ---------------------------------------------------------------------------
// Inference Engine Auto-Trigger
// ---------------------------------------------------------------------------

function triggerInferenceIfNeeded(firmId: string): void {
  const count = (firmEventCounters.get(firmId) || 0) + 1;
  firmEventCounters.set(firmId, count);

  if (count >= INFERENCE_TRIGGER_THRESHOLD) {
    firmEventCounters.set(firmId, 0);
    analyzePatterns(firmId).catch((err) =>
      logger.warn('Inference engine auto-trigger failed', { error: err instanceof Error ? err.message : String(err) }),
    );
  }
}
