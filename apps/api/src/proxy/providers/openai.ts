// ==========================================
// Iron Gate — OpenAI Provider Adapter
// ==========================================

import type { LLMProviderConfig } from '@iron-gate/types';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-router';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-4o';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream: boolean;
}

interface OpenAIChatResponse {
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

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  async send(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse> {
    if (!config.apiKey) {
      throw new Error('[OpenAI] API key is required');
    }

    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    const model = request.model || config.model || DEFAULT_MODEL;
    const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

    const messages: OpenAIChatMessage[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body: OpenAIChatRequest = {
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
        `[OpenAI] API error ${response.status}: ${errorBody}`
      );
    }

    const data = (await response.json()) as OpenAIChatResponse;

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

        console.warn(
          `[OpenAI] Retrying request (attempt ${attempt}/${MAX_RETRIES}) after ${delayMs}ms — status ${response.status}`
        );
        await this.sleep(delayMs);
        return this.fetchWithRetry(url, init, attempt + 1);
      }

      return response;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[OpenAI] Network error, retrying (attempt ${attempt}/${MAX_RETRIES}) after ${delayMs}ms:`,
          error
        );
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
