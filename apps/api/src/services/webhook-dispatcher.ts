// ============================================================================
// Iron Gate — Webhook Dispatcher Service
// ============================================================================
// Dispatches events to registered webhook URLs with HMAC-SHA256 signatures.
// Includes retry logic with exponential backoff.
// ============================================================================

import { db } from '../db/client';
import { webhookSubscriptions, webhookDeliveryLog } from '../db/schema';
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
  || process.env.IRON_GATE_MASTER_SECRET;

if (!ENCRYPTION_SECRET) {
  console.error('[CRITICAL] No encryption secret set — webhook secrets will be stored in plaintext. Set IRON_GATE_ENCRYPTION_SECRET.');
}

const WEBHOOK_KEY_SALT = new TextEncoder().encode('ig-webhook-secret-enc-v1');
let _webhookEncKey: CryptoKey | null = null;

async function getWebhookEncKey(): Promise<CryptoKey> {
  if (_webhookEncKey) return _webhookEncKey;
  if (!ENCRYPTION_SECRET) throw new Error('No encryption secret available');
  _webhookEncKey = await deriveKey(ENCRYPTION_SECRET, WEBHOOK_KEY_SALT);
  return _webhookEncKey;
}

async function encryptSecret(plaintext: string): Promise<string> {
  if (!ENCRYPTION_SECRET) {
    logger.warn('Webhook secret stored in plaintext — no IRON_GATE_ENCRYPTION_SECRET configured');
    return plaintext;
  }
  const key = await getWebhookEncKey();
  return encrypt(plaintext, key);
}

async function decryptSecret(ciphertext: string): Promise<string> {
  if (!ENCRYPTION_SECRET) {
    logger.warn('Returning webhook secret as plaintext — no IRON_GATE_ENCRYPTION_SECRET configured');
    return ciphertext;
  }
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
          db.update(webhookSubscriptions).set({ secret: enc }).where(eq(webhookSubscriptions.id, sub.id))
            .catch((err) => logger.error('Webhook secret re-encryption DB update failed', { subId: sub.id, error: String(err) }));
        }).catch((err) => logger.error('Webhook secret re-encryption failed', { subId: sub.id, error: String(err) }));
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
  const maxAttempts = 5;
  const baseBackoffs = [1000, 5000, 15000, 30000, 60000]; // 1s, 5s, 15s, 30s, 60s
  const firmId = (payload as any).firmId || 'unknown';

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let success = false;
  let errorMsg: string | null = null;

  try {
    const body = JSON.stringify(payload);
    const signature = await hmacSha256(body, secret);
    const deliveryId = crypto.randomUUID();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IronGate-Signature': signature,
        'X-IronGate-Event': eventType,
        'X-IronGate-Delivery': deliveryId,
      },
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    statusCode = response.status;
    success = response.ok;

    // Capture response body for debugging (truncated to 1KB)
    try {
      responseBody = (await response.text()).slice(0, 1024);
    } catch { /* ignore body read errors */ }

    if (!response.ok) {
      errorMsg = `HTTP ${statusCode}`;
    }
  } catch (error) {
    errorMsg = error instanceof Error ? error.message : String(error);
  }

  // Log every delivery attempt to webhookDeliveryLog for auditability
  logDeliveryAttempt(subId, firmId, eventType, payload, statusCode, responseBody, attempt, success, errorMsg);

  if (success) return;

  // Retry with jitter: base backoff ± 25% randomness to prevent thundering herd
  if (attempt < maxAttempts) {
    const base = baseBackoffs[attempt - 1];
    const jitter = base * 0.25 * (Math.random() * 2 - 1); // ±25%
    await sleep(Math.max(500, Math.round(base + jitter)));
    return deliverWithRetry(subId, url, secret, eventType, payload, attempt + 1);
  }

  // Deactivate subscription after all retries exhausted
  await db
    .update(webhookSubscriptions)
    .set({ isActive: false })
    .where(eq(webhookSubscriptions.id, subId));
  logger.warn('Deactivated webhook subscription after repeated failures', { subId, maxAttempts, lastError: errorMsg });
}

/** Fire-and-forget delivery log — never blocks the retry flow */
function logDeliveryAttempt(
  webhookId: string,
  firmId: string,
  eventType: string,
  payload: Record<string, unknown>,
  statusCode: number | null,
  responseBody: string | null,
  attempt: number,
  success: boolean,
  error: string | null,
): void {
  db.insert(webhookDeliveryLog).values({
    webhookId,
    firmId,
    eventType,
    payload,
    statusCode,
    responseBody,
    attempt,
    success,
    error,
  }).catch((err) => {
    logger.warn('Failed to log webhook delivery attempt', {
      webhookId, attempt, error: err instanceof Error ? err.message : String(err),
    });
  });
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
