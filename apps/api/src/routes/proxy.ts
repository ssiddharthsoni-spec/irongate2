import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { firms } from '../db/schema';
import { eq } from 'drizzle-orm';
import { Pseudonymizer } from '../proxy/pseudonymizer';
import type { PseudonymMap } from '../proxy/pseudonymizer';
import { PseudonymStore } from '../proxy/pseudonym-store';
import { LLMRouter } from '../proxy/llm-router';
import type { FirmLLMConfig } from '../proxy/llm-router';
import { appendEvent } from '../services/audit-chain';
import { enqueueWebhook, enqueueSIEM } from '../jobs/enqueue';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';
import { detectFirmAware, scoreFirmAware } from '../detection';
import {
  mergeEntityRules,
  getEffectiveBlockThreshold,
  getEffectiveRiskMultiplier,
} from '@iron-gate/config';
import type { ComplianceFrameworkId, EntityAction } from '@iron-gate/config';
import { departmentPolicyMiddleware, type DepartmentPolicy } from '../middleware/department-policy';
import { piiSafetyNetMiddleware, scanForUnmaskedPII } from '../middleware/pii-safety-net';

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
  c.header('Sunset', '2025-06-01');
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
  c.header('Sunset', '2025-06-01');
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
