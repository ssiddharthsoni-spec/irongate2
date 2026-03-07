/**
 * Adaptive Weight Engine — Phase 4.1
 *
 * Adjusts entity type weights per-firm based on aggregated feedback data.
 * When users consistently mark a detection type as false positive,
 * the weight is reduced. When overrides confirm true positives, weights
 * are increased.
 *
 * Privacy: Only aggregated counts are used — never individual feedback text.
 *
 * Weight adjustment formula:
 *   adjustedWeight = baseWeight * (1 + (truePositiveRate - 0.5) * learningRate)
 *   where truePositiveRate = correct / total for that entity type
 *
 * Constraints:
 *   - Minimum 10 feedback samples before adjustment
 *   - Weight can only change ±50% from base
 *   - HIGH_PII_TYPES weights can only INCREASE, never decrease
 */

import { db } from '../db/client';
import { feedback } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../lib/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeightAdjustment {
  entityType: string;
  baseWeight: number;
  adjustedWeight: number;
  truePositiveRate: number;
  sampleSize: number;
  direction: 'increased' | 'decreased' | 'unchanged';
}

export interface AdaptiveWeightsResult {
  firmId: string;
  adjustments: WeightAdjustment[];
  generatedAt: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_WEIGHTS: Record<string, number> = {
  PERSON: 10, ORGANIZATION: 8, LOCATION: 3, DATE: 2,
  PHONE_NUMBER: 15, EMAIL: 12, CREDIT_CARD: 30, SSN: 40,
  MONETARY_AMOUNT: 12, ACCOUNT_NUMBER: 25, IP_ADDRESS: 8,
  MEDICAL_RECORD: 35, PASSPORT_NUMBER: 35, DRIVERS_LICENSE: 30,
  MATTER_NUMBER: 20, CLIENT_MATTER_PAIR: 25, PRIVILEGE_MARKER: 30,
  API_KEY: 30, AWS_CREDENTIAL: 35, DATABASE_URI: 35, PRIVATE_KEY: 40,
};

// Types whose weights can ONLY increase — never reduce sensitivity
const PROTECTED_TYPES = new Set([
  'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI', 'PRIVATE_KEY',
]);

const LEARNING_RATE = 0.3;
const MIN_SAMPLES = 10;
const MAX_ADJUSTMENT = 0.5; // ±50%

// ── Core Engine ──────────────────────────────────────────────────────────────

export async function computeAdaptiveWeights(firmId: string): Promise<AdaptiveWeightsResult> {
  // Get feedback statistics by entity type for this firm
  const stats = await db
    .select({
      entityType: feedback.entityType,
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
    })
    .from(feedback)
    .where(and(
      eq(feedback.firmId, firmId),
      sql`${feedback.entityType} != '__override__'`,
    ))
    .groupBy(feedback.entityType);

  const adjustments: WeightAdjustment[] = [];

  for (const stat of stats) {
    const total = Number(stat.total);
    const correct = Number(stat.correct);
    const entityType = stat.entityType;
    const baseWeight = BASE_WEIGHTS[entityType] ?? 5;

    if (total < MIN_SAMPLES) {
      adjustments.push({
        entityType,
        baseWeight,
        adjustedWeight: baseWeight,
        truePositiveRate: total > 0 ? correct / total : 1,
        sampleSize: total,
        direction: 'unchanged',
      });
      continue;
    }

    const truePositiveRate = correct / total;
    // Scale: 0.5 = neutral, >0.5 = increase, <0.5 = decrease
    let adjustment = (truePositiveRate - 0.5) * LEARNING_RATE;

    // Clamp to ±MAX_ADJUSTMENT
    adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, adjustment));

    // Protected types: never decrease
    if (PROTECTED_TYPES.has(entityType) && adjustment < 0) {
      adjustment = 0;
    }

    const adjustedWeight = Math.round(baseWeight * (1 + adjustment));

    adjustments.push({
      entityType,
      baseWeight,
      adjustedWeight,
      truePositiveRate: Math.round(truePositiveRate * 100) / 100,
      sampleSize: total,
      direction: adjustment > 0.01 ? 'increased' : adjustment < -0.01 ? 'decreased' : 'unchanged',
    });
  }

  logger.info('Computed adaptive weights', {
    firmId,
    totalTypes: adjustments.length,
    adjusted: adjustments.filter(a => a.direction !== 'unchanged').length,
  });

  return {
    firmId,
    adjustments,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get weight overrides as a simple Record for passing to computeScore().
 */
export async function getWeightOverrides(firmId: string): Promise<Record<string, number>> {
  const result = await computeAdaptiveWeights(firmId);
  const overrides: Record<string, number> = {};

  for (const adj of result.adjustments) {
    if (adj.direction !== 'unchanged') {
      overrides[adj.entityType] = adj.adjustedWeight;
    }
  }

  return overrides;
}
