// ==========================================
// Iron Gate Phase 2 — LLM Router
// ==========================================
//
// Routes prompts to the appropriate LLM provider based on the sensitivity-
// derived route (passthrough, cloud_masked, private_llm) and the firm's
// configured providers.

import type { LLMProviderConfig, LLMRoute } from '@iron-gate/types';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { OllamaProvider } from './providers/ollama';
import { AzureOpenAIProvider } from './providers/azure';

// ---------------------------------------------------------------------------
// Public interfaces (consumed by provider adapters and route handlers)
// ---------------------------------------------------------------------------

export interface LLMRequest {
  prompt: string;
  route: LLMRoute;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  provider: string;
  tokensUsed: {
    prompt: number;
    completion: number;
  };
  latencyMs: number;
}

export interface LLMProvider {
  readonly name: string;
  send(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Firm LLM configuration shape (subset of firms.config jsonb)
// ---------------------------------------------------------------------------

export interface FirmLLMConfig {
  openai?: { apiKey?: string; model?: string; baseUrl?: string };
  anthropic?: { apiKey?: string; model?: string; baseUrl?: string };
  azure?: { apiKey?: string; model?: string; baseUrl?: string };
  ollama?: { baseUrl?: string; model?: string };
  privateLlm?: { baseUrl?: string; model?: string };
  // Which provider to use for cloud routes (default: openai)
  defaultCloudProvider?: 'openai' | 'anthropic' | 'azure';
  // Which provider to use for private_llm route (default: ollama)
  defaultPrivateProvider?: 'ollama';
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, LLMProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  azure: new AzureOpenAIProvider(),
  ollama: new OllamaProvider(),
};

// ---------------------------------------------------------------------------
// LLMRouter Class
// ---------------------------------------------------------------------------

export class LLMRouter {
  private config: FirmLLMConfig;

  constructor(config: FirmLLMConfig) {
    this.config = config;
  }

  /**
   * Send a prompt to the LLM provider dictated by the route.
   *
   * - passthrough / cloud_masked -> cloud provider (openai, anthropic, azure)
   * - private_llm -> self-hosted provider (ollama)
   */
  async send(request: LLMRequest): Promise<LLMResponse> {
    const { provider, providerConfig } = this.resolveProvider(request.route, request.model);

    console.log(
      `[LLMRouter] Routing to provider="${provider.name}" model="${request.model || providerConfig.model}" route="${request.route}"`,
    );

    return provider.send(request, providerConfig);
  }

  /**
   * Determine which provider + config to use based on the route and optional
   * model hint. If the caller specifies a model name that implies a provider
   * (e.g. "claude-*" -> anthropic, "gpt-*" -> openai), we honour that as long
   * as the firm has credentials configured.
   */
  private resolveProvider(
    route: LLMRoute,
    modelHint?: string,
  ): { provider: LLMProvider; providerConfig: LLMProviderConfig } {
    // Private route always goes to the self-hosted provider
    if (route === 'private_llm') {
      return this.resolvePrivateProvider();
    }

    // Cloud routes: try to infer provider from model hint
    if (modelHint) {
      const inferred = this.inferProviderFromModel(modelHint);
      if (inferred) {
        return inferred;
      }
    }

    // Fall back to the firm's default cloud provider
    return this.resolveCloudProvider();
  }

  private resolvePrivateProvider(): { provider: LLMProvider; providerConfig: LLMProviderConfig } {
    const ollamaConfig = this.config.ollama ?? this.config.privateLlm ?? {};

    return {
      provider: PROVIDERS.ollama,
      providerConfig: {
        provider: 'ollama',
        model: ollamaConfig.model ?? 'llama3',
        baseUrl: ollamaConfig.baseUrl ?? 'http://localhost:11434',
      },
    };
  }

  private resolveCloudProvider(): { provider: LLMProvider; providerConfig: LLMProviderConfig } {
    const preferred = this.config.defaultCloudProvider ?? 'openai';

    // Try the preferred provider first, then fall back to others
    const tryOrder: Array<'openai' | 'anthropic' | 'azure'> = [
      preferred,
      ...(['openai', 'anthropic', 'azure'] as const).filter((p) => p !== preferred),
    ];

    for (const providerName of tryOrder) {
      const cfg = this.config[providerName];
      if (cfg?.apiKey) {
        return {
          provider: PROVIDERS[providerName],
          providerConfig: {
            provider: providerName,
            model: cfg.model ?? (providerName === 'openai' ? 'gpt-4o' : providerName === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'),
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
          },
        };
      }
    }

    // No cloud provider configured — throw a descriptive error
    throw new Error(
      '[LLMRouter] No cloud LLM provider configured. Set an API key for openai, anthropic, or azure in the firm config.',
    );
  }

  private inferProviderFromModel(
    model: string,
  ): { provider: LLMProvider; providerConfig: LLMProviderConfig } | null {
    const lower = model.toLowerCase();

    if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3')) {
      const cfg = this.config.openai;
      if (cfg?.apiKey) {
        return {
          provider: PROVIDERS.openai,
          providerConfig: {
            provider: 'openai',
            model,
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
          },
        };
      }
    }

    if (lower.startsWith('claude')) {
      const cfg = this.config.anthropic;
      if (cfg?.apiKey) {
        return {
          provider: PROVIDERS.anthropic,
          providerConfig: {
            provider: 'anthropic',
            model,
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
          },
        };
      }
    }

    if (lower.startsWith('llama') || lower.startsWith('mistral') || lower.startsWith('codellama') || lower.startsWith('phi')) {
      const cfg = this.config.ollama ?? this.config.privateLlm;
      if (cfg) {
        return {
          provider: PROVIDERS.ollama,
          providerConfig: {
            provider: 'ollama',
            model,
            baseUrl: cfg.baseUrl ?? 'http://localhost:11434',
          },
        };
      }
    }

    return null;
  }
}
