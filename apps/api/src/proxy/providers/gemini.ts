// ==========================================
// Iron Gate — Google Gemini Provider Adapter
// ==========================================
//
// Uses Google's OpenAI-compatible endpoint so the request/response shape
// matches the rest of the LLMRouter ecosystem. Native Gemini JSON format
// (contents[].parts[].text) is avoided for now to keep this small.
//
// Docs: https://ai.google.dev/gemini-api/docs/openai
// Endpoint: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions

import type { LLMProviderConfig } from '@iron-gate/types';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-router';
import { logger } from '../../lib/logger';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

interface GeminiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GeminiChatRequest {
  model: string;
  messages: GeminiChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream: boolean;
}

interface GeminiChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  async send(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse> {
    if (!config.apiKey) {
      throw new Error('[Gemini] API key is required');
    }

    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    const model = request.model || config.model || DEFAULT_MODEL;
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const messages: GeminiChatMessage[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body: GeminiChatRequest = {
      model,
      messages,
      stream: false,
    };

    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const startTime = performance.now();
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `[Gemini] API error ${response.status}: ${errorBody}`
      );
    }

    const data = (await response.json()) as GeminiChatResponse;

    const text = data.choices?.[0]?.message?.content ?? '';

    return {
      text,
      model: data.model,
      provider: this.name,
      tokensUsed: {
        prompt: data.usage?.prompt_tokens ?? 0,
        completion: data.usage?.completion_tokens ?? 0,
      },
      latencyMs,
    };
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    attempt = 1
  ): Promise<Response> {
    try {
      const response = await fetch(url, init);

      // Retry on 429 (rate limit) and 5xx (server errors)
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < MAX_RETRIES
      ) {
        const retryAfter = response.headers.get('retry-after');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);

        logger.warn('Gemini retrying request', {
          attempt,
          maxRetries: MAX_RETRIES,
          delayMs,
          status: response.status,
        });
        await this.sleep(delayMs);
        return this.fetchWithRetry(url, init, attempt + 1);
      }

      return response;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn('Gemini network error, retrying', {
          attempt,
          maxRetries: MAX_RETRIES,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.sleep(delayMs);
        return this.fetchWithRetry(url, init, attempt + 1);
      }
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
