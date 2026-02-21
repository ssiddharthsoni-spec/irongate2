// ============================================================================
// Iron Gate — Webhook Dispatcher Service
// ============================================================================
// Dispatches events to registered webhook URLs with HMAC-SHA256 signatures.
// Includes retry logic with exponential backoff.
// ============================================================================

import { db } from '../db/client';
import { webhookSubscriptions } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

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
      // Fire-and-forget per subscription
      deliverWithRetry(sub.id, sub.url, sub.secret, eventType, payload).catch((err) => {
        console.error(`[Webhook] Delivery failed for ${sub.url}:`, err);
      });
    }
  } catch (error) {
    console.error('[Webhook] Failed to query subscriptions:', error);
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
  const [sub] = await db
    .insert(webhookSubscriptions)
    .values({ firmId, url, secret, eventTypes, isActive: true })
    .returning();
  return sub;
}

/**
 * Remove a webhook subscription.
 */
export async function removeWebhook(id: string) {
  await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
}

/**
 * List webhook subscriptions for a firm.
 */
export async function listWebhooks(firmId: string) {
  return db
    .select()
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
      console.warn(`[Webhook] Deactivated subscription ${subId} after ${maxAttempts} failures`);
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
