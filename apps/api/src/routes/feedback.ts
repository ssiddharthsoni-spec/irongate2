import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { feedback, events } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';

export const feedbackRoutes = new Hono<AppEnv>();

// POST /v1/feedback — Submit entity feedback
feedbackRoutes.post('/', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  const feedbackSchema = z.object({
    eventId: z.string().uuid().optional(),
    entityType: z.string(),
    entityHash: z.string().optional(),
    entityText: z.string().optional(),
    isCorrect: z.boolean(),
    correctedType: z.string().optional(),
    feedbackType: z.enum(['correct', 'not_pii', 'wrong_type', 'partial_match']).optional(),
  });

  const parsed = feedbackSchema.parse(body);

  // SECURITY: Validate eventId belongs to the same firm to prevent cross-firm data injection.
  // Without this check, a user in Firm A could submit feedback referencing events from Firm B,
  // poisoning Firm B's detection accuracy metrics and weight overrides.
  if (parsed.eventId) {
    const [event] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, parsed.eventId), eq(events.firmId, firmId)))
      .limit(1);

    if (!event) {
      logger.warn('Cross-firm feedback attempt blocked', { userId, firmId, eventId: parsed.eventId });
      return c.json({ error: 'Event not found' }, 404);
    }
  }

  // Generate entityHash from entityText if not provided (hash PII server-side)
  let entityHash = parsed.entityHash || '';
  if (!entityHash && parsed.entityText) {
    const data = new TextEncoder().encode(parsed.entityText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    entityHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  if (!entityHash) {
    entityHash = 'unknown';
  }

  const eventId = parsed.eventId ?? null;

  const [inserted] = await db.insert(feedback).values({
    eventId,
    firmId,
    userId,
    entityType: parsed.entityType,
    entityHash,
    isCorrect: parsed.isCorrect,
    correctedType: parsed.correctedType,
  }).returning({ id: feedback.id });

  return c.json({ feedbackId: inserted.id });
});

// GET /v1/feedback/stats — Feedback statistics for admin
feedbackRoutes.get('/stats', async (c) => {
  const firmId = c.get('firmId');

  const [stats] = await db
    .select({
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
      incorrect: sql<number>`count(*) filter (where ${feedback.isCorrect} = false)`,
    })
    .from(feedback)
    .where(eq(feedback.firmId, firmId));

  const byType = await db
    .select({
      entityType: feedback.entityType,
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
      incorrect: sql<number>`count(*) filter (where ${feedback.isCorrect} = false)`,
    })
    .from(feedback)
    .where(eq(feedback.firmId, firmId))
    .groupBy(feedback.entityType);

  const total = Number(stats?.total || 0);
  const correct = Number(stats?.correct || 0);

  return c.json({
    totalFeedback: total,
    accuracyRate: total > 0 ? Math.round((correct / total) * 100) : 0,
    byEntityType: byType.map((t) => ({
      entityType: t.entityType,
      total: Number(t.total),
      correct: Number(t.correct),
      incorrect: Number(t.incorrect),
      accuracy: Number(t.total) > 0
        ? Math.round((Number(t.correct) / Number(t.total)) * 100)
        : 0,
    })),
  });
});

// GET /v1/feedback/accuracy — Detection accuracy by entity type (for dashboard chart)
feedbackRoutes.get('/accuracy', async (c) => {
  const firmId = c.get('firmId');

  const byType = await db
    .select({
      entityType: feedback.entityType,
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
      incorrect: sql<number>`count(*) filter (where ${feedback.isCorrect} = false)`,
    })
    .from(feedback)
    .where(eq(feedback.firmId, firmId))
    .groupBy(feedback.entityType);

  const accuracy = byType.map((t) => {
    const total = Number(t.total);
    const correct = Number(t.correct);
    const rate = total > 0 ? Math.round((correct / total) * 100) : 100;
    return {
      entityType: t.entityType,
      total,
      correct,
      incorrect: Number(t.incorrect),
      accuracyRate: rate,
      flagged: rate < 70, // Flag types below 70% accuracy for review
    };
  });

  return c.json({
    accuracy: accuracy.sort((a, b) => a.accuracyRate - b.accuracyRate),
    flaggedTypes: accuracy.filter((a) => a.flagged).map((a) => a.entityType),
  });
});

// GET /v1/feedback/rules — Computed suppression rules from feedback data (Priority 5.4)
feedbackRoutes.get('/rules', async (c) => {
  const firmId = c.get('firmId');

  const byType = await db
    .select({
      entityType: feedback.entityType,
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
      incorrect: sql<number>`count(*) filter (where ${feedback.isCorrect} = false)`,
    })
    .from(feedback)
    .where(eq(feedback.firmId, firmId))
    .groupBy(feedback.entityType);

  const rules: Array<{
    entityType: string;
    rule: string;
    description: string;
    confidence: number;
  }> = [];

  for (const t of byType) {
    const total = Number(t.total);
    const incorrect = Number(t.incorrect);
    if (total < 10) continue; // Need minimum sample size

    const falsePositiveRate = incorrect / total;

    // Rule: If 80%+ of a type's detections are false positives, suppress short matches
    if (falsePositiveRate >= 0.8) {
      rules.push({
        entityType: t.entityType,
        rule: 'suppress_short',
        description: `Suppress ${t.entityType} detections under 4 characters (${Math.round(falsePositiveRate * 100)}% false positive rate)`,
        confidence: falsePositiveRate,
      });
    }

    // Rule: If 60%+ false positive rate, reduce confidence by 50%
    if (falsePositiveRate >= 0.6) {
      rules.push({
        entityType: t.entityType,
        rule: 'reduce_confidence',
        description: `Reduce ${t.entityType} confidence by 50% (${Math.round(falsePositiveRate * 100)}% false positive rate)`,
        confidence: falsePositiveRate,
      });
    }
  }

  return c.json({ rules, generatedAt: new Date().toISOString() });
});

// POST /v1/feedback/override — Capture user override of a sensitivity decision
// When a user overrides a block/warn decision (e.g., "Allow anyway"), we record
// the original score, the override action, and the zone for federated learning.
feedbackRoutes.post('/override', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  const overrideSchema = z.object({
    eventId: z.string().uuid().optional(),
    originalScore: z.number().min(0).max(100),
    originalLevel: z.enum(['low', 'medium', 'high', 'critical']),
    originalZone: z.enum(['green', 'amber', 'red']),
    overrideAction: z.enum(['allow', 'block', 'escalate']),
    reason: z.string().max(500).optional(),
    entityTypeCounts: z.record(z.string(), z.number()).optional(),
    tiersConsulted: z.array(z.number()).optional(),
  });

  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
  }

  // Validate eventId belongs to same firm
  if (parsed.data.eventId) {
    const [event] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, parsed.data.eventId), eq(events.firmId, firmId)))
      .limit(1);

    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
  }

  // Store as feedback with override metadata
  const [inserted] = await db.insert(feedback).values({
    eventId: parsed.data.eventId ?? null,
    firmId,
    userId,
    entityType: '__override__',
    entityHash: `override:${parsed.data.originalZone}:${parsed.data.overrideAction}`,
    isCorrect: parsed.data.overrideAction === 'block', // block = system was right, allow = system was wrong
    correctedType: JSON.stringify({
      originalScore: parsed.data.originalScore,
      originalLevel: parsed.data.originalLevel,
      originalZone: parsed.data.originalZone,
      overrideAction: parsed.data.overrideAction,
      reason: parsed.data.reason,
      entityTypeCounts: parsed.data.entityTypeCounts,
      tiersConsulted: parsed.data.tiersConsulted,
    }),
  }).returning({ id: feedback.id });

  logger.info('Sensitivity override captured', {
    firmId,
    userId,
    originalScore: parsed.data.originalScore,
    originalZone: parsed.data.originalZone,
    overrideAction: parsed.data.overrideAction,
    feedbackId: inserted.id,
  });

  return c.json({ feedbackId: inserted.id, captured: true });
});

// GET /v1/feedback/overrides — Override statistics for adaptive learning
feedbackRoutes.get('/overrides', async (c) => {
  const firmId = c.get('firmId');

  const overrides = await db
    .select({
      total: sql<number>`count(*)`,
      allows: sql<number>`count(*) filter (where ${feedback.entityHash} like 'override:%:allow')`,
      blocks: sql<number>`count(*) filter (where ${feedback.entityHash} like 'override:%:block')`,
      escalates: sql<number>`count(*) filter (where ${feedback.entityHash} like 'override:%:escalate')`,
    })
    .from(feedback)
    .where(and(
      eq(feedback.firmId, firmId),
      eq(feedback.entityType, '__override__'),
    ));

  const total = Number(overrides[0]?.total || 0);
  const allows = Number(overrides[0]?.allows || 0);

  return c.json({
    totalOverrides: total,
    allows,
    blocks: Number(overrides[0]?.blocks || 0),
    escalates: Number(overrides[0]?.escalates || 0),
    overrideRate: total > 0 ? Math.round((allows / total) * 100) : 0,
  });
});
