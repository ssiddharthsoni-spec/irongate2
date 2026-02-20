import { Hono } from 'hono';
import { db } from '../db/client';
import { events, users } from '../db/schema';
import { eq, sql, desc, gte, and } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const dashboardRoutes = new Hono<AppEnv>();

// GET /v1/dashboard/overview — Firm overview statistics
dashboardRoutes.get('/overview', async (c) => {
  const firmId = c.get('firmId');
  const daysBack = parseInt(c.req.query('days') || '30');
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const firmCondition = and(eq(events.firmId, firmId), gte(events.createdAt, since));

  // Total interactions
  const [totals] = await db
    .select({
      total: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
      blocked: sql<number>`count(*) filter (where ${events.action} = 'block')`,
      warned: sql<number>`count(*) filter (where ${events.action} = 'warn')`,
    })
    .from(events)
    .where(firmCondition);

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

  // Tool breakdown
  const toolBreakdown = await db
    .select({
      toolId: events.aiToolId,
      count: sql<number>`count(*)`,
    })
    .from(events)
    .where(firmCondition)
    .groupBy(events.aiToolId)
    .orderBy(sql`count(*) desc`);

  const totalCount = Number(totals?.total || 0);
  const toolBreakdownWithPct = toolBreakdown.map((t) => ({
    toolId: t.toolId,
    toolName: t.toolId,
    count: Number(t.count),
    percentage: totalCount > 0 ? Math.round((Number(t.count) / totalCount) * 100) : 0,
  }));

  // Daily trend
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

  // Top users
  const topUsers = await db
    .select({
      userId: events.userId,
      promptCount: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
      highRiskCount: sql<number>`count(*) filter (where ${events.sensitivityScore} > 60)`,
    })
    .from(events)
    .where(firmCondition)
    .groupBy(events.userId)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  // Recent high risk events
  const recentHighRisk = await db
    .select()
    .from(events)
    .where(and(firmCondition, gte(events.sensitivityScore, 60)))
    .orderBy(desc(events.createdAt))
    .limit(20);

  return c.json({
    totalInteractions: Number(totals?.total || 0),
    totalProtected: Number(totals?.warned || 0) + Number(totals?.blocked || 0),
    totalBlocked: Number(totals?.blocked || 0),
    avgSensitivityScore: Math.round(Number(totals?.avgScore || 0) * 10) / 10,
    scoreDistribution: {
      low: Number(distribution?.low || 0),
      medium: Number(distribution?.medium || 0),
      high: Number(distribution?.high || 0),
      critical: Number(distribution?.critical || 0),
    },
    toolBreakdown: toolBreakdownWithPct,
    dailyTrend: dailyTrend.map((d) => ({
      date: d.date,
      count: Number(d.count),
      avgScore: Math.round(Number(d.avgScore) * 10) / 10,
    })),
    topUsers: topUsers.map((u) => ({
      userId: u.userId,
      displayName: u.userId, // Would join with users table in production
      promptCount: Number(u.promptCount),
      avgScore: Math.round(Number(u.avgScore) * 10) / 10,
      highRiskCount: Number(u.highRiskCount),
    })),
    recentHighRisk,
  });
});
