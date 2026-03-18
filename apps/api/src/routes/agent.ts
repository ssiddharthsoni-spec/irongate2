/**
 * Agent Complete API — POST /v1/agent/complete
 *
 * Provides LLM completion for the extension's agent detector (Tier 4 backend).
 * The extension sends a system prompt + user prompt, and this endpoint proxies
 * to an OpenAI-compatible API (same LLM provider as the classifier).
 *
 * SECURITY: The agent detector in the extension sanitizes text before sending
 * to this tier (entities replaced with [TYPE] tokens). This endpoint is a
 * last-resort fallback — local Chrome AI and client LLM are preferred.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';

const agentRoutes = new Hono<AppEnv>();

// ── Request Schema ───────────────────────────────────────────────────────────

const agentCompleteSchema = z.object({
  system: z.string().min(1).max(8000),
  prompt: z.string().min(1).max(12000),
  maxTokens: z.number().min(1).max(8192).optional().default(2048),
  temperature: z.number().min(0).max(2).optional().default(0.1),
});

// ── POST /complete ──────────────────────────────────────────────────────────

agentRoutes.post('/complete', async (c) => {
  const body = await c.req.json();
  const parsed = agentCompleteSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
  }

  const { system, prompt, maxTokens, temperature } = parsed.data;
  const firmId = c.get('firmId');

  // Use the same LLM provider as the classifier
  const llmEndpoint = process.env.AGENT_LLM_ENDPOINT
    || process.env.CLASSIFIER_LLM_ENDPOINT;
  const llmApiKey = process.env.AGENT_LLM_API_KEY
    || process.env.CLASSIFIER_LLM_API_KEY;
  const llmModel = process.env.AGENT_LLM_MODEL || 'gpt-4o-mini';

  if (!llmEndpoint || !llmApiKey) {
    logger.warn('Agent complete: no LLM configured', { firmId });
    return c.json({ error: 'LLM not configured on server' }, 503);
  }

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmApiKey}`,
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.error('Agent LLM API error', {
        firmId,
        status: response.status,
        body: errText.substring(0, 200),
      });
      return c.json({ error: `LLM API error: ${response.status}` }, 502);
    }

    const data = await response.json() as any;
    const completion = data.choices?.[0]?.message?.content || '';
    const tokenCount = data.usage?.total_tokens;
    const latencyMs = Date.now() - start;

    logger.info('Agent complete', {
      firmId,
      model: llmModel,
      promptLen: prompt.length,
      completionLen: completion.length,
      tokenCount,
      latencyMs,
    });

    return c.json({
      text: completion,
      completion,
      tokenCount,
      latencyMs,
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('aborted') || message.includes('timeout')) {
      logger.warn('Agent complete timed out', { firmId, latencyMs });
      return c.json({ error: 'LLM request timed out' }, 504);
    }

    logger.error('Agent complete error', { firmId, error: message, latencyMs });
    return c.json({ error: 'Internal error' }, 500);
  }
});

export { agentRoutes };
