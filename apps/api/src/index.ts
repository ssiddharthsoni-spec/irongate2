import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { eventsRoutes } from './routes/events';
import { dashboardRoutes } from './routes/dashboard';
import { adminRoutes } from './routes/admin';
import { reportsRoutes } from './routes/reports';
import { feedbackRoutes } from './routes/feedback';
import { proxyRoutes } from './routes/proxy';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { firmContextMiddleware } from './middleware/firm-context';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['chrome-extension://*', 'http://localhost:3001', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Firm-ID'],
  })
);

// Health check (no auth)
app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0', timestamp: new Date().toISOString() }));

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

// Support both Bun (export default) and Node.js (@hono/node-server)
if (typeof globalThis.Bun !== 'undefined') {
  // Bun runtime — use native server
  console.log(`[Iron Gate API] Starting on port ${port} (Bun)`);
  // @ts-ignore Bun export default syntax
  module.exports = { port, fetch: app.fetch };
} else {
  // Node.js runtime — use @hono/node-server
  import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port }, () => {
      console.log(`[Iron Gate API] Running on http://localhost:${port} (Node.js)`);
    });
  });
}

export default {
  port,
  fetch: app.fetch,
};
