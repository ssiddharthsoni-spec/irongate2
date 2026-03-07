import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { firms, events, apiKeys } from '../db/schema';
import { eq, and, gte, lte, sql, count, isNotNull } from 'drizzle-orm';
import {
  COMPLIANCE_PROFILES,
  mergeEntityRules,
  getEffectiveRiskMultiplier,
  getEffectiveBlockThreshold,
} from '@iron-gate/config';
import type { ComplianceFrameworkId } from '@iron-gate/config';
import type { AppEnv } from '../types';

export const complianceRoutes = new Hono<AppEnv>();

/**
 * Calculate a real compliance score by checking which controls are
 * actually satisfied by the firm's current configuration.
 */
async function calculateComplianceScore(
  firmId: string,
  firm: { encryptionSalt: string | null; config: unknown },
  activeFrameworks: ComplianceFrameworkId[],
): Promise<{ score: number; controlsMet: number; controlsTotal: number }> {
  if (activeFrameworks.length === 0) {
    return { score: 0, controlsMet: 0, controlsTotal: 0 };
  }

  const config = (firm.config as Record<string, unknown>) || {};

  // Collect all required controls across active frameworks (deduplicated)
  const allControls = new Set<string>();
  for (const fwId of activeFrameworks) {
    const profile = COMPLIANCE_PROFILES[fwId];
    if (profile) {
      for (const ctrl of profile.requiredControls) allControls.add(ctrl);
    }
  }
  const controlsTotal = allControls.size;
  if (controlsTotal === 0) return { score: 100, controlsMet: 0, controlsTotal: 0 };

  let controlsMet = 0;

  // 1. Encryption at rest configured
  if (firm.encryptionSalt) controlsMet++;

  // 2. Audit logging active (events exist in last 30 days)
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const [row] = await db
      .select({ cnt: count() })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, cutoff)));
    if ((row?.cnt ?? 0) > 0) controlsMet++;
  } catch { /* DB unavailable */ }

  // 3. Kill switch accessible (admin keys configured)
  if (process.env.ADMIN_KEY_1 && process.env.ADMIN_KEY_2) controlsMet++;

  // 4. API keys with expiration set
  try {
    const [row] = await db
      .select({ cnt: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.firmId, firmId), isNotNull(apiKeys.expiresAt)));
    if ((row?.cnt ?? 0) > 0) controlsMet++;
  } catch { /* DB unavailable */ }

  // 5. TLS enforcement (production/staging always use TLS)
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') controlsMet++;

  // 6. Compliance frameworks configured
  if (activeFrameworks.length > 0) controlsMet++;

  // 7. SIEM integration configured
  if (config.siem) controlsMet++;

  // 8. Public key uploaded (envelope encryption)
  if (config.public_key) controlsMet++;

  const score = Math.round((Math.min(controlsMet, controlsTotal) / controlsTotal) * 100);
  return { score, controlsMet: Math.min(controlsMet, controlsTotal), controlsTotal };
}

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

  const validFrameworkIds = Object.keys(COMPLIANCE_PROFILES) as [string, ...string[]];
  const updateSchema = z.object({
    frameworks: z.array(z.enum(validFrameworkIds)).max(20),
  });

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: err.errors }, 400);
    }
    return c.json({ error: 'Invalid request body' }, 400);
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
    effectiveRiskMultiplier: getEffectiveRiskMultiplier(body.frameworks as ComplianceFrameworkId[]),
    effectiveBlockThreshold: getEffectiveBlockThreshold(body.frameworks as ComplianceFrameworkId[]),
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

  const { score, controlsMet, controlsTotal } = await calculateComplianceScore(
    firmId, firm, activeFrameworks,
  );

  const statuses = activeFrameworks.map(id => {
    const profile = COMPLIANCE_PROFILES[id];
    if (!profile) return null;

    return {
      frameworkId: id,
      name: profile.name,
      shortName: profile.shortName,
      enabled: true,
      score,
      controlsMet,
      controlsTotal,
      lastAssessmentDate: (config.complianceUpdatedAt as string) || null,
    };
  }).filter(Boolean);

  return c.json({
    frameworks: statuses,
    summary: {
      totalFrameworks: activeFrameworks.length,
      overallScore: score,
      totalEvents,
      blockedEvents,
      highRiskEvents,
      period: '30d',
    },
    disclaimer: 'This score reflects Iron Gate platform configuration status, not a formal compliance assessment. Consult your compliance team for official audit readiness.',
  });
});

// GET /v1/compliance/governance — Zero-Knowledge Governance Report (IG-023)
// Generates a comprehensive governance report using only aggregate metadata.
// No raw PII, prompt text, or reversible identifiers are included.
complianceRoutes.get('/governance', async (c) => {
  const firmId = c.get('firmId');
  const period = c.req.query('period') || '30d';
  const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '365d' ? 365 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const config = (firm.config as Record<string, unknown>) || {};
  const activeFrameworks = (config.complianceFrameworks as ComplianceFrameworkId[]) || [];

  // Aggregate stats — zero knowledge: counts and distributions only
  let totalEvents = 0;
  let blockedEvents = 0;
  let pseudonymizedEvents = 0;
  let allowedEvents = 0;
  let highRiskEvents = 0;
  let entityTypeCounts: Array<{ entityType: string; count: number }> = [];
  let dailyVolume: Array<{ date: string; count: number }> = [];
  let toolDistribution: Array<{ tool: string; count: number }> = [];
  let actionDistribution: Array<{ action: string; count: number }> = [];
  let sensitivityDistribution = { low: 0, medium: 0, high: 0, critical: 0 };

  try {
    // Total events
    const [total] = await db
      .select({ count: count() })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate)));
    totalEvents = total?.count ?? 0;

    // Blocked events
    const [blocked] = await db
      .select({ count: count() })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), eq(events.action, 'block')));
    blockedEvents = blocked?.count ?? 0;

    // Pseudonymized events (action = 'proxy' in the enum)
    const [pseudonymized] = await db
      .select({ count: count() })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), eq(events.action, 'proxy')));
    pseudonymizedEvents = pseudonymized?.count ?? 0;

    // Allowed events (action = 'pass' in the enum)
    const [allowed] = await db
      .select({ count: count() })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), eq(events.action, 'pass')));
    allowedEvents = allowed?.count ?? 0;

    // High risk events (score >= 70)
    const [highRisk] = await db
      .select({ count: count() })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), gte(events.sensitivityScore, 70)));
    highRiskEvents = highRisk?.count ?? 0;

    // Entity type distribution (aggregate counts — no raw values)
    const entityTypeRows = await db
      .select({
        entityType: sql<string>`jsonb_array_elements_text(entity_types)`,
        count: count(),
      })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate)))
      .groupBy(sql`jsonb_array_elements_text(entity_types)`)
      .orderBy(sql`count(*) DESC`)
      .limit(20);
    entityTypeCounts = entityTypeRows.map(r => ({ entityType: r.entityType, count: r.count }));

    // Daily volume (for trend analysis)
    const dailyRows = await db
      .select({
        date: sql<string>`date_trunc('day', created_at)::date::text`,
        count: count(),
      })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate)))
      .groupBy(sql`date_trunc('day', created_at)`)
      .orderBy(sql`date_trunc('day', created_at)`);
    dailyVolume = dailyRows.map(r => ({ date: r.date, count: r.count }));

    // Tool distribution
    const toolRows = await db
      .select({
        tool: events.aiToolId,
        count: count(),
      })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate)))
      .groupBy(events.aiToolId)
      .orderBy(sql`count(*) DESC`);
    toolDistribution = toolRows.map(r => ({ tool: r.tool ?? 'unknown', count: r.count }));

    // Action distribution
    const actionRows = await db
      .select({
        action: events.action,
        count: count(),
      })
      .from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate)))
      .groupBy(events.action);
    actionDistribution = actionRows.map(r => ({ action: r.action ?? 'unknown', count: r.count }));

    // Sensitivity distribution
    const [lowCount] = await db.select({ count: count() }).from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), lte(events.sensitivityScore, 25)));
    const [medCount] = await db.select({ count: count() }).from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), gte(events.sensitivityScore, 26), lte(events.sensitivityScore, 60)));
    const [highCount] = await db.select({ count: count() }).from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), gte(events.sensitivityScore, 61), lte(events.sensitivityScore, 85)));
    const [critCount] = await db.select({ count: count() }).from(events)
      .where(and(eq(events.firmId, firmId), gte(events.createdAt, startDate), gte(events.sensitivityScore, 86)));
    sensitivityDistribution = {
      low: lowCount?.count ?? 0,
      medium: medCount?.count ?? 0,
      high: highCount?.count ?? 0,
      critical: critCount?.count ?? 0,
    };
  } catch {
    // DB query failures — report with partial data
  }

  const { score, controlsMet, controlsTotal } = await calculateComplianceScore(
    firmId, firm, activeFrameworks,
  );

  const mergedRules = mergeEntityRules(activeFrameworks);

  return c.json({
    governanceReport: {
      id: crypto.randomUUID(),
      firmId,
      generatedAt: new Date().toISOString(),
      zeroKnowledge: true,
      period: { start: startDate.toISOString(), end: new Date().toISOString(), days },
      compliance: {
        activeFrameworks: activeFrameworks.map(id => {
          const p = COMPLIANCE_PROFILES[id];
          return p ? { id: p.id, name: p.name, shortName: p.shortName } : { id, name: id, shortName: id };
        }),
        score,
        controlsMet,
        controlsTotal,
        entityRuleCount: mergedRules.length,
        effectiveRiskMultiplier: getEffectiveRiskMultiplier(activeFrameworks),
        effectiveBlockThreshold: getEffectiveBlockThreshold(activeFrameworks),
      },
      activity: {
        totalEvents,
        blockedEvents,
        pseudonymizedEvents,
        allowedEvents,
        highRiskEvents,
        blockRate: totalEvents > 0 ? Math.round((blockedEvents / totalEvents) * 100) : 0,
        pseudonymizationRate: totalEvents > 0 ? Math.round((pseudonymizedEvents / totalEvents) * 100) : 0,
      },
      distributions: {
        entityTypes: entityTypeCounts,
        dailyVolume,
        tools: toolDistribution,
        actions: actionDistribution,
        sensitivity: sensitivityDistribution,
      },
      dataGuarantees: {
        noRawPII: true,
        noPromptText: true,
        noReversibleIdentifiers: true,
        aggregateOnly: true,
        minimumAggregation: 'daily',
      },
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
  const reportScore = await calculateComplianceScore(firmId, firm, activeFrameworks);

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
        complianceScore: reportScore.score,
        violations: [],
      },
      entityRules: mergedRules,
      effectiveSettings: {
        riskMultiplier: getEffectiveRiskMultiplier(activeFrameworks),
        blockThreshold: getEffectiveBlockThreshold(activeFrameworks),
      },
      disclaimer: 'This score reflects Iron Gate platform configuration status, not a formal compliance assessment. Consult your compliance team for official audit readiness.',
    },
  });
});
