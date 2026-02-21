// Iron Gate API Server
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { eventsRoutes } from './routes/events';
import { dashboardRoutes } from './routes/dashboard';
import { adminRoutes } from './routes/admin';
import { reportsRoutes } from './routes/reports';
import { feedbackRoutes } from './routes/feedback';
import { proxyRoutes } from './routes/proxy';
import { documentRoutes } from './routes/documents';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { securityRoutes } from './routes/security';
import { billingRoutes } from './routes/billing';
import { notificationRoutes } from './routes/notifications';
import { inviteRoutes } from './routes/invites';
import { stripeWebhookRoutes } from './routes/stripe-webhook';
import { alertRoutes } from './routes/alerts';
import { apiKeyRoutes } from './routes/api-keys';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { firmContextMiddleware } from './middleware/firm-context';
import { securityHeadersMiddleware } from './middleware/security-headers';
import { requestLoggerMiddleware } from './middleware/request-logger';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Build allowed origins from environment
const allowedOrigins: string[] = [];
if (process.env.NODE_ENV === 'development') {
  allowedOrigins.push('http://localhost:3001', 'http://localhost:3000');
}
if (process.env.DASHBOARD_URL) {
  allowedOrigins.push(process.env.DASHBOARD_URL);
} else {
  allowedOrigins.push('https://irongate-dashboard.vercel.app');
}
if (process.env.CHROME_EXTENSION_ID) {
  allowedOrigins.push(`chrome-extension://${process.env.CHROME_EXTENSION_ID}`);
}

// Global middleware
app.use('*', logger());
app.use('*', securityHeadersMiddleware);
app.use('*', requestLoggerMiddleware);
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return allowedOrigins[0];
      // In development, allow any chrome extension for testing
      if (process.env.NODE_ENV === 'development' && origin.startsWith('chrome-extension://')) {
        return origin;
      }
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Firm-ID', 'X-Admin-Key-1', 'X-Admin-Key-2', 'X-Admin-Justification'],
  })
);

// Health check (no auth) — checks DB connectivity in production
app.get('/health', async (c) => {
  const health: Record<string, unknown> = {
    status: 'ok',
    version: '0.2.0',
    timestamp: new Date().toISOString(),
  };

  // Deep health check with ?deep=true
  if (c.req.query('deep') === 'true') {
    try {
      const { sql } = await import('drizzle-orm');
      const { db } = await import('./db/client');
      await db.execute(sql`SELECT 1`);
      health.database = 'connected';
    } catch (e) {
      health.database = 'disconnected';
      health.status = 'degraded';
      health.dbError = e instanceof Error ? e.message : String(e);
    }
  }

  return c.json(health);
});

// Auth routes (self-authenticated — must be mounted before the global auth middleware)
app.route('/v1/auth', authRoutes);

// Stripe webhook (no auth — verified via webhook signature)
app.route('/v1/webhooks/stripe', stripeWebhookRoutes);

// API routes (with auth)
app.use('/v1/*', authMiddleware);
app.use('/v1/*', rateLimitMiddleware);
app.use('/v1/*', firmContextMiddleware);

app.route('/v1/events', eventsRoutes);
app.route('/v1/dashboard', dashboardRoutes);
app.route('/v1/admin', adminRoutes);
app.route('/v1/reports', reportsRoutes);
app.route('/v1/feedback', feedbackRoutes);
app.route('/v1/proxy', proxyRoutes);
app.route('/v1/documents', documentRoutes);
app.route('/v1/audit', auditRoutes);
app.route('/v1/security', securityRoutes);
app.route('/v1/billing', billingRoutes);
app.route('/v1/notifications', notificationRoutes);
app.route('/v1/invites', inviteRoutes);
app.route('/v1/alerts', alertRoutes);
app.route('/v1/api-keys', apiKeyRoutes);

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('[Iron Gate API] Error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = parseInt(process.env.PORT || '3000');

import('@hono/node-server').then(({ serve }) => {
  serve({ fetch: app.fetch, port }, () => {
    console.log(`[Iron Gate API] Running on http://localhost:${port}`);
  });
});
