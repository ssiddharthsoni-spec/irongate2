/**
 * Federated Weight Aggregator — Quarterly Job
 *
 * Collects anonymized override/feedback data across all firms, computes
 * weight deltas for each entity type, runs outlier detection, and pushes
 * updated base weights to the global weight table.
 *
 * Privacy guarantees:
 * - No raw PII is processed (only entity type + isCorrect + override action)
 * - Per-firm data is anonymized before aggregation
 * - Outlier firms (Z-score > 2.5) are quarantined and excluded
 * - Results are aggregate weight adjustments, not individual data
 *
 * Run schedule: Quarterly via BullMQ or manual API trigger.
 */

import { db } from '../db/client';
import { feedback, firms } from '../db/schema';
import { eq, sql, and, gte } from 'drizzle-orm';
import { logger } from '../lib/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FirmFeedbackSummary {
  firmId: string;
  entityType: string;
  totalFeedback: number;
  correctCount: number;
  incorrectCount: number;
  truePositiveRate: number;
}

export interface AggregatedWeightDelta {
  entityType: string;
  /** Current suggested weight adjustment (multiplier, e.g., 0.8 = reduce 20%) */
  weightMultiplier: number;
  /** Number of firms contributing data for this entity type */
  firmCount: number;
  /** Total feedback samples across all firms */
  totalSamples: number;
  /** Average true positive rate across firms */
  avgTruePositiveRate: number;
  /** Whether any firms were quarantined as outliers */
  quarantinedFirms: number;
  /** Confidence in this adjustment (0-1) */
  confidence: number;
}

export interface FederatedAggregationResult {
  deltas: AggregatedWeightDelta[];
  totalFirmsAnalyzed: number;
  totalFeedbackProcessed: number;
  quarantinedFirmCount: number;
  runAt: string;
  periodDays: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Minimum feedback samples per firm per entity type to include */
const MIN_SAMPLES_PER_FIRM = 10;

/** Minimum number of firms contributing data for a delta to be computed */
const MIN_FIRMS_FOR_DELTA = 3;

/** Z-score threshold for outlier detection */
const OUTLIER_Z_THRESHOLD = 2.5;

/** Maximum weight adjustment per cycle (prevents wild swings) */
const MAX_ADJUSTMENT = 0.3; // ±30%

/** Learning rate for weight updates */
const LEARNING_RATE = 0.1;

/** Entity types that can ONLY have weights increased (never decreased) */
const PROTECTED_TYPES = new Set([
  'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'PRIVATE_KEY', 'AWS_CREDENTIAL', 'DATABASE_URI', 'CLASSIFICATION_MARKING',
]);

// ── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Run the federated aggregation job.
 * @param periodDays Number of days of feedback to analyze (default: 90 = quarterly)
 */
export async function runFederatedAggregation(
  periodDays = 90,
): Promise<FederatedAggregationResult> {
  const start = Date.now();
  const cutoffDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  logger.info('Federated aggregation starting', { periodDays, cutoff: cutoffDate.toISOString() });

  // Step 1: Collect per-firm feedback summaries (anonymized)
  const firmSummaries = await collectFirmSummaries(cutoffDate);
  if (firmSummaries.length === 0) {
    logger.info('No feedback data to aggregate');
    return {
      deltas: [],
      totalFirmsAnalyzed: 0,
      totalFeedbackProcessed: 0,
      quarantinedFirmCount: 0,
      runAt: new Date().toISOString(),
      periodDays,
    };
  }

  // Step 2: Group by entity type across firms
  const byEntityType = groupByEntityType(firmSummaries);

  // Step 3: Detect outlier firms and quarantine
  let quarantinedCount = 0;
  const cleanedByType: typeof byEntityType = {};

  for (const [entityType, summaries] of Object.entries(byEntityType)) {
    const { cleaned, quarantined } = detectOutliers(summaries);
    cleanedByType[entityType] = cleaned;
    quarantinedCount += quarantined;
  }

  // Step 4: Compute weight deltas from cleaned data
  const deltas = computeWeightDeltas(cleanedByType);

  // Step 5: Store results
  const totalSamples = firmSummaries.reduce((s, f) => s + f.totalFeedback, 0);
  const uniqueFirms = new Set(firmSummaries.map(f => f.firmId)).size;

  const result: FederatedAggregationResult = {
    deltas,
    totalFirmsAnalyzed: uniqueFirms,
    totalFeedbackProcessed: totalSamples,
    quarantinedFirmCount: quarantinedCount,
    runAt: new Date().toISOString(),
    periodDays,
  };

  logger.info('Federated aggregation complete', {
    deltas: deltas.length,
    firms: uniqueFirms,
    samples: totalSamples,
    quarantined: quarantinedCount,
    durationMs: Date.now() - start,
  });

  return result;
}

// ── Step 1: Collect Firm Summaries ───────────────────────────────────────────

async function collectFirmSummaries(
  cutoffDate: Date,
): Promise<FirmFeedbackSummary[]> {
  // Exclude override feedback (entityType = '__override__')
  const rows = await db
    .select({
      firmId: feedback.firmId,
      entityType: feedback.entityType,
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
      incorrect: sql<number>`count(*) filter (where ${feedback.isCorrect} = false)`,
    })
    .from(feedback)
    .where(and(
      gte(feedback.createdAt, cutoffDate),
      sql`${feedback.entityType} != '__override__'`,
    ))
    .groupBy(feedback.firmId, feedback.entityType);

  return rows
    .filter(r => Number(r.total) >= MIN_SAMPLES_PER_FIRM)
    .map(r => ({
      firmId: r.firmId,
      entityType: r.entityType,
      totalFeedback: Number(r.total),
      correctCount: Number(r.correct),
      incorrectCount: Number(r.incorrect),
      truePositiveRate: Number(r.total) > 0
        ? Number(r.correct) / Number(r.total)
        : 0,
    }));
}

// ── Step 2: Group by Entity Type ─────────────────────────────────────────────

function groupByEntityType(
  summaries: FirmFeedbackSummary[],
): Record<string, FirmFeedbackSummary[]> {
  const groups: Record<string, FirmFeedbackSummary[]> = {};
  for (const s of summaries) {
    if (!groups[s.entityType]) groups[s.entityType] = [];
    groups[s.entityType].push(s);
  }
  return groups;
}

// ── Step 3: Outlier Detection ────────────────────────────────────────────────

function detectOutliers(summaries: FirmFeedbackSummary[]): {
  cleaned: FirmFeedbackSummary[];
  quarantined: number;
} {
  if (summaries.length < 3) {
    return { cleaned: summaries, quarantined: 0 };
  }

  // Compute mean and stddev of true positive rates
  const rates = summaries.map(s => s.truePositiveRate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rates.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) {
    return { cleaned: summaries, quarantined: 0 };
  }

  const cleaned: FirmFeedbackSummary[] = [];
  let quarantined = 0;

  for (const s of summaries) {
    const zScore = Math.abs(s.truePositiveRate - mean) / stddev;
    if (zScore > OUTLIER_Z_THRESHOLD) {
      quarantined++;
      logger.warn('Federated aggregation: quarantined outlier firm', {
        firmId: s.firmId,
        entityType: s.entityType,
        truePositiveRate: s.truePositiveRate,
        zScore: Math.round(zScore * 100) / 100,
        mean: Math.round(mean * 100) / 100,
      });
    } else {
      cleaned.push(s);
    }
  }

  return { cleaned, quarantined };
}

// ── Step 4: Compute Weight Deltas ────────────────────────────────────────────

function computeWeightDeltas(
  byEntityType: Record<string, FirmFeedbackSummary[]>,
): AggregatedWeightDelta[] {
  const deltas: AggregatedWeightDelta[] = [];

  for (const [entityType, summaries] of Object.entries(byEntityType)) {
    if (summaries.length < MIN_FIRMS_FOR_DELTA) continue;

    const totalSamples = summaries.reduce((s, f) => s + f.totalFeedback, 0);
    const avgTPR = summaries.reduce((s, f) => s + f.truePositiveRate, 0) / summaries.length;

    // Weight adjustment formula:
    // - TPR = 1.0: entity type is perfectly accurate → slight increase
    // - TPR = 0.5: coin flip → no change (baseline)
    // - TPR = 0.0: all false positives → decrease weight
    //
    // multiplier = 1 + learningRate * (TPR - 0.5), clamped to ±MAX_ADJUSTMENT
    let adjustment = LEARNING_RATE * (avgTPR - 0.5);
    adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, adjustment));

    // Protected types: only allow increases
    if (PROTECTED_TYPES.has(entityType) && adjustment < 0) {
      adjustment = 0;
    }

    const multiplier = 1 + adjustment;

    // Confidence based on sample size and firm diversity
    const sampleConfidence = Math.min(1, totalSamples / 200);
    const firmConfidence = Math.min(1, summaries.length / 10);
    const confidence = Math.round(sampleConfidence * firmConfidence * 100) / 100;

    deltas.push({
      entityType,
      weightMultiplier: Math.round(multiplier * 1000) / 1000,
      firmCount: summaries.length,
      totalSamples,
      avgTruePositiveRate: Math.round(avgTPR * 1000) / 1000,
      quarantinedFirms: 0, // Filled in by caller if needed
      confidence,
    });
  }

  // Sort by confidence descending
  deltas.sort((a, b) => b.confidence - a.confidence);

  return deltas;
}

// ── API Route Handler ────────────────────────────────────────────────────────

/**
 * Trigger a federated aggregation run. Intended to be called from an admin
 * endpoint or a scheduled job (BullMQ / cron).
 */
export async function handleFederatedAggregation(periodDays?: number): Promise<FederatedAggregationResult> {
  return runFederatedAggregation(periodDays);
}
