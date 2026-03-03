// Iron Gate API Server
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { logger as honoLogger } from 'hono/logger';
import { logger } from './lib/logger';
import { z } from 'zod';
import crypto from 'crypto';

// ── Sentry (initialize before anything else) ──────────────────────────────
let SentryMod: any = null;
if (process.env.SENTRY_DSN) {
  try {
    const mod = require('@sentry/node');
    mod.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    SentryMod = mod;
    logger.info('Sentry initialized');
  } catch {
    logger.warn('Sentry SDK not available — error tracking disabled');
  }
}

import { eventsRoutes } from './routes/events';
import { dashboardRoutes } from './routes/dashboard';
import { adminRoutes } from './routes/admin';
import { reportsRoutes } from './routes/reports';
import { feedbackRoutes } from './routes/feedback';
import { proxyRoutes } from './routes/proxy';
import { documentRoutes } from './routes/documents';
import { auditRoutes } from './routes/audit';
import { heartbeatRoutes } from './routes/heartbeat';
import { authRoutes } from './routes/auth';
import { extensionAuthRoutes } from './routes/extension-auth';
import { securityRoutes } from './routes/security';
import { billingRoutes } from './routes/billing';
import { notificationRoutes } from './routes/notifications';
import { inviteRoutes } from './routes/invites';
import { stripeWebhookRoutes } from './routes/stripe-webhook';
import { alertRoutes } from './routes/alerts';
import { apiKeyRoutes } from './routes/api-keys';
import { complianceRoutes } from './routes/compliance';
import { userDataRoutes } from './routes/user-data';
import { logoutRoutes } from './routes/logout';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { firmContextMiddleware } from './middleware/firm-context';
import { securityHeadersMiddleware } from './middleware/security-headers';
import { requestLoggerMiddleware } from './middleware/request-logger';
import { csrfProtectionMiddleware } from './middleware/csrf';
import { jwtRevocationMiddleware } from './middleware/jwt-revocation';
import { requirePerm } from './middleware/rbac';
import { metrics } from './lib/metrics';
import { openApiSpec } from './docs/openapi';
import { sql } from 'drizzle-orm';
import { db } from './db/client';
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

// 1. Request body size limit — prevent memory exhaustion attacks (10 MB)
app.use('*', bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// 2. Request ID correlation — propagate or generate X-Request-Id for tracing
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
  c.set('requestId' as any, requestId);
  c.header('X-Request-Id', requestId);
  await next();
});

app.use('*', honoLogger());
app.use('*', securityHeadersMiddleware);
app.use('*', requestLoggerMiddleware);
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return allowedOrigins[0];
      // Only allow registered Iron Gate Chrome extension IDs
      if (origin.startsWith('chrome-extension://')) {
        const extId = origin.replace('chrome-extension://', '');
        const allowedIds = (process.env.ALLOWED_EXTENSION_IDS || process.env.CHROME_EXTENSION_ID || '')
          .split(',').map((id: string) => id.trim()).filter(Boolean);
        // In development, allow all extensions when no IDs are configured
        if (allowedIds.length === 0) {
          return process.env.NODE_ENV === 'development' ? origin : null;
        }
        return allowedIds.includes(extId) ? origin : null;
      }
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Firm-ID', 'X-Admin-Key-1', 'X-Admin-Key-2', 'X-Admin-Justification', 'x-api-key'],
    credentials: true,
  })
);

// Health check (no auth) — checks DB connectivity in production
app.get('/health', async (c) => {
  const health: Record<string, unknown> = {
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  };

  // Deep health check with ?deep=true
  if (c.req.query('deep') === 'true') {
    try {
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

// Mirror health check under /v1 so extension connect works without auth
app.get('/v1/health', async (c) => {
  return c.json({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// Metrics endpoint — gated behind API key or admin key for security
app.get('/health/metrics', async (c) => {
  const apiKey = c.req.header('X-API-Key');
  const adminKey = c.req.header('X-Admin-Key-1');
  const metricsKey = process.env.METRICS_API_KEY;

  // Require at least one form of authentication
  const isAuthed =
    (apiKey && metricsKey && apiKey === metricsKey) ||
    (adminKey && process.env.ADMIN_KEY_1 && adminKey === process.env.ADMIN_KEY_1);

  if (!isAuthed) {
    return c.json({ error: 'Unauthorized: Provide X-API-Key or X-Admin-Key-1' }, 401);
  }

  const snapshot = metrics.snapshot();

  // Add BullMQ queue metrics if available
  try {
    const { getCoOccurrencesQueue, getWebhooksQueue, getSiemQueue, getInferenceQueue } = await import('./jobs/queues');
    const queueMetrics: Record<string, unknown> = {};

    for (const [name, queue] of Object.entries({
      'co-occurrences': getCoOccurrencesQueue(),
      webhooks: getWebhooksQueue(),
      siem: getSiemQueue(),
      inference: getInferenceQueue(),
    })) {
      if (queue) {
        const counts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed');
        queueMetrics[name] = counts;
      }
    }

    return c.json({ ...snapshot, queues: queueMetrics });
  } catch {
    return c.json(snapshot);
  }
});

// API Documentation (no auth)
app.get('/openapi.json', (c) => c.json(openApiSpec));
app.get('/docs', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Iron Gate API Docs</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
</head><body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });</script>
</body></html>`;
  return c.html(html);
});

// Auth routes (self-authenticated — must be mounted before the global auth middleware)
app.route('/v1/auth', authRoutes);
app.route('/v1/auth', extensionAuthRoutes);

// Stripe webhook (no auth — verified via webhook signature)
app.route('/v1/webhooks/stripe', stripeWebhookRoutes);

// API routes (with auth + security middleware)
app.use('/v1/*', csrfProtectionMiddleware);
app.use('/v1/*', authMiddleware);
app.use('/v1/*', jwtRevocationMiddleware);
app.use('/v1/*', rateLimitMiddleware);
app.use('/v1/*', firmContextMiddleware);

// RBAC enforcement on admin and privileged routes
app.use('/v1/admin/*', requirePerm('viewDashboard'));
app.use('/v1/invites/*', requirePerm('inviteUsers'));

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
app.route('/v1/compliance', complianceRoutes);
app.route('/v1/user', userDataRoutes);
app.route('/v1/heartbeat', heartbeatRoutes);
app.route('/v1/logout', logoutRoutes);

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler — returns 400 for Zod validation errors, 500 for everything else
app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json({ error: 'Validation error', details: err.errors }, 400);
  }
  const requestId = (c.get as any)('requestId');
  // Report to Sentry if initialized
  if (SentryMod) {
    SentryMod.captureException(err, {
      extra: {
        method: c.req.method,
        path: c.req.path,
        firmId: c.get('firmId'),
        userId: c.get('userId'),
        requestId,
      },
    });
  }
  logger.error('Unhandled error', { error: err instanceof Error ? err.message : String(err), requestId });
  return c.json({ error: 'Internal server error' }, 500);
});

// ── Startup Validation ──────────────────────────────────────────────────────
const isDevAuth = process.env.NODE_ENV === 'development' && process.env.IRON_GATE_DEV_AUTH === 'true';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').optional(),
  SUPABASE_DB_URL: z.string().min(1).optional(),
  CLERK_SECRET_KEY: isDevAuth ? z.string().optional() : z.string().min(1, 'CLERK_SECRET_KEY is required for production auth'),
  IRON_GATE_MASTER_SECRET: z.string().min(16, 'IRON_GATE_MASTER_SECRET must be at least 16 characters').optional(),
  PORT: z.string().regex(/^\d+$/, 'PORT must be a number').optional().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
  REDIS_URL: z.string().min(1).optional(),
  CHROME_EXTENSION_ID: z.string().optional(),
  ALLOWED_EXTENSION_IDS: z.string().optional(),
  DASHBOARD_URL: z.string().min(1).optional(),
  ADMIN_KEY_1: z.string().min(1).optional(),
  ADMIN_KEY_2: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  DETECTION_SERVICE_URL: z.string().min(1).optional(),
}).refine(
  (data) => data.DATABASE_URL || data.SUPABASE_DB_URL,
  { message: 'Either DATABASE_URL or SUPABASE_DB_URL must be set' },
);

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  for (const issue of envResult.error.issues) {
    logger.error(`ENV ERROR: ${issue.path.join('.')} — ${issue.message}`);
  }
  // Don't exit — let the server start so the healthcheck can respond.
  // Routes that need missing vars will fail individually with clear errors.
  logger.error('Environment validation failed. Some features may not work. Fix the above errors.');
}

// Warnings for optional but recommended vars
if (!process.env.REDIS_URL) {
  logger.warn('REDIS_URL not set — rate limiting will use in-memory fallback');
}
if (!process.env.ALLOWED_EXTENSION_IDS && !process.env.CHROME_EXTENSION_ID) {
  logger.warn('No ALLOWED_EXTENSION_IDS configured — Chrome extension CORS will be rejected');
}
if (!process.env.ADMIN_KEY_1 || !process.env.ADMIN_KEY_2) {
  logger.warn('ADMIN_KEY_1/ADMIN_KEY_2 not set — kill switch endpoint will be inaccessible');
}

const port = parseInt(process.env.PORT || '3000');

// ── Process-level error handlers ────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  if (SentryMod) SentryMod.captureException(reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  if (SentryMod) SentryMod.captureException(err);
  // Give Sentry time to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

// ── Server startup with graceful shutdown ───────────────────────────────────
import('@hono/node-server').then(({ serve }) => {
  const server = serve({ fetch: app.fetch, port }, async () => {
    logger.info('Server started', { port, url: `http://localhost:${port}` });

    // Verify database connectivity (non-fatal — health endpoint reports degraded status)
    try {
      await db.execute(sql`SELECT 1`);
      logger.info('Database connection verified');
    } catch (err) {
      logger.error('Database connection failed on startup — routes requiring DB will fail', { error: err instanceof Error ? err.message : String(err) });
    }

    // Start scheduled jobs
    import('./jobs/scheduler').then(({ startScheduler }) => startScheduler()).catch(err => logger.error('Failed to start scheduler', { error: err instanceof Error ? err.message : String(err) }));

    // Start BullMQ background workers (co-occurrences, webhooks, SIEM, inference)
    import('./jobs/workers').then(({ startWorkers }) => startWorkers()).catch(err => logger.error('Failed to start workers', { error: err instanceof Error ? err.message : String(err) }));
  });

  // ── Graceful Shutdown ───────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);

    // Force exit after timeout to prevent hanging
    setTimeout(() => {
      logger.warn('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();

    // 1. Stop accepting new connections and drain in-flight requests
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed');
        resolve();
      });
    });

    // 2. Close BullMQ workers (let in-flight jobs finish)
    try {
      const { closeWorkers } = await import('./jobs/workers');
      await closeWorkers();
      logger.info('BullMQ workers closed');
    } catch { /* workers may not be started */ }

    // 3. Close Redis connection
    try {
      const { closeRedis } = await import('./lib/redis');
      await closeRedis();
      logger.info('Redis connection closed');
    } catch { /* Redis may not be connected */ }

    // 4. Flush Sentry events
    if (SentryMod) {
      await SentryMod.close(2000);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});
