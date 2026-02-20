// ==========================================
// Iron Gate — Azure OpenAI Provider Adapter
// ==========================================

import type { LLMProviderConfig } from '@iron-gate/types';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-router';

const DEFAULT_API_VERSION = '2024-02-01';
const DEFAULT_MODEL = 'gpt-4o';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

interface AzureChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AzureChatRequest {
  messages: AzureChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream: boolean;
}

interface AzureChatResponse {
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

export class AzureOpenAIProvider implements LLMProvider {
  readonly name = 'azure';

  async send(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse> {
    if (!config.apiKey) {
      throw new Error('[Azure OpenAI] API key is required');
    }
    if (!config.baseUrl) {
      throw new Error(
        '[Azure OpenAI] Base URL is required (e.g., https://your-resource.openai.azure.com)'
      );
    }

    const model = request.model || config.model || DEFAULT_MODEL;
    const baseUrl = config.baseUrl.replace(/\/$/, '');

    // Azure OpenAI uses deployment-based URLs:
    // {baseUrl}/openai/deployments/{deployment}/chat/completions?api-version=YYYY-MM-DD
    const url = `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=${DEFAULT_API_VERSION}`;

    const messages: AzureChatMessage[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body: AzureChatRequest = {
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
        'api-key': config.apiKey,
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `[Azure OpenAI] API error ${response.status}: ${errorBody}`
      );
    }

    const data = (await response.json()) as AzureChatResponse;

    const text = data.choices?.[0]?.message?.content ?? '';

    return {
      text,
      model: data.model || model,
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

      // Retry on 429 (rate limit / throttling) and 5xx (server errors)
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < MAX_RETRIES
      ) {
        const retryAfter = response.headers.get('retry-after');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);

        console.warn(
          `[Azure OpenAI] Retrying request (attempt ${attempt}/${MAX_RETRIES}) after ${delayMs}ms — status ${response.status}`
        );
        await this.sleep(delayMs);
        return this.fetchWithRetry(url, init, attempt + 1);
      }

      return response;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[Azure OpenAI] Network error, retrying (attempt ${attempt}/${MAX_RETRIES}) after ${delayMs}ms:`,
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
