/**
 * Proxy Handler — Phase 2
 *
 * Handles the full proxy flow from the service worker side:
 * 1. Receives intercepted prompt from content script
 * 2. Sends to backend POST /v1/proxy/analyze for analysis + pseudonymization
 * 3. Routes based on sensitivity: passthrough, cloud_masked, or private_llm
 * 4. If routed, sends pseudonymized prompt to POST /v1/proxy/send
 * 5. Returns the de-pseudonymized LLM response to the content script
 */

import { apiRequest, apiUploadFile, ApiError } from './api-client';

// Debug logging — gated behind ironGateDebug storage flag
let _proxyDebug = false;
try { chrome.storage.local.get('ironGateDebug', (r) => { _proxyDebug = !!r.ironGateDebug; }); } catch {}
function proxyLog(...args: any[]) { if (_proxyDebug) console.log('[Iron Gate Proxy]', ...args); }

// ─── Request Deduplication ──────────────────────────────────────────────────
// Prevents concurrent duplicate prompts from being processed simultaneously,
// which could cause mismatched responses.
const _inFlightRequests = new Map<string, Promise<ProxyFlowResult>>();
const DEDUP_TTL_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProxyAnalyzeResult {
  originalScore: {
    score: number;
    level: string;
    explanation: string;
    entities: Array<{ type: string; text: string; confidence: number }>;
  };
  maskedPrompt: string;
  pseudonymMap: Record<string, string>;
  recommendedRoute: 'passthrough' | 'cloud_masked' | 'private_llm';
  entitiesFound: number;
}

export interface ProxySendResult {
  response: string;
  model: string;
  provider: string;
  tokensUsed: { prompt: number; completion: number };
  latencyMs: number;
}

export interface ProxyFlowResult {
  action: 'allow' | 'proxy';
  response?: string;
  score: number;
  level: string;
  explanation?: string;
  entities?: Array<{ type: string; text: string; confidence: number }>;
  model?: string;
  provider?: string;
  latencyMs?: number;
}

// ─── Analyze ─────────────────────────────────────────────────────────────────

/**
 * Send prompt text to the backend for sensitivity analysis and pseudonymization.
 * The backend runs entity detection, scoring, and generates a masked version
 * of the prompt with pseudonyms replacing sensitive entities.
 */
export async function analyzePrompt(
  promptText: string,
  aiToolId: string,
  sessionId: string
): Promise<ProxyAnalyzeResult> {
  const result = await apiRequest<ProxyAnalyzeResult>({
    method: 'POST',
    path: '/proxy/analyze',
    body: {
      text: promptText,
      aiToolId,
      sessionId,
      timestamp: Date.now(),
    },
  });

  proxyLog(
    `Analysis complete — score: ${result.originalScore.score}, ` +
    `route: ${result.recommendedRoute}, entities: ${result.entitiesFound}`
  );

  return result;
}

// ─── Send ────────────────────────────────────────────────────────────────────

/**
 * Send a pseudonymized prompt to the backend for LLM processing.
 * The backend routes to the appropriate provider based on the route:
 * - cloud_masked: sends masked prompt to a cloud LLM (e.g., GPT-4, Claude)
 * - private_llm: sends to the firm's private/on-premise LLM
 *
 * The backend handles de-pseudonymization of the response before returning.
 */
export async function sendProxiedPrompt(
  maskedPrompt: string,
  route: string,
  sessionId: string,
  options?: {
    model?: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<ProxySendResult> {
  const result = await apiRequest<ProxySendResult>({
    method: 'POST',
    path: '/proxy/send',
    body: {
      maskedPrompt,
      route,
      sessionId,
      timestamp: Date.now(),
      ...(options?.model && { model: options.model }),
      ...(options?.systemPrompt && { systemPrompt: options.systemPrompt }),
      ...(options?.maxTokens && { maxTokens: options.maxTokens }),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
    },
  });

  proxyLog(
    `Response received — model: ${result.model}, ` +
    `provider: ${result.provider}, latency: ${result.latencyMs}ms, ` +
    `tokens: ${result.tokensUsed.prompt + result.tokensUsed.completion}`
  );

  return result;
}

// ─── Relay (Zero-Knowledge) ──────────────────────────────────────────────────

export interface ProxyRelayResult {
  action: 'relayed' | 'blocked';
  response?: string;
  reason?: string;
  model?: string;
  provider?: string;
  tokensUsed?: { prompt: number; completion: number };
  latencyMs?: number;
  score?: number;
  level?: string;
}

/**
 * Send an already-pseudonymized prompt to the backend for LLM relay.
 * The backend NEVER sees raw PII — only masked text, score, and entity types.
 * De-pseudonymization happens client-side in the extension.
 */
export async function relayPrompt(
  maskedPrompt: string,
  sensitivityScore: number,
  sensitivityLevel: string,
  entityTypes: string[],
  entityCount: number,
  aiToolId: string,
  sessionId: string,
  route: 'cloud' | 'private_llm',
  options?: {
    model?: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<ProxyRelayResult> {
  const result = await apiRequest<ProxyRelayResult>({
    method: 'POST',
    path: '/proxy/relay',
    body: {
      maskedPrompt,
      sensitivityScore,
      sensitivityLevel,
      entityTypes,
      entityCount,
      aiToolId,
      sessionId,
      route,
      ...(options?.model && { model: options.model }),
      ...(options?.systemPrompt && { systemPrompt: options.systemPrompt }),
      ...(options?.maxTokens && { maxTokens: options.maxTokens }),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
    },
  });

  proxyLog(
    `Relay complete — action: ${result.action}, ` +
    `model: ${result.model || 'n/a'}, latency: ${result.latencyMs || 0}ms`
  );

  return result;
}

/**
 * Build a collision-resistant dedup key from the full prompt text.
 * SHA-256 in SubtleCrypto is available in service workers. We combine the
 * session id and prompt length as cheap discriminators so a hash collision
 * (astronomically unlikely) is still further gated. Hex-encoded to keep
 * the key a plain string for Map semantics.
 */
async function hashPromptForDedup(sessionId: string, promptText: string): Promise<string> {
  const data = new TextEncoder().encode(promptText);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${sessionId}:${promptText.length}:${hex}`;
}

// ─── Full Flow ───────────────────────────────────────────────────────────────

/**
 * Execute the complete proxy flow:
 *
 * 1. Analyze the prompt — gets sensitivity score, entities, and pseudonymized text
 * 2. Decide routing:
 *    - passthrough: prompt is safe, let the original submission proceed
 *    - cloud_masked / private_llm: intercept and proxy through our backend
 * 3. If proxied, send the masked prompt and get an LLM response
 * 4. Return the de-pseudonymized response to the content script
 *
 * The content script is responsible for:
 * - Showing the block overlay if score exceeds threshold
 * - Injecting the proxied response into the AI tool's UI
 */
export async function handleProxyFlow(
  promptText: string,
  aiToolId: string,
  sessionId: string
): Promise<ProxyFlowResult> {
  // Deduplication: if an identical prompt is already in-flight, return its result.
  //
  // Old key used the first 128 chars of the prompt, which collided on any two
  // prompts sharing a prefix. Two "Draft a letter to…" prompts with different
  // bodies would be deduplicated into one and both get the same verdict.
  // Sr. Engineer Audit · Item 9: hash the FULL text via SubtleCrypto SHA-256.
  const dedupKey = await hashPromptForDedup(sessionId, promptText);
  const existing = _inFlightRequests.get(dedupKey);
  if (existing) {
    proxyLog('Dedup hit — returning in-flight result for same prompt');
    return existing;
  }

  const resultPromise = _handleProxyFlowInner(promptText, aiToolId, sessionId);
  _inFlightRequests.set(dedupKey, resultPromise);
  resultPromise.finally(() => {
    setTimeout(() => _inFlightRequests.delete(dedupKey), DEDUP_TTL_MS);
  });
  return resultPromise;
}

async function _handleProxyFlowInner(
  promptText: string,
  aiToolId: string,
  sessionId: string
): Promise<ProxyFlowResult> {
  // Step 1: Analyze the prompt
  let analysis: ProxyAnalyzeResult;
  try {
    analysis = await analyzePrompt(promptText, aiToolId, sessionId);
  } catch (error) {
    // SECURITY: Fail-closed in proxy mode — do NOT silently allow raw prompts.
    // If no API key is configured, allow (extension is not set up yet).
    // Otherwise, block the prompt and tell the user to retry.
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('No API key') || msg.includes('api key')) {
      proxyLog('No API key configured, skipping analysis.');
      return {
        action: 'allow',
        score: 0,
        level: 'low',
        explanation: 'No API key configured — protection inactive.',
      };
    }

    proxyLog('Analysis failed — BLOCKING prompt (fail-closed):', error);
    return {
      action: 'proxy',
      score: 100,
      level: 'critical',
      explanation: 'Analysis service unavailable — prompt blocked for safety.',
      response: '[Iron Gate] The analysis service is temporarily unavailable. Your prompt was NOT sent to protect your data. Please try again in a moment.',
    };
  }

  const { originalScore, maskedPrompt, recommendedRoute } = analysis;

  // Step 2: Route decision
  if (recommendedRoute === 'passthrough') {
    proxyLog('Route: passthrough — allowing original submission');
    return {
      action: 'allow',
      score: originalScore.score,
      level: originalScore.level,
      explanation: originalScore.explanation,
      entities: originalScore.entities,
    };
  }

  // Step 3: Proxy the prompt through our backend
  proxyLog(`Route: ${recommendedRoute} — proxying through backend`);

  let sendResult: ProxySendResult;
  try {
    sendResult = await sendProxiedPrompt(maskedPrompt, recommendedRoute, sessionId);
  } catch (error) {
    // If sending fails, inform the user but don't silently allow.
    // The content script should show an error state.
    proxyLog('Send failed:', error);

    const errorMessage =
      error instanceof ApiError
        ? `Proxy request failed (${error.status}): ${error.message}`
        : 'Proxy request failed due to a network error.';

    return {
      action: 'proxy',
      score: originalScore.score,
      level: originalScore.level,
      explanation: originalScore.explanation,
      entities: originalScore.entities,
      response: `[Iron Gate Error] ${errorMessage} Your original prompt was not sent to the AI tool.`,
    };
  }

  // Step 4: Return the de-pseudonymized response
  return {
    action: 'proxy',
    response: sendResult.response,
    score: originalScore.score,
    level: originalScore.level,
    explanation: originalScore.explanation,
    entities: originalScore.entities,
    model: sendResult.model,
    provider: sendResult.provider,
    latencyMs: sendResult.latencyMs,
  };
}

// ─── File Upload Analysis ──────────────────────────────────────────────────

export interface FileAnalysisResult {
  fileName: string;
  fileType: string;
  fileSize: number;
  textLength: number;
  score: number;
  level: string;
  entitiesFound: number;
  explanation: string;
  entities: Array<{
    type: string;
    start: number;
    end: number;
    confidence: number;
    source: string;
    length: number;
  }>;
  breakdown: Record<string, number>;
  originalText: string;
  redactedText: string;
  entitiesRedacted: number;
  eventId: string;
}

/**
 * Send a file to the backend for document scanning.
 * Converts base64 back to a Blob/File and uploads via multipart/form-data.
 */
export async function analyzeFile(
  fileName: string,
  fileBase64: string,
  fileType: string
): Promise<FileAnalysisResult> {
  const result = await apiUploadFile<any>('/documents/scan', fileName, fileBase64, fileType);

  proxyLog(
    `File scan complete — "${fileName}", score: ${result.score}, ` +
    `level: ${result.level}, entities: ${result.entitiesFound}`
  );

  return {
    fileName: result.fileName,
    fileType: result.fileType || fileType,
    fileSize: result.fileSize || 0,
    textLength: result.textLength || 0,
    score: result.score,
    level: result.level,
    entitiesFound: result.entitiesFound,
    explanation: result.explanation,
    entities: (result.entities || []).map((e: any) => ({
      type: e.type,
      start: e.start,
      end: e.end,
      confidence: e.confidence,
      source: e.source,
      length: e.length,
    })),
    breakdown: result.breakdown || {},
    originalText: result.originalText || '',
    redactedText: result.redactedText || '',
    entitiesRedacted: result.entitiesRedacted || 0,
    eventId: result.eventId || '',
  };
}
