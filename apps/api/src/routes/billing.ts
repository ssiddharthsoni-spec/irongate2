import { Hono } from 'hono';
import Stripe from 'stripe';
import { db } from '../db/client';
import { subscriptions, invoices, events, users } from '../db/schema';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const billingRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Stripe client — lazy-initialised so the app can still boot without the key
// ---------------------------------------------------------------------------
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

// ---------------------------------------------------------------------------
// Price-ID lookup from env vars
// ---------------------------------------------------------------------------
type Tier = 'pro' | 'business';
type Cycle = 'monthly' | 'annual';

function getPriceId(tier: Tier, cycle: Cycle): string | undefined {
  const map: Record<string, string | undefined> = {
    'pro_monthly': process.env.STRIPE_PRICE_PRO_MONTHLY,
    'pro_annual': process.env.STRIPE_PRICE_PRO_ANNUAL,
    'business_monthly': process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    'business_annual': process.env.STRIPE_PRICE_BUSINESS_ANNUAL,
  };
  return map[`${tier}_${cycle}`];
}

// ---------------------------------------------------------------------------
// GET / — Current firm's billing info (subscription + recent invoices)
// ---------------------------------------------------------------------------
billingRoutes.get('/', async (c) => {
  const firmId = c.get('firmId');

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const recentInvoices = await db
    .select()
    .from(invoices)
    .where(eq(invoices.firmId, firmId))
    .orderBy(desc(invoices.createdAt))
    .limit(10);

  if (!subscription) {
    return c.json({
      subscription: {
        tier: 'free',
        status: 'active',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      invoices: recentInvoices,
    });
  }

  // Lazy trial expiry — downgrade to free if trial period has ended
  let effectiveTier = subscription.tier;
  let effectiveStatus = subscription.status;
  if (subscription.status === 'trialing' && subscription.currentPeriodEnd) {
    if (new Date(subscription.currentPeriodEnd) < new Date()) {
      await db.update(subscriptions)
        .set({ tier: 'free', status: 'active', updatedAt: new Date() })
        .where(eq(subscriptions.id, subscription.id));
      effectiveTier = 'free';
      effectiveStatus = 'active';
    }
  }

  return c.json({
    subscription: {
      tier: effectiveTier,
      status: effectiveStatus,
      stripeCustomerId: subscription.stripeCustomerId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripePriceId: subscription.stripePriceId,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    },
    invoices: recentInvoices,
  });
});

// ---------------------------------------------------------------------------
// POST /checkout — Create Stripe Checkout session for upgrade
// ---------------------------------------------------------------------------
billingRoutes.post('/checkout', async (c) => {
  const stripe = getStripe();
  if (!stripe) {
    return c.json({
      message: 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing.',
      mock: true,
      checkoutUrl: 'https://checkout.stripe.com/mock-session',
    }, 200);
  }

  const firmId = c.get('firmId');
  let body: { tier?: string; cycle?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const tier = body.tier as Tier;
  const cycle = (body.cycle || 'monthly') as Cycle;

  if (!tier || !['pro', 'business'].includes(tier)) {
    return c.json({ error: 'Invalid tier. Must be "pro" or "business".' }, 400);
  }
  if (!['monthly', 'annual'].includes(cycle)) {
    return c.json({ error: 'Invalid cycle. Must be "monthly" or "annual".' }, 400);
  }

  const priceId = getPriceId(tier, cycle);
  if (!priceId) {
    return c.json({
      error: `Price ID not configured for ${tier}/${cycle}. Set STRIPE_PRICE_${tier.toUpperCase()}_${cycle.toUpperCase()} env var.`,
    }, 500);
  }

  // Look up or create Stripe customer for this firm
  let [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  let customerId = subscription?.stripeCustomerId;

  if (!customerId || customerId.startsWith('trial_')) {
    const customer = await stripe.customers.create({
      metadata: { firmId },
    });
    customerId = customer.id;

    if (subscription) {
      // Update existing trial subscription with real Stripe customer
      await db.update(subscriptions)
        .set({ stripeCustomerId: customerId })
        .where(eq(subscriptions.firmId, firmId));
    } else {
      // Create a free-tier subscription record for the firm
      await db.insert(subscriptions).values({
        firmId,
        stripeCustomerId: customerId,
        tier: 'free',
        status: 'active',
      });
    }
  }

  // Per-seat billing for Pro, flat rate for Team (business)
  let quantity = 1;
  if (tier === 'pro') {
    const [seatRow] = await db
      .select({ seatCount: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.firmId, firmId));
    quantity = Math.max(1, Number(seatRow?.seatCount ?? 1));
  }
  // Team (business) tier: quantity stays 1 (flat $99/month)

  const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';

  // Only offer trial if the firm hasn't already had one
  const hasExistingTrial = subscription?.status === 'trialing' || subscription?.stripeSubscriptionId;
  const subscriptionData: Record<string, unknown> = {};
  if (!hasExistingTrial) {
    subscriptionData.trial_period_days = 15;
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity }],
    ...(Object.keys(subscriptionData).length > 0 && { subscription_data: subscriptionData }),
    success_url: `${dashboardUrl}/admin?billing=success`,
    cancel_url: `${dashboardUrl}/admin?billing=canceled`,
    metadata: { firmId, tier, cycle, seats: String(quantity) },
  });

  return c.json({ checkoutUrl: session.url });
});

// ---------------------------------------------------------------------------
// POST /portal — Create Stripe Customer Portal session
// ---------------------------------------------------------------------------
billingRoutes.post('/portal', async (c) => {
  const stripe = getStripe();
  if (!stripe) {
    return c.json({
      message: 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing.',
      mock: true,
      portalUrl: 'https://billing.stripe.com/mock-portal',
    }, 200);
  }

  const firmId = c.get('firmId');

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (!subscription?.stripeCustomerId) {
    return c.json({ error: 'No billing account found for this firm. Please start a subscription first.' }, 404);
  }

  const dashboardUrl = process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app';

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${dashboardUrl}/admin`,
  });

  return c.json({ portalUrl: session.url });
});

// ---------------------------------------------------------------------------
// GET /invoices — List invoices for the firm
// ---------------------------------------------------------------------------
billingRoutes.get('/invoices', async (c) => {
  const firmId = c.get('firmId');

  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '25') || 25, 100));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0') || 0);

  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.firmId, firmId))
    .orderBy(desc(invoices.createdAt))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(invoices)
    .where(eq(invoices.firmId, firmId));

  return c.json({
    invoices: rows,
    pagination: {
      total: Number(countRow?.count ?? 0),
      limit,
      offset,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /usage — Current month usage (prompt count, entity count)
// ---------------------------------------------------------------------------
billingRoutes.get('/usage', async (c) => {
  const firmId = c.get('firmId');

  // Start of current month in UTC
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [usage] = await db
    .select({
      promptCount: sql<number>`count(*)`,
      entityCount: sql<number>`coalesce(sum(jsonb_array_length(${events.entities})), 0)`,
    })
    .from(events)
    .where(
      and(
        eq(events.firmId, firmId),
        gte(events.createdAt, monthStart),
      ),
    );

  // Also pull the subscription to show tier limits
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const tier = subscription?.tier || 'free';

  // Tier limits (prompts per month) — all tiers have unlimited scans
  // Gating is by feature (regex-only for Basic, ML for Pro+), not volume
  const tierLimits: Record<string, number> = {
    free: -1,      // Basic: unlimited scans, regex-only
    pro: -1,       // Pro: unlimited scans + ML detection
    business: -1,  // Team: unlimited scans + ML + shared dashboard
    enterprise: -1, // Enterprise: unlimited
  };

  const promptCount = Number(usage?.promptCount || 0);
  const entityCount = Number(usage?.entityCount || 0);
  const limit = tierLimits[tier] ?? 500;

  return c.json({
    period: {
      start: monthStart.toISOString(),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    },
    promptCount,
    entityCount,
    tier,
    limit: limit === -1 ? null : limit,
    usagePercent: limit === -1 ? 0 : Math.round((promptCount / limit) * 100),
  });
});
