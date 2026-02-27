import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { feedback } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const feedbackRoutes = new Hono<AppEnv>();

// POST /v1/feedback — Submit entity feedback
feedbackRoutes.post('/', async (c) => {
  const body = await c.req.json();
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

  // Generate entityHash from entityText if not provided
  let entityHash = parsed.entityHash || '';
  if (!entityHash && parsed.entityText) {
    const data = new TextEncoder().encode(parsed.entityText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    entityHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Use a sentinel UUID when no eventId is provided (e.g., extension feedback)
  const eventId = parsed.eventId || '00000000-0000-0000-0000-000000000000';

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
