import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/client';
import { firms, users, clientMatters, weightOverrides, firmPlugins, events, subscriptions } from '../db/schema';
import { eq, and, gte, sql, desc } from 'drizzle-orm';
import { analyzePatterns, getProposals, approveProposal, rejectProposal } from '../services/inference-engine';
import { registerWebhook, removeWebhook, listWebhooks } from '../services/webhook-dispatcher';
import { invalidateCache } from '../services/plugin-loader';
import { processFeedback } from '../services/feedback-processor';
import { invalidateUserCache } from '../middleware/auth';
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
      name: parsed.firmName,
      mode: parsed.protectionMode,
      config: {
        industry: parsed.industry,
        firmSize: parsed.firmSize,
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
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

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
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

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
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'metadata.google.internal'];
    const blockedPrefixes = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
      '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
      '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '169.254.'];
    if (blockedHosts.includes(hostname) || blockedPrefixes.some(p => hostname.startsWith(p))) {
      return c.json({ error: 'Webhook URL must point to a public endpoint' }, 400);
    }
    if (urlObj.protocol !== 'https:') {
      return c.json({ error: 'Webhook URL must use HTTPS' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid webhook URL' }, 400);
  }

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
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const siemSchema = z.object({
    enabled: z.boolean(),
    provider: z.enum(['splunk', 'datadog', 'generic']),
    url: z.string().url(),
    token: z.string().min(1),
    format: z.enum(['json', 'cef']).optional().default('json'),
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
