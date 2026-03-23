/**
 * Iron Gate API Gateway
 *
 * OpenAI/Anthropic-compatible reverse proxy that intercepts prompts
 * from desktop AI apps, runs them through Iron Gate's detection pipeline,
 * and either passes through, pseudonymizes, or blocks.
 *
 * Usage:
 *   OPENAI_BASE_URL=http://localhost:8443  (in your AI app)
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { createOpenAIRoutes } from './routes/openai';
import { createAnthropicRoutes } from './routes/anthropic';

// BUG-05: Upstream fetch timeout — prevents gateway from hanging indefinitely
const UPSTREAM_TIMEOUT_MS = 60_000; // 60s — generous for AI API streaming responses

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

const config = loadConfig();
const app = new Hono();

// Request logging
app.use('*', logger());

// ── Health + Status ──────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    gateway: true,
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }),
);

app.get('/gateway/status', (c) =>
  c.json({
    firmId: config.firmId,
    thresholds: config.thresholds,
    upstreams: config.upstreams,
    failOpen: config.failOpen,
  }),
);

// ── Provider Routes ──────────────────────────────────────────────────

const openaiRoutes = createOpenAIRoutes(config);
const anthropicRoutes = createAnthropicRoutes(config);

app.route('/', openaiRoutes);
app.route('/', anthropicRoutes);

// ── Catch-all: passthrough ───────────────────────────────────────────

app.all('*', async (c) => {
  // For any unmatched path, try to proxy to OpenAI by default
  const url = `${config.upstreams.openai}${c.req.path}`;
  const method = c.req.method;

  try {
    // BUG-40: Only forwarding Authorization and Content-Type is intentional —
    // the catch-all proxies the user's upstream provider key, not Iron Gate headers
    // (X-Firm-ID, X-Admin-Key, x-api-key are NOT forwarded).
    const init: RequestInit = {
      method,
      headers: new Headers({
        'Content-Type': c.req.header('content-type') || 'application/json',
        ...(c.req.header('authorization') ? { Authorization: c.req.header('authorization')! } : {}),
      }),
    };

    if (method !== 'GET' && method !== 'HEAD') {
      init.body = await c.req.raw.text();
    }

    const response = await fetchWithTimeout(url, init);
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') || 'application/json' },
    });
  } catch (error) {
    return c.json({ error: 'Gateway proxy error' }, 502);
  }
});

// ── Start ─────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`[Iron Gate Gateway] Running on http://localhost:${config.port}`);
  console.log(`[Iron Gate Gateway] Firm: ${config.firmId}`);
  console.log(`[Iron Gate Gateway] Thresholds: pseudonymize >= ${config.thresholds.pseudonymize}, block >= ${config.thresholds.block}`);
  console.log(`[Iron Gate Gateway] Fail-open: ${config.failOpen}`);
  console.log('');
  console.log('[Iron Gate Gateway] Configure your AI tools:');
  console.log(`  OPENAI_BASE_URL=http://localhost:${config.port}`);
  console.log(`  ANTHROPIC_BASE_URL=http://localhost:${config.port}`);
  console.log('');
  console.log('[Iron Gate Gateway] Or for SDKs:');
  console.log(`  openai.OpenAI(base_url="http://localhost:${config.port}/v1")`);
  console.log(`  new Anthropic({ baseURL: "http://localhost:${config.port}" })`);
});
