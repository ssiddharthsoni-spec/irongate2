// ============================================================================
// Iron Gate — Trust Score Service (★ MOAT)
// ============================================================================
// Composite governance score across 5 dimensions.
// Each dimension is scored 0–100, then weighted to produce a final score.
// ============================================================================

import { db } from '../db/client';
import { events, feedback, weightOverrides } from '../db/schema';
import { eq, sql, and, gte, count } from 'drizzle-orm';
import { verifyChain } from './audit-chain';
import type { TrustScore, TrustDimension } from '@iron-gate/types';

const KNOWN_AI_TOOLS = [
  'chatgpt', 'claude', 'gemini', 'copilot', 'deepseek',
  'poe', 'perplexity', 'you', 'huggingface', 'groq', 'generic',
];

/**
 * Compute the IronGate Trust Score for a firm.
 */
export async function computeTrustScore(firmId: string): Promise<TrustScore> {
  const dimensions = await Promise.all([
    computeDetectionAccuracy(firmId),
    computeFeedbackParticipation(firmId),
    computePolicyCompliance(firmId),
    computeChainIntegrity(firmId),
    computeCoverageCompleteness(firmId),
  ]);

  const overall = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);

  return {
    overall: Math.round(overall),
    dimensions,
    firmId,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Get trust score history for trend chart (last N days).
 * Since we don't store historical scores, we compute a simplified trend
 * based on event data quality over time.
 */
export async function getTrustHistory(firmId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const dailyStats = await db
    .select({
      date: sql<string>`date_trunc('day', ${events.createdAt})::date::text`,
      totalEvents: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
      blockedCount: sql<number>`count(*) filter (where ${events.action} = 'block')`,
      overrideCount: sql<number>`count(*) filter (where ${events.action} = 'override')`,
    })
    .from(events)
    .where(and(eq(events.firmId, firmId), gte(events.createdAt, since)))
    .groupBy(sql`date_trunc('day', ${events.createdAt})`)
    .orderBy(sql`date_trunc('day', ${events.createdAt})`);

  return dailyStats.map((d) => ({
    date: d.date,
    totalEvents: Number(d.totalEvents),
    avgScore: Math.round(Number(d.avgScore || 0)),
    complianceRate: Number(d.totalEvents) > 0
      ? Math.round((1 - Number(d.overrideCount) / Number(d.totalEvents)) * 100)
      : 100,
  }));
}

// ---------------------------------------------------------------------------
// Dimension Calculators
// ---------------------------------------------------------------------------

async function computeDetectionAccuracy(firmId: string): Promise<TrustDimension> {
  // Get feedback-derived accuracy
  const [stats] = await db
    .select({
      totalFeedback: sql<number>`count(*)`,
      correctCount: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
    })
    .from(feedback)
    .where(eq(feedback.firmId, firmId));

  const total = Number(stats?.totalFeedback || 0);
  const correct = Number(stats?.correctCount || 0);

  // If no feedback yet, assume 80% baseline
  const accuracy = total > 0 ? (correct / total) * 100 : 80;

  return {
    name: 'Detection Accuracy',
    score: Math.round(accuracy),
    weight: 0.25,
    description: total > 0
      ? `${correct}/${total} entities correctly classified (${Math.round(accuracy)}%)`
      : 'No feedback data yet — using baseline score',
  };
}

async function computeFeedbackParticipation(firmId: string): Promise<TrustDimension> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [eventCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(eq(events.firmId, firmId), gte(events.createdAt, thirtyDaysAgo)));

  const [feedbackCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(feedback)
    .where(and(eq(feedback.firmId, firmId), gte(feedback.createdAt, thirtyDaysAgo)));

  const evts = Number(eventCount?.count || 0);
  const fbs = Number(feedbackCount?.count || 0);

  // Target: at least 10% of events should have feedback
  const participation = evts > 0 ? Math.min(100, (fbs / evts) * 1000) : 0;

  return {
    name: 'Feedback Participation',
    score: Math.round(participation),
    weight: 0.15,
    description: `${fbs} feedback submissions across ${evts} events (last 30 days)`,
  };
}

async function computePolicyCompliance(firmId: string): Promise<TrustDimension> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [stats] = await db
    .select({
      highRiskEvents: sql<number>`count(*) filter (where ${events.sensitivityScore} > 60)`,
      overrideEvents: sql<number>`count(*) filter (where ${events.action} = 'override')`,
    })
    .from(events)
    .where(and(eq(events.firmId, firmId), gte(events.createdAt, thirtyDaysAgo)));

  const highRisk = Number(stats?.highRiskEvents || 0);
  const overrides = Number(stats?.overrideEvents || 0);

  const compliance = highRisk > 0
    ? Math.round((1 - overrides / highRisk) * 100)
    : 100;

  return {
    name: 'Policy Compliance',
    score: compliance,
    weight: 0.30,
    description: highRisk > 0
      ? `${overrides} overrides on ${highRisk} high-risk events (${100 - compliance}% override rate)`
      : 'No high-risk events in last 30 days',
  };
}

async function computeChainIntegrity(firmId: string): Promise<TrustDimension> {
  try {
    const verification = await verifyChain(firmId);
    return {
      name: 'Chain Integrity',
      score: verification.valid ? 100 : 0,
      weight: 0.15,
      description: verification.valid
        ? `${verification.totalEvents} events verified — chain intact`
        : `Chain broken at position ${verification.brokenAt}`,
    };
  } catch {
    return {
      name: 'Chain Integrity',
      score: 50,
      weight: 0.15,
      description: 'Unable to verify chain — using baseline score',
    };
  }
}

async function computeCoverageCompleteness(firmId: string): Promise<TrustDimension> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const toolsUsed = await db
    .selectDistinct({ aiToolId: events.aiToolId })
    .from(events)
    .where(and(eq(events.firmId, firmId), gte(events.createdAt, thirtyDaysAgo)));

  const coverage = Math.round((toolsUsed.length / KNOWN_AI_TOOLS.length) * 100);

  return {
    name: 'Coverage Completeness',
    score: Math.min(100, coverage),
    weight: 0.15,
    description: `${toolsUsed.length}/${KNOWN_AI_TOOLS.length} known AI tools monitored`,
  };
}
