import { Hono } from 'hono';
import Stripe from 'stripe';
import { db } from '../db/client';
import { subscriptions, invoices } from '../db/schema';
import { eq } from 'drizzle-orm';

// This route does NOT use AppEnv — no auth middleware.
// Stripe sends webhooks directly; we verify the signature instead.
export const stripeWebhookRoutes = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

/**
 * Map a Stripe price ID back to our tier name using the configured env vars.
 */
function tierFromPriceId(priceId: string): 'pro' | 'business' | 'free' {
  const mapping: Record<string, 'pro' | 'business'> = {};

  if (process.env.STRIPE_PRICE_PRO_MONTHLY) mapping[process.env.STRIPE_PRICE_PRO_MONTHLY] = 'pro';
  if (process.env.STRIPE_PRICE_PRO_ANNUAL) mapping[process.env.STRIPE_PRICE_PRO_ANNUAL] = 'pro';
  if (process.env.STRIPE_PRICE_BUSINESS_MONTHLY) mapping[process.env.STRIPE_PRICE_BUSINESS_MONTHLY] = 'business';
  if (process.env.STRIPE_PRICE_BUSINESS_ANNUAL) mapping[process.env.STRIPE_PRICE_BUSINESS_ANNUAL] = 'business';

  return mapping[priceId] || 'free';
}

/**
 * Map Stripe subscription status to our schema's status enum.
 */
function mapStripeStatus(status: string): 'active' | 'past_due' | 'canceled' | 'trialing' {
  switch (status) {
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired': return 'canceled';
    case 'trialing': return 'trialing';
    default: return 'active';
  }
}

// ---------------------------------------------------------------------------
// POST / — Handle Stripe webhook events
// ---------------------------------------------------------------------------
stripeWebhookRoutes.post('/', async (c) => {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[Stripe Webhook] STRIPE_SECRET_KEY not set — ignoring webhook.');
    return c.json({ received: true, mock: true }, 200);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = c.req.header('stripe-signature');

  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured.');
    return c.json({ error: 'Webhook secret not configured.' }, 500);
  }

  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header.' }, 400);
  }

  // Stripe requires the raw body bytes for signature verification
  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Stripe Webhook] Signature verification failed:', message);
    return c.json({ error: 'Webhook signature verification failed.' }, 400);
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------
  try {
    switch (event.type) {
      case 'invoice.paid': {
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      }

      case 'invoice.payment_failed': {
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      }

      case 'customer.subscription.updated': {
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[Stripe Webhook] Error handling ${event.type}:`, err);
    // Return 200 so Stripe doesn't retry — we log the error server-side
    return c.json({ received: true, error: 'Handler error logged.' }, 200);
  }

  return c.json({ received: true });
});

// ---------------------------------------------------------------------------
// Handler: invoice.paid
// ---------------------------------------------------------------------------
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId || !invoice.id) return;

  // Find the subscription record to get the firmId
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);

  if (!sub) {
    console.warn(`[Stripe Webhook] invoice.paid — no subscription found for customer ${customerId}`);
    return;
  }

  // Upsert the invoice
  await db
    .insert(invoices)
    .values({
      firmId: sub.firmId,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? 'usd',
      status: 'paid',
      paidAt: new Date(),
      invoiceUrl: invoice.hosted_invoice_url ?? null,
    })
    .onConflictDoUpdate({
      target: invoices.stripeInvoiceId,
      set: {
        status: 'paid',
        paidAt: new Date(),
        amount: invoice.amount_paid ?? 0,
        invoiceUrl: invoice.hosted_invoice_url ?? null,
      },
    });

  console.log(`[Stripe Webhook] invoice.paid — recorded invoice ${invoice.id} for firm ${sub.firmId}`);
}

// ---------------------------------------------------------------------------
// Handler: invoice.payment_failed
// ---------------------------------------------------------------------------
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId || !invoice.id) return;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);

  if (!sub) {
    console.warn(`[Stripe Webhook] invoice.payment_failed — no subscription found for customer ${customerId}`);
    return;
  }

  // Record the failed invoice
  await db
    .insert(invoices)
    .values({
      firmId: sub.firmId,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_due ?? 0,
      currency: invoice.currency ?? 'usd',
      status: 'payment_failed',
      invoiceUrl: invoice.hosted_invoice_url ?? null,
    })
    .onConflictDoUpdate({
      target: invoices.stripeInvoiceId,
      set: {
        status: 'payment_failed',
      },
    });

  // Mark subscription as past_due
  if (sub.stripeSubscriptionId) {
    await db
      .update(subscriptions)
      .set({
        status: 'past_due',
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeCustomerId, customerId));
  }

  console.log(`[Stripe Webhook] invoice.payment_failed — invoice ${invoice.id} for firm ${sub.firmId}`);
}

// ---------------------------------------------------------------------------
// Handler: customer.subscription.updated
// ---------------------------------------------------------------------------
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  const priceId = subscription.items.data[0]?.price?.id;
  const tier = priceId ? tierFromPriceId(priceId) : 'free';
  const status = mapStripeStatus(subscription.status);

  // Upsert subscription record by customer ID
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);

  if (existing) {
    await db
      .update(subscriptions)
      .set({
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId ?? null,
        tier,
        status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeCustomerId, customerId));
  } else {
    // Edge case: webhook arrives before our checkout flow saves the record.
    // We store with a placeholder firmId from metadata if available.
    const firmId = subscription.metadata?.firmId;
    if (!firmId) {
      console.warn(`[Stripe Webhook] subscription.updated — no existing record and no firmId in metadata for customer ${customerId}`);
      return;
    }

    await db.insert(subscriptions).values({
      firmId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId ?? null,
      tier,
      status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
  }

  console.log(`[Stripe Webhook] subscription.updated — customer ${customerId} → tier=${tier}, status=${status}`);
}

// ---------------------------------------------------------------------------
// Handler: customer.subscription.deleted
// ---------------------------------------------------------------------------
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  await db
    .update(subscriptions)
    .set({
      tier: 'free',
      status: 'canceled',
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeCustomerId, customerId));

  console.log(`[Stripe Webhook] subscription.deleted — customer ${customerId} downgraded to free`);
}
