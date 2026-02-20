// ==========================================
// Iron Gate — Anthropic Provider Adapter
// ==========================================

import type { LLMProviderConfig } from '@iron-gate/types';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-router';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  async send(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse> {
    if (!config.apiKey) {
      throw new Error('[Anthropic] API key is required');
    }

    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    const model = request.model || config.model || DEFAULT_MODEL;
    const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;

    const messages: AnthropicMessage[] = [
      { role: 'user', content: request.prompt },
    ];

    const body: AnthropicRequest = {
      model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const startTime = performance.now();
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `[Anthropic] API error ${response.status}: ${errorBody}`
      );
    }

    const data = (await response.json()) as AnthropicResponse;

    // Extract text from content blocks
    const text = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      model: data.model,
      provider: this.name,
      tokensUsed: {
        prompt: data.usage?.input_tokens ?? 0,
        completion: data.usage?.output_tokens ?? 0,
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

      // Retry on 429 (rate limit), 529 (overloaded), and 5xx (server errors)
      if (
        (response.status === 429 || response.status === 529 || response.status >= 500) &&
        attempt < MAX_RETRIES
      ) {
        const retryAfter = response.headers.get('retry-after');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);

        console.warn(
          `[Anthropic] Retrying request (attempt ${attempt}/${MAX_RETRIES}) after ${delayMs}ms — status ${response.status}`
        );
        await this.sleep(delayMs);
        return this.fetchWithRetry(url, init, attempt + 1);
      }

      return response;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[Anthropic] Network error, retrying (attempt ${attempt}/${MAX_RETRIES}) after ${delayMs}ms:`,
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
