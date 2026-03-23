import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/client';
import { firms, users, clientMatters, weightOverrides, firmPlugins, events, subscriptions, featureFlags, departments, departmentPolicies, incidents, entityDictionaries, auditLog, conversationState } from '../db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { invalidateDepartmentPolicyCache } from '../middleware/department-policy';
import { analyzePatterns, getProposals, approveProposal, rejectProposal } from '../services/inference-engine';
import { computeAdaptiveWeights, getWeightOverrides } from '../services/adaptive-weights';
import { handleFederatedAggregation } from '../jobs/federated-aggregator';
import { getZoneAnalytics } from '../services/zone-analytics';
import { registerWebhook, removeWebhook, listWebhooks } from '../services/webhook-dispatcher';
import { invalidateCache } from '../services/plugin-loader';
import { processFeedback } from '../services/feedback-processor';
import { invalidateUserCache } from '../middleware/auth';
import { sanitizeInput, sanitizeUrl } from '../lib/sanitize';
import { requirePerm } from '../middleware/rbac';
import { mdmRoutes } from './mdm';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';
import type { Context } from 'hono';

export const adminRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Audit logging helper — fire-and-forget, never blocks the request
// ---------------------------------------------------------------------------

// BUG-13: Returns a promise — callers should `await` for sensitive operations
// (user management, role changes) but can fire-and-forget for non-critical events
async function logAdminAction(
  c: Context<AppEnv>,
  action: string,
  resourceType: string,
  opts?: {
    resourceId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  const firmId = c.get('firmId');
  const actorId = c.get('userId');
  const ipAddress = c.req.header('cf-connecting-ip')
    || c.req.header('x-render-client-ip')
    || (c.req.header('x-forwarded-for') || '').split(',')[0].trim()
    || null;

  try {
    await db.insert(auditLog)
      .values({
        firmId,
        actorId,
        actorEmail: null, // populated if available via join, not critical
        action,
        resourceType,
        resourceId: opts?.resourceId || null,
        oldValue: opts?.oldValue != null ? opts.oldValue : null,
        newValue: opts?.newValue != null ? opts.newValue : null,
        ipAddress,
        userAgent: c.req.header('user-agent') || null,
      });
  } catch (err) {
    logger.warn('Audit log insert failed', { error: String(err) });
  }
}

// Mount MDM config export sub-routes under /mdm/*
adminRoutes.route('/mdm', mdmRoutes);

// ---------------------------------------------------------------------------
// Granular RBAC — write operations require specific permissions beyond
// the blanket 'viewDashboard' check applied at the app-level router.
// ---------------------------------------------------------------------------

// Firm config mutations require admin-level access
adminRoutes.post('/firm', requirePerm('setSensitivityThresholds'));
adminRoutes.put('/firm', requirePerm('setSensitivityThresholds'));

// User management requires invite/role-change permissions
adminRoutes.get('/users', requirePerm('viewFirmAnalytics'));

// Client matter mutations
adminRoutes.post('/client-matters', requirePerm('addCustomEntityPatterns'));

// Weight overrides (detection tuning)
adminRoutes.put('/weight-overrides', requirePerm('setSensitivityThresholds'));
adminRoutes.delete('/weight-overrides/:entityType', requirePerm('setSensitivityThresholds'));

// Intent weight overrides
adminRoutes.get('/intent-weights', requirePerm('setSensitivityThresholds'));
adminRoutes.put('/intent-weights', requirePerm('setSensitivityThresholds'));
adminRoutes.delete('/intent-weights', requirePerm('setSensitivityThresholds'));

// Inferred entity management
adminRoutes.post('/inferred-entities/analyze', requirePerm('addCustomEntityPatterns'));
adminRoutes.put('/inferred-entities/:id', requirePerm('addCustomEntityPatterns'));

// Webhook management
adminRoutes.post('/webhooks', requirePerm('manageWebhooks'));
adminRoutes.delete('/webhooks/:id', requirePerm('manageWebhooks'));

// SIEM configuration
adminRoutes.put('/siem', requirePerm('configureSIEM'));

// Plugin management
adminRoutes.post('/plugins', requirePerm('addCustomEntityPatterns'));
adminRoutes.put('/plugins/:id', requirePerm('addCustomEntityPatterns'));
adminRoutes.delete('/plugins/:id', requirePerm('addCustomEntityPatterns'));

// Feedback weight recalculation
adminRoutes.post('/recalculate-weights', requirePerm('setSensitivityThresholds'));

// Feature flags
adminRoutes.put('/feature-flags', requirePerm('setSensitivityThresholds'));
adminRoutes.delete('/feature-flags/:key', requirePerm('setSensitivityThresholds'));

// Department management
adminRoutes.post('/departments', requirePerm('setSensitivityThresholds'));
adminRoutes.put('/departments/:id', requirePerm('setSensitivityThresholds'));
adminRoutes.delete('/departments/:id', requirePerm('removeUsers'));
adminRoutes.put('/departments/:id/policies', requirePerm('setSensitivityThresholds'));

// Audit log export
adminRoutes.get('/audit-log/export', requirePerm('viewFirmAnalytics'));

// Session revocation
adminRoutes.post('/users/:userId/revoke-sessions', requirePerm('removeUsers'));
adminRoutes.post('/revoke-all-sessions', requirePerm('removeUsers'));

// GET /v1/admin/firm — Get firm configuration
adminRoutes.get('/firm', async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) {
    return c.json({ error: 'Firm not found' }, 404);
  }

  // Strip sensitive credentials from config before returning
  const config = (firm.config ?? {}) as Record<string, any>;
  const safeConfig = { ...config };
  if (safeConfig.llm) {
    const safeLlm = { ...safeConfig.llm };
    for (const provider of ['openai', 'anthropic', 'azure'] as const) {
      if (safeLlm[provider]?.apiKey) {
        safeLlm[provider] = { ...safeLlm[provider], apiKey: `****${safeLlm[provider].apiKey.slice(-4)}` };
      }
    }
    safeConfig.llm = safeLlm;
  }
  if (safeConfig.siem?.token) {
    safeConfig.siem = { ...safeConfig.siem, token: `****${safeConfig.siem.token.slice(-4)}` };
  }

  // Flag if the user is still on the default/placeholder firm (hasn't completed onboarding)
  const isDefaultFirm = firmId === process.env.DEFAULT_FIRM_ID;

  return c.json({ ...firm, config: safeConfig, isDefaultFirm });
});

// POST /v1/admin/firm — Create firm during onboarding
adminRoutes.post('/firm', async (c) => {
  const userId = c.get('userId');
  const clerkId = c.get('clerkId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const createSchema = z.object({
    firmName: z.string().min(1).max(255),
    industry: z.string().optional(),
    firmSize: z.string().optional(),
    protectionMode: z.enum(['audit', 'proxy']).optional().default('proxy'),
    thresholds: z.object({
      warn: z.number().min(0).max(100).optional().default(30),
      block: z.number().min(0).max(100).optional().default(60),
      proxy: z.number().min(0).max(100).optional().default(80),
    }).optional(),
    teamMembers: z.array(z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'user']).optional().default('user'),
    })).optional().default([]),
  });

  const parsed = createSchema.parse(body);

  // Create the new firm
  const encryptionSalt = crypto.randomBytes(16).toString('hex');
  const [newFirm] = await db
    .insert(firms)
    .values({
      name: sanitizeInput(parsed.firmName),
      mode: parsed.protectionMode,
      config: {
        industry: parsed.industry ? sanitizeInput(parsed.industry) : undefined,
        firmSize: parsed.firmSize ? sanitizeInput(parsed.firmSize) : undefined,
        thresholds: parsed.thresholds,
      },
      encryptionSalt,
    })
    .returning();

  // Move the calling user to the new firm
  await db
    .update(users)
    .set({ firmId: newFirm.id, role: 'admin', updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Invalidate cached user so next request picks up the new firmId
  invalidateUserCache(clerkId);

  // Auto-start 15-day Pro trial (no credit card required)
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 15);

  await db.insert(subscriptions).values({
    firmId: newFirm.id,
    stripeCustomerId: `trial_${newFirm.id}`,
    tier: 'pro',
    status: 'trialing',
    currentPeriodStart: new Date(),
    currentPeriodEnd: trialEnd,
  });

  logAdminAction(c, 'firm.create', 'firm', { resourceId: newFirm.id, newValue: { name: parsed.firmName, mode: parsed.protectionMode } });
  return c.json(newFirm, 201);
});

// PUT /v1/admin/firm — Update firm configuration
adminRoutes.put('/firm', async (c) => {
  const firmId = c.get('firmId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const updateSchema = z.object({
    name: z.string().optional(),
    mode: z.enum(['audit', 'proxy']).optional(),
    config: z.record(z.unknown()).optional(),
  });

  const parsed = updateSchema.parse(body);

  const [updated] = await db
    .update(firms)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(firms.id, firmId))
    .returning();

  if (!updated) return c.json({ error: 'Firm not found' }, 404);

  logAdminAction(c, 'firm.update', 'firm', { resourceId: updated.id, newValue: parsed });
  return c.json(updated);
});

// GET /v1/admin/users — List firm users (paginated, max 100)
adminRoutes.get('/users', async (c) => {
  const firmId = c.get('firmId');
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100), 100);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);

  const firmUsers = await db
    .select()
    .from(users)
    .where(eq(users.firmId, firmId))
    .limit(limit)
    .offset(offset);

  return c.json({ users: firmUsers, limit, offset });
});

// POST /v1/admin/client-matters — Import client/matter data
adminRoutes.post('/client-matters', async (c) => {
  const firmId = c.get('firmId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const matterSchema = z.object({
    matters: z.array(z.object({
      clientName: z.string().max(500),
      aliases: z.array(z.string().max(200)).max(50).optional().default([]),
      matterNumber: z.string().max(100).optional(),
      matterDescription: z.string().max(2000).optional(),
      parties: z.array(z.string().max(200)).max(100).optional().default([]),
      sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
    })).max(10000),
  });

  const parsed = matterSchema.parse(body);

  const values = parsed.matters.map((m) => ({
    firmId,
    clientName: m.clientName,
    aliases: m.aliases,
    matterNumber: m.matterNumber,
    matterDescription: m.matterDescription,
    parties: m.parties,
    sensitivityLevel: m.sensitivityLevel as any,
  }));

  const inserted = await db.insert(clientMatters).values(values).returning({ id: clientMatters.id });

  logAdminAction(c, 'client_matters.import', 'client_matter', { newValue: { count: inserted.length } });
  return c.json({ imported: inserted.length });
});

// GET /v1/admin/client-matters — List client/matters (paginated)
adminRoutes.get('/client-matters', async (c) => {
  const firmId = c.get('firmId');
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '100')), 1000);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0'));

  const [matters, [countResult]] = await Promise.all([
    db.select().from(clientMatters).where(eq(clientMatters.firmId, firmId)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(clientMatters).where(eq(clientMatters.firmId, firmId)),
  ]);

  return c.json({ matters, total: Number(countResult?.total || 0), limit, offset });
});

// GET /v1/admin/weight-overrides — Get firm weight overrides
adminRoutes.get('/weight-overrides', async (c) => {
  const firmId = c.get('firmId');

  const overrides = await db
    .select()
    .from(weightOverrides)
    .where(eq(weightOverrides.firmId, firmId));

  return c.json(overrides);
});

// PUT /v1/admin/weight-overrides — Update or create a weight override
adminRoutes.put('/weight-overrides', async (c) => {
  const firmId = c.get('firmId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const overrideSchema = z.object({
    entityType: z.string().min(1),
    weight: z.number().min(0.1).max(3.0),
  });
  const parsed = overrideSchema.parse(body);

  const [upserted] = await db
    .insert(weightOverrides)
    .values({
      firmId,
      entityType: parsed.entityType,
      weightMultiplier: parsed.weight,
      sampleCount: 0,
      lastUpdated: new Date(),
    })
    .onConflictDoUpdate({
      target: [weightOverrides.firmId, weightOverrides.entityType],
      set: {
        weightMultiplier: parsed.weight,
        lastUpdated: new Date(),
      },
    })
    .returning();

  logAdminAction(c, 'weight_override.upsert', 'weight_override', { newValue: { entityType: parsed.entityType, weight: parsed.weight } });
  return c.json(upserted);
});

// DELETE /v1/admin/weight-overrides/:entityType — Remove a weight override
adminRoutes.delete('/weight-overrides/:entityType', async (c) => {
  const firmId = c.get('firmId');
  const entityType = c.req.param('entityType');

  await db
    .delete(weightOverrides)
    .where(and(eq(weightOverrides.firmId, firmId), eq(weightOverrides.entityType, entityType)));

  logAdminAction(c, 'weight_override.delete', 'weight_override', { oldValue: { entityType } });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Inferred Entities (Phase 4)
// ---------------------------------------------------------------------------

// GET /v1/admin/inferred-entities — List pending proposals
adminRoutes.get('/inferred-entities', async (c) => {
  const firmId = c.get('firmId');
  const proposals = await getProposals(firmId);
  return c.json(proposals);
});

// POST /v1/admin/inferred-entities/analyze — Trigger pattern analysis
adminRoutes.post('/inferred-entities/analyze', async (c) => {
  const firmId = c.get('firmId');
  const results = await analyzePatterns(firmId);
  logAdminAction(c, 'inferred_entities.analyze', 'inferred_entity', { newValue: { discovered: results.length } });
  return c.json({ discovered: results.length, results });
});

// PUT /v1/admin/inferred-entities/:id — Approve or reject
adminRoutes.put('/inferred-entities/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const actionSchema = z.object({
    action: z.enum(['approve', 'reject']),
  });
  const parsed = actionSchema.parse(body);

  const firmId = c.get('firmId');
  if (parsed.action === 'approve') {
    await approveProposal(id, userId, firmId);
  } else {
    await rejectProposal(id, userId, firmId);
  }

  logAdminAction(c, `inferred_entity.${parsed.action}`, 'inferred_entity', { resourceId: id });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Webhooks (Phase 7)
// ---------------------------------------------------------------------------

// GET /v1/admin/webhooks — List webhook subscriptions
adminRoutes.get('/webhooks', async (c) => {
  const firmId = c.get('firmId');
  const webhooks = await listWebhooks(firmId);
  return c.json(webhooks);
});

// POST /v1/admin/webhooks — Register new webhook
adminRoutes.post('/webhooks', async (c) => {
  const firmId = c.get('firmId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const webhookSchema = z.object({
    url: z.string().url(),
    secret: z.string().min(16),
    eventTypes: z.array(z.string()).min(1),
  });
  const parsed = webhookSchema.parse(body);

  // SSRF protection: reject webhook URLs pointing to private/internal networks
  try {
    const urlObj = new URL(parsed.url);
    const hostname = urlObj.hostname.toLowerCase();

    // Strip IPv6 brackets for consistent matching
    const bare = hostname.replace(/^\[|\]$/g, '');

    // Block known internal hostnames
    const blockedHosts = new Set([
      'localhost', '127.0.0.1', '0.0.0.0', '::1', '::',
      '0000:0000:0000:0000:0000:0000:0000:0001', // long-form ::1
      'metadata.google.internal', 'metadata.google',
      '169.254.169.254', // AWS/GCP metadata
    ]);

    // Block IPv4 private ranges
    const blockedIPv4Prefixes = [
      '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
      '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
      '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '169.254.', '0.',
    ];

    // Block IPv6 private/link-local ranges and IPv4-mapped IPv6 addresses
    const blockedIPv6Prefixes = [
      'fc', 'fd',    // unique local (RFC 4193)
      'fe80',        // link-local
      '::ffff:10.',  // IPv4-mapped private
      '::ffff:172.', // IPv4-mapped private
      '::ffff:192.168.', // IPv4-mapped private
      '::ffff:127.', // IPv4-mapped loopback
      '::ffff:169.254.', // IPv4-mapped link-local
      '::ffff:0.',   // IPv4-mapped zero
      '0000:',       // long-form zero prefix
    ];

    const isBlocked = blockedHosts.has(bare)
      || blockedIPv4Prefixes.some(p => bare.startsWith(p))
      || blockedIPv6Prefixes.some(p => bare.startsWith(p))
      || bare === '0' || bare === '0.0.0.0'
      || /^[0:]+1?$/.test(bare); // catches ::, ::0, ::1 variants

    if (isBlocked) {
      return c.json({ error: 'Webhook URL must point to a public endpoint' }, 400);
    }
    if (urlObj.protocol !== 'https:') {
      return c.json({ error: 'Webhook URL must use HTTPS' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid webhook URL' }, 400);
  }

  const sub = await registerWebhook(firmId, parsed.url, parsed.secret, parsed.eventTypes);
  logAdminAction(c, 'webhook.create', 'webhook', { resourceId: sub.id, newValue: { url: parsed.url, eventTypes: parsed.eventTypes } });
  return c.json(sub, 201);
});

// DELETE /v1/admin/webhooks/:id — Remove webhook
adminRoutes.delete('/webhooks/:id', async (c) => {
  const id = c.req.param('id');
  const firmId = c.get('firmId');
  const deleted = await removeWebhook(id, firmId);
  if (!deleted) {
    return c.json({ error: 'Webhook not found' }, 404);
  }
  logAdminAction(c, 'webhook.delete', 'webhook', { resourceId: id });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// SIEM Configuration (Phase 7)
// ---------------------------------------------------------------------------

// PUT /v1/admin/siem — Configure SIEM endpoint
adminRoutes.put('/siem', async (c) => {
  const firmId = c.get('firmId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const siemSchema = z.object({
    enabled: z.boolean(),
    provider: z.enum(['splunk', 'datadog', 'generic', 'sentinel']),
    url: z.string().url(),
    token: z.string().min(1),
    format: z.enum(['json', 'cef', 'asim']).optional().default('json'),
  });
  const parsed = siemSchema.parse(body);

  // SSRF protection: reject SIEM URLs pointing to private/internal networks
  try {
    const urlObj = new URL(parsed.url);
    const hostname = urlObj.hostname.toLowerCase();
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'metadata.google.internal'];
    const blockedPrefixes = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
      '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
      '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '169.254.'];
    if (blockedHosts.includes(hostname) || blockedPrefixes.some(p => hostname.startsWith(p))) {
      return c.json({ error: 'SIEM URL must point to a public endpoint' }, 400);
    }
    if (urlObj.protocol !== 'https:') {
      return c.json({ error: 'SIEM URL must use HTTPS' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid SIEM URL' }, 400);
  }

  // Store SIEM config in firms.config.siem
  const [firm] = await db.select({ config: firms.config }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);
  const existingConfig = (firm.config as Record<string, unknown>) || {};

  const [updated] = await db
    .update(firms)
    .set({
      config: { ...existingConfig, siem: parsed },
      updatedAt: new Date(),
    })
    .where(eq(firms.id, firmId))
    .returning();

  logAdminAction(c, 'siem.configure', 'siem', { newValue: { provider: parsed.provider, enabled: parsed.enabled, format: parsed.format } });
  return c.json({ ok: true, siem: parsed });
});

// ---------------------------------------------------------------------------
// Plugins (Phase 8)
// ---------------------------------------------------------------------------

// GET /v1/admin/plugins — List installed plugins
adminRoutes.get('/plugins', async (c) => {
  const firmId = c.get('firmId');
  const plugins = await db
    .select()
    .from(firmPlugins)
    .where(eq(firmPlugins.firmId, firmId));
  return c.json(plugins);
});

// POST /v1/admin/plugins — Upload a new plugin
adminRoutes.post('/plugins', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const pluginSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().default(''),
    version: z.string().optional().default('1.0.0'),
    code: z.string().min(1).max(50000),
    entityTypes: z.array(z.string()).min(1),
  });
  const parsed = pluginSchema.parse(body);

  const [plugin] = await db
    .insert(firmPlugins)
    .values({
      firmId,
      name: sanitizeInput(parsed.name),
      description: sanitizeInput(parsed.description),
      version: parsed.version,
      code: parsed.code, // Plugin code is sandboxed, not rendered in HTML
      entityTypes: parsed.entityTypes,
      isActive: true,
      hitCount: 0,
      falsePositiveRate: 0,
      createdBy: userId,
    })
    .returning();

  invalidateCache(firmId);
  logAdminAction(c, 'plugin.create', 'plugin', { resourceId: plugin.id, newValue: { name: parsed.name, version: parsed.version } });
  return c.json(plugin, 201);
});

// PUT /v1/admin/plugins/:id — Enable or disable a plugin
adminRoutes.put('/plugins/:id', async (c) => {
  const id = c.req.param('id');
  const firmId = c.get('firmId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const updateSchema = z.object({
    isActive: z.boolean().optional(),
    code: z.string().min(1).max(50000).optional(),
  });
  const parsed = updateSchema.parse(body);

  const [updated] = await db
    .update(firmPlugins)
    .set({ ...parsed, updatedAt: new Date() })
    .where(and(eq(firmPlugins.id, id), eq(firmPlugins.firmId, firmId)))
    .returning();

  if (!updated) {
    return c.json({ error: 'Plugin not found' }, 404);
  }

  invalidateCache(firmId);
  logAdminAction(c, 'plugin.update', 'plugin', { resourceId: id, newValue: parsed });
  return c.json(updated);
});

// GET /v1/admin/plugins/:id/stats — Get plugin statistics
adminRoutes.get('/plugins/:id/stats', async (c) => {
  const firmId = c.get('firmId');
  const pluginId = c.req.param('id');

  const [plugin] = await db
    .select({
      id: firmPlugins.id,
      name: firmPlugins.name,
      hitCount: firmPlugins.hitCount,
      falsePositiveRate: firmPlugins.falsePositiveRate,
      lastTriggered: firmPlugins.updatedAt,
      entityTypes: firmPlugins.entityTypes,
      isActive: firmPlugins.isActive,
    })
    .from(firmPlugins)
    .where(and(eq(firmPlugins.id, pluginId), eq(firmPlugins.firmId, firmId)))
    .limit(1);

  if (!plugin) {
    return c.json({ error: 'Plugin not found' }, 404);
  }

  return c.json(plugin);
});

// DELETE /v1/admin/plugins/:id — Remove a plugin
adminRoutes.delete('/plugins/:id', async (c) => {
  const id = c.req.param('id');
  const firmId = c.get('firmId');

  await db.delete(firmPlugins).where(and(eq(firmPlugins.id, id), eq(firmPlugins.firmId, firmId)));
  invalidateCache(firmId);
  logAdminAction(c, 'plugin.delete', 'plugin', { resourceId: id });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Feedback & Weights (Phase 10)
// ---------------------------------------------------------------------------

// POST /v1/admin/recalculate-weights — Trigger feedback processing
adminRoutes.post('/recalculate-weights', async (c) => {
  const firmId = c.get('firmId');
  const results = await processFeedback(firmId);
  logAdminAction(c, 'weights.recalculate', 'weight_override', { newValue: { processed: results.length } });
  return c.json({ processed: results.length, stats: results });
});

// ---------------------------------------------------------------------------
// Analytics (User activity & login tracking)
// ---------------------------------------------------------------------------

// GET /v1/admin/analytics — User activity overview
adminRoutes.get('/analytics', async (c) => {
  const firmId = c.get('firmId');
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [userStats, firmUsers, signupTrend, totalInteractions, userEventCounts] = await Promise.all([
    // Aggregate user counts
    db.select({
      totalUsers: sql<number>`count(*)`,
      activeNow: sql<number>`count(*) filter (where ${users.updatedAt} >= ${fiveMinAgo})`,
      activeToday: sql<number>`count(*) filter (where ${users.updatedAt} >= ${todayStart})`,
    }).from(users).where(eq(users.firmId, firmId)),

    // Per-user details
    db.select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      updatedAt: users.updatedAt,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.firmId, firmId)).orderBy(desc(users.updatedAt)),

    // Signup trend (last 30 days)
    db.select({
      date: sql<string>`date_trunc('day', ${users.createdAt})::date::text`,
      count: sql<number>`count(*)`,
    }).from(users)
      .where(and(eq(users.firmId, firmId), gte(users.createdAt, thirtyDaysAgo)))
      .groupBy(sql`date_trunc('day', ${users.createdAt})`)
      .orderBy(sql`date_trunc('day', ${users.createdAt})`),

    // Total interaction count
    db.select({
      total: sql<number>`count(*)`,
    }).from(events).where(eq(events.firmId, firmId)),

    // Per-user interaction counts
    db.select({
      userId: events.userId,
      interactions: sql<number>`count(*)`,
    }).from(events)
      .where(eq(events.firmId, firmId))
      .groupBy(events.userId),
  ]);

  const eventCountMap = new Map(
    userEventCounts.map(u => [u.userId, Number(u.interactions)])
  );

  const usersWithStatus = firmUsers.map(u => ({
    id: u.id,
    name: u.displayName || u.email.split('@')[0],
    email: u.email,
    role: u.role,
    lastActive: u.updatedAt?.toISOString() || null,
    interactions: eventCountMap.get(u.id) || 0,
    status: (u.updatedAt && u.updatedAt >= fiveMinAgo ? 'online' : 'offline') as 'online' | 'offline',
    createdAt: u.createdAt.toISOString(),
  }));

  return c.json({
    summary: {
      totalUsers: Number(userStats[0]?.totalUsers || 0),
      activeNow: Number(userStats[0]?.activeNow || 0),
      activeToday: Number(userStats[0]?.activeToday || 0),
      totalInteractions: Number(totalInteractions[0]?.total || 0),
    },
    users: usersWithStatus,
    signupTrend: signupTrend.map(d => ({
      date: d.date,
      count: Number(d.count),
    })),
  });
});

// ---------------------------------------------------------------------------
// Feature Flags
// ---------------------------------------------------------------------------

adminRoutes.get('/feature-flags', async (c) => {
  const firmId = c.get('firmId');
  const flags = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.firmId, firmId));
  return c.json({ flags });
});

adminRoutes.get('/feature-flags/:key', async (c) => {
  const firmId = c.get('firmId');
  const key = c.req.param('key');
  const [flag] = await db
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.firmId, firmId), eq(featureFlags.key, key)))
    .limit(1);
  if (!flag) return c.json({ key, enabled: false, exists: false });
  return c.json({ ...flag, exists: true });
});

adminRoutes.put('/feature-flags', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const schema = z.object({
    key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'Key must be lowercase snake_case'),
    enabled: z.boolean(),
    description: z.string().max(500).optional(),
    metadata: z.record(z.unknown()).optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  const [upserted] = await db
    .insert(featureFlags)
    .values({
      firmId,
      key: parsed.data.key,
      enabled: parsed.data.enabled,
      description: parsed.data.description ? sanitizeInput(parsed.data.description) : null,
      metadata: parsed.data.metadata || {},
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [featureFlags.firmId, featureFlags.key],
      set: {
        enabled: parsed.data.enabled,
        description: parsed.data.description ? sanitizeInput(parsed.data.description) : null,
        metadata: parsed.data.metadata || {},
        updatedAt: new Date(),
      },
    })
    .returning();

  logAdminAction(c, 'feature_flag.upsert', 'feature_flag', { newValue: { key: parsed.data.key, enabled: parsed.data.enabled } });
  return c.json(upserted);
});

adminRoutes.delete('/feature-flags/:key', async (c) => {
  const firmId = c.get('firmId');
  const key = c.req.param('key');
  await db
    .delete(featureFlags)
    .where(and(eq(featureFlags.firmId, firmId), eq(featureFlags.key, key)));
  logAdminAction(c, 'feature_flag.delete', 'feature_flag', { oldValue: { key } });
  return c.json({ ok: true });
});

// GET /v1/admin/detection-health — Detection service health monitoring
adminRoutes.get('/detection-health', async (c) => {
  const { getDetectionClient } = await import('../proxy/detection-client');
  const client = getDetectionClient();

  const circuitState = client.getCircuitState();
  const serviceAvailable = client.isServiceAvailable();
  const healthOk = await client.healthCheck();

  return c.json({
    detectionService: {
      healthy: healthOk,
      circuitBreakerState: circuitState,
      serviceAvailable,
      fallback: !healthOk ? 'local_regex' : 'none',
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Departments & Department Policies
// ---------------------------------------------------------------------------

// GET /v1/admin/departments — List departments for firm
adminRoutes.get('/departments', async (c) => {
  const firmId = c.get('firmId');

  const depts = await db
    .select()
    .from(departments)
    .where(eq(departments.firmId, firmId))
    .orderBy(departments.name);

  return c.json({ departments: depts });
});

// POST /v1/admin/departments — Create a department
adminRoutes.post('/departments', async (c) => {
  const firmId = c.get('firmId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const createSchema = z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(1000).optional(),
    parentId: z.string().uuid().optional(),
  });

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  // If parentId is given, verify it belongs to the same firm
  if (parsed.data.parentId) {
    const [parent] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, parsed.data.parentId), eq(departments.firmId, firmId)))
      .limit(1);
    if (!parent) {
      return c.json({ error: 'Parent department not found' }, 404);
    }
  }

  try {
    const [dept] = await db
      .insert(departments)
      .values({
        firmId,
        name: sanitizeInput(parsed.data.name),
        description: parsed.data.description ? sanitizeInput(parsed.data.description) : null,
        parentId: parsed.data.parentId || null,
      })
      .returning();

    logAdminAction(c, 'department.create', 'department', { resourceId: dept.id, newValue: { name: parsed.data.name } });
    return c.json(dept, 201);
  } catch (err: any) {
    if (err?.code === '23505') {
      return c.json({ error: 'A department with this name already exists in your firm' }, 409);
    }
    throw err;
  }
});

// PUT /v1/admin/departments/:id — Update a department
adminRoutes.put('/departments/:id', async (c) => {
  const firmId = c.get('firmId');
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const updateSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional(),
    parentId: z.string().uuid().nullable().optional(),
  });

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  // Prevent setting parentId to self
  if (parsed.data.parentId === id) {
    return c.json({ error: 'A department cannot be its own parent' }, 400);
  }

  const sanitizedData: Record<string, any> = { updatedAt: new Date() };
  if (parsed.data.name) sanitizedData.name = sanitizeInput(parsed.data.name);
  if (parsed.data.description !== undefined) sanitizedData.description = parsed.data.description ? sanitizeInput(parsed.data.description) : null;
  if (parsed.data.parentId !== undefined) sanitizedData.parentId = parsed.data.parentId;

  const [updated] = await db
    .update(departments)
    .set(sanitizedData)
    .where(and(eq(departments.id, id), eq(departments.firmId, firmId)))
    .returning();

  if (!updated) {
    return c.json({ error: 'Department not found' }, 404);
  }

  logAdminAction(c, 'department.update', 'department', { resourceId: id, newValue: sanitizedData });
  return c.json(updated);
});

// DELETE /v1/admin/departments/:id — Delete a department
adminRoutes.delete('/departments/:id', async (c) => {
  const firmId = c.get('firmId');
  const id = c.req.param('id');

  // Delete associated policies first
  await db
    .delete(departmentPolicies)
    .where(and(eq(departmentPolicies.departmentId, id), eq(departmentPolicies.firmId, firmId)));

  // Clear users' departmentId references
  await db
    .update(users)
    .set({ departmentId: null, updatedAt: new Date() })
    .where(and(eq(users.departmentId, id), eq(users.firmId, firmId)));

  // Delete the department
  const deleted = await db
    .delete(departments)
    .where(and(eq(departments.id, id), eq(departments.firmId, firmId)))
    .returning({ id: departments.id });

  if (deleted.length === 0) {
    return c.json({ error: 'Department not found' }, 404);
  }

  // Invalidate policy cache
  invalidateDepartmentPolicyCache(id);

  logAdminAction(c, 'department.delete', 'department', { resourceId: id });
  return c.json({ ok: true });
});

// GET /v1/admin/departments/:id/policies — Get policies for a department
adminRoutes.get('/departments/:id/policies', async (c) => {
  const firmId = c.get('firmId');
  const departmentId = c.req.param('id');

  // Verify department belongs to this firm
  const [dept] = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.firmId, firmId)))
    .limit(1);

  if (!dept) {
    return c.json({ error: 'Department not found' }, 404);
  }

  const policies = await db
    .select()
    .from(departmentPolicies)
    .where(and(eq(departmentPolicies.departmentId, departmentId), eq(departmentPolicies.firmId, firmId)));

  return c.json({ department: dept, policies });
});

// PUT /v1/admin/departments/:id/policies — Upsert a policy for a department
adminRoutes.put('/departments/:id/policies', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  const departmentId = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const policySchema = z.object({
    policyType: z.enum(['allowed_sites', 'blocked_entity_types', 'can_bypass', 'max_sensitivity']),
    policyValue: z.record(z.unknown()),
    isActive: z.boolean().optional().default(true),
  });

  const parsed = policySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  // Validate policyValue shape based on policyType
  switch (parsed.data.policyType) {
    case 'allowed_sites': {
      const sites = (parsed.data.policyValue as any)?.sites;
      if (!Array.isArray(sites) || !sites.every((s: unknown) => typeof s === 'string')) {
        return c.json({ error: 'allowed_sites policy requires { sites: string[] }' }, 400);
      }
      break;
    }
    case 'blocked_entity_types': {
      const entityTypes = (parsed.data.policyValue as any)?.entityTypes;
      if (!Array.isArray(entityTypes) || !entityTypes.every((t: unknown) => typeof t === 'string')) {
        return c.json({ error: 'blocked_entity_types policy requires { entityTypes: string[] }' }, 400);
      }
      break;
    }
    case 'can_bypass': {
      const enabled = (parsed.data.policyValue as any)?.enabled;
      if (typeof enabled !== 'boolean') {
        return c.json({ error: 'can_bypass policy requires { enabled: boolean }' }, 400);
      }
      break;
    }
    case 'max_sensitivity': {
      const maxScore = (parsed.data.policyValue as any)?.maxScore;
      if (typeof maxScore !== 'number' || maxScore < 0 || maxScore > 100) {
        return c.json({ error: 'max_sensitivity policy requires { maxScore: number } between 0 and 100' }, 400);
      }
      break;
    }
  }

  // Verify department belongs to this firm
  const [dept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.firmId, firmId)))
    .limit(1);

  if (!dept) {
    return c.json({ error: 'Department not found' }, 404);
  }

  // Upsert the policy (unique constraint on departmentId + policyType)
  const [upserted] = await db
    .insert(departmentPolicies)
    .values({
      departmentId,
      firmId,
      policyType: parsed.data.policyType,
      policyValue: parsed.data.policyValue,
      isActive: parsed.data.isActive,
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [departmentPolicies.departmentId, departmentPolicies.policyType],
      set: {
        policyValue: parsed.data.policyValue,
        isActive: parsed.data.isActive,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Invalidate cache so changes take effect immediately
  invalidateDepartmentPolicyCache(departmentId);

  logAdminAction(c, 'department_policy.upsert', 'department_policy', { resourceId: departmentId, newValue: { policyType: parsed.data.policyType } });
  return c.json(upserted);
});

// ---------------------------------------------------------------------------
// SCIM Token Management — Generate, rotate, and revoke SCIM bearer tokens
// ---------------------------------------------------------------------------

// GET /v1/admin/scim-token — Check if a SCIM token exists (does not reveal the token)
adminRoutes.get('/scim-token', requirePerm('setSensitivityThresholds'), async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db.select({ config: firms.config }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const config = (firm.config ?? {}) as Record<string, any>;
  const hasToken = !!config.scimToken;
  const tokenPrefix = hasToken ? `scim_****${(config.scimToken as string).slice(-4)}` : null;

  return c.json({
    hasToken,
    tokenPrefix,
    scimBaseUrl: `${process.env.API_URL || 'https://irongate-api.onrender.com'}/scim/v2`,
  });
});

// POST /v1/admin/scim-token — Generate a new SCIM token (or rotate existing)
adminRoutes.post('/scim-token', requirePerm('setSensitivityThresholds'), async (c) => {
  const firmId = c.get('firmId');

  // Generate a cryptographically secure token
  const token = `scim_${crypto.randomBytes(32).toString('hex')}`;

  const [firm] = await db.select({ config: firms.config }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const existingConfig = (firm.config ?? {}) as Record<string, any>;
  const updatedConfig = { ...existingConfig, scimToken: token };

  await db.update(firms).set({ config: updatedConfig, updatedAt: new Date() }).where(eq(firms.id, firmId));

  logAdminAction(c, 'scim_token.generate', 'scim_token');
  return c.json({
    token, // Only returned once — client must store it
    message: 'SCIM token generated. Store this securely — it will not be shown again.',
    scimBaseUrl: `${process.env.API_URL || 'https://irongate-api.onrender.com'}/scim/v2`,
  }, 201);
});

// DELETE /v1/admin/scim-token — Revoke the SCIM token
adminRoutes.delete('/scim-token', requirePerm('setSensitivityThresholds'), async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db.select({ config: firms.config }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) return c.json({ error: 'Firm not found' }, 404);

  const existingConfig = (firm.config ?? {}) as Record<string, any>;
  delete existingConfig.scimToken;

  await db.update(firms).set({ config: existingConfig, updatedAt: new Date() }).where(eq(firms.id, firmId));

  logAdminAction(c, 'scim_token.revoke', 'scim_token');
  return c.json({ ok: true, message: 'SCIM token revoked. Any configured identity provider will lose access.' });
});

// ---------------------------------------------------------------------------
// Security Incidents
// ---------------------------------------------------------------------------

// RBAC: incident management requires admin-level access
adminRoutes.post('/incidents', requirePerm('setSensitivityThresholds'));
adminRoutes.put('/incidents/:id', requirePerm('setSensitivityThresholds'));

// GET /v1/admin/incidents — List incidents for firm (paginated, filterable by status/severity)
adminRoutes.get('/incidents', async (c) => {
  const firmId = c.get('firmId');
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), 100);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
  const statusFilter = c.req.query('status');
  const severityFilter = c.req.query('severity');

  const conditions = [eq(incidents.firmId, firmId)];
  if (statusFilter) {
    conditions.push(eq(incidents.status, statusFilter));
  }
  if (severityFilter) {
    conditions.push(eq(incidents.severity, severityFilter));
  }

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(incidents)
      .where(and(...conditions))
      .orderBy(desc(incidents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(incidents)
      .where(and(...conditions)),
  ]);

  return c.json({
    incidents: items,
    total: Number(countResult[0]?.total || 0),
    limit,
    offset,
  });
});

// GET /v1/admin/incidents/:id — Get single incident
adminRoutes.get('/incidents/:id', async (c) => {
  const firmId = c.get('firmId');
  const id = c.req.param('id');

  const [incident] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, id), eq(incidents.firmId, firmId)))
    .limit(1);

  if (!incident) {
    return c.json({ error: 'Incident not found' }, 404);
  }

  return c.json(incident);
});

// POST /v1/admin/incidents — Create incident
adminRoutes.post('/incidents', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const createSchema = z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
    status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional().default('open'),
    assignedTo: z.string().uuid().optional(),
    affectedUsers: z.number().int().min(0).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  const [created] = await db
    .insert(incidents)
    .values({
      firmId,
      title: sanitizeInput(parsed.data.title),
      description: parsed.data.description ? sanitizeInput(parsed.data.description) : null,
      severity: parsed.data.severity,
      status: parsed.data.status,
      reportedBy: userId,
      assignedTo: parsed.data.assignedTo || null,
      affectedUsers: parsed.data.affectedUsers ?? null,
      metadata: parsed.data.metadata || {},
    })
    .returning();

  logAdminAction(c, 'incident.create', 'incident', { resourceId: created.id, newValue: { title: parsed.data.title, severity: parsed.data.severity } });
  return c.json(created, 201);
});

// PUT /v1/admin/incidents/:id — Update incident
adminRoutes.put('/incidents/:id', async (c) => {
  const firmId = c.get('firmId');
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const updateSchema = z.object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
    rootCause: z.string().max(5000).nullable().optional(),
    remediation: z.string().max(5000).nullable().optional(),
    affectedUsers: z.number().int().min(0).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = sanitizeInput(parsed.data.title);
  if (parsed.data.description !== undefined) updates.description = parsed.data.description ? sanitizeInput(parsed.data.description) : null;
  if (parsed.data.severity !== undefined) updates.severity = parsed.data.severity;
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    if (parsed.data.status === 'resolved' && !updates.resolvedAt) updates.resolvedAt = new Date();
    if (parsed.data.status === 'closed' && !updates.closedAt) updates.closedAt = new Date();
  }
  if (parsed.data.assignedTo !== undefined) updates.assignedTo = parsed.data.assignedTo;
  if (parsed.data.rootCause !== undefined) updates.rootCause = parsed.data.rootCause ? sanitizeInput(parsed.data.rootCause) : null;
  if (parsed.data.remediation !== undefined) updates.remediation = parsed.data.remediation ? sanitizeInput(parsed.data.remediation) : null;
  if (parsed.data.affectedUsers !== undefined) updates.affectedUsers = parsed.data.affectedUsers;
  if (parsed.data.metadata !== undefined) updates.metadata = parsed.data.metadata;

  const [updated] = await db
    .update(incidents)
    .set(updates)
    .where(and(eq(incidents.id, id), eq(incidents.firmId, firmId)))
    .returning();

  if (!updated) {
    return c.json({ error: 'Incident not found' }, 404);
  }

  logAdminAction(c, 'incident.update', 'incident', { resourceId: id, newValue: updates });
  return c.json(updated);
});

// ── Adaptive Weights & Zone Analytics (Phase 4) ──────────────────────────────

// GET /v1/admin/adaptive-weights — View computed adaptive weights for this firm
adminRoutes.get('/adaptive-weights', async (c) => {
  const firmId = c.get('firmId');
  const result = await computeAdaptiveWeights(firmId);
  return c.json(result);
});

// GET /v1/admin/adaptive-weights/overrides — Get weight overrides for scorer
adminRoutes.get('/adaptive-weights/overrides', async (c) => {
  const firmId = c.get('firmId');
  const overrides = await getWeightOverrides(firmId);
  return c.json({ firmId, overrides, count: Object.keys(overrides).length });
});

// GET /v1/admin/zone-analytics — Zone distribution analytics
adminRoutes.get('/zone-analytics', async (c) => {
  const firmId = c.get('firmId');
  const days = parseInt(c.req.query('days') || '30', 10);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const zoneStats = await db
    .select({
      total: sql<number>`count(*)`,
      green: sql<number>`count(*) filter (where (${events.metadata}->>'sensitivityScore')::int <= 25)`,
      amber: sql<number>`count(*) filter (where (${events.metadata}->>'sensitivityScore')::int between 26 and 60)`,
      red: sql<number>`count(*) filter (where (${events.metadata}->>'sensitivityScore')::int > 60)`,
    })
    .from(events)
    .where(and(
      eq(events.firmId, firmId),
      gte(events.createdAt, since),
    ));

  const total = Number(zoneStats[0]?.total || 0);
  const green = Number(zoneStats[0]?.green || 0);
  const amber = Number(zoneStats[0]?.amber || 0);
  const red = Number(zoneStats[0]?.red || 0);

  return c.json({
    period: { days, since: since.toISOString() },
    total,
    zones: {
      green: { count: green, percentage: total > 0 ? Math.round((green / total) * 100) : 0 },
      amber: { count: amber, percentage: total > 0 ? Math.round((amber / total) * 100) : 0 },
      red: { count: red, percentage: total > 0 ? Math.round((red / total) * 100) : 0 },
    },
  });
});

// POST /v1/admin/federated-aggregation — Trigger a federated weight aggregation run
// Collects anonymized feedback across all firms, detects outliers, and computes weight deltas.
adminRoutes.post('/federated-aggregation', requirePerm('setSensitivityThresholds'), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const periodDays = body.periodDays ?? 90;
  const result = await handleFederatedAggregation(periodDays);
  logAdminAction(c, 'federated_aggregation.run', 'weight_override', { newValue: { periodDays } });
  return c.json(result);
});

// GET /v1/admin/zone-analytics — Full zone analytics for the firm
// Returns distribution, trends, overrides, and accuracy improvement metrics.
adminRoutes.get('/zone-analytics-full', async (c) => {
  const firmId = c.get('firmId');
  const days = Number(c.req.query('days') || 30);
  const result = await getZoneAnalytics(firmId, days);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// Entity Dictionary (Tier 3 Detection)
// ---------------------------------------------------------------------------

const entityCategorySchema = z.enum(['person', 'organization', 'project', 'client', 'location', 'custom']);

// RBAC: entity dictionary management requires admin access
adminRoutes.post('/entity-dictionary', requirePerm('setSensitivityThresholds'));
adminRoutes.post('/entity-dictionary/bulk', requirePerm('setSensitivityThresholds'));
adminRoutes.put('/entity-dictionary/:id', requirePerm('setSensitivityThresholds'));
adminRoutes.delete('/entity-dictionary/:id', requirePerm('setSensitivityThresholds'));

// GET /v1/admin/entity-dictionary — List all entities for firm (paginated, filterable)
adminRoutes.get('/entity-dictionary', async (c) => {
  const firmId = c.get('firmId');
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100), 1000);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
  const categoryFilter = c.req.query('category');

  const conditions = [eq(entityDictionaries.firmId, firmId), eq(entityDictionaries.isActive, true)];
  if (categoryFilter) {
    conditions.push(eq(entityDictionaries.category, categoryFilter));
  }

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(entityDictionaries)
      .where(and(...conditions))
      .orderBy(entityDictionaries.name)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(entityDictionaries)
      .where(and(...conditions)),
  ]);

  return c.json({
    entities: items,
    total: Number(countResult[0]?.total || 0),
    limit,
    offset,
  });
});

// POST /v1/admin/entity-dictionary — Add single entity
adminRoutes.post('/entity-dictionary', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const createSchema = z.object({
    category: entityCategorySchema,
    name: z.string().min(1).max(500),
    aliases: z.array(z.string().max(500)).max(50).optional().default([]),
    metadata: z.record(z.unknown()).optional().default({}),
  });

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  try {
    const [created] = await db
      .insert(entityDictionaries)
      .values({
        firmId,
        category: parsed.data.category,
        name: sanitizeInput(parsed.data.name),
        aliases: parsed.data.aliases.map(a => sanitizeInput(a)),
        metadata: parsed.data.metadata,
        createdBy: userId,
      })
      .returning();

    logAdminAction(c, 'entity_dictionary.create', 'entity_dictionary', { resourceId: created.id, newValue: { category: parsed.data.category, name: parsed.data.name } });
    return c.json(created, 201);
  } catch (err: any) {
    if (err?.message?.includes('unique') || err?.message?.includes('duplicate')) {
      return c.json({ error: 'Entity with this name and category already exists' }, 409);
    }
    throw err;
  }
});

// POST /v1/admin/entity-dictionary/bulk — Bulk import entities (up to 10,000)
adminRoutes.post('/entity-dictionary/bulk', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const bulkSchema = z.object({
    entities: z.array(z.object({
      category: entityCategorySchema,
      name: z.string().min(1).max(500),
      aliases: z.array(z.string().max(500)).max(50).optional().default([]),
      metadata: z.record(z.unknown()).optional().default({}),
    })).min(1).max(10000),
  });

  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  const values = parsed.data.entities.map(e => ({
    firmId,
    category: e.category,
    name: sanitizeInput(e.name),
    aliases: e.aliases.map(a => sanitizeInput(a)),
    metadata: e.metadata,
    createdBy: userId,
  }));

  // Insert in batches of 500 to avoid query size limits
  let inserted = 0;
  let skipped = 0;
  const batchSize = 500;
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize);
    try {
      const result = await db
        .insert(entityDictionaries)
        .values(batch)
        .onConflictDoNothing({ target: [entityDictionaries.firmId, entityDictionaries.category, entityDictionaries.name] })
        .returning();
      inserted += result.length;
      skipped += batch.length - result.length;
    } catch {
      skipped += batch.length;
    }
  }

  logAdminAction(c, 'entity_dictionary.bulk_import', 'entity_dictionary', { newValue: { inserted, skipped, total: values.length } });
  return c.json({ inserted, skipped, total: values.length }, 201);
});

// PUT /v1/admin/entity-dictionary/:id — Update entity
adminRoutes.put('/entity-dictionary/:id', async (c) => {
  const firmId = c.get('firmId');
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const updateSchema = z.object({
    category: entityCategorySchema.optional(),
    name: z.string().min(1).max(500).optional(),
    aliases: z.array(z.string().max(500)).max(50).optional(),
    metadata: z.record(z.unknown()).optional(),
    isActive: z.boolean().optional(),
  });

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.name !== undefined) updates.name = sanitizeInput(parsed.data.name);
  if (parsed.data.aliases !== undefined) updates.aliases = parsed.data.aliases.map(a => sanitizeInput(a));
  if (parsed.data.metadata !== undefined) updates.metadata = parsed.data.metadata;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

  const [updated] = await db
    .update(entityDictionaries)
    .set(updates)
    .where(and(eq(entityDictionaries.id, id), eq(entityDictionaries.firmId, firmId)))
    .returning();

  if (!updated) return c.json({ error: 'Entity not found' }, 404);
  logAdminAction(c, 'entity_dictionary.update', 'entity_dictionary', { resourceId: id, newValue: updates });
  return c.json(updated);
});

// DELETE /v1/admin/entity-dictionary/:id — Soft delete (set isActive=false)
adminRoutes.delete('/entity-dictionary/:id', async (c) => {
  const firmId = c.get('firmId');
  const id = c.req.param('id');

  const [updated] = await db
    .update(entityDictionaries)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(entityDictionaries.id, id), eq(entityDictionaries.firmId, firmId)))
    .returning();

  if (!updated) return c.json({ error: 'Entity not found' }, 404);
  logAdminAction(c, 'entity_dictionary.delete', 'entity_dictionary', { resourceId: id });
  return c.json({ deleted: true, id });
});

// GET /v1/admin/entity-dictionary/export — Export all active entities as JSON (for extension sync)
adminRoutes.get('/entity-dictionary/export', async (c) => {
  const firmId = c.get('firmId');

  const items = await db
    .select({
      id: entityDictionaries.id,
      category: entityDictionaries.category,
      name: entityDictionaries.name,
      aliases: entityDictionaries.aliases,
      metadata: entityDictionaries.metadata,
    })
    .from(entityDictionaries)
    .where(and(eq(entityDictionaries.firmId, firmId), eq(entityDictionaries.isActive, true)))
    .orderBy(entityDictionaries.category, entityDictionaries.name);

  return c.json({ entities: items, count: items.length });
});

// GET /v1/admin/entity-dictionary/version — Returns hash of current dictionary (change detection)
adminRoutes.get('/entity-dictionary/version', async (c) => {
  const firmId = c.get('firmId');

  // Compute a hash based on count + latest update timestamp
  const [stats] = await db
    .select({
      count: sql<number>`count(*)`,
      latestUpdate: sql<string>`max(updated_at)`,
    })
    .from(entityDictionaries)
    .where(and(eq(entityDictionaries.firmId, firmId), eq(entityDictionaries.isActive, true)));

  const count = Number(stats?.count || 0);
  const latest = stats?.latestUpdate || '';
  const hashInput = `${firmId}:${count}:${latest}`;
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);

  return c.json({ hash, count });
});

// ---------------------------------------------------------------------------
// Intent Weight Overrides — per-firm overrides for intent classification weights
// Stored in firm config JSONB under `intentWeights` key
// ---------------------------------------------------------------------------

const VALID_INTENT_CATEGORIES = [
  'credential_disclosure', 'data_analysis', 'communication_sharing',
  'drafting_sensitive', 'brainstorming', 'productivity', 'coding',
  'creative', 'research', 'general',
] as const;

const DEFAULT_INTENT_WEIGHTS: Record<string, number> = {
  credential_disclosure: 2.0,
  data_analysis: 1.5,
  communication_sharing: 1.5,
  drafting_sensitive: 1.3,
  brainstorming: 0.3,
  productivity: 0.2,
  coding: 0.15,
  creative: 0.15,
  research: 0.1,
  general: 1.0,
};

// GET /v1/admin/intent-weights — Get firm intent weight overrides
adminRoutes.get('/intent-weights', async (c) => {
  const firmId = c.get('firmId');
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);

  const config = (firm?.config as Record<string, unknown>) || {};
  const overrides = (config.intentWeights as Record<string, number>) || {};

  return c.json({
    defaults: DEFAULT_INTENT_WEIGHTS,
    overrides,
    effective: { ...DEFAULT_INTENT_WEIGHTS, ...overrides },
  });
});

// PUT /v1/admin/intent-weights — Set intent weight overrides
adminRoutes.put('/intent-weights', async (c) => {
  const firmId = c.get('firmId');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const schema = z.object({
    weights: z.record(
      z.enum(VALID_INTENT_CATEGORIES),
      z.number().min(0).max(3.0),
    ),
  });

  const parsed = schema.parse(body);

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  const config = (firm?.config as Record<string, unknown>) || {};

  const updatedConfig = {
    ...config,
    intentWeights: { ...(config.intentWeights as Record<string, number> || {}), ...parsed.weights },
  };

  await db.update(firms).set({
    config: updatedConfig,
    updatedAt: new Date(),
  }).where(eq(firms.id, firmId));

  logAdminAction(c, 'intent_weights.update', 'intent_weights', { newValue: parsed.weights });
  return c.json({
    overrides: updatedConfig.intentWeights,
    effective: { ...DEFAULT_INTENT_WEIGHTS, ...updatedConfig.intentWeights as Record<string, number> },
  });
});

// DELETE /v1/admin/intent-weights — Reset intent weights to defaults
adminRoutes.delete('/intent-weights', async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  const config = (firm?.config as Record<string, unknown>) || {};
  delete config.intentWeights;

  await db.update(firms).set({
    config,
    updatedAt: new Date(),
  }).where(eq(firms.id, firmId));

  logAdminAction(c, 'intent_weights.reset', 'intent_weights');
  return c.json({ ok: true, effective: DEFAULT_INTENT_WEIGHTS });
});

// ---------------------------------------------------------------------------
// Audit Log Export (CSV / JSON download)
// ---------------------------------------------------------------------------

// GET /v1/admin/audit-log/export — Export audit log as CSV or JSON file
adminRoutes.get('/audit-log/export', async (c) => {
  const firmId = c.get('firmId');
  const format = (c.req.query('format') || 'json').toLowerCase();
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const actionFilter = c.req.query('action');
  const resourceFilter = c.req.query('resourceType');

  if (format !== 'csv' && format !== 'json') {
    return c.json({ error: 'Invalid format — must be "csv" or "json"' }, 400);
  }

  // Validate date formats
  if (startDate && isNaN(new Date(startDate).getTime())) {
    return c.json({ error: 'Invalid startDate format' }, 400);
  }
  if (endDate && isNaN(new Date(endDate).getTime())) {
    return c.json({ error: 'Invalid endDate format' }, 400);
  }

  const conditions = [eq(auditLog.firmId, firmId)];
  if (startDate) conditions.push(gte(auditLog.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(auditLog.createdAt, new Date(endDate)));
  if (actionFilter) conditions.push(eq(auditLog.action, actionFilter));
  if (resourceFilter) conditions.push(eq(auditLog.resourceType, resourceFilter));

  const MAX_EXPORT = 10_000;
  const entries = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt))
    .limit(MAX_EXPORT);

  if (format === 'csv') {
    const csvHeaders = [
      'timestamp', 'actor_email', 'action', 'resource_type',
      'resource_id', 'ip_address', 'old_value', 'new_value',
    ];
    const csvRows = entries.map((e) => {
      return [
        e.createdAt ? new Date(e.createdAt as any).toISOString() : '',
        e.actorEmail || '',
        e.action || '',
        e.resourceType || '',
        e.resourceId || '',
        e.ipAddress || '',
        e.oldValue != null ? JSON.stringify(e.oldValue) : '',
        e.newValue != null ? JSON.stringify(e.newValue) : '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [csvHeaders.join(','), ...csvRows].join('\n');
    c.header('Content-Disposition', 'attachment; filename="irongate-audit-log.csv"');
    c.header('Content-Type', 'text/csv');
    return c.text(csv);
  }

  // JSON format
  c.header('Content-Disposition', 'attachment; filename="irongate-audit-log.json"');
  c.header('Content-Type', 'application/json');
  return c.json({
    exportedAt: new Date().toISOString(),
    firmId,
    count: entries.length,
    entries,
  });
});

// ---------------------------------------------------------------------------
// User Session Revocation
// ---------------------------------------------------------------------------

// POST /v1/admin/users/:userId/revoke-sessions — Revoke all sessions for a user
adminRoutes.post('/users/:userId/revoke-sessions', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.req.param('userId');

  // Verify user belongs to this firm
  const [targetUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
    .limit(1);

  if (!targetUser) {
    return c.json({ error: 'User not found in this firm' }, 404);
  }

  const deleted = await db
    .delete(conversationState)
    .where(and(
      eq(conversationState.firmId, firmId),
      eq(conversationState.userId, userId),
    ))
    .returning({ id: conversationState.id });

  logAdminAction(c, 'sessions.revoke_user', 'user', {
    resourceId: userId,
    newValue: { revokedSessions: deleted.length },
  });

  return c.json({
    ok: true,
    userId,
    revokedSessions: deleted.length,
  });
});

// POST /v1/admin/revoke-all-sessions — Revoke all sessions for the entire firm
adminRoutes.post('/revoke-all-sessions', async (c) => {
  const firmId = c.get('firmId');

  const deleted = await db
    .delete(conversationState)
    .where(eq(conversationState.firmId, firmId))
    .returning({ id: conversationState.id });

  logAdminAction(c, 'sessions.revoke_firm', 'firm', {
    newValue: { revokedSessions: deleted.length },
  });

  return c.json({
    ok: true,
    revokedSessions: deleted.length,
  });
});

// ---------------------------------------------------------------------------
// Audit Log Viewer
// ---------------------------------------------------------------------------

// GET /v1/admin/audit-log — View admin audit trail (paginated, filterable)
adminRoutes.get('/audit-log', requirePerm('viewFirmAnalytics'), async (c) => {
  const firmId = c.get('firmId');
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
  const actionFilter = c.req.query('action');
  const resourceFilter = c.req.query('resourceType');

  const conditions = [eq(auditLog.firmId, firmId)];
  if (actionFilter) conditions.push(eq(auditLog.action, actionFilter));
  if (resourceFilter) conditions.push(eq(auditLog.resourceType, resourceFilter));

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(auditLog)
      .where(and(...conditions)),
  ]);

  return c.json({
    entries: items,
    total: Number(countResult[0]?.total || 0),
    limit,
    offset,
  });
});
