// ============================================================================
// Iron Gate — Feedback Processor Service (Phase 10)
// ============================================================================
// Aggregates entity feedback to compute false positive rates and
// auto-update weight overrides when sample count exceeds threshold.
// ============================================================================

import { db } from '../db/client';
import { feedback, weightOverrides, events } from '../db/schema';
import { eq, sql, and, gte } from 'drizzle-orm';

interface FeedbackStats {
  entityType: string;
  totalFeedback: number;
  correctCount: number;
  incorrectCount: number;
  falsePositiveRate: number;
}

/**
 * Process accumulated feedback for a firm.
 * Computes per-entity-type false positive rates and updates weight overrides
 * when we have enough data (>= 50 feedback items per type).
 */
export async function processFeedback(firmId: string): Promise<FeedbackStats[]> {
  // Aggregate feedback by entity type
  const stats = await db
    .select({
      entityType: feedback.entityType,
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
      incorrect: sql<number>`count(*) filter (where ${feedback.isCorrect} = false)`,
    })
    .from(feedback)
    .where(eq(feedback.firmId, firmId))
    .groupBy(feedback.entityType);

  const results: FeedbackStats[] = [];

  for (const stat of stats) {
    const total = Number(stat.total);
    const correct = Number(stat.correct);
    const incorrect = Number(stat.incorrect);
    const falsePositiveRate = total > 0 ? incorrect / total : 0;

    results.push({
      entityType: stat.entityType,
      totalFeedback: total,
      correctCount: correct,
      incorrectCount: incorrect,
      falsePositiveRate,
    });

    // Auto-update weight overrides when we have enough data
    if (total >= 50) {
      try {
        // Adjust weight: high false positive rate → reduce weight
        // False positive rate 0% → weight multiplier 1.0
        // False positive rate 50% → weight multiplier 0.5
        const weightMultiplier = Math.max(0.1, 1 - falsePositiveRate);

        await db
          .insert(weightOverrides)
          .values({
            firmId,
            entityType: stat.entityType,
            weightMultiplier,
            sampleCount: total,
            falsePositiveRate,
          })
          .onConflictDoUpdate({
            target: [weightOverrides.firmId, weightOverrides.entityType],
            set: {
              weightMultiplier,
              sampleCount: total,
              falsePositiveRate,
              lastUpdated: new Date(),
            },
          });
      } catch (error) {
        console.warn(`[Feedback Processor] Failed to update weight for ${stat.entityType}:`, error);
      }
    }
  }

  return results;
}
