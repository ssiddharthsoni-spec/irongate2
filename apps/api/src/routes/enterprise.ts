/**
 * Enterprise Routes — SSO enforcement, DPA, ToS, Data Deletion, Deployment Health, ROI
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import {
  firms, users, events, subscriptions, apiKeys, extensionHeartbeats,
  tosAcceptance, dpaAcceptance, dataDeletionRequests, webhookDeliveryLog,
  webhookSubscriptions, feedback, pseudonymMaps, clientMatters,
  weightOverrides, firmPlugins, entityCoOccurrences, inferredEntities,
  sensitivityPatterns, featureFlags, departments, departmentPolicies,
  auditLog, alerts, invites,
} from '../db/schema';
import { eq, and, gte, desc, sql, count, avg, lt } from 'drizzle-orm';
import { requirePerm } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { sanitizeInput } from '../lib/sanitize';
import type { AppEnv } from '../types';

export const enterpriseRoutes = new Hono<AppEnv>();

// ============================================================================
// SSO Enforcement
// ============================================================================

// GET /v1/enterprise/sso-config — Get SSO enforcement status
enterpriseRoutes.get('/sso-config', async (c) => {
  const firmId = c.get('firmId');
  const [firm] = await db.select({ config: firms.config }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const config = (firm.config ?? {}) as Record<string, any>;
  return c.json({
    ssoRequired: !!config.ssoRequired,
    ssoProvider: config.ssoProvider || null,
    enforceForAllUsers: config.ssoEnforceAll !== false,
  });
});

// PUT /v1/enterprise/sso-config — Toggle SSO enforcement
enterpriseRoutes.put('/sso-config', requirePerm('setSensitivityThresholds'), async (c) => {
  const firmId = c.get('firmId');
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const schema = z.object({
    ssoRequired: z.boolean(),
    ssoProvider: z.enum(['clerk', 'okta', 'azure_ad', 'google']).optional(),
    enforceForAllUsers: z.boolean().optional().default(true),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const [firm] = await db.select({ config: firms.config }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const existingConfig = (firm.config ?? {}) as Record<string, any>;
  const updatedConfig = {
    ...existingConfig,
    ssoRequired: parsed.data.ssoRequired,
    ssoProvider: parsed.data.ssoProvider || existingConfig.ssoProvider,
    ssoEnforceAll: parsed.data.enforceForAllUsers,
  };

  await db.update(firms).set({ config: updatedConfig, updatedAt: new Date() }).where(eq(firms.id, firmId));

  return c.json({ ok: true, ...parsed.data });
});

// ============================================================================
// Terms of Service Tracking
// ============================================================================

const CURRENT_TOS_VERSION = '1.2';

// GET /v1/enterprise/tos — Check ToS acceptance status for the firm
enterpriseRoutes.get('/tos', async (c) => {
  const firmId = c.get('firmId');

  const [latest] = await db
    .select()
    .from(tosAcceptance)
    .where(eq(tosAcceptance.firmId, firmId))
    .orderBy(desc(tosAcceptance.acceptedAt))
    .limit(1);

  return c.json({
    currentVersion: CURRENT_TOS_VERSION,
    accepted: latest?.tosVersion === CURRENT_TOS_VERSION,
    lastAccepted: latest ? {
      version: latest.tosVersion,
      acceptedAt: latest.acceptedAt.toISOString(),
      acceptedBy: latest.acceptedBy,
    } : null,
    needsReacceptance: !latest || latest.tosVersion !== CURRENT_TOS_VERSION,
  });
});

// POST /v1/enterprise/tos/accept — Accept current ToS version
enterpriseRoutes.post('/tos/accept', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
  const ua = c.req.header('user-agent') || '';

  await db.insert(tosAcceptance).values({
    firmId,
    acceptedBy: userId,
    tosVersion: CURRENT_TOS_VERSION,
    ipAddress: ip.split(',')[0].trim(),
    userAgent: ua.slice(0, 500),
  });

  return c.json({ accepted: true, version: CURRENT_TOS_VERSION });
});

// ============================================================================
// Data Processing Agreement
// ============================================================================

const CURRENT_DPA_VERSION = '1.0';

// GET /v1/enterprise/dpa — Check DPA acceptance status
enterpriseRoutes.get('/dpa', async (c) => {
  const firmId = c.get('firmId');

  const [latest] = await db
    .select()
    .from(dpaAcceptance)
    .where(eq(dpaAcceptance.firmId, firmId))
    .orderBy(desc(dpaAcceptance.acceptedAt))
    .limit(1);

  return c.json({
    currentVersion: CURRENT_DPA_VERSION,
    accepted: latest?.dpaVersion === CURRENT_DPA_VERSION,
    lastAccepted: latest ? {
      version: latest.dpaVersion,
      signerName: latest.signerName,
      signerTitle: latest.signerTitle,
      signerEmail: latest.signerEmail,
      acceptedAt: latest.acceptedAt.toISOString(),
    } : null,
  });
});

// POST /v1/enterprise/dpa/accept — Accept DPA
enterpriseRoutes.post('/dpa/accept', requirePerm('setSensitivityThresholds'), async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const schema = z.object({
    signerName: z.string().min(1).max(255),
    signerTitle: z.string().max(255).optional(),
    signerEmail: z.string().email(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await db.insert(dpaAcceptance).values({
    firmId,
    acceptedBy: userId,
    signerName: sanitizeInput(parsed.data.signerName),
    signerTitle: parsed.data.signerTitle ? sanitizeInput(parsed.data.signerTitle) : null,
    signerEmail: parsed.data.signerEmail,
    dpaVersion: CURRENT_DPA_VERSION,
    ipAddress: ip.split(',')[0].trim(),
  });

  return c.json({ accepted: true, version: CURRENT_DPA_VERSION });
});

// ============================================================================
// Data Deletion / Offboarding (GDPR Article 17)
// ============================================================================

// POST /v1/enterprise/request-deletion — Request firm data deletion
enterpriseRoutes.post('/request-deletion', requirePerm('setSensitivityThresholds'), async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const schema = z.object({
    confirm: z.literal(true),
    reason: z.string().min(1).max(1000),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // Check no pending request exists
  const [existing] = await db
    .select()
    .from(dataDeletionRequests)
    .where(and(eq(dataDeletionRequests.firmId, firmId), eq(dataDeletionRequests.status, 'pending')))
    .limit(1);

  if (existing) {
    return c.json({
      error: 'A deletion request is already pending.',
      scheduledAt: existing.scheduledAt.toISOString(),
    }, 409);
  }

  const gracePeriodDays = 30;
  const scheduledAt = new Date(Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000);

  const [request] = await db.insert(dataDeletionRequests).values({
    firmId,
    requestedBy: userId,
    status: 'pending',
    reason: sanitizeInput(parsed.data.reason),
    scheduledAt,
  }).returning();

  logger.info('Data deletion requested', { firmId, userId, scheduledAt: scheduledAt.toISOString() });

  return c.json({
    id: request.id,
    status: 'pending',
    scheduledAt: scheduledAt.toISOString(),
    gracePeriodDays,
    message: `Deletion scheduled for ${scheduledAt.toISOString()}. Cancel within ${gracePeriodDays} days to retain data.`,
  }, 201);
});

// DELETE /v1/enterprise/cancel-deletion — Cancel pending deletion request
enterpriseRoutes.delete('/cancel-deletion', requirePerm('setSensitivityThresholds'), async (c) => {
  const firmId = c.get('firmId');

  const [updated] = await db
    .update(dataDeletionRequests)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(and(
      eq(dataDeletionRequests.firmId, firmId),
      eq(dataDeletionRequests.status, 'pending'),
    ))
    .returning();

  if (!updated) return c.json({ error: 'No pending deletion request found' }, 404);

  return c.json({ ok: true, message: 'Deletion request cancelled.' });
});

// GET /v1/enterprise/deletion-status — Check deletion request status
enterpriseRoutes.get('/deletion-status', async (c) => {
  const firmId = c.get('firmId');

  const [request] = await db
    .select()
    .from(dataDeletionRequests)
    .where(eq(dataDeletionRequests.firmId, firmId))
    .orderBy(desc(dataDeletionRequests.createdAt))
    .limit(1);

  if (!request) return c.json({ hasPendingRequest: false });

  return c.json({
    hasPendingRequest: request.status === 'pending',
    status: request.status,
    scheduledAt: request.scheduledAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    cancelledAt: request.cancelledAt?.toISOString() || null,
    executedAt: request.executedAt?.toISOString() || null,
  });
});

// ============================================================================
// Deployment Health Monitor
// ============================================================================

// GET /v1/enterprise/deployment-health — Extension deployment status
enterpriseRoutes.get('/deployment-health', async (c) => {
  const firmId = c.get('firmId');

  // Total users in firm
  const [userCount] = await db
    .select({ total: count() })
    .from(users)
    .where(eq(users.firmId, firmId));

  // Users with recent heartbeat (last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentHeartbeats = await db
    .select({
      userId: extensionHeartbeats.userId,
      extensionVersion: extensionHeartbeats.extensionVersion,
      activePlatform: extensionHeartbeats.activePlatform,
      receivedAt: extensionHeartbeats.receivedAt,
    })
    .from(extensionHeartbeats)
    .where(and(
      eq(extensionHeartbeats.firmId, firmId),
      gte(extensionHeartbeats.receivedAt, oneDayAgo),
    ))
    .orderBy(desc(extensionHeartbeats.receivedAt));

  // Deduplicate by userId — keep latest heartbeat per user
  const latestByUser = new Map<string, typeof recentHeartbeats[0]>();
  for (const hb of recentHeartbeats) {
    if (!latestByUser.has(hb.userId)) {
      latestByUser.set(hb.userId, hb);
    }
  }

  // Version distribution
  const versionDist = new Map<string, number>();
  for (const hb of latestByUser.values()) {
    const ver = hb.extensionVersion || 'unknown';
    versionDist.set(ver, (versionDist.get(ver) || 0) + 1);
  }

  const totalUsers = userCount?.total ?? 0;
  const activeUsers = latestByUser.size;
  const coverage = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;

  return c.json({
    totalUsers,
    activeUsers,
    inactiveUsers: totalUsers - activeUsers,
    coveragePercent: coverage,
    versionDistribution: Object.fromEntries(versionDist),
    latestVersion: '0.2.7',
    usersWithOutdatedVersion: Array.from(latestByUser.entries())
      .filter(([_, hb]) => hb.extensionVersion !== '0.2.7')
      .map(([uid]) => uid).length,
    lastUpdated: new Date().toISOString(),
  });
});

// ============================================================================
// ROI / Business Impact
// ============================================================================

// GET /v1/enterprise/roi — Business impact metrics
enterpriseRoutes.get('/roi', async (c) => {
  const firmId = c.get('firmId');

  // Events in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [eventStats] = await db
    .select({
      totalEvents: count(),
      avgScore: avg(events.sensitivityScore),
    })
    .from(events)
    .where(and(
      eq(events.firmId, firmId),
      gte(events.createdAt, thirtyDaysAgo),
    ));

  // Count high-risk blocked events
  const [blockedStats] = await db
    .select({ blocked: count() })
    .from(events)
    .where(and(
      eq(events.firmId, firmId),
      eq(events.action, 'block'),
      gte(events.createdAt, thirtyDaysAgo),
    ));

  // Count entities detected
  const [entityStats] = await db
    .select({ total: count() })
    .from(events)
    .where(and(
      eq(events.firmId, firmId),
      gte(events.createdAt, thirtyDaysAgo),
      gte(events.sensitivityScore, 26), // medium+ only
    ));

  // Industry average cost per breached record: $165 (IBM Cost of Data Breach 2025)
  const COST_PER_RECORD = 165;
  const entitiesProtected = Number(entityStats?.total ?? 0);
  const estimatedBreachCostAvoided = entitiesProtected * COST_PER_RECORD;

  // Compliance hours saved: ~2 min per event for manual review, automated = 0
  const MANUAL_REVIEW_MINS = 2;
  const totalEventsNum = Number(eventStats?.totalEvents ?? 0);
  const manualHoursSaved = Math.round((totalEventsNum * MANUAL_REVIEW_MINS) / 60);

  // Risk trend: compare last 7 days avg score vs prior 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [recentAvg] = await db
    .select({ avg: avg(events.sensitivityScore) })
    .from(events)
    .where(and(eq(events.firmId, firmId), gte(events.createdAt, sevenDaysAgo)));

  const [priorAvg] = await db
    .select({ avg: avg(events.sensitivityScore) })
    .from(events)
    .where(and(
      eq(events.firmId, firmId),
      gte(events.createdAt, fourteenDaysAgo),
      lt(events.createdAt, sevenDaysAgo),
    ));

  const recentAvgScore = Number(recentAvg?.avg ?? 0);
  const priorAvgScore = Number(priorAvg?.avg ?? 0);
  const riskTrend = priorAvgScore > 0
    ? Math.round(((recentAvgScore - priorAvgScore) / priorAvgScore) * 100)
    : 0;

  return c.json({
    period: 'last_30_days',
    promptsScanned: totalEventsNum,
    entitiesProtected,
    blockedPrompts: Number(blockedStats?.blocked ?? 0),
    avgSensitivityScore: Math.round(Number(eventStats?.avgScore ?? 0)),
    estimatedBreachCostAvoided,
    complianceHoursSaved: manualHoursSaved,
    riskTrendPercent: riskTrend,
    riskTrendDirection: riskTrend < 0 ? 'improving' : riskTrend > 0 ? 'worsening' : 'stable',
    costPerRecord: COST_PER_RECORD,
  });
});

// ============================================================================
// Webhook Delivery Log
// ============================================================================

// GET /v1/enterprise/webhook-deliveries/:webhookId — Delivery history
enterpriseRoutes.get('/webhook-deliveries/:webhookId', async (c) => {
  const firmId = c.get('firmId');
  const webhookId = c.req.param('webhookId');

  // Verify webhook belongs to firm
  const [wh] = await db
    .select({ id: webhookSubscriptions.id })
    .from(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.id, webhookId), eq(webhookSubscriptions.firmId, firmId)))
    .limit(1);

  if (!wh) return c.json({ error: 'Webhook not found' }, 404);

  const limit = Math.min(100, parseInt(c.req.query('limit') || '50'));
  const offset = parseInt(c.req.query('offset') || '0');

  const deliveries = await db
    .select()
    .from(webhookDeliveryLog)
    .where(and(
      eq(webhookDeliveryLog.webhookId, webhookId),
      eq(webhookDeliveryLog.firmId, firmId),
    ))
    .orderBy(desc(webhookDeliveryLog.deliveredAt))
    .limit(limit)
    .offset(offset);

  const [totalCount] = await db
    .select({ total: count() })
    .from(webhookDeliveryLog)
    .where(and(
      eq(webhookDeliveryLog.webhookId, webhookId),
      eq(webhookDeliveryLog.firmId, firmId),
    ));

  return c.json({
    deliveries: deliveries.map(d => ({
      id: d.id,
      eventType: d.eventType,
      statusCode: d.statusCode,
      success: d.success,
      attempt: d.attempt,
      error: d.error,
      deliveredAt: d.deliveredAt.toISOString(),
    })),
    total: totalCount?.total ?? 0,
    limit,
    offset,
  });
});

// POST /v1/enterprise/webhook-deliveries/:id/redeliver — Manual re-delivery
enterpriseRoutes.post('/webhook-deliveries/:id/redeliver', requirePerm('manageWebhooks'), async (c) => {
  const firmId = c.get('firmId');
  const deliveryId = c.req.param('id');

  const [delivery] = await db
    .select()
    .from(webhookDeliveryLog)
    .where(and(
      eq(webhookDeliveryLog.id, deliveryId),
      eq(webhookDeliveryLog.firmId, firmId),
    ))
    .limit(1);

  if (!delivery) return c.json({ error: 'Delivery not found' }, 404);

  // Re-enqueue via the webhook dispatcher
  try {
    const { enqueueWebhook } = await import('../jobs/enqueue');
    await enqueueWebhook({ firmId, eventType: delivery.eventType, payload: delivery.payload as Record<string, unknown> });
    return c.json({ ok: true, message: 'Webhook re-delivery queued.' });
  } catch (err) {
    logger.error('Webhook re-delivery failed', { error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Re-delivery failed' }, 500);
  }
});
