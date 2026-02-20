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

import { apiRequest, ApiError } from './api-client';

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

  console.log(
    `[Iron Gate Proxy] Analysis complete — score: ${result.originalScore.score}, ` +
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

  console.log(
    `[Iron Gate Proxy] Response received — model: ${result.model}, ` +
    `provider: ${result.provider}, latency: ${result.latencyMs}ms, ` +
    `tokens: ${result.tokensUsed.prompt + result.tokensUsed.completion}`
  );

  return result;
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
  // Step 1: Analyze the prompt
  let analysis: ProxyAnalyzeResult;
  try {
    analysis = await analyzePrompt(promptText, aiToolId, sessionId);
  } catch (error) {
    // If analysis fails, fall back to allowing the prompt through.
    // We never want to block the user due to our own infrastructure failure.
    console.error('[Iron Gate Proxy] Analysis failed, falling back to allow:', error);
    return {
      action: 'allow',
      score: 0,
      level: 'low',
      explanation: 'Analysis unavailable — prompt allowed by default.',
    };
  }

  const { originalScore, maskedPrompt, recommendedRoute } = analysis;

  // Step 2: Route decision
  if (recommendedRoute === 'passthrough') {
    // Prompt is low-sensitivity — let the original submission proceed
    console.log('[Iron Gate Proxy] Route: passthrough — allowing original submission');
    return {
      action: 'allow',
      score: originalScore.score,
      level: originalScore.level,
      explanation: originalScore.explanation,
      entities: originalScore.entities,
    };
  }

  // Step 3: Proxy the prompt through our backend
  console.log(`[Iron Gate Proxy] Route: ${recommendedRoute} — proxying through backend`);

  let sendResult: ProxySendResult;
  try {
    sendResult = await sendProxiedPrompt(maskedPrompt, recommendedRoute, sessionId);
  } catch (error) {
    // If sending fails, inform the user but don't silently allow.
    // The content script should show an error state.
    console.error('[Iron Gate Proxy] Send failed:', error);

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
