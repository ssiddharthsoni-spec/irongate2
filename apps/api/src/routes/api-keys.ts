import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/client';
import { apiKeys } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { invalidateApiKeyCache } from '../middleware/auth';
import type { AppEnv } from '../types';

export const apiKeyRoutes = new Hono<AppEnv>();

/**
 * Generate a random API key with the ig_ prefix.
 * Returns both the raw key (shown once) and its SHA-256 hash (stored).
 */
function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `ig_${randomBytes}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 12);
  return { key, hash, prefix };
}

// GET / — List API keys for the firm (does not expose full keys)
apiKeyRoutes.get('/', async (c) => {
  const firmId = c.get('firmId');

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scope: apiKeys.scope,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.firmId, firmId), isNull(apiKeys.revokedAt)));

  return c.json(keys.map((k) => ({
    ...k,
    expired: k.expiresAt ? new Date(k.expiresAt) < new Date() : false,
  })));
});

// POST / — Create a new API key
apiKeyRoutes.post('/', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');
  const body = await c.req.json();

  const schema = z.object({
    name: z.string().min(1).max(100),
    scope: z.enum(['read', 'write', 'admin']).default('read'),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  });

  const parsed = schema.parse(body);
  const { key, hash, prefix } = generateApiKey();

  const expiresAt = parsed.expiresInDays
    ? new Date(Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [created] = await db
    .insert(apiKeys)
    .values({
      firmId,
      name: parsed.name,
      keyHash: hash,
      keyPrefix: prefix,
      scope: parsed.scope,
      createdBy: userId,
      expiresAt,
    })
    .returning();

  // Return the full key ONLY on creation — never again
  return c.json({
    id: created.id,
    name: created.name,
    key, // Full key — shown once
    keyPrefix: prefix,
    scope: created.scope,
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
  }, 201);
});

// DELETE /:id — Revoke an API key
apiKeyRoutes.delete('/:id', async (c) => {
  const firmId = c.get('firmId');
  const keyId = c.req.param('id');

  // Get the key hash before revoking so we can invalidate the auth cache
  const [existing] = await db
    .select({ keyHash: apiKeys.keyHash })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.firmId, firmId)))
    .limit(1);

  const [revoked] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.firmId, firmId)))
    .returning();

  if (!revoked) {
    return c.json({ error: 'API key not found' }, 404);
  }

  // Invalidate auth cache so the revoked key is rejected immediately
  if (existing) {
    invalidateApiKeyCache(existing.keyHash);
  }

  return c.json({ success: true });
});
