import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { eventsRoutes } from './routes/events';
import { dashboardRoutes } from './routes/dashboard';
import { adminRoutes } from './routes/admin';
import { reportsRoutes } from './routes/reports';
import { feedbackRoutes } from './routes/feedback';
import { proxyRoutes } from './routes/proxy';
import { authRoutes } from './routes/auth';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { firmContextMiddleware } from './middleware/firm-context';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Build allowed origins from environment
const allowedOrigins: string[] = [
  'http://localhost:3001',  // Dashboard dev
  'http://localhost:3000',  // API dev (for testing)
];
if (process.env.DASHBOARD_URL) allowedOrigins.push(process.env.DASHBOARD_URL);
if (process.env.CHROME_EXTENSION_ID) {
  allowedOrigins.push(`chrome-extension://${process.env.CHROME_EXTENSION_ID}`);
}

// Global middleware
app.use('*', logger());
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
    allowHeaders: ['Content-Type', 'Authorization', 'X-Firm-ID'],
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
      const { db } = await import('./db/client');
      const result = await db.execute({ sql: 'SELECT 1' } as any);
      health.database = 'connected';
    } catch {
      health.database = 'disconnected';
      health.status = 'degraded';
    }
  }

  return c.json(health);
});

// Auth routes (self-authenticated — must be mounted before the global auth middleware)
app.route('/v1/auth', authRoutes);

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
