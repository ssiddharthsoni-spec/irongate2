// Iron Gate API Server
console.log(`[BOOT] Iron Gate API starting — pid=${process.pid} node=${process.version} PORT=${process.env.PORT || '3000'} at ${new Date().toISOString()}`);
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
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
      // Strip PII from error reports — never send request bodies to Sentry
      beforeSend(event: any) {
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers['authorization'];
            delete event.request.headers['x-api-key'];
            delete event.request.headers['x-admin-key-1'];
            delete event.request.headers['x-admin-key-2'];
            delete event.request.headers['cookie'];
          }
        }
        return event;
      },
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
import { provenanceRoutes } from './routes/provenance';
import { scimRoutes } from './routes/scim';
import { incidentRoutes } from './routes/incidents';
import { enterpriseRoutes } from './routes/enterprise';
import classifyRoutes from './routes/classify';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware, proxyRateLimitMiddleware } from './middleware/rate-limit';
import { firmContextMiddleware } from './middleware/firm-context';
import { rlsContextMiddleware } from './middleware/rls-context';
import { securityHeadersMiddleware } from './middleware/security-headers';
import { requestLoggerMiddleware } from './middleware/request-logger';
import { csrfProtectionMiddleware } from './middleware/csrf';
import { jwtRevocationMiddleware } from './middleware/jwt-revocation';
import { requirePerm } from './middleware/rbac';
import { adminRestrictionsMiddleware } from './middleware/admin-restrictions';
import { mfaEnforcementMiddleware } from './middleware/mfa-enforcement';
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
    version: '0.2.7',
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
      // Don't leak DB error details (may contain connection strings)
      health.dbError = 'connection_failed';
    }
  }

  return c.json(health);
});

// Kubernetes liveness probe — always returns 200 if process is running
app.get('/health/live', (c) => c.json({ status: 'alive' }));

// Kubernetes readiness probe — returns 200 only if dependencies are healthy
app.get('/health/ready', async (c) => {
  const checks: Record<string, boolean> = {};

  // Database check
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = true;
  } catch {
    checks.database = false;
  }

  // Redis check
  try {
    const redis = (await import('./lib/redis')).getRedisClient();
    if (redis) {
      await redis.ping();
      checks.redis = true;
    } else {
      checks.redis = false;
    }
  } catch {
    checks.redis = false;
  }

  // Encryption config check
  checks.encryption = !!(process.env.IRON_GATE_ENCRYPTION_SECRET || process.env.IRON_GATE_MASTER_SECRET);

  const allHealthy = Object.values(checks).every(Boolean);
  return c.json(
    { status: allHealthy ? 'ready' : 'degraded', checks },
    allHealthy ? 200 : 503,
  );
});

// Mirror health check under /v1 so extension connect works without auth
app.get('/v1/health', async (c) => {
  return c.json({
    status: 'ok',
    version: '0.2.7',
    timestamp: new Date().toISOString(),
  });
});

// Metrics endpoint — gated behind API key or admin key for security
app.get('/health/metrics', async (c) => {
  const apiKey = c.req.header('X-API-Key');
  const adminKey = c.req.header('X-Admin-Key-1');
  const metricsKey = process.env.METRICS_API_KEY;

  // Require at least one form of authentication (constant-time comparison)
  const isAuthed =
    (apiKey && metricsKey && apiKey.length === metricsKey.length &&
      crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(metricsKey))) ||
    (adminKey && process.env.ADMIN_KEY_1 && adminKey.length === process.env.ADMIN_KEY_1.length &&
      crypto.timingSafeEqual(Buffer.from(adminKey), Buffer.from(process.env.ADMIN_KEY_1)));

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
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css"
  integrity="sha384-rcbEi6xgdPk0iWkAQzT2F3FeBJXdG+ydrawGlfHAFIZG7wU6aKbQaRewysYpmrlW" crossorigin="anonymous"/>
</head><body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"
  integrity="sha384-NXtFPpN61oWCuN4D42K6Zd5Rt2+uxeIT36R7kpXBuY9tLnZorzrJ4ykpqwJfgjpZ" crossorigin="anonymous"></script>
<script>SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });</script>
</body></html>`;
  return c.html(html);
});

// Auth routes — stricter rate limit (20 req/min per IP) to prevent brute-force.
// Mounted before the global auth middleware because these endpoints self-authenticate.
const authRateCounts = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_LIMIT = 20;
const AUTH_RATE_WINDOW = 60_000;

app.use('/v1/auth/*', createMiddleware(async (c, next) => {
  const ip = c.req.header('cf-connecting-ip')
    || c.req.header('x-render-client-ip')
    || (c.req.header('x-forwarded-for') || '').split(',')[0].trim()
    || 'anonymous';
  const now = Date.now();
  let entry = authRateCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + AUTH_RATE_WINDOW };
    authRateCounts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > AUTH_RATE_LIMIT) {
    return c.json({ error: 'Too many auth requests — try again later' }, 429);
  }
  // Periodic cleanup
  if (authRateCounts.size > 5000) {
    for (const [k, v] of authRateCounts) {
      if (now > v.resetAt) authRateCounts.delete(k);
    }
  }
  await next();
}));

app.route('/v1/auth', authRoutes);
app.route('/v1/auth', extensionAuthRoutes);

// Stripe webhook (no auth — verified via webhook signature)
app.route('/v1/webhooks/stripe', stripeWebhookRoutes);

// SCIM 2.0 provisioning (no Clerk auth — uses its own bearer token via firms.config.scimToken)
app.route('/scim', scimRoutes);

// API routes (with auth + security middleware)
app.use('/v1/*', csrfProtectionMiddleware);
app.use('/v1/*', authMiddleware);
app.use('/v1/*', jwtRevocationMiddleware);
app.use('/v1/*', rateLimitMiddleware);
app.use('/v1/*', firmContextMiddleware);
app.use('/v1/*', rlsContextMiddleware);

// MFA enforcement on admin routes (when firm has mfaRequired=true)
app.use('/v1/admin/*', mfaEnforcementMiddleware);
// RBAC enforcement on admin and privileged routes
app.use('/v1/admin/*', requirePerm('viewDashboard'));
// Dual-approval restrictions for Iron Gate internal admin access
app.use('/v1/admin/internal/*', adminRestrictionsMiddleware);
app.use('/v1/invites/*', requirePerm('inviteUsers'));

app.route('/v1/events', eventsRoutes);
app.route('/v1/dashboard', dashboardRoutes);
app.route('/v1/admin', adminRoutes);
app.route('/v1/reports', reportsRoutes);
app.route('/v1/feedback', feedbackRoutes);
app.use('/v1/proxy/*', proxyRateLimitMiddleware);
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
app.route('/v1/provenance', provenanceRoutes);
app.route('/v1/incidents', incidentRoutes);
app.route('/v1/enterprise', enterpriseRoutes);
app.route('/v1/classify', classifyRoutes);

// ---------------------------------------------------------------------------
// Internal cron endpoints (secured by CRON_SECRET header)
// ---------------------------------------------------------------------------
app.get('/internal/cron/retention', async (c) => {
  const cronSecret = process.env.CRON_SECRET;
  const provided = c.req.header('Authorization');
  if (!cronSecret || provided !== `Bearer ${cronSecret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  try {
    const { runRetentionCleanup } = await import('./jobs/data-retention');
    const result = await runRetentionCleanup();
    return c.json({ status: 'ok', ...result });
  } catch (err) {
    logger.error('Retention cron failed', { error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Retention cleanup failed' }, 500);
  }
});

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
  IRON_GATE_ENCRYPTION_SECRET: z.string().min(16, 'IRON_GATE_ENCRYPTION_SECRET must be at least 16 characters').optional(),
  IRON_GATE_SIGNING_SECRET: z.string().min(16, 'IRON_GATE_SIGNING_SECRET must be at least 16 characters').optional(),
  PORT: z.string().regex(/^\d+$/, 'PORT must be a number').optional().default('3000'),
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).optional().default('development'),
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
  CRON_SECRET: z.string().min(16).optional(),
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
if (process.env.IRON_GATE_MASTER_SECRET && !process.env.IRON_GATE_ENCRYPTION_SECRET && !process.env.IRON_GATE_SIGNING_SECRET) {
  // Log critical warning but DO NOT throw — throwing kills the process before
  // /health can respond, causing Render to fail the deploy and roll back.
  if (process.env.NODE_ENV === 'production') {
    logger.error('CRITICAL: Using shared IRON_GATE_MASTER_SECRET in production. Set separate IRON_GATE_ENCRYPTION_SECRET and IRON_GATE_SIGNING_SECRET in Render dashboard.');
  } else {
    logger.warn('Using shared IRON_GATE_MASTER_SECRET for both encryption and signing — set IRON_GATE_ENCRYPTION_SECRET and IRON_GATE_SIGNING_SECRET separately for production');
  }
}
if (process.env.IRON_GATE_DEV_AUTH === 'true' && process.env.NODE_ENV === 'production') {
  logger.error('CRITICAL: IRON_GATE_DEV_AUTH=true is set in production! Disabling dev auth.');
  process.env.IRON_GATE_DEV_AUTH = 'false';
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
logger.info('Starting server...', { port, nodeVersion: process.version, pid: process.pid });

import('@hono/node-server').then(({ serve }) => {
  const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, async () => {
    logger.info('Server started', { port, hostname: '0.0.0.0', url: `http://0.0.0.0:${port}` });

    // Verify database connectivity (non-fatal — health endpoint reports degraded status)
    try {
      await db.execute(sql`SELECT 1`);
      logger.info('Database connection verified');

      // Auto-migrate: ensure new columns/tables exist
      const { runAutoMigrations } = await import('./db/auto-migrate');
      await runAutoMigrations();
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
}).catch((err) => {
  // If @hono/node-server fails to import, log and exit — this is truly fatal
  console.error('[FATAL] Failed to start HTTP server:', err);
  process.exit(1);
});
