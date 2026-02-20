// ==========================================
// Iron Gate — Ollama Provider Adapter
// (Self-hosted / Private LLM)
// ==========================================

import type { LLMProviderConfig } from '@iron-gate/types';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-router';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  async send(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse> {
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    const model = request.model || config.model || DEFAULT_MODEL;
    const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;

    const messages: OllamaChatMessage[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body: OllamaChatRequest = {
      model,
      messages,
      stream: false,
    };

    const options: OllamaChatRequest['options'] = {};
    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      options.num_predict = request.maxTokens;
    }
    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    const startTime = performance.now();
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `[Ollama] API error ${response.status}: ${errorBody}`
      );
    }

    const data = (await response.json()) as OllamaChatResponse;

    const text = data.message?.content ?? '';

    // Ollama provides token counts through eval_count and prompt_eval_count
    const promptTokens = data.prompt_eval_count ?? 0;
    const completionTokens = data.eval_count ?? 0;

    return {
      text,
      model: data.model,
      provider: this.name,
      tokensUsed: {
        prompt: promptTokens,
        completion: completionTokens,
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

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[Ollama] Retrying request (attempt ${attempt}/${MAX_RETRIES}) after ${delayMs}ms — status ${response.status}`
        );
        await this.sleep(delayMs);
        return this.fetchWithRetry(url, init, attempt + 1);
      }

      return response;
    } catch (error) {
      // Ollama is local — connection refused is common if the server is down
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[Ollama] Connection error, retrying (attempt ${attempt}/${MAX_RETRIES}) after ${delayMs}ms:`,
          error
        );
        await this.sleep(delayMs);
        return this.fetchWithRetry(url, init, attempt + 1);
      }
      throw new Error(
        `[Ollama] Failed to connect to ${url}. Is Ollama running? Original error: ${error}`
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
