import { Hono } from 'hono';
import { db } from '../db/client';
import { events, users } from '../db/schema';
import { eq, sql, desc, gte, lte, and } from 'drizzle-orm';
import { computeTrustScore, getTrustHistory } from '../services/trust-score';
import { getGraph } from '../services/sensitivity-graph';
import type { AppEnv } from '../types';

export const dashboardRoutes = new Hono<AppEnv>();

function computePercentChange(previous: number, current: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/** Support both ?period=30d and ?days=30 query parameter formats */
function parsePeriodDays(c: any): number {
  const period = c.req.query('period');
  if (period) {
    const match = period.match(/^(\d+)d$/);
    if (match) return Math.min(parseInt(match[1]), 365);
  }
  const days = c.req.query('days');
  if (days) return Math.min(Math.max(1, parseInt(days) || 30), 365);
  return 30;
}

// GET /v1/dashboard/overview — Firm overview statistics
dashboardRoutes.get('/overview', async (c) => {
  const firmId = c.get('firmId');
  const daysBack = parsePeriodDays(c);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const firmCondition = and(eq(events.firmId, firmId), gte(events.createdAt, since));

  // Total interactions + action distribution
  const [totals] = await db
    .select({
      total: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
      blocked: sql<number>`count(*) filter (where ${events.action} = 'block')`,
      warned: sql<number>`count(*) filter (where ${events.action} = 'warn')`,
      passed: sql<number>`count(*) filter (where ${events.action} = 'pass')`,
      proxied: sql<number>`count(*) filter (where ${events.action} = 'proxy')`,
      overridden: sql<number>`count(*) filter (where ${events.action} = 'override')`,
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

  // Recent high risk events — minimized projection (no raw PII)
  const recentHighRisk = await db
    .select({
      id: events.id,
      aiToolId: events.aiToolId,
      sensitivityScore: events.sensitivityScore,
      sensitivityLevel: events.sensitivityLevel,
      entities: events.entities,
      action: events.action,
      captureMethod: events.captureMethod,
      eventHash: events.eventHash,
      chainPosition: events.chainPosition,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(and(firmCondition, gte(events.sensitivityScore, 60)))
    .orderBy(desc(events.createdAt))
    .limit(20);

  // Entity type breakdown — unnest JSONB entities array
  const entityBreakdownResult = await db.execute(
    sql`SELECT entity->>'type' AS entity_type, COUNT(*)::int AS count
        FROM ${events}, jsonb_array_elements(${events.entities}) AS entity
        WHERE ${events.firmId} = ${firmId}
          AND ${events.createdAt} >= ${since}
        GROUP BY entity->>'type'
        ORDER BY count DESC
        LIMIT 20`
  );

  // Total entities detected (efficient — no unnesting)
  const [entityTotals] = await db
    .select({
      totalEntities: sql<number>`COALESCE(SUM(jsonb_array_length(${events.entities})), 0)`,
    })
    .from(events)
    .where(firmCondition);

  // Previous period comparison
  const previousPeriodStart = new Date(Date.now() - daysBack * 2 * 24 * 60 * 60 * 1000);
  const previousPeriodEnd = since;
  const previousCondition = and(
    eq(events.firmId, firmId),
    gte(events.createdAt, previousPeriodStart),
    lte(events.createdAt, previousPeriodEnd)
  );

  const [previousTotals] = await db
    .select({
      total: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${events.sensitivityScore})`,
      blocked: sql<number>`count(*) filter (where ${events.action} = 'block')`,
      warned: sql<number>`count(*) filter (where ${events.action} = 'warn')`,
      proxied: sql<number>`count(*) filter (where ${events.action} = 'proxy')`,
    })
    .from(events)
    .where(previousCondition);

  const [previousEntityTotals] = await db
    .select({
      totalEntities: sql<number>`COALESCE(SUM(jsonb_array_length(${events.entities})), 0)`,
    })
    .from(events)
    .where(previousCondition);

  // Compute impact metrics
  const currentProtected = Number(totals?.warned || 0) + Number(totals?.blocked || 0) + Number(totals?.proxied || 0);
  const previousProtected = Number(previousTotals?.blocked || 0) + Number(previousTotals?.warned || 0) + Number(previousTotals?.proxied || 0);

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
    impact: {
      totalEntitiesDetected: Number(entityTotals?.totalEntities || 0),
      totalActionsProtected: currentProtected,
      entityBreakdown: [...entityBreakdownResult].map((r: any) => ({
        entityType: r.entity_type,
        count: Number(r.count),
      })),
      actionDistribution: {
        pass: Number(totals?.passed || 0),
        warn: Number(totals?.warned || 0),
        block: Number(totals?.blocked || 0),
        proxy: Number(totals?.proxied || 0),
        override: Number(totals?.overridden || 0),
      },
      previousPeriod: {
        totalInteractions: Number(previousTotals?.total || 0),
        totalEntitiesDetected: Number(previousEntityTotals?.totalEntities || 0),
        totalProtected: previousProtected,
        avgSensitivityScore: Math.round(Number(previousTotals?.avgScore || 0) * 10) / 10,
      },
      trends: {
        entitiesChange: computePercentChange(
          Number(previousEntityTotals?.totalEntities || 0),
          Number(entityTotals?.totalEntities || 0)
        ),
        protectedChange: computePercentChange(previousProtected, currentProtected),
        interactionsChange: computePercentChange(
          Number(previousTotals?.total || 0),
          Number(totals?.total || 0)
        ),
      },
    },
  });
});

// GET /v1/dashboard/user-activity — Per-user entity type breakdown
dashboardRoutes.get('/user-activity', async (c) => {
  const firmId = c.get('firmId');
  const daysBack = parsePeriodDays(c);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const firmCondition = and(eq(events.firmId, firmId), gte(events.createdAt, since));

  // Run all three queries in parallel
  const [userStats, userEntities, firmUsers] = await Promise.all([
    // Q1: Per-user aggregate stats
    db.select({
      userId: events.userId,
      totalEvents: sql<number>`count(*)::int`,
      avgScore: sql<number>`round(avg(${events.sensitivityScore})::numeric, 1)`,
      highRiskCount: sql<number>`count(*) filter (where ${events.sensitivityScore} > 60)::int`,
      lastActivity: sql<string>`max(${events.createdAt})::text`,
      blocked: sql<number>`count(*) filter (where ${events.action} = 'block')::int`,
      warned: sql<number>`count(*) filter (where ${events.action} = 'warn')::int`,
      proxied: sql<number>`count(*) filter (where ${events.action} = 'proxy')::int`,
    })
      .from(events)
      .where(firmCondition)
      .groupBy(events.userId)
      .orderBy(sql`count(*) desc`),

    // Q2: Per-user entity type breakdown (JSONB unnest)
    db.execute(
      sql`SELECT e.user_id,
                 entity->>'type' AS entity_type,
                 COUNT(*)::int AS count
          FROM ${events} e, jsonb_array_elements(e.entities) AS entity
          WHERE e.firm_id = ${firmId}
            AND e.created_at >= ${since}
          GROUP BY e.user_id, entity->>'type'
          ORDER BY e.user_id, count DESC`
    ),

    // Q3: User display info
    db.select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
    })
      .from(users)
      .where(eq(users.firmId, firmId)),
  ]);

  // Build lookup maps
  const userMap = new Map(firmUsers.map((u) => [u.id, u]));
  const entityMap = new Map<string, { type: string; count: number }[]>();
  for (const row of userEntities as any[]) {
    const uid = row.user_id;
    if (!entityMap.has(uid)) entityMap.set(uid, []);
    entityMap.get(uid)!.push({ type: row.entity_type, count: Number(row.count) });
  }

  // Merge results
  const result = userStats.map((s) => {
    const user = userMap.get(s.userId);
    return {
      userId: s.userId,
      displayName: user?.displayName || user?.email || s.userId,
      email: user?.email || '',
      role: user?.role || 'user',
      totalEvents: Number(s.totalEvents),
      avgScore: Number(s.avgScore),
      highRiskCount: Number(s.highRiskCount),
      lastActivity: s.lastActivity,
      actionBreakdown: {
        blocked: Number(s.blocked),
        warned: Number(s.warned),
        proxied: Number(s.proxied),
      },
      entityBreakdown: entityMap.get(s.userId) || [],
    };
  });

  return c.json({ users: result });
});

// GET /v1/dashboard/trust-score — Firm trust score with dimensions
dashboardRoutes.get('/trust-score', async (c) => {
  const firmId = c.get('firmId');
  const days = parseInt(c.req.query('days') || '30');

  const [score, history] = await Promise.all([
    computeTrustScore(firmId),
    getTrustHistory(firmId, days),
  ]);

  return c.json({ score, history });
});

// GET /v1/dashboard/sensitivity-graph — Entity co-occurrence graph
dashboardRoutes.get('/sensitivity-graph', async (c) => {
  const firmId = c.get('firmId');
  const graph = await getGraph(firmId);
  return c.json({ edges: graph });
});
