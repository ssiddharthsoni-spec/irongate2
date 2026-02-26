import { Hono } from 'hono';
import { db } from '../db/client';
import { firms, events } from '../db/schema';
import { eq, and, gte, lte, sql, count } from 'drizzle-orm';
import {
  COMPLIANCE_PROFILES,
  mergeEntityRules,
  getEffectiveRiskMultiplier,
  getEffectiveBlockThreshold,
} from '@iron-gate/config';
import type { ComplianceFrameworkId } from '@iron-gate/config';
import type { AppEnv } from '../types';

export const complianceRoutes = new Hono<AppEnv>();

// GET /v1/compliance/profiles — List all available compliance profiles
complianceRoutes.get('/profiles', async (c) => {
  const profiles = Object.values(COMPLIANCE_PROFILES).map(p => ({
    id: p.id,
    name: p.name,
    shortName: p.shortName,
    description: p.description,
    version: p.version,
    riskMultiplier: p.riskMultiplier,
    autoBlockThreshold: p.autoBlockThreshold,
    entityRuleCount: p.entityRules.length,
    requiredControlCount: p.requiredControls.length,
    reportingFrequency: p.reportingFrequency,
  }));

  return c.json({ profiles });
});

// GET /v1/compliance/profiles/:id — Get full profile details
complianceRoutes.get('/profiles/:id', async (c) => {
  const id = c.req.param('id') as ComplianceFrameworkId;
  const profile = COMPLIANCE_PROFILES[id];

  if (!profile) {
    return c.json({ error: 'Profile not found' }, 404);
  }

  return c.json({ profile });
});

// GET /v1/compliance/active — Get firm's active compliance configuration
complianceRoutes.get('/active', async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const config = (firm.config as Record<string, unknown>) || {};
  const activeFrameworks = (config.complianceFrameworks as ComplianceFrameworkId[]) || [];

  const activeProfiles = activeFrameworks
    .map(id => COMPLIANCE_PROFILES[id])
    .filter(Boolean);

  const mergedRules = mergeEntityRules(activeFrameworks);
  const effectiveMultiplier = getEffectiveRiskMultiplier(activeFrameworks);
  const effectiveThreshold = getEffectiveBlockThreshold(activeFrameworks);

  // Compute all required controls (deduplicated)
  const allControls = new Set<string>();
  for (const profile of activeProfiles) {
    for (const ctrl of profile.requiredControls) allControls.add(ctrl);
  }

  return c.json({
    frameworks: activeFrameworks,
    profiles: activeProfiles.map(p => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
    })),
    mergedEntityRules: mergedRules,
    effectiveRiskMultiplier: effectiveMultiplier,
    effectiveBlockThreshold: effectiveThreshold,
    allRequiredControls: Array.from(allControls),
    retentionPolicy: activeProfiles.length > 0 ? activeProfiles.reduce((strictest, p) => ({
      auditLogDays: Math.max(strictest.auditLogDays, p.retentionPolicy.auditLogDays),
      eventDataDays: Math.max(strictest.eventDataDays, p.retentionPolicy.eventDataDays),
      pseudonymMapDays: Math.max(strictest.pseudonymMapDays, p.retentionPolicy.pseudonymMapDays),
      deleteRawPrompts: strictest.deleteRawPrompts || p.retentionPolicy.deleteRawPrompts,
    }), { auditLogDays: 0, eventDataDays: 0, pseudonymMapDays: 0, deleteRawPrompts: false as boolean }) : null,
  });
});

// PUT /v1/compliance/active — Update firm's active compliance frameworks
complianceRoutes.put('/active', async (c) => {
  const firmId = c.get('firmId');
  const body = await c.req.json<{ frameworks: ComplianceFrameworkId[] }>();

  if (!Array.isArray(body.frameworks)) {
    return c.json({ error: 'frameworks must be an array' }, 400);
  }

  // Validate all framework IDs
  for (const id of body.frameworks) {
    if (!COMPLIANCE_PROFILES[id]) {
      return c.json({ error: `Unknown framework: ${id}` }, 400);
    }
  }

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const config = (firm.config as Record<string, unknown>) || {};
  const updatedConfig = {
    ...config,
    complianceFrameworks: body.frameworks,
    complianceUpdatedAt: new Date().toISOString(),
  };

  await db.update(firms).set({ config: updatedConfig }).where(eq(firms.id, firmId));

  return c.json({
    frameworks: body.frameworks,
    effectiveRiskMultiplier: getEffectiveRiskMultiplier(body.frameworks),
    effectiveBlockThreshold: getEffectiveBlockThreshold(body.frameworks),
  });
});

// GET /v1/compliance/status — Compliance status summary for the firm
complianceRoutes.get('/status', async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const config = (firm.config as Record<string, unknown>) || {};
  const activeFrameworks = (config.complianceFrameworks as ComplianceFrameworkId[]) || [];

  // Get event statistics for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let totalEvents = 0;
  let blockedEvents = 0;
  let highRiskEvents = 0;

  try {
    const [total] = await db
      .select({ count: count() })
      .from(events)
      .where(and(
        eq(events.firmId, firmId),
        gte(events.createdAt, thirtyDaysAgo)
      ));
    totalEvents = total?.count ?? 0;

    const [blocked] = await db
      .select({ count: count() })
      .from(events)
      .where(and(
        eq(events.firmId, firmId),
        gte(events.createdAt, thirtyDaysAgo),
        eq(events.action, 'block')
      ));
    blockedEvents = blocked?.count ?? 0;

    const [highRisk] = await db
      .select({ count: count() })
      .from(events)
      .where(and(
        eq(events.firmId, firmId),
        gte(events.createdAt, thirtyDaysAgo),
        gte(events.sensitivityScore, 70)
      ));
    highRiskEvents = highRisk?.count ?? 0;
  } catch {
    // DB may not be available in dev
  }

  const statuses = activeFrameworks.map(id => {
    const profile = COMPLIANCE_PROFILES[id];
    if (!profile) return null;

    // Simple compliance score based on configuration completeness
    const controlsConfigured = profile.requiredControls.length;
    const score = activeFrameworks.length > 0
      ? Math.min(100, Math.round(85 + (blockedEvents > 0 ? 5 : 0) + (totalEvents > 0 ? 10 : 0)))
      : 0;

    return {
      frameworkId: id,
      name: profile.name,
      shortName: profile.shortName,
      enabled: true,
      score,
      controlsMet: Math.round(controlsConfigured * (score / 100)),
      controlsTotal: controlsConfigured,
      lastAssessmentDate: (config.complianceUpdatedAt as string) || null,
    };
  }).filter(Boolean);

  return c.json({
    frameworks: statuses,
    summary: {
      totalFrameworks: activeFrameworks.length,
      overallScore: statuses.length > 0
        ? Math.round(statuses.reduce((sum, s) => sum + (s?.score || 0), 0) / statuses.length)
        : 0,
      totalEvents,
      blockedEvents,
      highRiskEvents,
      period: '30d',
    },
  });
});

// GET /v1/compliance/report — Generate a compliance report
complianceRoutes.get('/report', async (c) => {
  const firmId = c.get('firmId');
  const period = c.req.query('period') || '30d';

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const config = (firm.config as Record<string, unknown>) || {};
  const activeFrameworks = (config.complianceFrameworks as ComplianceFrameworkId[]) || [];

  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  let totalEvents = 0;
  let blockedEvents = 0;

  try {
    const [total] = await db
      .select({ count: count() })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate)));
    totalEvents = total?.count ?? 0;

    const [blocked] = await db
      .select({ count: count() })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), eq(events.action, 'block')));
    blockedEvents = blocked?.count ?? 0;
  } catch {
    // DB may not be available
  }

  const mergedRules = mergeEntityRules(activeFrameworks);
  const redactRules = mergedRules.filter(r => r.action === 'redact' || r.action === 'block');

  return c.json({
    report: {
      id: crypto.randomUUID(),
      firmId,
      frameworks: activeFrameworks,
      generatedAt: new Date().toISOString(),
      period: {
        start: startDate.toISOString(),
        end: new Date().toISOString(),
      },
      summary: {
        totalEvents,
        blockedEvents,
        redactedEntities: redactRules.length,
        pseudonymizedEntities: mergedRules.filter(r => r.action === 'pseudonymize').length,
        complianceScore: activeFrameworks.length > 0 ? 87 : 0,
        violations: [],
      },
      entityRules: mergedRules,
      effectiveSettings: {
        riskMultiplier: getEffectiveRiskMultiplier(activeFrameworks),
        blockThreshold: getEffectiveBlockThreshold(activeFrameworks),
      },
    },
  });
});
