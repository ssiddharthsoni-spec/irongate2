/**
 * Tier 3 Classification API — POST /v1/classify
 *
 * Receives sanitized text (PII replaced with [TYPE] tokens) from the
 * extension's confidence router and returns a server-side sensitivity
 * classification using LLM or heuristic fallback.
 *
 * Zero-knowledge: the server NEVER sees raw PII values.
 * The sanitized text contains only structural context + type tokens.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { classifyWithLLM, classifyWithHeuristic } from '../services/llm-classifier';
import type { ClassificationRequest } from '../services/llm-classifier';
import { getSemanticCache } from '../services/semantic-cache';
import type { AppEnv } from '../types';

const classifyRoutes = new Hono<AppEnv>();

// ── Request Schema ───────────────────────────────────────────────────────────

const classifyRequestSchema = z.object({
  sanitizedText: z.string().min(1).max(10000),
  entityTypeCounts: z.record(z.string(), z.number()),
  tier1Score: z.number().min(0).max(100),
  tier1Level: z.enum(['low', 'medium', 'high', 'critical']),
  firmId: z.string().min(1).optional(),
});

// ── POST /classify ───────────────────────────────────────────────────────────

classifyRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = classifyRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
  }

  // Use firmId from auth context, not from request body (prevent spoofing)
  const firmId = c.get('firmId');
  const request: ClassificationRequest = { ...parsed.data, firmId };

  // Validate that sanitized text doesn't contain obvious raw PII
  // (defense-in-depth: the extension should have already sanitized)
  if (containsLikelyRawPII(request.sanitizedText)) {
    logger.warn('Classify endpoint received text with likely raw PII — rejecting', {
      firmId,
    });
    return c.json({ error: 'Sanitized text appears to contain raw PII. Use sanitizeForClassification() before sending.' }, 422);
  }

  // ── Semantic Cache Lookup ──────────────────────────────────────────────────
  const cache = getSemanticCache();
  const fingerprint = cache.buildFingerprint(
    request.entityTypeCounts,
    request.sanitizedText.length,
    request.tier1Score,
  );

  const cached = cache.get(fingerprint);
  if (cached) {
    logger.info('Tier 3 classification cache hit', {
      firmId: request.firmId,
      fingerprint,
      score: cached.score,
    });
    return c.json({
      score: cached.score,
      level: cached.level,
      confidence: cached.confidence,
      reasoning: cached.reasoning,
      source: cached.source + ' (cached)',
      latencyMs: 0,
      cached: true,
    });
  }

  // ── Classification ─────────────────────────────────────────────────────────
  // Default Tier 3 LLM is now Gemini 2.5 Flash via Google's OpenAI-compatible
  // endpoint. CLASSIFIER_LLM_* env vars override, GEMINI_API_KEY is the
  // natural default. Falls back to heuristic if no key is configured.
  // NOTE: llmEndpoint must be the FULL URL including /chat/completions.
  const llmEndpoint =
    process.env.CLASSIFIER_LLM_ENDPOINT ||
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const llmApiKey = process.env.CLASSIFIER_LLM_API_KEY || process.env.GEMINI_API_KEY;
  const llmModel = process.env.CLASSIFIER_LLM_MODEL || 'gemini-2.5-flash';

  let result;
  if (llmEndpoint && llmApiKey) {
    result = await classifyWithLLM(request, llmEndpoint, llmApiKey, llmModel);
  } else {
    result = classifyWithHeuristic(request);
  }

  // Store in semantic cache
  cache.set(fingerprint, {
    score: result.score,
    level: result.level,
    confidence: result.confidence,
    reasoning: result.reasoning,
    source: result.source,
  });

  logger.info('Tier 3 classification complete', {
    firmId: request.firmId,
    tier1Score: request.tier1Score,
    tier3Score: result.score,
    tier3Level: result.level,
    source: result.source,
    latencyMs: result.latencyMs,
    upgraded: result.score > request.tier1Score,
  });

  return c.json({
    score: result.score,
    level: result.level,
    confidence: result.confidence,
    reasoning: result.reasoning,
    source: result.source,
    latencyMs: result.latencyMs,
    cached: false,
  });
});

// ── PII Detection Guard ──────────────────────────────────────────────────────
// Simple patterns that should NOT appear in properly sanitized text.

function containsLikelyRawPII(text: string): boolean {
  const patterns = [
    /\b\d{3}-\d{2}-\d{4}\b/,       // SSN
    /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, // Credit card
    /\bAKIA[A-Z0-9]{16}\b/,        // AWS access key
    /\bpostgresql?:\/\/[^\s]+/i,    // Database URI
    /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, // Private key
  ];

  return patterns.some(p => p.test(text));
}

export default classifyRoutes;
