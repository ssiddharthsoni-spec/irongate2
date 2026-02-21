import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { firms, events } from '../db/schema';
import { eq } from 'drizzle-orm';
import { Pseudonymizer } from '../proxy/pseudonymizer';
import type { PseudonymMap } from '../proxy/pseudonymizer';
import { PseudonymStore } from '../proxy/pseudonym-store';
import { LLMRouter } from '../proxy/llm-router';
import type { FirmLLMConfig } from '../proxy/llm-router';
import type { AppEnv } from '../types';
import { detectFirmAware, scoreFirmAware } from '../detection';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const analyzeRequestSchema = z.object({
  // Accept both 'promptText' and 'text' for compatibility with extension
  promptText: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  aiToolId: z.string().min(1, 'aiToolId is required'),
  sessionId: z.string().uuid('sessionId must be a valid UUID'),
  userId: z.string().uuid('userId must be a valid UUID').optional(),
  firmId: z.string().uuid('firmId must be a valid UUID').optional(),
  timestamp: z.number().optional(),
}).refine(
  (data) => data.promptText || data.text,
  { message: 'Either promptText or text is required' },
);

const sendRequestSchema = z.object({
  maskedPrompt: z.string().min(1, 'maskedPrompt is required'),
  route: z.enum(['passthrough', 'cloud_masked', 'private_llm']),
  sessionId: z.string().uuid('sessionId must be a valid UUID'),
  model: z.string().optional().default('gpt-4'),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().int().positive().optional().default(4096),
  temperature: z.number().min(0).max(2).optional().default(0.7),
});

// Firm config shape (stored in the firms.config jsonb column)
interface FirmConfig {
  thresholds?: {
    passthrough?: number;  // score <= this -> passthrough
    cloudMasked?: number;  // score <= this -> cloud_masked, else private_llm
  };
  llm?: FirmLLMConfig;
  pseudonymTtlMinutes?: number;
}

// ---------------------------------------------------------------------------
// Helper: determine recommended route based on score and firm thresholds
// ---------------------------------------------------------------------------

function determineRoute(
  score: number,
  thresholds: NonNullable<FirmConfig['thresholds']>,
): 'passthrough' | 'cloud_masked' | 'private_llm' {
  const passthroughMax = thresholds.passthrough ?? 25;
  const cloudMaskedMax = thresholds.cloudMasked ?? 75;

  if (score <= passthroughMax) return 'passthrough';
  if (score <= cloudMaskedMax) return 'cloud_masked';
  return 'private_llm';
}

// ---------------------------------------------------------------------------
// Helper: compute SHA-256 hash for audit logging
// ---------------------------------------------------------------------------

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Helper: extract a flat original->pseudonym record from the PseudonymMap
// ---------------------------------------------------------------------------

function buildPseudonymRecord(map: PseudonymMap): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [, entry] of map.mappings) {
    if (entry.original) {
      record[entry.original] = entry.pseudonym;
    }
  }
  return record;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const proxyRoutes = new Hono<AppEnv>();

// ---- POST /v1/proxy/analyze ------------------------------------------------
proxyRoutes.post('/analyze', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = analyzeRequestSchema.parse(body);

    const promptText = (parsed.promptText || parsed.text)!;
    const firmId = parsed.firmId || c.get('firmId');
    const userId = parsed.userId || c.get('userId');

    // 1. Load firm config for thresholds
    const [firm] = await db
      .select({ config: firms.config })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1);

    const firmConfig = (firm?.config ?? {}) as FirmConfig;
    const thresholds = firmConfig.thresholds ?? {};

    // 2. Detect entities using firm-aware pipeline (regex + plugins + client-matters)
    const detectedEntities = await detectFirmAware(promptText, { firmId });

    // 3. Score sensitivity with firm graph boost + weight overrides
    const scoreResult = await scoreFirmAware(promptText, detectedEntities, { firmId });

    // 4. Determine recommended route based on score vs firm thresholds
    const recommendedRoute = determineRoute(scoreResult.score, thresholds);

    // 5. Pseudonymize if route is not passthrough and entities were found
    let maskedPrompt = promptText;
    let pseudonymMap: Record<string, string> = {};

    if (recommendedRoute !== 'passthrough' && detectedEntities.length > 0) {
      const pseudonymizer = new Pseudonymizer(parsed.sessionId, firmId);
      const result = pseudonymizer.pseudonymize(promptText, detectedEntities);
      maskedPrompt = result.maskedText;
      pseudonymMap = buildPseudonymRecord(result.map);

      // Persist the pseudonym map so /send can de-pseudonymize later
      const store = new PseudonymStore();
      await store.save(result.map);
    }

    // 6. Return analysis result
    return c.json({
      originalScore: {
        score: scoreResult.score,
        level: scoreResult.level,
        breakdown: scoreResult.breakdown,
      },
      maskedPrompt,
      pseudonymMap,
      recommendedRoute,
      entitiesFound: detectedEntities.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
    }
    throw error;
  }
});

// ---- POST /v1/proxy/send ---------------------------------------------------
proxyRoutes.post('/send', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = sendRequestSchema.parse(body);

    const firmId = c.get('firmId');
    const userId = c.get('userId');
    const startTime = Date.now();

    // 1. Load firm config for LLM provider settings
    const [firm] = await db
      .select({ config: firms.config })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1);

    const firmConfig = (firm?.config ?? {}) as FirmConfig;

    // 2. Load the pseudonym map for this session and prepare de-pseudonymizer
    const store = new PseudonymStore();
    const sessionMap = await store.load(parsed.sessionId, firmId);

    const pseudonymizer = new Pseudonymizer(parsed.sessionId, firmId);
    if (sessionMap) {
      pseudonymizer.loadMap(sessionMap);
    }

    // 3. Send the (potentially pseudonymized) prompt to the appropriate LLM
    const router = new LLMRouter(firmConfig.llm ?? {});
    const llmResult = await router.send({
      prompt: parsed.maskedPrompt,
      route: parsed.route,
      model: parsed.model,
      systemPrompt: parsed.systemPrompt,
      maxTokens: parsed.maxTokens,
      temperature: parsed.temperature,
    });

    // 4. De-pseudonymize the LLM response
    let decodedResponse = llmResult.text;
    if (sessionMap && sessionMap.mappings.size > 0) {
      decodedResponse = pseudonymizer.depseudonymize(llmResult.text);
    }

    const latencyMs = Date.now() - startTime;

    // 5. Log the proxy event to the events table
    const promptHash = await sha256(parsed.maskedPrompt);
    const action: 'proxy' | 'pass' = parsed.route === 'passthrough' ? 'pass' : 'proxy';
    const sensitivityLevel: 'low' | 'medium' | 'high' | 'critical' =
      parsed.route === 'passthrough' ? 'low'
      : parsed.route === 'cloud_masked' ? 'medium'
      : 'high';

    await db.insert(events).values({
      firmId,
      userId,
      aiToolId: `proxy:${parsed.model}`,
      promptHash,
      promptLength: parsed.maskedPrompt.length,
      sensitivityScore: parsed.route === 'passthrough' ? 0 : parsed.route === 'cloud_masked' ? 50 : 85,
      sensitivityLevel,
      entities: [],
      action,
      captureMethod: 'proxy',
      sessionId: parsed.sessionId,
      metadata: {
        route: parsed.route,
        model: llmResult.model,
        provider: llmResult.provider,
        tokensUsed: llmResult.tokensUsed,
        latencyMs,
      },
    });

    // 6. Return the de-pseudonymized response
    return c.json({
      response: decodedResponse,
      model: llmResult.model,
      provider: llmResult.provider,
      tokensUsed: llmResult.tokensUsed,
      latencyMs,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
    }
    throw error;
  }
});
