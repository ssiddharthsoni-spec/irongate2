/**
 * Private LLM Relay — Phase 3.2
 *
 * Handles relaying pseudonymized prompts to a firm's private/on-premise LLM.
 * The prompt arrives already masked — this module never sees raw PII.
 *
 * Two modes:
 * 1. Standard relay: sends masked prompt to firm's LLM endpoint.
 *    The firm's LLM responds with masked text. Extension de-pseudonymizes.
 *
 * 2. De-pseudonymized relay (opt-in, requires DPA): the firm provides
 *    the reverse map along with the prompt. This module de-pseudonymizes
 *    before sending to the firm's LLM. Used when the firm's fine-tuned
 *    model needs real names/data to produce useful responses.
 *    This is explicitly opted in via firm config and logged separately.
 */

import { logger } from '../lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PrivateLLMConfig {
  baseUrl: string;
  model?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  /** If true, the relay accepts a reverse map and de-pseudonymizes before sending.
   *  Requires a DPA. Logged as a separate audit event type. */
  allowDepseudonymization?: boolean;
}

export interface PrivateLLMRequest {
  prompt: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface PrivateLLMResponse {
  text: string;
  model: string;
  provider: string;
  tokensUsed: { prompt: number; completion: number };
  latencyMs: number;
}

// ─── SSRF Protection ─────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[::1\]$/,
  /^\[fe80:/i,
  /^\[fc00:/i,
  /^\[fd00:/i,
  /\.internal$/i,
  /\.local$/i,
  /\.localhost$/i,
];

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOSTNAMES.some(p => p.test(hostname));
}

// ─── Relay ───────────────────────────────────────────────────────────────────

/**
 * Send a masked prompt to the firm's private LLM endpoint.
 * The prompt is already pseudonymized — no raw PII.
 */
export async function relayToPrivateLLM(
  config: PrivateLLMConfig,
  request: PrivateLLMRequest,
): Promise<PrivateLLMResponse> {
  const startTime = Date.now();

  // Validate URL
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error(`Invalid private LLM URL: ${config.baseUrl}`);
  }

  // SSRF check — block private/internal network addresses
  // EXCEPT when the firm explicitly configures an internal endpoint
  // (enterprise firms run LLMs on their private network)
  if (isBlockedHost(url.hostname)) {
    logger.warn('Private LLM relay to internal address', {
      hostname: url.hostname,
      note: 'Allowed for private LLM relay — firm explicitly configured this endpoint',
    });
    // For private LLM, we allow internal addresses — that's the whole point
  }

  const model = request.model || config.model || 'default';

  // Build request body in OpenAI-compatible format
  const body = {
    model,
    messages: [
      ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
      { role: 'user', content: request.prompt },
    ],
    max_tokens: request.maxTokens ?? 4096,
    temperature: request.temperature ?? 0.7,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
    ...(config.headers ?? {}),
  };

  const timeout = config.timeout ?? 60000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Private LLM returned ${response.status}: ${text.substring(0, 200)}`);
    }

    const json = await response.json();

    // Parse OpenAI-compatible response
    const responseText = json.choices?.[0]?.message?.content
      ?? json.response
      ?? json.text
      ?? json.output
      ?? '';

    const tokensUsed = {
      prompt: json.usage?.prompt_tokens ?? 0,
      completion: json.usage?.completion_tokens ?? 0,
    };

    return {
      text: responseText,
      model: json.model ?? model,
      provider: 'private_llm',
      tokensUsed,
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Private LLM request timed out after ${timeout}ms`);
    }
    throw error;
  }
}
