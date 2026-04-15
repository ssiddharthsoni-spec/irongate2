/**
 * Model Runtime — Four-Tier LLM Fallback Chain
 *
 * Provides a unified `complete(prompt, systemPrompt)` interface that
 * automatically falls through four backends:
 *
 *   Tier 1: Chrome Built-in AI (Gemini Nano, window.ai). Free, ~200ms.
 *   Tier 2: Client's own LLM (Ollama/vLLM). Configured per-firm. ~300ms.
 *   Tier 3: WASM model (small on-device model). No network. ~800ms.
 *   Tier 4: IronGate API. Last resort. Only sends sanitized text.
 *
 * Each tier implements the RuntimeBackend interface. The runtime tries
 * them in order, skipping unavailable backends.
 *
 * SECURITY: Tiers 1-3 are fully local — no PII leaves the device.
 * Tier 4 only receives text where entities are already replaced with
 * type tokens ([PERSON], [SSN], etc.).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Max tokens for the response (default: 2048) */
  maxTokens?: number;
  /** Temperature (default: 0.1 for deterministic rewrites) */
  temperature?: number;
}

export interface CompletionResponse {
  text: string;
  backend: BackendName;
  latencyMs: number;
  tokenCount?: number;
}

export type BackendName = 'chrome-ai' | 'client-llm' | 'wasm-model' | 'irongate-api';

export interface RuntimeBackend {
  name: BackendName;
  isAvailable(): Promise<boolean>;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export interface ModelRuntimeConfig {
  /** Client LLM endpoint (Ollama/vLLM), if configured */
  clientLlmEndpoint?: string;
  /** Client LLM model name (default: varies by provider) */
  clientLlmModel?: string;
  /** IronGate API base URL */
  apiBaseUrl?: string;
  /** IronGate API key */
  apiKey?: string;
  /** Disable specific backends */
  disabledBackends?: BackendName[];
}

// ── Chrome Built-in AI (Tier 1) ──────────────────────────────────────────────

function createChromeAIBackend(): RuntimeBackend {
  let _session: any = null;

  return {
    name: 'chrome-ai',

    async isAvailable(): Promise<boolean> {
      try {
        // Chrome Built-in AI API: window.ai.languageModel
        const ai = (globalThis as any).ai;
        if (!ai?.languageModel) return false;
        const caps = await ai.languageModel.capabilities();
        return caps.available === 'readily' || caps.available === 'after-download';
      } catch {
        return false;
      }
    },

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const start = performance.now();
      const ai = (globalThis as any).ai;

      if (!_session) {
        _session = await ai.languageModel.create({
          systemPrompt: request.systemPrompt,
          temperature: request.temperature ?? 0.1,
          topK: 3,
        });
      }

      const text = await _session.prompt(request.userPrompt);

      return {
        text,
        backend: 'chrome-ai',
        latencyMs: performance.now() - start,
      };
    },
  };
}

// ── Client LLM via Ollama/vLLM (Tier 2) ─────────────────────────────────────

function createClientLLMBackend(config: ModelRuntimeConfig): RuntimeBackend {
  return {
    name: 'client-llm',

    async isAvailable(): Promise<boolean> {
      if (!config.clientLlmEndpoint) return false;
      try {
        const resp = await fetch(config.clientLlmEndpoint, {
          method: 'HEAD',
          signal: AbortSignal.timeout(2000),
        });
        return resp.ok;
      } catch {
        return false;
      }
    },

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      if (!config.clientLlmEndpoint) throw new Error('No client LLM endpoint');
      const start = performance.now();

      // Support both Ollama and OpenAI-compatible endpoints
      const body = {
        model: config.clientLlmModel || 'gemma4:e2b',
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 2048,
        stream: false,
      };

      const resp = await fetch(`${config.clientLlmEndpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`Client LLM error: ${resp.status}`);
      const data = await resp.json();

      const text = data.choices?.[0]?.message?.content
        || data.message?.content
        || data.response
        || '';

      return {
        text,
        backend: 'client-llm',
        latencyMs: performance.now() - start,
        tokenCount: data.usage?.total_tokens,
      };
    },
  };
}

// ── WASM Model (Tier 3) ──────────────────────────────────────────────────────
// Placeholder for future WASM-based small model (e.g., Phi-3-mini).
// Currently returns unavailable — will be implemented when a suitable
// WASM-compatible model is bundled.

function createWASMBackend(): RuntimeBackend {
  return {
    name: 'wasm-model',

    async isAvailable(): Promise<boolean> {
      // TODO: Check if WASM model assets are bundled
      return false;
    },

    async complete(_request: CompletionRequest): Promise<CompletionResponse> {
      throw new Error('WASM model not yet available');
    },
  };
}

// ── IronGate API (Tier 4) ────────────────────────────────────────────────────

function createAPIBackend(config: ModelRuntimeConfig): RuntimeBackend {
  return {
    name: 'irongate-api',

    async isAvailable(): Promise<boolean> {
      return !!config.apiBaseUrl && !!config.apiKey;
    },

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      if (!config.apiBaseUrl || !config.apiKey) {
        throw new Error('IronGate API not configured');
      }
      const start = performance.now();

      const resp = await fetch(`${config.apiBaseUrl}/v1/agent/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          system: request.systemPrompt,
          prompt: request.userPrompt,
          maxTokens: request.maxTokens ?? 2048,
          temperature: request.temperature ?? 0.1,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const data = await resp.json();

      return {
        text: data.text || data.completion || '',
        backend: 'irongate-api',
        latencyMs: performance.now() - start,
        tokenCount: data.tokenCount,
      };
    },
  };
}

// ── Model Runtime Factory ────────────────────────────────────────────────────

export interface ModelRuntime {
  /** Complete a prompt using the best available backend */
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Check which backends are currently available */
  getAvailableBackends(): Promise<BackendName[]>;
}

export function createModelRuntime(config: ModelRuntimeConfig = {}): ModelRuntime {
  const disabled = new Set(config.disabledBackends || []);

  const backends: RuntimeBackend[] = [
    createChromeAIBackend(),
    createClientLLMBackend(config),
    createWASMBackend(),
    createAPIBackend(config),
  ].filter(b => !disabled.has(b.name));

  return {
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const errors: string[] = [];

      for (const backend of backends) {
        try {
          const available = await backend.isAvailable();
          if (!available) continue;
          return await backend.complete(request);
        } catch (err) {
          errors.push(`${backend.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      throw new Error(`All model backends failed: ${errors.join('; ')}`);
    },

    async getAvailableBackends(): Promise<BackendName[]> {
      const available: BackendName[] = [];
      for (const backend of backends) {
        try {
          if (await backend.isAvailable()) {
            available.push(backend.name);
          }
        } catch { /* skip */ }
      }
      return available;
    },
  };
}
