/**
 * Zone Analytics — Per-Firm Detection Metrics
 *
 * Tracks zone distribution (green/amber/red), cache hit rates,
 * override rates, and amber zone trends over time. Surfaces data
 * for the dashboard to prove accuracy is improving.
 */

import { db } from '../db/client';
import { events, feedback } from '../db/schema';
import { eq, and, gte, sql, desc } from 'drizzle-orm';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZoneDistribution {
  green: number;
  amber: number;
  red: number;
  total: number;
  greenPct: number;
  amberPct: number;
  redPct: number;
}

export interface ZoneTrend {
  date: string;
  green: number;
  amber: number;
  red: number;
  total: number;
  avgScore: number;
}

export interface OverrideMetrics {
  totalOverrides: number;
  allowRate: number;
  blockRate: number;
  escalateRate: number;
  /** Overrides by original zone (how often do users override red vs amber) */
  byZone: Record<string, number>;
}

export interface ZoneAnalyticsResult {
  period: { days: number; since: string };
  distribution: ZoneDistribution;
  trend: ZoneTrend[];
  overrides: OverrideMetrics;
  accuracy: {
    feedbackCount: number;
    accuracyRate: number;
    improvementVsPrior: number | null;
  };
}

// ── Score → Zone mapping (matches confidence-router.ts) ──────────────────────

function scoreToZone(score: number): 'green' | 'amber' | 'red' {
  if (score <= 25) return 'green';
  if (score <= 60) return 'amber';
  return 'red';
}

// ── Main Analytics Function ──────────────────────────────────────────────────

export async function getZoneAnalytics(
  firmId: string,
  days = 30,
): Promise<ZoneAnalyticsResult> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const priorSince = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);

  // ── Zone Distribution ────────────────────────────────────────────────────
  const distRows = await db
    .select({
      score: events.sensitivityScore,
    })
    .from(events)
    .where(and(eq(events.firmId, firmId), gte(events.createdAt, since)));

  let green = 0, amber = 0, red = 0;
  for (const row of distRows) {
    const zone = scoreToZone(Number(row.score));
    if (zone === 'green') green++;
    else if (zone === 'amber') amber++;
    else red++;
  }
  const total = green + amber + red;

  const distribution: ZoneDistribution = {
    green, amber, red, total,
    greenPct: total > 0 ? Math.round((green / total) * 100) : 0,
    amberPct: total > 0 ? Math.round((amber / total) * 100) : 0,
    redPct: total > 0 ? Math.round((red / total) * 100) : 0,
  };

  // ── Daily Trend ──────────────────────────────────────────────────────────
  const trendRows = await db
    .select({
      date: sql<string>`date(${events.createdAt})`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
      count: sql<number>`count(*)`,
    })
    .from(events)
    .where(and(eq(events.firmId, firmId), gte(events.createdAt, since)))
    .groupBy(sql`date(${events.createdAt})`)
    .orderBy(sql`date(${events.createdAt})`);

  // For each day, we need per-zone counts. Since we already have the raw scores,
  // compute from event data grouped by date.
  const dailyScores = await db
    .select({
      date: sql<string>`date(${events.createdAt})`,
      score: events.sensitivityScore,
    })
    .from(events)
    .where(and(eq(events.firmId, firmId), gte(events.createdAt, since)));

  const byDate: Record<string, { green: number; amber: number; red: number; scores: number[] }> = {};
  for (const row of dailyScores) {
    const d = String(row.date);
    if (!byDate[d]) byDate[d] = { green: 0, amber: 0, red: 0, scores: [] };
    const zone = scoreToZone(Number(row.score));
    byDate[d][zone]++;
    byDate[d].scores.push(Number(row.score));
  }

  const trend: ZoneTrend[] = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      green: data.green,
      amber: data.amber,
      red: data.red,
      total: data.green + data.amber + data.red,
      avgScore: data.scores.length > 0
        ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length)
        : 0,
    }));

  // ── Override Metrics ─────────────────────────────────────────────────────
  const overrideRows = await db
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
      gte(feedback.createdAt, since),
    ));

  const totalOverrides = Number(overrideRows[0]?.total || 0);
  const allows = Number(overrideRows[0]?.allows || 0);
  const blocks = Number(overrideRows[0]?.blocks || 0);
  const escalates = Number(overrideRows[0]?.escalates || 0);

  // Count overrides by original zone
  const zoneOverrides = await db
    .select({
      entityHash: feedback.entityHash,
    })
    .from(feedback)
    .where(and(
      eq(feedback.firmId, firmId),
      eq(feedback.entityType, '__override__'),
      gte(feedback.createdAt, since),
    ));

  const byZone: Record<string, number> = { green: 0, amber: 0, red: 0 };
  for (const row of zoneOverrides) {
    const hash = String(row.entityHash);
    // Format: 'override:<zone>:<action>'
    const parts = hash.split(':');
    if (parts.length >= 2 && byZone[parts[1]] !== undefined) {
      byZone[parts[1]]++;
    }
  }

  const overrides: OverrideMetrics = {
    totalOverrides,
    allowRate: totalOverrides > 0 ? Math.round((allows / totalOverrides) * 100) : 0,
    blockRate: totalOverrides > 0 ? Math.round((blocks / totalOverrides) * 100) : 0,
    escalateRate: totalOverrides > 0 ? Math.round((escalates / totalOverrides) * 100) : 0,
    byZone,
  };

  // ── Accuracy (current vs prior period) ───────────────────────────────────
  const [currentAccuracy] = await db
    .select({
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
    })
    .from(feedback)
    .where(and(
      eq(feedback.firmId, firmId),
      sql`${feedback.entityType} != '__override__'`,
      gte(feedback.createdAt, since),
    ));

  const [priorAccuracy] = await db
    .select({
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${feedback.isCorrect} = true)`,
    })
    .from(feedback)
    .where(and(
      eq(feedback.firmId, firmId),
      sql`${feedback.entityType} != '__override__'`,
      gte(feedback.createdAt, priorSince),
      sql`${feedback.createdAt} < ${since}`,
    ));

  const currentTotal = Number(currentAccuracy?.total || 0);
  const currentCorrect = Number(currentAccuracy?.correct || 0);
  const currentRate = currentTotal > 0 ? Math.round((currentCorrect / currentTotal) * 100) : 0;

  const priorTotal = Number(priorAccuracy?.total || 0);
  const priorCorrect = Number(priorAccuracy?.correct || 0);
  const priorRate = priorTotal > 0 ? Math.round((priorCorrect / priorTotal) * 100) : 0;

  const improvement = priorTotal >= 10 ? currentRate - priorRate : null;

  return {
    period: { days, since: since.toISOString() },
    distribution,
    trend,
    overrides,
    accuracy: {
      feedbackCount: currentTotal,
      accuracyRate: currentRate,
      improvementVsPrior: improvement,
    },
  };
}
