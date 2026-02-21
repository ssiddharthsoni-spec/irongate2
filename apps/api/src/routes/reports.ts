import { Hono } from 'hono';
import { db } from '../db/client';
import { events } from '../db/schema';
import { eq, sql, gte, and } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const reportsRoutes = new Hono<AppEnv>();

/** Support both ?period=30d and ?days=30 query parameter formats */
function parsePeriodDays(c: any): number {
  const period = c.req.query('period');
  if (period) {
    const match = period.match(/^(\d+)d$/);
    if (match) return parseInt(match[1]);
  }
  const days = c.req.query('days');
  if (days) return parseInt(days) || 30;
  return 30;
}

// GET /v1/reports/exposure — Shadow AI Exposure Report data
reportsRoutes.get('/exposure', async (c) => {
  const firmId = c.get('firmId');
  const daysBack = parsePeriodDays(c);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const firmCondition = and(eq(events.firmId, firmId), gte(events.createdAt, since));

  // Aggregate statistics
  const [stats] = await db
    .select({
      totalInteractions: sql<number>`count(*)`,
      uniqueUsers: sql<number>`count(distinct ${events.userId})`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
      maxScore: sql<number>`max(${events.sensitivityScore})`,
      highRiskCount: sql<number>`count(*) filter (where ${events.sensitivityScore} > 60)`,
      criticalCount: sql<number>`count(*) filter (where ${events.sensitivityScore} > 85)`,
    })
    .from(events)
    .where(firmCondition);

  // By tool
  const byTool = await db
    .select({
      toolId: events.aiToolId,
      count: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
      highRiskCount: sql<number>`count(*) filter (where ${events.sensitivityScore} > 60)`,
    })
    .from(events)
    .where(firmCondition)
    .groupBy(events.aiToolId)
    .orderBy(sql`count(*) desc`);

  // Score distribution
  const [distribution] = await db
    .select({
      low: sql<number>`count(*) filter (where ${events.sensitivityScore} <= 25)`,
      medium: sql<number>`count(*) filter (where ${events.sensitivityScore} > 25 and ${events.sensitivityScore} <= 60)`,
      high: sql<number>`count(*) filter (where ${events.sensitivityScore} > 60 and ${events.sensitivityScore} <= 85)`,
      critical: sql<number>`count(*) filter (where ${events.sensitivityScore} > 85)`,
    })
    .from(events)
    .where(firmCondition);

  // Daily trend for chart
  const dailyTrend = await db
    .select({
      date: sql<string>`date_trunc('day', ${events.createdAt})::date::text`,
      count: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
    })
    .from(events)
    .where(firmCondition)
    .groupBy(sql`date_trunc('day', ${events.createdAt})`)
    .orderBy(sql`date_trunc('day', ${events.createdAt})`);

  return c.json({
    reportDate: new Date().toISOString(),
    periodDays: daysBack,
    executiveSummary: {
      totalInteractions: Number(stats?.totalInteractions || 0),
      uniqueUsers: Number(stats?.uniqueUsers || 0),
      avgSensitivityScore: Math.round(Number(stats?.avgScore || 0) * 10) / 10,
      highRiskInteractions: Number(stats?.highRiskCount || 0),
      criticalInteractions: Number(stats?.criticalCount || 0),
      maxSensitivityScore: Number(stats?.maxScore || 0),
    },
    toolBreakdown: byTool.map((t) => ({
      toolId: t.toolId,
      count: Number(t.count),
      avgScore: Math.round(Number(t.avgScore) * 10) / 10,
      highRiskCount: Number(t.highRiskCount),
    })),
    scoreDistribution: {
      low: Number(distribution?.low || 0),
      medium: Number(distribution?.medium || 0),
      high: Number(distribution?.high || 0),
      critical: Number(distribution?.critical || 0),
    },
    dailyTrend: dailyTrend.map((d) => ({
      date: d.date,
      count: Number(d.count),
      avgScore: Math.round(Number(d.avgScore) * 10) / 10,
    })),
    recommendations: [
      'Deploy Iron Gate Proxy Mode to automatically protect sensitive prompts',
      'Implement user training on AI tool data hygiene practices',
      'Configure custom sensitivity thresholds for your organization',
      'Enable real-time alerts for critical sensitivity events',
    ],
  });
});
