// ============================================================================
// IronGate API Gateway — OpenAI & Anthropic compatible endpoints
// ============================================================================
//
// Drop-in replacement for api.openai.com and api.anthropic.com. Customers
// point their existing OpenAI/Anthropic SDK at IronGate's base URL instead,
// and every request flows through the detection → pseudonymize → forward →
// de-pseudonymize → audit pipeline.
//
// Architecture:
//   * Request format: OpenAI-compatible (industry-standard)
//   * Routing: `model` field determines upstream provider (OpenAI / Anthropic /
//     Gemini / Ollama). Generic and multi-provider — not locked to any vendor.
//   * Detection: reuses the same pipeline as the browser extension (server-side
//     regex + firm plugins + client matter matching + contextual scoring).
//   * Pseudonymization: Pseudonymizer class generates deterministic fakes,
//     maintains session map for response de-pseudonymization.
//
// Supported endpoints:
//   POST /v1/gateway/chat/completions   (OpenAI-compatible; routes to any provider by model)
//   POST /v1/gateway/messages            (Anthropic-compatible; routes to any provider by model)
//   GET  /v1/gateway/models              (list supported models across all providers)
//
// Auth: Bearer <IronGate API key> (standard authMiddleware).
//
// Streaming: Not yet supported (stream: true returns 400). Coming in v0.3.0.

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq } from 'drizzle-orm';
import { Pseudonymizer } from '../proxy/pseudonymizer';
import { LLMRouter } from '../proxy/llm-router';
import type { FirmLLMConfig } from '../proxy/llm-router';
import { enqueueAudit } from '../jobs/enqueue';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';
import { detectFirmAware } from '../detection/detector';
import { scoreFirmAware } from '../detection/scorer';
import type { LLMRoute } from '@iron-gate/types';

export const gatewayRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Infer LLM routing tier from the sensitivity level. */
function routeFromSensitivity(level: string): LLMRoute {
  if (level === 'low') return 'passthrough';
  return 'cloud_masked';
}

/** Infer the target provider from the requested model name. */
function providerFromModel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3')) return 'openai';
  if (lower.startsWith('claude')) return 'anthropic';
  if (lower.startsWith('gemini')) return 'gemini';
  if (lower.startsWith('llama') || lower.startsWith('mistral') || lower.startsWith('codellama') || lower.startsWith('phi')) return 'ollama';
  return 'gemini';
}

/** Concatenate messages into a single blob for whole-conversation detection. */
function concatMessagesForDetection(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
}

/** SHA-256 hex digest for audit log prompt fingerprint. */
function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ---------------------------------------------------------------------------
// Schemas — OpenAI Chat Completions
// ---------------------------------------------------------------------------

const openAIMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const openAIChatCompletionsSchema = z.object({
  model: z.string().min(1),
  messages: z.array(openAIMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional().default(false),
  // Preserved for SDK compat (not used by gateway logic)
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  user: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Schemas — Anthropic Messages
// ---------------------------------------------------------------------------

const anthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const anthropicMessagesSchema = z.object({
  model: z.string().min(1),
  messages: z.array(anthropicMessageSchema).min(1),
  system: z.string().optional(),
  max_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// POST /v1/gateway/chat/completions  (OpenAI-compatible, multi-provider)
// ---------------------------------------------------------------------------

gatewayRoutes.post('/chat/completions', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId') || firmId;
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400);
  }

  const parsed = openAIChatCompletionsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          message: 'Invalid request: ' + parsed.error.issues.map((i) => i.message).join('; '),
          type: 'invalid_request_error',
        },
      },
      400,
    );
  }

  const { model, messages, temperature, max_tokens, stream } = parsed.data;

  if (stream) {
    return c.json(
      {
        error: {
          message: 'Streaming responses are not yet supported. Set stream: false. Coming in v0.3.0.',
          type: 'invalid_request_error',
        },
      },
      400,
    );
  }

  try {
    // 1. Concat + detect entities across the full conversation
    const fullText = concatMessagesForDetection(messages);
    const entities = await detectFirmAware(fullText, { firmId });
    const score = await scoreFirmAware(fullText, entities, { firmId });
    const sensitivityLevel = score.level;
    const route = routeFromSensitivity(sensitivityLevel);

    // 2. Load firm config for provider credentials
    const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
    const firmConfig = (firm?.config as { llm?: FirmLLMConfig }) || {};
    const llmConfig: FirmLLMConfig = firmConfig.llm || {};

    // 3. Pseudonymize each message (if sensitivity warrants it)
    const sessionId = requestId;
    const pseudo = new Pseudonymizer(sessionId, firmId);
    const shouldMask = route !== 'passthrough' && entities.length > 0;
    const processedMessages = messages.map((m) => {
      if (!shouldMask) return m;
      // Re-detect per message to get accurate offsets for this content
      const messageEntities = entities.filter((e) => m.content.includes(e.text));
      if (messageEntities.length === 0) return m;
      const result = pseudo.pseudonymize(m.content, messageEntities);
      return { role: m.role, content: result.maskedText };
    });

    // 4. Route to upstream provider
    const router = new LLMRouter(llmConfig);
    const systemMessage = processedMessages.find((m) => m.role === 'system');
    const userMessages = processedMessages.filter((m) => m.role !== 'system');
    const lastUser = userMessages[userMessages.length - 1];
    const llmResponse = await router.send({
      prompt: lastUser?.content || '',
      route,
      model,
      systemPrompt: systemMessage?.content,
      maxTokens: max_tokens,
      temperature,
    });

    // 5. De-pseudonymize the response
    const finalText = shouldMask ? pseudo.depseudonymize(llmResponse.text) : llmResponse.text;

    // 6. Build OpenAI-compatible response
    const completion = {
      id: `chatcmpl-${requestId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: llmResponse.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: finalText },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: llmResponse.tokensUsed.prompt,
        completion_tokens: llmResponse.tokensUsed.completion,
        total_tokens: llmResponse.tokensUsed.prompt + llmResponse.tokensUsed.completion,
      },
      irongate: {
        sensitivity_level: sensitivityLevel,
        sensitivity_score: score.score,
        entity_categories: Array.from(new Set(entities.map((e) => e.type))),
        entity_count: entities.length,
        route,
        provider: providerFromModel(model),
        latency_ms: Date.now() - startTime,
      },
    };

    // 7. Anonymized audit log (no prompt text, only metadata + hash)
    enqueueAudit({
      firmId,
      userId,
      aiToolId: `gateway:${providerFromModel(model)}`,
      sessionId,
      promptHash: sha256Hex(fullText),
      promptLength: fullText.length,
      sensitivityScore: score.score,
      sensitivityLevel,
      action: route === 'passthrough' ? 'pass' : 'proxy',
      captureMethod: 'gateway',
      metadata: {
        gatewayEndpoint: 'chat/completions',
        provider: providerFromModel(model),
        model,
        entityCategories: Array.from(new Set(entities.map((e) => e.type))),
        entityCount: entities.length,
        latencyMs: Date.now() - startTime,
      },
    }).catch((err) => logger.warn('Gateway audit enqueue failed', { error: String(err) }));

    return c.json(completion);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Gateway chat/completions failed', { firmId, error: message });
    return c.json(
      {
        error: {
          message: `IronGate gateway error: ${message}`,
          type: 'api_error',
        },
      },
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /v1/gateway/messages  (Anthropic-compatible, multi-provider)
// ---------------------------------------------------------------------------

gatewayRoutes.post('/messages', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId') || firmId;
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
  }

  const parsed = anthropicMessagesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Invalid request: ' + parsed.error.issues.map((i) => i.message).join('; '),
        },
      },
      400,
    );
  }

  const { model, messages, system, max_tokens, temperature, stream } = parsed.data;

  if (stream) {
    return c.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Streaming responses are not yet supported. Set stream: false. Coming in v0.3.0.',
        },
      },
      400,
    );
  }

  try {
    const fullText = (system ? `system: ${system}\n\n` : '') + concatMessagesForDetection(messages);
    const entities = await detectFirmAware(fullText, { firmId });
    const score = await scoreFirmAware(fullText, entities, { firmId });
    const sensitivityLevel = score.level;
    const route = routeFromSensitivity(sensitivityLevel);

    const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
    const firmConfig = (firm?.config as { llm?: FirmLLMConfig }) || {};
    const llmConfig: FirmLLMConfig = firmConfig.llm || {};

    const sessionId = requestId;
    const pseudo = new Pseudonymizer(sessionId, firmId);
    const shouldMask = route !== 'passthrough' && entities.length > 0;

    const processedMessages = messages.map((m) => {
      if (!shouldMask) return m;
      const messageEntities = entities.filter((e) => m.content.includes(e.text));
      if (messageEntities.length === 0) return m;
      const result = pseudo.pseudonymize(m.content, messageEntities);
      return { role: m.role, content: result.maskedText };
    });
    let processedSystem = system;
    if (processedSystem && shouldMask) {
      const sysEntities = entities.filter((e) => processedSystem!.includes(e.text));
      if (sysEntities.length > 0) {
        processedSystem = pseudo.pseudonymize(processedSystem, sysEntities).maskedText;
      }
    }

    const router = new LLMRouter(llmConfig);
    const lastUser = processedMessages[processedMessages.length - 1];
    const llmResponse = await router.send({
      prompt: lastUser?.content || '',
      route,
      model,
      systemPrompt: processedSystem,
      maxTokens: max_tokens,
      temperature,
    });

    const finalText = shouldMask ? pseudo.depseudonymize(llmResponse.text) : llmResponse.text;

    const anthropicResponse = {
      id: `msg_${requestId.replace(/-/g, '')}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: finalText }],
      model: llmResponse.model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: llmResponse.tokensUsed.prompt,
        output_tokens: llmResponse.tokensUsed.completion,
      },
      irongate: {
        sensitivity_level: sensitivityLevel,
        sensitivity_score: score.score,
        entity_categories: Array.from(new Set(entities.map((e) => e.type))),
        entity_count: entities.length,
        route,
        provider: providerFromModel(model),
        latency_ms: Date.now() - startTime,
      },
    };

    enqueueAudit({
      firmId,
      userId,
      aiToolId: `gateway:${providerFromModel(model)}`,
      sessionId,
      promptHash: sha256Hex(fullText),
      promptLength: fullText.length,
      sensitivityScore: score.score,
      sensitivityLevel,
      action: route === 'passthrough' ? 'pass' : 'proxy',
      captureMethod: 'gateway',
      metadata: {
        gatewayEndpoint: 'messages',
        provider: providerFromModel(model),
        model,
        entityCategories: Array.from(new Set(entities.map((e) => e.type))),
        entityCount: entities.length,
        latencyMs: Date.now() - startTime,
      },
    }).catch((err) => logger.warn('Gateway audit enqueue failed', { error: String(err) }));

    return c.json(anthropicResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Gateway messages failed', { firmId, error: message });
    return c.json(
      {
        type: 'error',
        error: { type: 'api_error', message: `IronGate gateway error: ${message}` },
      },
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /v1/gateway/models
// ---------------------------------------------------------------------------

gatewayRoutes.get('/models', async (c) => {
  const models = [
    { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
    { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
    { id: 'gpt-4-turbo', object: 'model', owned_by: 'openai' },
    { id: 'claude-sonnet-4-20250514', object: 'model', owned_by: 'anthropic' },
    { id: 'claude-3-5-sonnet-20241022', object: 'model', owned_by: 'anthropic' },
    { id: 'claude-3-5-haiku-20241022', object: 'model', owned_by: 'anthropic' },
    { id: 'gemini-2.5-flash', object: 'model', owned_by: 'google' },
    { id: 'gemini-2.5-pro', object: 'model', owned_by: 'google' },
  ].map((m) => ({ ...m, created: 1704067200 }));

  return c.json({ object: 'list', data: models });
});
