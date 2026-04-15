import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/client';
import { firms, users, subscriptions, apiKeys, emailVerificationTokens, enrollmentCodes } from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { applySuperAdminRole, applySuperAdminSubscription, getSuperAdminTier, isSuperAdminEmail } from '../lib/super-admin';

export const extensionAuthRoutes = new Hono();

// Simple in-memory rate limiter — 5 requests per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60_000;
const RATE_LIMIT_MAX_ENTRIES = 2_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    // Periodic cleanup: evict expired entries when map grows (lower threshold for earlier cleanup)
    if (rateLimitMap.size > 500) {
      for (const [k, v] of rateLimitMap) {
        if (now > v.resetAt) rateLimitMap.delete(k);
      }
      // Hard cap: evict zero-count entries first, then oldest if still too large
      if (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
        // First pass: remove entries with count=0 (fully consumed)
        for (const [k, v] of rateLimitMap) {
          if (v.count === 0) rateLimitMap.delete(k);
        }
        // Second pass: drop oldest if still too large
        if (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
          const excess = rateLimitMap.size - RATE_LIMIT_MAX_ENTRIES;
          let dropped = 0;
          for (const k of rateLimitMap.keys()) {
            if (dropped >= excess) break;
            rateLimitMap.delete(k);
            dropped++;
          }
        }
      }
    }
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 email verification tokens
// Token format: base64url(userId:expiry:hmac)
// ---------------------------------------------------------------------------
const VERIFY_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function getHmacSecret(): string {
  const secret = process.env.JWT_SIGNING_KEY || process.env.IRON_GATE_SIGNING_SECRET || process.env.IRON_GATE_MASTER_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    // Use crypto.randomUUID() fallback instead of guessable pid
    const fallback = `emergency-hmac-${crypto.randomUUID()}`;
    console.error('[CRITICAL] No HMAC secret configured for email verification. Set JWT_SIGNING_KEY or IRON_GATE_SIGNING_SECRET.');
    return fallback;
  }
  // BUG-10: Use crypto-random even in dev — process.pid is predictable (1-5000 in containers)
  return `dev-hmac-${crypto.randomBytes(32).toString('hex')}`;
}

function createVerificationToken(userId: string, email: string): { token: string; hash: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_EXPIRY_MS);
  const payload = `${userId}:${email}:${expiresAt.getTime()}`;
  const hmac = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${hmac}`).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash, expiresAt };
}

function verifyToken(token: string): { valid: boolean; userId?: string; email?: string } {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');
    if (parts.length < 4) return { valid: false };

    const hmac = parts.pop()!;
    const payload = parts.join(':');

    // Validate array has enough parts after popping HMAC
    if (parts.length < 3) return { valid: false };
    const [userId, email, expiryStr] = [parts[0], parts[1], parts[2]];

    // Validate that userId and email are non-empty
    if (!userId || !email || !expiryStr) return { valid: false };

    // Check expiry
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry) || Date.now() > expiry) return { valid: false };

    // Verify HMAC (constant-time comparison)
    const expected = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');
    if (hmac.length !== expected.length) return { valid: false };
    let hmacBuf: Buffer;
    let expectedBuf: Buffer;
    try {
      hmacBuf = Buffer.from(hmac, 'hex');
      expectedBuf = Buffer.from(expected, 'hex');
    } catch {
      return { valid: false };
    }
    if (!crypto.timingSafeEqual(hmacBuf, expectedBuf)) {
      return { valid: false };
    }

    return { valid: true, userId, email };
  } catch {
    return { valid: false };
  }
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

  // BUG-09: Capture start time for constant-time delay to prevent timing-based enumeration
  const handleStart = Date.now();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Managed mode: the extension sends "[managed]" as the email when auto-enrolling
  // from chrome.storage.managed policy. These devices are IT-deployed and trusted.
  const MANAGED_EMAIL_SENTINEL = '[managed]';

  const schema = z.object({
    email: z.string().refine(
      (email) => {
        // Allow the managed-mode sentinel without email validation
        if (email === MANAGED_EMAIL_SENTINEL) return true;
        // Standard email validation
        if (!z.string().email().safeParse(email).success) return false;
        // Block disposable/temporary email domains commonly used for abuse
        const disposableDomains = new Set([
          'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
          'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
          'dispostable.com', '10minutemail.com', 'trashmail.com', 'maildrop.cc',
        ]);
        const domain = email.split('@')[1]?.toLowerCase();
        return domain && !disposableDomains.has(domain);
      },
      { message: 'Please use a work email address' }
    ),
    deviceId: z.string().uuid(),
    industry: z.string().optional(),
    firmCode: z.string().optional(),
  });

  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.errors }, 400);
  }
  const parsed = result.data;

  const isManagedDevice = parsed.email === MANAGED_EMAIL_SENTINEL;

  try {
    // Managed devices: use deviceId-based lookup instead of email (many managed
    // devices share the "[managed]" sentinel email). For managed mode, firmCode is
    // required — it determines which firm the device joins.
    if (isManagedDevice && !parsed.firmCode) {
      return c.json({ error: 'Managed mode requires a firmCode (enrollment code).' }, 400);
    }

    // Check if user already exists
    if (!isManagedDevice) {
      const [existing] = await db
        .select({
          id: users.id,
          firmId: users.firmId,
        })
        .from(users)
        .where(eq(users.email, parsed.email))
        .limit(1);

      if (existing) {
        // BUG-09: Constant-time delay to prevent timing-based enumeration
        const elapsed = Date.now() - handleStart;
        const minDelay = 150 + Math.random() * 100; // 150-250ms
        if (elapsed < minDelay) await new Promise(r => setTimeout(r, minDelay - elapsed));

        // Super-admin self-heal: if the caller is an allowlisted email and
        // lands on the already-exists path, their subscription/role should
        // still be elevated. Idempotent.
        if (isSuperAdminEmail(parsed.email) && existing.firmId) {
          try {
            await applySuperAdminRole(existing.id);
            await applySuperAdminSubscription(existing.firmId);
          } catch (err) {
            logger.error('Super-admin self-heal on re-register failed', {
              email: parsed.email,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // User already exists — return a generic message that does NOT leak
        // internal details (userId, firmId, firmName, tier, subscription).
        // The user should sign in via the dashboard or use their existing API key.
        return c.json({
          error: 'An account with this email already exists. Please sign in through the Iron Gate dashboard or use your existing API key.',
          status: 'existing',
        }, 409);
      }
    }

    // New user registration — wrap in transaction to prevent orphaned data
    const registrationResult = await db.transaction(async (tx) => {
      // Determine which firm to join
      let firmId = '';
      let firmName = '';

      if (parsed.firmCode) {
        // First check the enrollment_codes table for a valid code
        const [enrollCode] = await tx
          .select({
            id: enrollmentCodes.id,
            firmId: enrollmentCodes.firmId,
            usedCount: enrollmentCodes.usedCount,
            maxUses: enrollmentCodes.maxUses,
          })
          .from(enrollmentCodes)
          .where(and(
            eq(enrollmentCodes.code, parsed.firmCode),
            eq(enrollmentCodes.revoked, false),
          ))
          .limit(1);

        if (enrollCode) {
          // Validate expiry and usage limits
          const now = new Date();
          const [codeRecord] = await tx
            .select({ expiresAt: enrollmentCodes.expiresAt })
            .from(enrollmentCodes)
            .where(eq(enrollmentCodes.id, enrollCode.id))
            .limit(1);

          const expired = codeRecord?.expiresAt && codeRecord.expiresAt < now;
          const exhausted = enrollCode.maxUses !== null && enrollCode.usedCount >= enrollCode.maxUses;

          if (expired || exhausted) {
            // Code exists but is expired/exhausted — fall through to legacy check
          } else {
            // Valid enrollment code — increment usage and use its firmId
            await tx
              .update(enrollmentCodes)
              .set({ usedCount: sql`${enrollmentCodes.usedCount} + 1` })
              .where(eq(enrollmentCodes.id, enrollCode.id));

            const [ecFirm] = await tx
              .select({ id: firms.id, name: firms.name })
              .from(firms)
              .where(eq(firms.id, enrollCode.firmId))
              .limit(1);

            if (ecFirm) {
              firmId = ecFirm.id;
              firmName = ecFirm.name;
            }
          }
        }

        // Fall back to legacy firms.enrollmentCode if not resolved yet
        if (!firmId) {
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
        }
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
      const managedEmail = isManagedDevice ? `managed-${parsed.deviceId}@device.local` : parsed.email;
      const [newUser] = await tx
        .insert(users)
        .values({
          clerkId: `ext_${parsed.deviceId}`,
          firmId,
          email: managedEmail,
          displayName: isManagedDevice ? `Managed Device ${parsed.deviceId.slice(0, 8)}` : parsed.email.split('@')[0],
          role: parsed.firmCode ? 'user' : 'admin',
          // Managed devices are IT-deployed and trusted — auto-verify
          emailVerified: isManagedDevice ? true : false,
        })
        .returning({ id: users.id });

      // Start 15-day Pro trial (only for new personal firms, not when joining existing)
      let tier = 'free';
      let trialEndsAt: string | null = null;

      // Super-admin short-circuit: allowlisted emails get a permanent
      // premium subscription instead of a 15-day trial. Role is promoted
      // to admin too. Both writes are inside the same transaction so
      // either the whole super-admin state applies or none of it does.
      if (!parsed.firmCode && isSuperAdminEmail(parsed.email)) {
        await applySuperAdminRole(newUser.id, tx);
        await applySuperAdminSubscription(firmId, tx);
        tier = getSuperAdminTier();
        // currentPeriodEnd is 10 years out — returning it as trialEndsAt
        // would mis-label it in the UI. Leave null; the dashboard reads
        // the real period end from /billing.
        trialEndsAt = null;
      } else if (!parsed.firmCode) {
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

      // Generate API key — managed devices get WRITE scope immediately (IT-trusted).
      // Self-serve registrations get READ-ONLY scope, upgraded after email verification.
      const { key, hash, prefix } = generateApiKey();
      await tx.insert(apiKeys).values({
        firmId,
        name: isManagedDevice ? `Managed Device (${parsed.deviceId.slice(0, 8)})` : `Extension (${parsed.email})`,
        keyHash: hash,
        keyPrefix: prefix,
        scope: isManagedDevice ? 'write' : 'read',
        createdBy: newUser.id,
      });

      return { userId: newUser.id, firmId, firmName, apiKey: key, tier, trialEndsAt };
    });

    logger.info('Extension user registered', {
      email: parsed.email,
      firmId: registrationResult.firmId,
      tier: registrationResult.tier,
    });

    // Send welcome + verification emails (skip for managed devices — no real email)
    if (!isManagedDevice) {
      const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';
      const { token: verifyTokenStr, hash: verifyHash, expiresAt: verifyExpiry } = createVerificationToken(
        registrationResult.userId, parsed.email
      );

      // Store token hash in DB (not the token itself — hash-only storage)
      db.insert(emailVerificationTokens).values({
        userId: registrationResult.userId,
        firmId: registrationResult.firmId,
        email: parsed.email,
        tokenHash: verifyHash,
        expiresAt: verifyExpiry,
      }).catch((err) => {
        logger.error('Failed to store verification token', { userId: registrationResult.userId, emailDomain: parsed.email.split('@')[1], error: err instanceof Error ? err.message : String(err) });
      });

      const verifyUrl = `${dashboardUrl}/verify-email?token=${verifyTokenStr}`;
      import('../services/email').then(({ sendWelcomeEmail, sendVerificationEmail }) => {
        sendWelcomeEmail(parsed.email, parsed.email.split('@')[0]).catch((err) => {
          logger.error('Failed to send welcome email', { emailDomain: parsed.email.split('@')[1], error: err instanceof Error ? err.message : String(err) });
        });
        sendVerificationEmail(parsed.email, parsed.email.split('@')[0], verifyUrl).catch((err) => {
          logger.error('Failed to send verification email', { emailDomain: parsed.email.split('@')[1], error: err instanceof Error ? err.message : String(err) });
        });
      }).catch((err) => {
        logger.error('Failed to import email service', { error: err instanceof Error ? err.message : String(err) });
      });
    }

    // Only return what the extension needs — never expose internal IDs
    return c.json({
      apiKey: registrationResult.apiKey,
      firmId: registrationResult.firmId,
      firmName: registrationResult.firmName,
      tier: registrationResult.tier,
      trialEndsAt: registrationResult.trialEndsAt,
      status: 'created',
      emailVerified: isManagedDevice,
    }, 201);
  } catch (err) {
    // Handle known error codes with appropriate status
    if (err instanceof Error && err.message === 'INVALID_FIRM_CODE') {
      // BUG-09: Constant-time delay to prevent timing-based enumeration
      const elapsed = Date.now() - handleStart;
      const minDelay = 150 + Math.random() * 100; // 150-250ms
      if (elapsed < minDelay) await new Promise(r => setTimeout(r, minDelay - elapsed));

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
    // First check the enrollment_codes table
    const [enrollCode] = await db
      .select({
        id: enrollmentCodes.id,
        firmId: enrollmentCodes.firmId,
        maxUses: enrollmentCodes.maxUses,
        usedCount: enrollmentCodes.usedCount,
        expiresAt: enrollmentCodes.expiresAt,
      })
      .from(enrollmentCodes)
      .where(and(
        eq(enrollmentCodes.code, parsed.firmCode),
        eq(enrollmentCodes.revoked, false),
      ))
      .limit(1);

    if (enrollCode) {
      const now = new Date();
      const expired = enrollCode.expiresAt && enrollCode.expiresAt < now;
      const exhausted = enrollCode.maxUses !== null && enrollCode.usedCount >= enrollCode.maxUses;

      if (!expired && !exhausted) {
        const [ecFirm] = await db
          .select({ name: firms.name })
          .from(firms)
          .where(eq(firms.id, enrollCode.firmId))
          .limit(1);

        if (ecFirm) {
          return c.json({ valid: true, firmName: ecFirm.name });
        }
      }
    }

    // Fall back to legacy firms.enrollmentCode column
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

// ---------------------------------------------------------------------------
// GET /refresh-subscription — Extension calls this on sidepanel open to
// pick up server-side changes (super-admin upgrade, Stripe webhook, etc.)
// without requiring a re-registration.
//
// Authenticated via X-API-Key header.
// Runs super-admin self-heal: if the user's email is on the allowlist,
// ensures they have a firm + permanent business-tier subscription before
// returning the tier.
// ---------------------------------------------------------------------------
extensionAuthRoutes.get('/refresh-subscription', async (c) => {
  const apiKeyHeader = c.req.header('X-API-Key');
  if (!apiKeyHeader) return c.json({ error: 'Missing X-API-Key header' }, 401);
  const keyHash = crypto.createHash('sha256').update(apiKeyHeader).digest('hex');

  const [keyRow] = await db
    .select({
      firmId: apiKeys.firmId,
      createdBy: apiKeys.createdBy,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!keyRow || keyRow.revokedAt) {
    return c.json({ error: 'Invalid or revoked API key' }, 401);
  }

  const [u] = await db
    .select({ id: users.id, email: users.email, firmId: users.firmId })
    .from(users)
    .where(eq(users.id, keyRow.createdBy))
    .limit(1);

  // Super-admin self-heal: same policy as GET /billing on the dashboard side.
  // If the registered email is on the allowlist, ensure the subscription is
  // permanent business tier. Idempotent.
  let firmIdForQuery = keyRow.firmId;
  if (u && isSuperAdminEmail(u.email)) {
    try {
      await applySuperAdminRole(u.id);
      if (u.firmId) {
        await applySuperAdminSubscription(u.firmId);
        firmIdForQuery = u.firmId;
      }
    } catch (err) {
      logger.error('Super-admin self-heal on refresh-subscription failed', {
        email: u.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const [sub] = await db
    .select({
      tier: subscriptions.tier,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmIdForQuery))
    .orderBy(sql`${subscriptions.createdAt} desc`)
    .limit(1);

  return c.json({
    tier: sub?.tier || 'free',
    status: sub?.status || 'active',
    trialEndsAt: sub?.status === 'trialing' ? sub.currentPeriodEnd?.toISOString() : null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() || null,
  });
});

// ---------------------------------------------------------------------------
// POST /enroll — Auto-join a firm using an enrollment code
// Authenticated via X-API-Key header (existing extension user) or email+deviceId
// for users who registered but need to switch firms.
// ---------------------------------------------------------------------------
extensionAuthRoutes.post('/enroll', async (c) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(`enroll:${ip}`)) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const schema = z.object({
    enrollmentCode: z.string().min(1).max(50),
    extensionVersion: z.string().min(1).max(20),
  });

  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.errors }, 400);
  }
  const parsed = result.data;

  // Authenticate the caller via X-API-Key header
  const apiKeyHeader = c.req.header('X-API-Key');
  if (!apiKeyHeader) {
    return c.json({ error: 'Missing X-API-Key header. Register first via /register-extension.' }, 401);
  }

  const keyHash = crypto.createHash('sha256').update(apiKeyHeader).digest('hex');

  try {
    // 1. Look up the enrollment code — first in enrollment_codes table, then legacy firms column
    let firm: { id: string; name: string; mode: string } | undefined;

    const [enrollCode] = await db
      .select({
        id: enrollmentCodes.id,
        firmId: enrollmentCodes.firmId,
        maxUses: enrollmentCodes.maxUses,
        usedCount: enrollmentCodes.usedCount,
        expiresAt: enrollmentCodes.expiresAt,
      })
      .from(enrollmentCodes)
      .where(and(
        eq(enrollmentCodes.code, parsed.enrollmentCode),
        eq(enrollmentCodes.revoked, false),
      ))
      .limit(1);

    if (enrollCode) {
      const now = new Date();
      const expired = enrollCode.expiresAt && enrollCode.expiresAt < now;
      const exhausted = enrollCode.maxUses !== null && enrollCode.usedCount >= enrollCode.maxUses;

      if (!expired && !exhausted) {
        const [ecFirm] = await db
          .select({ id: firms.id, name: firms.name, mode: firms.mode })
          .from(firms)
          .where(eq(firms.id, enrollCode.firmId))
          .limit(1);

        if (ecFirm) {
          firm = ecFirm;
          // Increment usage count
          await db
            .update(enrollmentCodes)
            .set({ usedCount: sql`${enrollmentCodes.usedCount} + 1` })
            .where(eq(enrollmentCodes.id, enrollCode.id));
        }
      }
    }

    // Fall back to legacy firms.enrollmentCode column
    if (!firm) {
      const [legacyFirm] = await db
        .select({
          id: firms.id,
          name: firms.name,
          mode: firms.mode,
        })
        .from(firms)
        .where(eq(firms.enrollmentCode, parsed.enrollmentCode))
        .limit(1);

      firm = legacyFirm;
    }

    if (!firm) {
      return c.json({ error: 'Invalid enrollment code' }, 404);
    }

    // 2. Look up the user by their API key
    const [key] = await db
      .select({
        id: apiKeys.id,
        firmId: apiKeys.firmId,
        createdBy: apiKeys.createdBy,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!key || key.revokedAt) {
      return c.json({ error: 'Invalid or revoked API key' }, 401);
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        firmId: users.firmId,
      })
      .from(users)
      .where(eq(users.id, key.createdBy))
      .limit(1);

    if (!user) {
      return c.json({ error: 'User not found for this API key' }, 404);
    }

    // 3. If user is already in this firm, return success without changes
    if (user.firmId === firm.id) {
      return c.json({
        firmId: firm.id,
        firmName: firm.name,
        mode: firm.mode,
        message: 'Already enrolled in this firm',
      });
    }

    // 4. Associate the user with the firm and update the API key's firmId
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ firmId: firm.id, role: 'user', updatedAt: new Date() })
        .where(eq(users.id, user.id));

      // Move the API key to the new firm so it continues to work
      await tx
        .update(apiKeys)
        .set({ firmId: firm.id })
        .where(eq(apiKeys.id, key.id));
    });

    logger.info('User enrolled in firm via enrollment code', {
      userId: user.id,
      firmId: firm.id,
      extensionVersion: parsed.extensionVersion,
    });

    // 5. Return firm details so the extension can configure itself
    // Optionally return an existing valid API key for the new firm
    return c.json({
      firmId: firm.id,
      firmName: firm.name,
      mode: firm.mode,
    });
  } catch (err) {
    logger.error('Enrollment failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Enrollment failed. Please try again.' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /verify-email — Verify email with HMAC-signed token
// Upgrades API key scope from read → write on success.
// ---------------------------------------------------------------------------
extensionAuthRoutes.post('/verify-email', async (c) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(`verify:${ip}`)) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const schema = z.object({ token: z.string().min(1) });
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Missing or invalid token' }, 400);
  }

  const { token } = result.data;

  // Verify HMAC signature and expiry
  const verification = verifyToken(token);
  if (!verification.valid || !verification.userId || !verification.email) {
    return c.json({ error: 'Invalid or expired verification token' }, 400);
  }

  // Check token hash exists in DB and hasn't been used
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const [tokenRecord] = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!tokenRecord) {
      return c.json({ error: 'Invalid or expired verification token' }, 400);
    }

    if (tokenRecord.verifiedAt) {
      return c.json({ error: 'Email already verified', emailVerified: true }, 400);
    }

    if (new Date() > tokenRecord.expiresAt) {
      return c.json({ error: 'Verification token has expired. Please request a new one.' }, 400);
    }

    // Atomic upgrade: mark token used, verify user, upgrade API key scope
    await db.transaction(async (tx) => {
      // Atomically mark token as verified only if not already done (prevents race condition)
      const [updated] = await tx
        .update(emailVerificationTokens)
        .set({ verifiedAt: new Date() })
        .where(and(
          eq(emailVerificationTokens.id, tokenRecord.id),
          isNull(emailVerificationTokens.verifiedAt)
        ))
        .returning({ id: emailVerificationTokens.id });

      if (!updated) {
        // Another request already verified this token
        return c.json({ error: 'Email already verified', emailVerified: true }, 400);
      }

      // Mark user as verified
      await tx
        .update(users)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, tokenRecord.userId));

      // Upgrade all read-only API keys for this user to write scope
      await tx
        .update(apiKeys)
        .set({ scope: 'write' })
        .where(
          and(
            eq(apiKeys.createdBy, tokenRecord.userId),
            eq(apiKeys.scope, 'read'),
          ),
        );
    });

    logger.info('Email verified successfully', {
      userId: tokenRecord.userId,
    });

    return c.json({ emailVerified: true, message: 'Email verified. Your API key now has full access.' });
  } catch (err) {
    logger.error('Email verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Verification failed. Please try again.' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /resend-verification — Resend verification email
// Requires the user's email. Rate limited to prevent abuse.
// ---------------------------------------------------------------------------
extensionAuthRoutes.post('/resend-verification', async (c) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(`resend:${ip}`)) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const schema = z.object({ email: z.string().email() });
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Invalid email' }, 400);
  }

  const { email } = result.data;

  try {
    // Find user — always return success to prevent email enumeration
    const [user] = await db
      .select({ id: users.id, firmId: users.firmId, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || user.emailVerified) {
      // Don't reveal whether the email exists or is already verified
      return c.json({ message: 'If this email is registered and unverified, a verification link has been sent.' });
    }

    // Generate new token
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';
    const { token: verifyTokenStr, hash: verifyHash, expiresAt: verifyExpiry } = createVerificationToken(user.id, email);

    // Store token
    await db.insert(emailVerificationTokens).values({
      userId: user.id,
      firmId: user.firmId,
      email,
      tokenHash: verifyHash,
      expiresAt: verifyExpiry,
    });

    const verifyUrl = `${dashboardUrl}/verify-email?token=${verifyTokenStr}`;
    import('../services/email').then(({ sendVerificationEmail }) => {
      sendVerificationEmail(email, email.split('@')[0], verifyUrl).catch((err) => {
        logger.error('Failed to send verification email', { emailDomain: email.split('@')[1], error: err instanceof Error ? err.message : String(err) });
      });
    }).catch((err) => {
      logger.error('Failed to import email service', { error: err instanceof Error ? err.message : String(err) });
    });

    return c.json({ message: 'If this email is registered and unverified, a verification link has been sent.' });
  } catch (err) {
    logger.error('Resend verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Service unavailable. Please try again.' }, 503);
  }
});
