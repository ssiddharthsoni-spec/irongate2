// ============================================================================
// Iron Gate — Webhook Dispatcher Service
// ============================================================================
// Dispatches events to registered webhook URLs with HMAC-SHA256 signatures.
// Includes retry logic with exponential backoff.
// ============================================================================

import { db } from '../db/client';
import { webhookSubscriptions } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { encrypt, decrypt, deriveKey } from '@iron-gate/crypto';

// ── SSRF Protection for webhook URLs ────────────────────────────────────────
const PRIVATE_URL_PATTERNS = [
  /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./, /^169\.254\./, /^0\./, /^\[?::1\]?$/,
  /^\[?fe80:/i, /^\[?fc00:/i, /^\[?fd00:/i, /^\[?::ffff:/i,
  /\.internal$/i, /\.local$/i, /\.localhost$/i,
];

function validateWebhookUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS');
  }
  for (const pattern of PRIVATE_URL_PATTERNS) {
    if (pattern.test(parsed.hostname)) {
      throw new Error(`Webhook URL cannot point to private/internal network: ${parsed.hostname}`);
    }
  }
}

// ── Application-layer encryption for webhook secrets ─────────────────────────
// Prefer dedicated encryption secret; fall back to master secret for backward compat
const ENCRYPTION_SECRET = process.env.IRON_GATE_ENCRYPTION_SECRET
  || process.env.IRON_GATE_MASTER_SECRET || '';
const WEBHOOK_KEY_SALT = new TextEncoder().encode('ig-webhook-secret-enc-v1');
let _webhookEncKey: CryptoKey | null = null;

async function getWebhookEncKey(): Promise<CryptoKey> {
  if (_webhookEncKey) return _webhookEncKey;
  if (!ENCRYPTION_SECRET) throw new Error('IRON_GATE_ENCRYPTION_SECRET (or IRON_GATE_MASTER_SECRET) is required for webhook encryption');
  _webhookEncKey = await deriveKey(ENCRYPTION_SECRET, WEBHOOK_KEY_SALT);
  return _webhookEncKey;
}

async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getWebhookEncKey();
  return encrypt(plaintext, key);
}

async function decryptSecret(ciphertext: string): Promise<string> {
  const key = await getWebhookEncKey();
  return decrypt(ciphertext, key);
}

/**
 * Dispatch an event to all matching webhook subscriptions for a firm.
 * Fire-and-forget — errors are logged but don't block the caller.
 */
export async function dispatch(
  firmId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const subscriptions = await db
      .select()
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.firmId, firmId),
          eq(webhookSubscriptions.isActive, true),
        ),
      );

    // Filter to subscriptions that listen for this event type
    const matching = subscriptions.filter((sub) => {
      const eventTypes = sub.eventTypes as string[];
      return eventTypes.includes(eventType) || eventTypes.includes('*');
    });

    for (const sub of matching) {
      // Decrypt the secret before use — stored encrypted at rest
      let plainSecret: string;
      try {
        plainSecret = await decryptSecret(sub.secret);
      } catch {
        // If decryption fails, the secret may be legacy plaintext — use as-is once, then re-encrypt
        plainSecret = sub.secret;
        encryptSecret(sub.secret).then(enc => {
          db.update(webhookSubscriptions).set({ secret: enc }).where(eq(webhookSubscriptions.id, sub.id)).catch(() => {});
        }).catch(() => {});
      }
      // Fire-and-forget per subscription
      deliverWithRetry(sub.id, sub.url, plainSecret, eventType, payload).catch((err) => {
        logger.error('Webhook delivery failed', { url: sub.url, error: String(err) });
      });
    }
  } catch (error) {
    logger.error('Failed to query webhook subscriptions', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Register a new webhook subscription.
 */
export async function registerWebhook(
  firmId: string,
  url: string,
  secret: string,
  eventTypes: string[],
) {
  // SSRF protection — reject private/internal URLs
  validateWebhookUrl(url);
  // Encrypt webhook secret before storing — never persisted as plaintext
  const encryptedSecret = await encryptSecret(secret);
  const [sub] = await db
    .insert(webhookSubscriptions)
    .values({ firmId, url, secret: encryptedSecret, eventTypes, isActive: true })
    .returning();
  return sub;
}

/**
 * Remove a webhook subscription.
 */
export async function removeWebhook(id: string, firmId: string) {
  const result = await db.delete(webhookSubscriptions).where(
    and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.firmId, firmId)),
  ).returning({ id: webhookSubscriptions.id });
  return result.length > 0;
}

/**
 * List webhook subscriptions for a firm.
 */
export async function listWebhooks(firmId: string) {
  return db
    .select({
      id: webhookSubscriptions.id,
      firmId: webhookSubscriptions.firmId,
      url: webhookSubscriptions.url,
      eventTypes: webhookSubscriptions.eventTypes,
      isActive: webhookSubscriptions.isActive,
      createdAt: webhookSubscriptions.createdAt,
    })
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.firmId, firmId));
}

// ---------------------------------------------------------------------------
// Internal delivery with retry
// ---------------------------------------------------------------------------

async function deliverWithRetry(
  subId: string,
  url: string,
  secret: string,
  eventType: string,
  payload: Record<string, unknown>,
  attempt = 1,
): Promise<void> {
  const maxAttempts = 3;
  const backoffs = [1000, 5000, 25000]; // 1s, 5s, 25s

  try {
    const body = JSON.stringify(payload);
    const signature = await hmacSha256(body, secret);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IronGate-Signature': signature,
        'X-IronGate-Event': eventType,
        'X-IronGate-Delivery': crypto.randomUUID(),
      },
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok && attempt < maxAttempts) {
      await sleep(backoffs[attempt - 1]);
      return deliverWithRetry(subId, url, secret, eventType, payload, attempt + 1);
    }

    if (!response.ok && attempt >= maxAttempts) {
      // Deactivate subscription after 3 consecutive failures
      await db
        .update(webhookSubscriptions)
        .set({ isActive: false })
        .where(eq(webhookSubscriptions.id, subId));
      logger.warn('Deactivated webhook subscription after repeated failures', { subId, maxAttempts });
    }
  } catch (error) {
    if (attempt < maxAttempts) {
      await sleep(backoffs[attempt - 1]);
      return deliverWithRetry(subId, url, secret, eventType, payload, attempt + 1);
    }
    // Deactivate on persistent failure
    await db
      .update(webhookSubscriptions)
      .set({ isActive: false })
      .where(eq(webhookSubscriptions.id, subId));
  }
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
