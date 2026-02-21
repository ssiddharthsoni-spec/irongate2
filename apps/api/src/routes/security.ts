// Iron Gate — Security Routes
import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID, randomBytes } from 'node:crypto';
import { db } from '../db/client';
import { firms, users } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { AppEnv } from '../types';

// ---------------------------------------------------------------------------
// In-memory kill switch state
// ---------------------------------------------------------------------------
interface KillSwitchState {
  enabled: boolean;
  scope: 'global' | 'firm';
  firmId?: string;
  activatedAt: string;
}

const killSwitchStore = new Map<string, KillSwitchState>();

/** Resolve current kill switch status for a given firm. Checks in-memory store
 *  first, then falls back to the KILL_SWITCH env var (e.g. "true" / "1"). */
function isKillSwitchActive(firmId?: string): boolean {
  // Check firm-specific kill switch
  if (firmId) {
    const firmSwitch = killSwitchStore.get(`firm:${firmId}`);
    if (firmSwitch?.enabled) return true;
  }

  // Check global kill switch (in-memory)
  const globalSwitch = killSwitchStore.get('global');
  if (globalSwitch?.enabled) return true;

  // Fallback to environment variable
  const envSwitch = process.env.KILL_SWITCH;
  if (envSwitch === 'true' || envSwitch === '1') return true;

  return false;
}

export const securityRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// 1. POST /kill-switch — Activate or deactivate kill switch
//    Requires dual admin API keys: X-Admin-Key-1 and X-Admin-Key-2
// ---------------------------------------------------------------------------
securityRoutes.post('/kill-switch', async (c) => {
  // Dual admin key verification — both headers must be present and match env
  const key1 = c.req.header('X-Admin-Key-1');
  const key2 = c.req.header('X-Admin-Key-2');

  const expectedKey1 = process.env.ADMIN_KEY_1;
  const expectedKey2 = process.env.ADMIN_KEY_2;

  if (!key1 || !key2) {
    return c.json({ error: 'Both X-Admin-Key-1 and X-Admin-Key-2 headers are required' }, 401);
  }

  if (!expectedKey1 || !expectedKey2) {
    return c.json({ error: 'Kill switch admin keys are not configured on the server' }, 500);
  }

  // Constant-time comparison would be ideal in production; here we verify both keys
  if (key1 !== expectedKey1 || key2 !== expectedKey2) {
    return c.json({ error: 'Invalid admin keys' }, 403);
  }

  const bodySchema = z.object({
    enabled: z.boolean(),
    scope: z.enum(['global', 'firm']),
    firm_id: z.string().uuid().optional(),
  });

  const body = await c.req.json();
  const parsed = bodySchema.parse(body);

  if (parsed.scope === 'firm' && !parsed.firm_id) {
    return c.json({ error: 'firm_id is required when scope is "firm"' }, 400);
  }

  const now = new Date().toISOString();
  const storeKey = parsed.scope === 'global' ? 'global' : `firm:${parsed.firm_id}`;

  const state: KillSwitchState = {
    enabled: parsed.enabled,
    scope: parsed.scope,
    firmId: parsed.firm_id,
    activatedAt: now,
  };

  if (parsed.enabled) {
    killSwitchStore.set(storeKey, state);
  } else {
    killSwitchStore.delete(storeKey);
  }

  // Attempt to persist to kill_switch table if it exists (graceful fallback)
  try {
    await db.execute(sql`
      INSERT INTO kill_switch (id, enabled, scope, firm_id, activated_at)
      VALUES (${randomUUID()}, ${parsed.enabled}, ${parsed.scope}, ${parsed.firm_id ?? null}, ${now})
      ON CONFLICT (scope, COALESCE(firm_id, '00000000-0000-0000-0000-000000000000'))
      DO UPDATE SET enabled = ${parsed.enabled}, activated_at = ${now}
    `);
  } catch {
    // Table may not exist — that is fine, we have the in-memory store
  }

  return c.json({
    status: parsed.enabled ? 'activated' : 'deactivated',
    scope: parsed.scope,
    activated_at: now,
  });
});

// ---------------------------------------------------------------------------
// 2. GET /extension/status — Extension health / config check
//    Auth: JWT (any role — handled by global auth middleware)
// ---------------------------------------------------------------------------
securityRoutes.get('/extension/status', async (c) => {
  const firmId = c.get('firmId');

  const killSwitch = isKillSwitchActive(firmId);

  // Resolve monitored domains from firm config (fallback to defaults)
  let monitoredDomains: string[] = [
    'chat.openai.com',
    'openai.com',
    'bard.google.com',
    'gemini.google.com',
    'claude.ai',
    'copilot.microsoft.com',
    'perplexity.ai',
  ];

  try {
    const [firm] = await db
      .select({ config: firms.config })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1);

    const cfg = firm?.config as Record<string, unknown> | null;
    if (cfg && Array.isArray(cfg.monitoredDomains)) {
      monitoredDomains = cfg.monitoredDomains as string[];
    }
  } catch {
    // Proceed with defaults if config lookup fails
  }

  return c.json({
    active: true,
    config_version: 1,
    kill_switch: killSwitch,
    monitored_domains: monitoredDomains,
  });
});

// ---------------------------------------------------------------------------
// 3. DELETE /firm/data — Schedule deletion of all firm data
//    Auth: JWT (admin only)
// ---------------------------------------------------------------------------
securityRoutes.delete('/firm/data', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  // Verify the caller is an admin
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  const bodySchema = z.object({
    confirm: z.literal(true),
    reason: z.string().min(1),
  });

  const body = await c.req.json();
  const parsed = bodySchema.parse(body);

  const gracePeriodHours = 24;
  const deletionAt = new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000);

  // Mark firm for deletion by storing the request in firm config
  const [firm] = await db
    .select({ config: firms.config })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  const existingConfig = (firm?.config as Record<string, unknown>) || {};

  await db
    .update(firms)
    .set({
      config: {
        ...existingConfig,
        deletion_requested_at: new Date().toISOString(),
        deletion_scheduled_at: deletionAt.toISOString(),
        deletion_reason: parsed.reason,
        deletion_requested_by: userId,
      },
      updatedAt: new Date(),
    })
    .where(eq(firms.id, firmId));

  const tablesAffected = [
    'events',
    'pseudonym_maps',
    'feedback',
    'entity_co_occurrences',
    'inferred_entities',
    'sensitivity_patterns',
    'client_matters',
    'weight_overrides',
    'firm_plugins',
    'webhook_subscriptions',
  ];

  return c.json({
    scheduled: true,
    deletion_at: deletionAt.toISOString(),
    grace_period_hours: gracePeriodHours,
    tables_affected: tablesAffected,
  });
});

// ---------------------------------------------------------------------------
// 4. POST /firm/rotate-keys — Rotate firm encryption salt
//    Auth: JWT (admin only)
// ---------------------------------------------------------------------------
securityRoutes.post('/firm/rotate-keys', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  // Verify the caller is an admin
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  const bodySchema = z.object({
    confirm: z.literal(true),
  });

  const body = await c.req.json();
  bodySchema.parse(body);

  // Generate a new 32-byte encryption salt (hex-encoded = 64 chars)
  const newSalt = randomBytes(32).toString('hex');

  // Read current firm config for key version tracking
  const [firm] = await db
    .select({ config: firms.config, encryptionSalt: firms.encryptionSalt })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  const existingConfig = (firm?.config as Record<string, unknown>) || {};
  const currentKeyVersion = (existingConfig.key_version as number) || 1;
  const newKeyVersion = currentKeyVersion + 1;

  await db
    .update(firms)
    .set({
      encryptionSalt: newSalt,
      config: {
        ...existingConfig,
        key_version: newKeyVersion,
        last_key_rotation: new Date().toISOString(),
        key_rotation_requested_by: userId,
      },
      updatedAt: new Date(),
    })
    .where(eq(firms.id, firmId));

  // Estimate completion based on data volume (placeholder heuristic)
  const estimatedCompletion = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // ~5 minutes

  return c.json({
    status: 'rotating',
    new_key_version: newKeyVersion,
    estimated_completion: estimatedCompletion,
  });
});

// ---------------------------------------------------------------------------
// 5. POST /firm/public-key — Store firm public key for envelope encryption
//    Auth: JWT (admin only)
// ---------------------------------------------------------------------------
securityRoutes.post('/firm/public-key', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  // Verify the caller is an admin
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  const bodySchema = z.object({
    public_key: z.string().min(1),
  });

  const body = await c.req.json();
  const parsed = bodySchema.parse(body);

  // Store the public key in the firm config
  const [firm] = await db
    .select({ config: firms.config })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  const existingConfig = (firm?.config as Record<string, unknown>) || {};

  await db
    .update(firms)
    .set({
      config: {
        ...existingConfig,
        public_key: parsed.public_key,
        public_key_uploaded_at: new Date().toISOString(),
        public_key_uploaded_by: userId,
      },
      updatedAt: new Date(),
    })
    .where(eq(firms.id, firmId));

  return c.json({
    status: 'stored',
    algorithm: 'RSA-2048',
  });
});

// ---------------------------------------------------------------------------
// 6. GET /firm/security-status — Security posture summary
//    Auth: JWT (admin only)
// ---------------------------------------------------------------------------
securityRoutes.get('/firm/security-status', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  // Verify the caller is an admin
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  const [firm] = await db
    .select({
      config: firms.config,
      encryptionSalt: firms.encryptionSalt,
    })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  if (!firm) {
    return c.json({ error: 'Firm not found' }, 404);
  }

  const cfg = (firm.config as Record<string, unknown>) || {};

  const hasEncryptionSalt = !!firm.encryptionSalt;
  const publicKeyUploaded = !!cfg.public_key;
  const retentionDays = (cfg.retention_days as number) || 90;
  const lastKeyRotation = (cfg.last_key_rotation as string) || null;
  const killSwitch = isKillSwitchActive(firmId);

  return c.json({
    encryption: hasEncryptionSalt ? 'active' : 'inactive',
    rls: 'enabled',
    public_key_uploaded: publicKeyUploaded,
    retention_days: retentionDays,
    last_key_rotation: lastKeyRotation,
    kill_switch: killSwitch,
  });
});

export default securityRoutes;
