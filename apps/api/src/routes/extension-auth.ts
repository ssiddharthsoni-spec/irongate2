import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/client';
import { firms, users, subscriptions, apiKeys } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger';

export const extensionAuthRoutes = new Hono();

// Simple in-memory rate limiter — 5 requests per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60_000;
const RATE_LIMIT_MAX_ENTRIES = 10_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    // Periodic cleanup: evict expired entries when map grows too large
    if (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
      for (const [k, v] of rateLimitMap) {
        if (now > v.resetAt) rateLimitMap.delete(k);
      }
    }
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

/**
 * Generate a random API key with the ig_ prefix.
 */
function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `ig_${randomBytes}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 12);
  return { key, hash, prefix };
}

// ---------------------------------------------------------------------------
// POST /register-extension — Self-service extension registration
// No auth required — this IS the signup flow for extension users.
// ---------------------------------------------------------------------------
extensionAuthRoutes.post('/register-extension', async (c) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(`register:${ip}`)) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const schema = z.object({
    email: z.string().email(),
    deviceId: z.string().uuid(),
    industry: z.string().optional(),
    firmCode: z.string().optional(),
  });

  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.errors }, 400);
  }
  const parsed = result.data;

  try {
    // Check if user already exists with this email
    const [existing] = await db
      .select({
        id: users.id,
        firmId: users.firmId,
      })
      .from(users)
      .where(eq(users.email, parsed.email))
      .limit(1);

    if (existing) {
      // User exists — look up their subscription and generate a fresh API key
      const [sub] = await db
        .select({ tier: subscriptions.tier, currentPeriodEnd: subscriptions.currentPeriodEnd })
        .from(subscriptions)
        .where(eq(subscriptions.firmId, existing.firmId))
        .limit(1);

      const [firm] = await db
        .select({ name: firms.name })
        .from(firms)
        .where(eq(firms.id, existing.firmId))
        .limit(1);

      // Generate API key for this user
      const { key, hash, prefix } = generateApiKey();
      await db.insert(apiKeys).values({
        firmId: existing.firmId,
        name: `Extension (${parsed.email})`,
        keyHash: hash,
        keyPrefix: prefix,
        scope: 'write',
        createdBy: existing.id,
      });

      return c.json({
        userId: existing.id,
        firmId: existing.firmId,
        firmName: firm?.name || '',
        apiKey: key,
        tier: sub?.tier || 'free',
        trialEndsAt: sub?.currentPeriodEnd?.toISOString() || null,
        status: 'existing',
      });
    }

    // New user registration — wrap in transaction to prevent orphaned data
    const registrationResult = await db.transaction(async (tx) => {
      // Determine which firm to join
      let firmId: string;
      let firmName: string;

      if (parsed.firmCode) {
        // Look up firm by enrollment code
        const [firm] = await tx
          .select({ id: firms.id, name: firms.name })
          .from(firms)
          .where(eq(firms.enrollmentCode, parsed.firmCode))
          .limit(1);

        if (!firm) {
          throw new Error('INVALID_FIRM_CODE');
        }

        firmId = firm.id;
        firmName = firm.name;
      } else {
        // Create a personal firm
        const emailPrefix = parsed.email.split('@')[0];
        const encryptionSalt = crypto.randomBytes(16).toString('hex');

        const [newFirm] = await tx
          .insert(firms)
          .values({
            name: `${emailPrefix}'s workspace`,
            mode: 'audit',
            config: { industry: parsed.industry || null },
            encryptionSalt,
          })
          .returning({ id: firms.id, name: firms.name });

        firmId = newFirm.id;
        firmName = newFirm.name;
      }

      // Create user
      const [newUser] = await tx
        .insert(users)
        .values({
          clerkId: `ext_${parsed.deviceId}`,
          firmId,
          email: parsed.email,
          displayName: parsed.email.split('@')[0],
          role: parsed.firmCode ? 'user' : 'admin',
        })
        .returning({ id: users.id });

      // Start 15-day Pro trial (only for new personal firms, not when joining existing)
      let tier = 'free';
      let trialEndsAt: string | null = null;

      if (!parsed.firmCode) {
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 15);

        await tx.insert(subscriptions).values({
          firmId,
          stripeCustomerId: `trial_${firmId}`,
          tier: 'pro',
          status: 'trialing',
          currentPeriodStart: new Date(),
          currentPeriodEnd: trialEnd,
        });

        tier = 'pro';
        trialEndsAt = trialEnd.toISOString();
      } else {
        // Check existing subscription for the firm they're joining
        const [sub] = await tx
          .select({ tier: subscriptions.tier, currentPeriodEnd: subscriptions.currentPeriodEnd })
          .from(subscriptions)
          .where(eq(subscriptions.firmId, firmId))
          .limit(1);

        tier = sub?.tier || 'free';
        trialEndsAt = sub?.currentPeriodEnd?.toISOString() || null;
      }

      // Generate API key
      const { key, hash, prefix } = generateApiKey();
      await tx.insert(apiKeys).values({
        firmId,
        name: `Extension (${parsed.email})`,
        keyHash: hash,
        keyPrefix: prefix,
        scope: 'write',
        createdBy: newUser.id,
      });

      return { userId: newUser.id, firmId, firmName, apiKey: key, tier, trialEndsAt };
    });

    logger.info('Extension user registered', {
      email: parsed.email,
      firmId: registrationResult.firmId,
      tier: registrationResult.tier,
    });

    // Send welcome email (fire-and-forget, outside transaction)
    import('../services/email').then(({ sendWelcomeEmail }) => {
      sendWelcomeEmail(parsed.email, parsed.email.split('@')[0]).catch(() => {});
    }).catch(() => {});

    return c.json({
      ...registrationResult,
      status: 'created',
    }, 201);
  } catch (err) {
    // Handle known error codes with appropriate status
    if (err instanceof Error && err.message === 'INVALID_FIRM_CODE') {
      return c.json({ error: 'Invalid firm code' }, 400);
    }

    logger.error('Extension registration failed', {
      error: err instanceof Error ? err.message : String(err),
      email: parsed.email,
    });
    return c.json({
      error: 'Registration failed. Please try again.',
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /validate-firm-code — Check if a firm enrollment code is valid
// No auth required — called during onboarding before registration.
// ---------------------------------------------------------------------------
extensionAuthRoutes.post('/validate-firm-code', async (c) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(`validate:${ip}`)) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const schema = z.object({
    firmCode: z.string().min(1).max(50),
  });

  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.errors }, 400);
  }
  const parsed = result.data;

  try {
    const [firm] = await db
      .select({ id: firms.id, name: firms.name })
      .from(firms)
      .where(eq(firms.enrollmentCode, parsed.firmCode))
      .limit(1);

    if (!firm) {
      return c.json({ valid: false, firmName: null });
    }

    return c.json({ valid: true, firmName: firm.name });
  } catch (err) {
    logger.error('Firm code validation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Validation service unavailable' }, 503);
  }
});
