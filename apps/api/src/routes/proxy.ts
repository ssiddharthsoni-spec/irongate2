import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { Pseudonymizer } from '../proxy/pseudonymizer';
import type { PseudonymMap } from '../proxy/pseudonymizer';
import { PseudonymStore } from '../proxy/pseudonym-store';
import { LLMRouter } from '../proxy/llm-router';
import type { FirmLLMConfig } from '../proxy/llm-router';
import { appendEvent } from '../services/audit-chain';
import { enqueueAudit, enqueueWebhook, enqueueSIEM } from '../jobs/enqueue';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';
import { detectFirmAware, scoreFirmAware } from '../detection';
import { classifyIntent, classifyIntentFull, getIntentWeight, isQuickPassthrough } from '../detection/intent-classifier';
import type { LlmClassifierConfig } from '../detection/intent-classifier';
import { detectStructure } from '../detection/structure-detector';
import { contextualizeEntities, getContextRiskMultiplier } from '../detection/entity-contextualizer';
import type { ContextualizedEntity } from '../detection/entity-contextualizer';
import { conversationState } from '../db/schema';
import {
  mergeEntityRules,
  getEffectiveBlockThreshold,
  getEffectiveRiskMultiplier,
} from '@iron-gate/config';
import type { ComplianceFrameworkId, EntityAction } from '@iron-gate/config';
import { departmentPolicyMiddleware, type DepartmentPolicy } from '../middleware/department-policy';
import { piiSafetyNetMiddleware, scanForUnmaskedPII } from '../middleware/pii-safety-net';

// ---------------------------------------------------------------------------
// LLM Cost Controls — per-firm daily call budget
// ---------------------------------------------------------------------------

const LLM_DAILY_BUDGET = parseInt(process.env.LLM_DAILY_BUDGET_PER_FIRM || '500', 10);
const _llmCallCounts = new Map<string, { count: number; resetAt: number }>();
// Performance Lead Phase · Issue #3 — opportunistic eviction.
// Previously only evicted when the map grew past 5000. That's O(N) per
// overflow-trigger request AND lets day-1 entries linger for a firm that
// never hits the cap. Every 256 calls we do an O(N) sweep of expired
// entries. Bounded, amortized, and keeps the map small across all traffic
// patterns (not just adversarial ones).
let _llmBudgetCallsSinceSweep = 0;
const LLM_BUDGET_SWEEP_EVERY = 256;

/** Check and increment LLM call count for a firm. Returns true if within budget. */
function checkLlmBudget(firmId: string): boolean {
  const now = Date.now();

  _llmBudgetCallsSinceSweep++;
  if (_llmBudgetCallsSinceSweep >= LLM_BUDGET_SWEEP_EVERY || _llmCallCounts.size > 5000) {
    _llmBudgetCallsSinceSweep = 0;
    for (const [key, val] of _llmCallCounts) {
      if (val.resetAt < now) _llmCallCounts.delete(key);
    }
  }

  const entry = _llmCallCounts.get(firmId);

  if (!entry || entry.resetAt < now) {
    // Start new daily window (resets at next midnight UTC)
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    _llmCallCounts.set(firmId, { count: 1, resetAt: midnight.getTime() });
    return true;
  }

  if (entry.count >= LLM_DAILY_BUDGET) {
    return false;
  }

  entry.count++;
  return true;
}

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
  model: z.string().optional().default('gemini-2.5-flash'),
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
  complianceFrameworks?: ComplianceFrameworkId[];
}

// ---------------------------------------------------------------------------
// Helper: determine recommended route based on score and firm thresholds
// ---------------------------------------------------------------------------

type Route = 'passthrough' | 'cloud_masked' | 'private_llm';

const ROUTE_SEVERITY: Record<Route, number> = {
  passthrough: 0,
  cloud_masked: 1,
  private_llm: 2,
};

function determineRoute(
  score: number,
  thresholds: NonNullable<FirmConfig['thresholds']>,
): Route {
  const passthroughMax = thresholds.passthrough ?? 25;
  const cloudMaskedMax = thresholds.cloudMasked ?? 75;

  if (score <= passthroughMax) return 'passthrough';
  if (score <= cloudMaskedMax) return 'cloud_masked';
  return 'private_llm';
}

/** Return the stricter of two routes */
function stricterRoute(a: Route, b: Route): Route {
  return ROUTE_SEVERITY[a] >= ROUTE_SEVERITY[b] ? a : b;
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

// Apply department policy middleware to all proxy routes
proxyRoutes.use('*', departmentPolicyMiddleware());

// ---- POST /v1/proxy/analyze (DEPRECATED — use /relay) ----------------------
// This endpoint accepts raw PII text and pseudonymizes server-side.
// Deprecated in v0.2.7. Will be removed in v0.3.0.
// New clients should use POST /v1/proxy/relay which accepts pre-pseudonymized text.
proxyRoutes.post('/analyze', async (c) => {
  c.header('Deprecation', 'true');
  c.header('Sunset', '2027-06-01');
  c.header('Link', '</v1/proxy/relay>; rel="successor-version"');
  logger.warn('Deprecated endpoint called: POST /v1/proxy/analyze', { firmId: c.get('firmId') });
  try {
    const body = await c.req.json();
    const parsed = analyzeRequestSchema.parse(body);

    const promptText = (parsed.promptText || parsed.text)!;
    // Always use authenticated firm/user context — never trust client-supplied IDs
    const firmId = c.get('firmId');
    const userId = c.get('userId');

    // 1. Load firm config for thresholds
    const [firm] = await db
      .select({ config: firms.config })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1);

    if (!firm) return c.json({ error: 'Firm not found' }, 404);

    const firmConfig = (firm.config ?? {}) as FirmConfig;
    const thresholds = firmConfig.thresholds ?? {};

    // 2. Detect entities using firm-aware pipeline (regex + plugins + client-matters)
    const detectedEntities = await detectFirmAware(promptText, { firmId });

    // 3. Score sensitivity with firm graph boost + weight overrides
    const scoreResult = await scoreFirmAware(promptText, detectedEntities, { firmId });

    // 4. Apply compliance framework entity-level rules
    //    When HIPAA is active and a MEDICAL_RECORD is detected, it must be
    //    blocked/redacted regardless of the overall score.
    const activeFrameworks = firmConfig.complianceFrameworks || [];
    let complianceOverrideRoute: 'passthrough' | 'cloud_masked' | 'private_llm' | null = null;
    let complianceBlockedEntities: string[] = [];

    if (activeFrameworks.length > 0 && detectedEntities.length > 0) {
      const entityRules = mergeEntityRules(activeFrameworks);
      const ruleMap = new Map<string, EntityAction>();
      for (const rule of entityRules) {
        ruleMap.set(rule.entityType, rule.action);
      }

      // Check each detected entity against compliance rules
      for (const entity of detectedEntities) {
        const action = ruleMap.get(entity.type);
        if (action === 'block') {
          complianceBlockedEntities.push(entity.type);
          complianceOverrideRoute = 'private_llm'; // most restrictive
        } else if (action === 'redact' && complianceOverrideRoute !== 'private_llm') {
          complianceOverrideRoute = 'private_llm';
        } else if (action === 'pseudonymize' && !complianceOverrideRoute) {
          complianceOverrideRoute = 'cloud_masked';
        }
      }

      // Also apply the compliance block threshold
      const complianceThreshold = getEffectiveBlockThreshold(activeFrameworks);
      if (scoreResult.score >= complianceThreshold && !complianceOverrideRoute) {
        complianceOverrideRoute = 'private_llm';
      }
    }

    // 4b. Apply department-level entity auto-block rules
    const deptPolicy = c.get('departmentPolicy') as DepartmentPolicy | undefined;
    if (deptPolicy?.blockedEntityTypes && detectedEntities.length > 0) {
      const autoBlockSet = new Set(deptPolicy.blockedEntityTypes);
      for (const entity of detectedEntities) {
        if (autoBlockSet.has(entity.type)) {
          complianceBlockedEntities.push(entity.type);
          complianceOverrideRoute = 'private_llm';
        }
      }
    }
    // Department-level sensitivity threshold
    if (deptPolicy?.maxSensitivity != null) {
      if (scoreResult.score >= deptPolicy.maxSensitivity) {
        complianceOverrideRoute = complianceOverrideRoute
          ? stricterRoute(complianceOverrideRoute, 'private_llm')
          : 'private_llm';
      }
    }

    // 5. Determine recommended route — compliance + department rules override score-based routing
    const scoreBasedRoute = determineRoute(scoreResult.score, thresholds);
    const recommendedRoute = complianceOverrideRoute
      ? (stricterRoute(scoreBasedRoute, complianceOverrideRoute))
      : scoreBasedRoute;

    // 6. Pseudonymize if route is not passthrough and entities were found
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

    // 7. Return analysis result
    return c.json({
      originalScore: {
        score: scoreResult.score,
        level: scoreResult.level,
        breakdown: scoreResult.breakdown,
      },
      maskedPrompt,
      pseudonymCount: Object.keys(pseudonymMap).length,
      recommendedRoute,
      entitiesFound: detectedEntities.length,
      ...(complianceBlockedEntities.length > 0 && {
        complianceEnforcement: {
          blockedEntityTypes: complianceBlockedEntities,
          frameworks: activeFrameworks,
        },
      }),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
    }
    throw error;
  }
});

// ---- POST /v1/proxy/send (DEPRECATED — use /relay) -------------------------
// This endpoint handles LLM routing after server-side pseudonymization.
// Deprecated in v0.2.7. Will be removed in v0.3.0.
// New clients should use POST /v1/proxy/relay which handles the full flow.
proxyRoutes.post('/send', async (c) => {
  c.header('Deprecation', 'true');
  c.header('Sunset', '2027-06-01');
  c.header('Link', '</v1/proxy/relay>; rel="successor-version"');
  logger.warn('Deprecated endpoint called: POST /v1/proxy/send', { firmId: c.get('firmId') });
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

    if (!firm) return c.json({ error: 'Firm not found' }, 404);

    const firmConfig = (firm.config ?? {}) as FirmConfig;

    // 2. Load the pseudonym map for this session and prepare de-pseudonymizer
    const store = new PseudonymStore();
    const sessionMap = await store.load(parsed.sessionId, firmId);

    const pseudonymizer = new Pseudonymizer(parsed.sessionId, firmId);
    if (sessionMap) {
      pseudonymizer.loadMap(sessionMap);
    }

    // 2b. Server-side safety check: scan maskedPrompt for unmasked PII
    // Even though this is deprecated, prevent bypassing protection via tampered route
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/,           // SSN
      /\b(?:sk-|AKIA|AIza)[A-Za-z0-9]{10,}/,  // API keys
      /(?:mongodb\+srv|postgres(?:ql)?|mysql):\/\//i,  // DB URIs
    ];
    const hasRawPII = piiPatterns.some(p => p.test(parsed.maskedPrompt));
    const effectiveRoute = hasRawPII && parsed.route === 'passthrough'
      ? 'cloud_masked' as const
      : parsed.route;
    if (hasRawPII && parsed.route === 'passthrough') {
      logger.warn('/proxy/send: overriding passthrough route — raw PII detected in maskedPrompt', { firmId });
    }

    // 3. Send the (potentially pseudonymized) prompt to the appropriate LLM
    const router = new LLMRouter(firmConfig.llm ?? {});
    const llmResult = await router.send({
      prompt: parsed.maskedPrompt,
      route: effectiveRoute,
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

    // 5. Log the proxy event via audit chain for cryptographic trail
    const promptHash = await sha256(parsed.maskedPrompt);
    const action: 'proxy' | 'pass' = parsed.route === 'passthrough' ? 'pass' : 'proxy';
    const sensitivityLevel: 'low' | 'medium' | 'high' | 'critical' =
      parsed.route === 'passthrough' ? 'low'
      : parsed.route === 'cloud_masked' ? 'medium'
      : 'high';

    const sensitivityScore = parsed.route === 'passthrough' ? 0 : parsed.route === 'cloud_masked' ? 50 : 85;

    const inserted = await appendEvent({
      firmId,
      userId,
      aiToolId: `proxy:${parsed.model}`,
      promptHash,
      promptLength: parsed.maskedPrompt.length,
      sensitivityScore,
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

    // 5b. SIEM + webhook dispatch for high-risk proxy events
    if (sensitivityScore >= 60) {
      enqueueWebhook({
        firmId,
        eventType: 'high_risk_detected',
        payload: {
          eventId: inserted.id,
          aiToolId: `proxy:${parsed.model}`,
          sensitivityScore,
          sensitivityLevel,
          action,
          route: parsed.route,
          entityCount: 0,
        },
      }).catch((err) =>
        logger.warn('Failed to enqueue proxy webhook', { error: err instanceof Error ? err.message : String(err) }),
      );
    }

    enqueueSIEM({
      firmId,
      event: {
        eventId: inserted.id,
        firmId,
        aiToolId: `proxy:${parsed.model}`,
        sensitivityScore,
        sensitivityLevel,
        action,
        entityCount: 0,
        captureMethod: 'proxy',
        timestamp: new Date().toISOString(),
      },
    }).catch((err) =>
      logger.warn('Failed to enqueue proxy SIEM forward', { error: err instanceof Error ? err.message : String(err) }),
    );

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

// ---------------------------------------------------------------------------
// NEW: POST /v1/proxy/relay — Zero-Knowledge Proxy
// ---------------------------------------------------------------------------
// The extension sends ALREADY-PSEUDONYMIZED text. The proxy never receives
// raw PII. It checks firm policy, optionally routes to an LLM, and returns
// the response. De-pseudonymization happens client-side in the extension.
// ---------------------------------------------------------------------------

const relayRequestSchema = z.object({
  maskedPrompt: z.string().min(1, 'maskedPrompt is required'),
  sensitivityScore: z.number().min(0).max(100),
  sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']),
  entityTypes: z.array(z.string()).default([]),
  entityCount: z.number().int().min(0).default(0),
  aiToolId: z.string().min(1, 'aiToolId is required'),
  sessionId: z.string().min(1, 'sessionId is required'),
  route: z.enum(['cloud', 'private_llm']),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().int().positive().optional().default(4096),
  temperature: z.number().min(0).max(2).optional().default(0.7),
});

proxyRoutes.post('/relay', piiSafetyNetMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const parsed = relayRequestSchema.parse(body);

    const firmId = c.get('firmId');
    const userId = c.get('userId');
    const startTime = Date.now();

    // 1. Load firm config
    const [firm] = await db
      .select({ config: firms.config })
      .from(firms)
      .where(eq(firms.id, firmId))
      .limit(1);

    if (!firm) return c.json({ error: 'Firm not found' }, 404);

    const firmConfig = (firm.config ?? {}) as FirmConfig;

    // 2. Policy enforcement
    const activeFrameworks = firmConfig.complianceFrameworks || [];
    let blocked = false;
    let blockReason = '';

    if (activeFrameworks.length > 0 && parsed.entityTypes.length > 0) {
      const entityRules = mergeEntityRules(activeFrameworks);
      const ruleMap = new Map<string, EntityAction>();
      for (const rule of entityRules) {
        ruleMap.set(rule.entityType, rule.action);
      }
      for (const entityType of parsed.entityTypes) {
        if (ruleMap.get(entityType) === 'block') {
          blocked = true;
          blockReason = `Compliance policy blocks ${entityType} for frameworks: ${activeFrameworks.join(', ')}`;
          break;
        }
      }
    }

    const deptPolicy = c.get('departmentPolicy') as DepartmentPolicy | undefined;
    if (!blocked && deptPolicy?.blockedEntityTypes) {
      const autoBlockSet = new Set(deptPolicy.blockedEntityTypes);
      for (const entityType of parsed.entityTypes) {
        if (autoBlockSet.has(entityType)) {
          blocked = true;
          blockReason = `Department policy blocks ${entityType}`;
          break;
        }
      }
    }
    if (!blocked && deptPolicy?.maxSensitivity != null && parsed.sensitivityScore >= deptPolicy.maxSensitivity) {
      blocked = true;
      blockReason = `Sensitivity score ${parsed.sensitivityScore} exceeds department limit ${deptPolicy.maxSensitivity}`;
    }

    if (blocked) {
      const promptHash = await sha256(parsed.maskedPrompt);
      await appendEvent({
        firmId, userId,
        aiToolId: parsed.aiToolId,
        promptHash,
        promptLength: parsed.maskedPrompt.length,
        sensitivityScore: parsed.sensitivityScore,
        sensitivityLevel: parsed.sensitivityLevel,
        entities: [],
        action: 'block',
        captureMethod: 'relay',
        sessionId: parsed.sessionId,
        metadata: { blockReason, route: parsed.route },
      });
      return c.json({ action: 'blocked', reason: blockReason, score: parsed.sensitivityScore, level: parsed.sensitivityLevel }, 403);
    }

    // 3. Route to LLM
    const llmRoute = parsed.route === 'cloud' ? 'cloud_masked' as const : 'private_llm' as const;
    const router = new LLMRouter(firmConfig.llm ?? {});
    const llmResult = await router.send({
      prompt: parsed.maskedPrompt,
      route: llmRoute,
      model: parsed.model,
      systemPrompt: parsed.systemPrompt,
      maxTokens: parsed.maxTokens,
      temperature: parsed.temperature,
    });

    const latencyMs = Date.now() - startTime;

    // 4. Audit log (masked prompt hash — no raw PII)
    const promptHash = await sha256(parsed.maskedPrompt);
    const inserted = await appendEvent({
      firmId, userId,
      aiToolId: parsed.aiToolId,
      promptHash,
      promptLength: parsed.maskedPrompt.length,
      sensitivityScore: parsed.sensitivityScore,
      sensitivityLevel: parsed.sensitivityLevel,
      entities: [],
      action: 'proxy',
      captureMethod: 'relay',
      sessionId: parsed.sessionId,
      metadata: {
        route: parsed.route, model: llmResult.model,
        provider: llmResult.provider, tokensUsed: llmResult.tokensUsed,
        latencyMs, entityTypes: parsed.entityTypes, entityCount: parsed.entityCount,
      },
    });

    // 5. SIEM + webhook for high-risk
    if (parsed.sensitivityScore >= 60) {
      enqueueWebhook({
        firmId, eventType: 'high_risk_detected',
        payload: {
          eventId: inserted.id, aiToolId: parsed.aiToolId,
          sensitivityScore: parsed.sensitivityScore, sensitivityLevel: parsed.sensitivityLevel,
          action: 'proxy', route: parsed.route, entityCount: parsed.entityCount,
        },
      }).catch((err) => logger.warn('Failed to enqueue relay webhook', { error: err instanceof Error ? err.message : String(err) }));
    }

    enqueueSIEM({
      firmId,
      event: {
        eventId: inserted.id, firmId, aiToolId: parsed.aiToolId,
        sensitivityScore: parsed.sensitivityScore, sensitivityLevel: parsed.sensitivityLevel,
        action: 'proxy', entityCount: parsed.entityCount, captureMethod: 'relay',
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => logger.warn('Failed to enqueue relay SIEM', { error: err instanceof Error ? err.message : String(err) }));

    // 6. Return LLM response (still pseudonymized — extension de-pseudonymizes locally)
    return c.json({
      action: 'relayed',
      response: llmResult.text,
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

// ---------------------------------------------------------------------------
// Name variant generator for de-pseudonymization
// If pseudonym "Jordan Williams" → generate variants:
//   "Williams" → original last name, "Jordan" → original first name,
//   "Mr. Williams" → "Mr. <original last>", "Jordan's" → "<original first>'s"
// ---------------------------------------------------------------------------

function generateNameVariants(
  pseudonym: string,
  original: string,
): Array<[string, string]> {
  const variants: Array<[string, string]> = [];
  const pseudoParts = pseudonym.trim().split(/\s+/);
  const origParts = original.trim().split(/\s+/);

  if (pseudoParts.length < 2 || origParts.length < 2) return variants;

  const [pseudoFirst, ...pseudoLastParts] = pseudoParts;
  const pseudoLast = pseudoLastParts.join(' ');
  const [origFirst, ...origLastParts] = origParts;
  const origLast = origLastParts.join(' ');

  // Last name alone: "Williams" → original last name
  variants.push([pseudoLast, origLast]);

  // First name alone: "Jordan" → original first name
  variants.push([pseudoFirst, origFirst]);

  // Possessives: "Jordan's" → "<first>'s", "Williams's" → "<last>'s"
  variants.push([`${pseudoFirst}'s`, `${origFirst}'s`]);
  variants.push([`${pseudoLast}'s`, `${origLast}'s`]);
  variants.push([`${pseudonym}'s`, `${original}'s`]);

  // Honorifics: "Mr. Williams" → "Mr. <last>", "Ms. Williams" → "Ms. <last>"
  for (const prefix of ['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.']) {
    variants.push([`${prefix} ${pseudoLast}`, `${prefix} ${origLast}`]);
  }

  return variants;
}

// ---------------------------------------------------------------------------
// Response scanning: check AI response for leaked original entity text
// Before de-pseudonymizing, scan the LLM's response for original values
// that should NOT appear (the LLM should only have seen pseudonyms).
// If found, log a compliance alert — this means the LLM somehow knew
// the real data, which is a serious security concern.
// ---------------------------------------------------------------------------

export interface ResponseScanResult {
  hasLeaks: boolean;
  leaks: Array<{ original: string; entityType: string; position: number }>;
  unmatchedPseudonyms?: Array<{ pseudonym: string; entityType: string }>;
}

export function scanResponseForLeaks(
  responseText: string,
  reverseMap: Record<string, { original: string; pseudonym: string; entityType: string }>,
): ResponseScanResult {
  const leaks: ResponseScanResult['leaks'] = [];

  for (const entry of Object.values(reverseMap)) {
    // Skip short values (< 4 chars) — too many false positives
    if (entry.original.length < 4) continue;
    // Skip variant entries (they're for de-pseudo, not leak detection)
    if (entry.original === entry.pseudonym) continue;

    const idx = responseText.indexOf(entry.original);
    if (idx !== -1) {
      leaks.push({
        original: entry.original.substring(0, 3) + '***', // Truncate for safety
        entityType: entry.entityType,
        position: idx,
      });
    }
  }

  // Check for unmatched pseudonyms (pseudonym still present in response = de-pseudo failure)
  const unmatchedPseudonyms: Array<{ pseudonym: string; entityType: string }> = [];
  for (const entry of Object.values(reverseMap)) {
    if (entry.pseudonym.length < 4) continue;
    if (responseText.includes(entry.pseudonym)) {
      unmatchedPseudonyms.push({
        pseudonym: entry.pseudonym.substring(0, 8) + '...',
        entityType: entry.entityType,
      });
    }
  }

  return { hasLeaks: leaks.length > 0, leaks, unmatchedPseudonyms };
}

// ---------------------------------------------------------------------------
// POST /v1/proxy/process — Unified contextual-intelligence endpoint (Model A)
// ---------------------------------------------------------------------------

const processRequestSchema = z.object({
  text: z.string().min(1).max(100_000),
  aiToolId: z.string().optional().default('unknown'),
  sessionId: z.string().optional(),
  captureMethod: z.string().optional().default('typed'),
  platform: z.string().optional().default('unknown'),
  wasPasted: z.boolean().optional().default(false),
  quickCheck: z.boolean().optional().default(false),
});

proxyRoutes.post('/process', async (c) => {
  const firmId = c.get('firmId') as string;
  const start = Date.now();

  try {
    const parsed = processRequestSchema.parse(await c.req.json());
    const { text, aiToolId, sessionId, captureMethod, platform, wasPasted, quickCheck } = parsed;

    // ── Fast path: short inward-intent messages skip full detection ──
    if (isQuickPassthrough(text)) {
      return c.json({
        action: 'passthrough',
        reason: 'quick_passthrough',
        sensitivityScore: 0,
        sensitivityLevel: 'low',
        entities: [],
        latencyMs: Date.now() - start,
      });
    }

    // ── PARALLEL: Intent classification + Entity detection + Conversation state ──
    // These three operations are independent — run them concurrently to cut latency.
    // Default to Gemini 2.5 Flash (via OpenAI-compatible endpoint). GEMINI_API_KEY
    // is the primary env var; legacy OPENAI_API_KEY still works if configured.
    const withinBudget = checkLlmBudget(firmId);
    const classifierApiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    const classifierBaseUrl =
      process.env.GEMINI_BASE_URL ||
      (process.env.GEMINI_API_KEY
        ? 'https://generativelanguage.googleapis.com/v1beta/openai'
        : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
    const classifierModel =
      process.env.INTENT_CLASSIFIER_MODEL ||
      (process.env.GEMINI_API_KEY ? 'gemini-2.5-flash' : 'gpt-4o-mini');
    const llmClassifierConfig: LlmClassifierConfig | undefined =
      classifierApiKey && withinBudget
        ? {
            apiKey: classifierApiKey,
            baseUrl: classifierBaseUrl,
            model: classifierModel,
            timeoutMs: 1500,
          }
        : undefined;
    if (!withinBudget) {
      logger.warn('LLM daily budget exceeded for firm', { firmId, budget: LLM_DAILY_BUDGET });
    }

    // Launch all FOUR expensive operations in parallel — none depend on each other
    const [intentResult, firmRow, conversationRow, detectedEntitiesEarly] = await Promise.all([
      // 1. Intent classification (regex → NLP → LLM)
      classifyIntentFull(text, llmClassifierConfig),
      // 2. Firm config lookup
      db.select().from(firms).where(eq(firms.id, firmId)).limit(1),
      // 3. Conversation state lookup
      sessionId
        ? db.select().from(conversationState)
            .where(sql`${conversationState.sessionId} = ${sessionId} AND ${conversationState.firmId} = ${firmId}`)
            .limit(1).catch(() => [] as any[])
        : Promise.resolve([] as any[]),
      // 4. Entity detection (only needs firmId, runs parallel with intent)
      detectFirmAware(text, { firmId }),
    ]);

    const intentWeight = intentResult.confidence >= 0.7
      ? getIntentWeight(intentResult)
      : 1.0;

    // Conversation state floor
    let conversationFloor = 0;
    let sessionEscalated = false;
    const existing = conversationRow?.[0];
    if (existing && existing.peakScore >= 30) {
      conversationFloor = Math.min(30, Math.round(existing.peakScore * 0.4));
      sessionEscalated = true;
    }

    // Quick-check mode: intent-only classification for short safe messages
    const passthroughIntents = new Set([
      'research', 'creative', 'productivity', 'coding', 'brainstorming',
    ]);
    if (
      quickCheck && !sessionEscalated &&
      passthroughIntents.has(intentResult.intent) &&
      intentResult.confidence >= 0.7 &&
      intentResult.direction === 'inward'
    ) {
      return c.json({
        action: 'passthrough',
        reason: `quick_check_${intentResult.intent}`,
        intent: intentResult,
        sensitivityScore: 0,
        sensitivityLevel: 'low',
        entities: [],
        latencyMs: Date.now() - start,
      });
    }

    // Non-disclosure intents with high confidence → passthrough
    if (
      !sessionEscalated &&
      passthroughIntents.has(intentResult.intent) &&
      intentResult.confidence >= 0.8 &&
      intentWeight <= 0.3
    ) {
      return c.json({
        action: 'passthrough',
        reason: `intent_${intentResult.intent}`,
        intent: intentResult,
        sensitivityScore: 0,
        sensitivityLevel: 'low',
        entities: [],
        latencyMs: Date.now() - start,
      });
    }

    // ── 2. Entity detection (runs after firm config is available) ──
    const firm = firmRow?.[0];
    const firmConfig = (firm?.config as Record<string, unknown>) || {};
    const complianceFramework = firmConfig.complianceFramework as ComplianceFrameworkId | undefined;
    const activeFrameworks = complianceFramework ? [complianceFramework] : [];

    const firmIntentWeights = firmConfig.intentWeights as Record<string, number> | undefined;
    const effectiveIntentWeight = firmIntentWeights?.[intentResult.intent] ?? intentWeight;

    const detectedEntities = detectedEntitiesEarly;

    // ── 3. Entity contextualization ──
    const contextualizedEntities = contextualizeEntities(text, detectedEntities);
    const entityContextFactor = contextualizedEntities.length > 0
      ? contextualizedEntities.reduce(
          (acc, e) => acc * getContextRiskMultiplier(e),
          1.0,
        ) ** (1 / contextualizedEntities.length) // geometric mean
      : 1.0;
    const effectiveEntityContext = entityContextFactor < 0.5 ? entityContextFactor : // strong suppression
      entityContextFactor > 1.3 ? entityContextFactor : // strong boost
      1.0; // weak signal → neutral

    // ── 4. Structure detection ──
    const structureResult = detectStructure(text);
    const structureMultiplier = structureResult.confidence >= 0.7
      ? structureResult.multiplier
      : 1.0;

    // ── 5. Contextual scoring ──
    const pasteMultiplier = (wasPasted && detectedEntities.length > 0) ? 1.3 : 1.0;
    const baseScore = await scoreFirmAware(text, detectedEntities, { firmId });
    const rawScore = baseScore.score * effectiveIntentWeight * structureMultiplier * effectiveEntityContext * pasteMultiplier;
    // Apply conversation floor: disclosure sessions keep elevated monitoring
    const finalScore = Math.max(conversationFloor, Math.min(100, Math.round(rawScore)));

    const sensitivityLevel = finalScore >= 86 ? 'critical'
      : finalScore >= 61 ? 'high'
      : finalScore >= 26 ? 'medium'
      : 'low';

    // ── 6. Route decision ──
    const blockThreshold = getEffectiveBlockThreshold(activeFrameworks);
    const shouldBlock = finalScore >= blockThreshold;
    const shouldPseudonymize = finalScore >= 26 && !shouldBlock;

    let action: string;
    let pseudonymizedText: string | undefined;
    let reverseMapJson: Record<string, { original: string; pseudonym: string; entityType: string }> | undefined;

    if (shouldBlock) {
      action = 'blocked';
    } else if (shouldPseudonymize) {
      action = 'pseudonymized';
      const pseudoSessionId = sessionId || crypto.randomUUID();
      const pseudonymizer = new Pseudonymizer(pseudoSessionId, firmId);
      const pseudoResult = pseudonymizer.pseudonymize(text, detectedEntities);
      pseudonymizedText = pseudoResult.maskedText;
      // Serialize the Map for JSON transport, including name variants for de-pseudo
      const mapEntries: Record<string, { original: string; pseudonym: string; entityType: string }> = {};
      for (const [key, entry] of pseudoResult.map.mappings) {
        mapEntries[key] = {
          original: entry.original,
          pseudonym: entry.pseudonym,
          entityType: entry.entityType,
        };
        // Generate variants the LLM might use in its response
        if (entry.entityType === 'PERSON') {
          const variants = generateNameVariants(entry.pseudonym, entry.original);
          for (const [variantPseudo, variantOriginal] of variants) {
            const vKey = `variant_${key}_${variantPseudo}`;
            mapEntries[vKey] = {
              original: variantOriginal,
              pseudonym: variantPseudo,
              entityType: entry.entityType,
            };
          }
        }
      }
      reverseMapJson = mapEntries;
    } else {
      action = 'passthrough';
    }

    // ── 7. Audit trail — durable BullMQ queue (SOC 2 / HIPAA compliant) ──
    // Audit write is enqueued as a durable job with 5x retry + exponential backoff.
    // Response returns immediately. Failed jobs land in dead-letter for investigation.
    const auditAction = shouldBlock ? 'block' as const
      : shouldPseudonymize ? 'proxy' as const
      : 'pass' as const;

    const auditPromptHash = await sha256(text);
    const entityTypes = Array.from(new Set(detectedEntities.map(e => e.type)));

    enqueueAudit({
      firmId,
      userId: 'system',
      aiToolId,
      sessionId,
      promptHash: auditPromptHash,
      promptLength: text.length,
      sensitivityScore: finalScore,
      sensitivityLevel: sensitivityLevel as 'low' | 'medium' | 'high' | 'critical',
      action: auditAction,
      captureMethod,
      metadata: {
        intent: intentResult.intent,
        intentDirection: intentResult.direction,
        intentConfidence: intentResult.confidence,
        detectedLanguage: intentResult.detectedLanguage || 'en',
        structureType: structureResult.type,
        structureMultiplier,
        entityContextFactor: effectiveEntityContext,
        entityContextTags: contextualizedEntities.map(e => ({
          type: e.type,
          context: e.context,
          contextConfidence: e.contextConfidence,
        })),
        pasteMultiplier,
        intentWeight: effectiveIntentWeight,
        baseScore: baseScore.score,
        platform,
        entityCount: detectedEntities.length,
        wasPasted,
        source: 'process_endpoint',
      },
      siemEvent: {
        eventId: crypto.randomUUID(), firmId, aiToolId,
        sensitivityScore: finalScore, sensitivityLevel,
        action, entityCount: detectedEntities.length,
        captureMethod,
        timestamp: new Date().toISOString(),
      },
      ...(sessionId ? {
        conversationUpdate: {
          sessionId,
          entityTypes,
          intent: intentResult.intent,
        },
      } : {}),
    }).catch((err) => logger.error('Failed to enqueue audit job', {
      firmId,
      error: err instanceof Error ? err.message : String(err),
    }));

    // ── 8. Response — sent IMMEDIATELY, audit runs in background ──
    const latencyMs = Date.now() - start;
    return c.json({
      action,
      sensitivityScore: finalScore,
      sensitivityLevel,
      intent: intentResult,
      structure: { type: structureResult.type, multiplier: structureMultiplier },
      entityCount: detectedEntities.length,
      entities: detectedEntities.map(e => ({
        type: e.type,
        start: e.start,
        end: e.end,
      })),
      ...(pseudonymizedText !== undefined && { pseudonymizedText }),
      ...(reverseMapJson !== undefined && { reverseMap: reverseMapJson }),
      latencyMs,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
    }
    // Pipeline failure safety: default to AMBER (pseudonymize conservatively)
    // NEVER default to passthrough — that would let unprotected data through
    const elapsed = Date.now() - start;
    logger.error('Pipeline error, defaulting to AMBER (conservative protection)', {
      firmId, elapsed,
      error: error instanceof Error ? error.message : String(error),
      isTimeout: elapsed > 3000,
    });
    return c.json({
      action: 'pseudonymized',
      reason: elapsed > 3000 ? 'pipeline_timeout' : 'pipeline_error',
      sensitivityScore: 50,
      sensitivityLevel: 'medium',
      warning: 'Detection pipeline encountered an issue, defaulting to conservative protection',
      latencyMs: elapsed,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /v1/proxy/scan-response — Scan AI response for leaked original entities
// Called after de-pseudonymization to verify no original entity text appeared
// in the LLM's response (which should only contain pseudonyms).
// ---------------------------------------------------------------------------

const scanResponseSchema = z.object({
  responseText: z.string().min(1).max(500_000),
  sessionId: z.string().min(1),
  reverseMap: z.record(z.object({
    original: z.string(),
    pseudonym: z.string(),
    entityType: z.string(),
  })),
});

proxyRoutes.post('/scan-response', async (c) => {
  const firmId = c.get('firmId') as string;

  try {
    const parsed = scanResponseSchema.parse(await c.req.json());
    const result = scanResponseForLeaks(parsed.responseText, parsed.reverseMap);

    if (result.unmatchedPseudonyms && result.unmatchedPseudonyms.length > 0) {
      logger.warn('Unmatched pseudonyms in AI response (de-pseudo incomplete)', {
        firmId,
        sessionId: parsed.sessionId,
        count: result.unmatchedPseudonyms.length,
        types: result.unmatchedPseudonyms.map(u => u.entityType),
      });
    }

    if (result.hasLeaks) {
      logger.warn('RESPONSE LEAK DETECTED', {
        firmId,
        sessionId: parsed.sessionId,
        leakCount: result.leaks.length,
        leakTypes: result.leaks.map(l => l.entityType),
      });

      await appendEvent({
        firmId,
        userId: 'system',
        aiToolId: 'unknown',
        promptHash: '',
        promptLength: 0,
        sensitivityScore: 100,
        sensitivityLevel: 'critical',
        action: 'block',
        captureMethod: 'response_scan',
        metadata: {
          source: 'response_leak_scan',
          leakCount: result.leaks.length,
          leakTypes: result.leaks.map(l => l.entityType),
          sessionId: parsed.sessionId,
        },
      });
    }

    return c.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.errors }, 400);
    }
    throw error;
  }
});
