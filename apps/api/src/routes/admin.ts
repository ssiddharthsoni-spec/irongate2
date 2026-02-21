import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { firms, users, clientMatters, weightOverrides, firmPlugins } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { analyzePatterns, getProposals, approveProposal, rejectProposal } from '../services/inference-engine';
import { registerWebhook, removeWebhook, listWebhooks } from '../services/webhook-dispatcher';
import { invalidateCache } from '../services/plugin-loader';
import { processFeedback } from '../services/feedback-processor';
import type { AppEnv } from '../types';

export const adminRoutes = new Hono<AppEnv>();

// GET /v1/admin/firm — Get firm configuration
adminRoutes.get('/firm', async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) {
    return c.json({ error: 'Firm not found' }, 404);
  }

  return c.json(firm);
});

// PUT /v1/admin/firm — Update firm configuration
adminRoutes.put('/firm', async (c) => {
  const firmId = c.get('firmId');
  const body = await c.req.json();

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

  return c.json(updated);
});

// GET /v1/admin/users — List firm users
adminRoutes.get('/users', async (c) => {
  const firmId = c.get('firmId');

  const firmUsers = await db
    .select()
    .from(users)
    .where(eq(users.firmId, firmId));

  return c.json(firmUsers);
});

// POST /v1/admin/client-matters — Import client/matter data
adminRoutes.post('/client-matters', async (c) => {
  const firmId = c.get('firmId');
  const body = await c.req.json();

  const matterSchema = z.object({
    matters: z.array(z.object({
      clientName: z.string(),
      aliases: z.array(z.string()).optional().default([]),
      matterNumber: z.string().optional(),
      matterDescription: z.string().optional(),
      parties: z.array(z.string()).optional().default([]),
      sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
    })),
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

  return c.json({ imported: inserted.length });
});

// GET /v1/admin/client-matters — List client/matters
adminRoutes.get('/client-matters', async (c) => {
  const firmId = c.get('firmId');

  const matters = await db
    .select()
    .from(clientMatters)
    .where(eq(clientMatters.firmId, firmId));

  return c.json(matters);
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
  const body = await c.req.json();

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

  return c.json(upserted);
});

// DELETE /v1/admin/weight-overrides/:entityType — Remove a weight override
adminRoutes.delete('/weight-overrides/:entityType', async (c) => {
  const firmId = c.get('firmId');
  const entityType = c.req.param('entityType');

  await db
    .delete(weightOverrides)
    .where(and(eq(weightOverrides.firmId, firmId), eq(weightOverrides.entityType, entityType)));

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
  return c.json({ discovered: results.length, results });
});

// PUT /v1/admin/inferred-entities/:id — Approve or reject
adminRoutes.put('/inferred-entities/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json();

  const actionSchema = z.object({
    action: z.enum(['approve', 'reject']),
  });
  const parsed = actionSchema.parse(body);

  if (parsed.action === 'approve') {
    await approveProposal(id, userId);
  } else {
    await rejectProposal(id, userId);
  }

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
  const body = await c.req.json();

  const webhookSchema = z.object({
    url: z.string().url(),
    secret: z.string().min(16),
    eventTypes: z.array(z.string()).min(1),
  });
  const parsed = webhookSchema.parse(body);

  const sub = await registerWebhook(firmId, parsed.url, parsed.secret, parsed.eventTypes);
  return c.json(sub, 201);
});

// DELETE /v1/admin/webhooks/:id — Remove webhook
adminRoutes.delete('/webhooks/:id', async (c) => {
  const id = c.req.param('id');
  await removeWebhook(id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// SIEM Configuration (Phase 7)
// ---------------------------------------------------------------------------

// PUT /v1/admin/siem — Configure SIEM endpoint
adminRoutes.put('/siem', async (c) => {
  const firmId = c.get('firmId');
  const body = await c.req.json();

  const siemSchema = z.object({
    enabled: z.boolean(),
    provider: z.enum(['splunk', 'datadog', 'generic']),
    url: z.string().url(),
    token: z.string().min(1),
    format: z.enum(['json', 'cef']).optional().default('json'),
  });
  const parsed = siemSchema.parse(body);

  // Store SIEM config in firms.config.siem
  const [firm] = await db.select({ config: firms.config }).from(firms).where(eq(firms.id, firmId)).limit(1);
  const existingConfig = (firm?.config as Record<string, unknown>) || {};

  const [updated] = await db
    .update(firms)
    .set({
      config: { ...existingConfig, siem: parsed },
      updatedAt: new Date(),
    })
    .where(eq(firms.id, firmId))
    .returning();

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
  const body = await c.req.json();

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
      name: parsed.name,
      description: parsed.description,
      version: parsed.version,
      code: parsed.code,
      entityTypes: parsed.entityTypes,
      isActive: true,
      hitCount: 0,
      falsePositiveRate: 0,
      createdBy: userId,
    })
    .returning();

  invalidateCache(firmId);
  return c.json(plugin, 201);
});

// PUT /v1/admin/plugins/:id — Enable or disable a plugin
adminRoutes.put('/plugins/:id', async (c) => {
  const id = c.req.param('id');
  const firmId = c.get('firmId');
  const body = await c.req.json();

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
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Feedback & Weights (Phase 10)
// ---------------------------------------------------------------------------

// POST /v1/admin/recalculate-weights — Trigger feedback processing
adminRoutes.post('/recalculate-weights', async (c) => {
  const firmId = c.get('firmId');
  const results = await processFeedback(firmId);
  return c.json({ processed: results.length, stats: results });
});
