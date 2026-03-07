/**
 * Tier 2 Adapter — Client-Side LLM Classification
 *
 * Uses a locally-configured LLM (e.g., Ollama, LM Studio, or a firm's
 * private endpoint) for on-device sensitivity classification.
 *
 * Benefits:
 *   - No data leaves the device (zero network for classification)
 *   - ~200ms latency (much faster than server round-trip)
 *   - Works offline
 *
 * The adapter implements the TierAdapter interface from confidence-router.ts
 * and can be plugged into the router at initialization.
 *
 * Configuration is provided via managed config (admin-pushed settings).
 */

import type { TierAdapter, TierResult } from './confidence-router';
import { scoreToZone } from './confidence-router';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Tier2Config {
  /** Local LLM endpoint (e.g., http://localhost:11434/api/generate for Ollama) */
  endpoint: string;
  /** Model name (e.g., 'llama3.2:1b', 'phi-3-mini') */
  model: string;
  /** API format: 'ollama' | 'openai' */
  format: 'ollama' | 'openai';
  /** Timeout in ms (default: 5000) */
  timeoutMs?: number;
  /** Whether this tier is enabled */
  enabled: boolean;
}

// ── Classification Prompt ────────────────────────────────────────────────────

const TIER2_SYSTEM_PROMPT = `You are a data sensitivity classifier. Analyze the text and respond with ONLY a JSON object:
{"score":<0-100>,"level":"<low|medium|high|critical>","reasoning":"<brief reason>"}

Score ranges:
- 0-25 (low): Generic queries, no PII
- 26-60 (medium): Some identifiable info
- 61-85 (high): Multiple sensitive entities, legal/medical/financial
- 86-100 (critical): Highly sensitive (bulk PII, credentials, privilege)`;

// ── Tier 2 Adapter ───────────────────────────────────────────────────────────

export function createTier2Adapter(config: Tier2Config): TierAdapter {
  let available = config.enabled;
  let consecutiveFailures = 0;
  const MAX_FAILURES = 3;

  return {
    tier: 2,
    name: `client-llm (${config.model})`,

    isAvailable(): boolean {
      return available && consecutiveFailures < MAX_FAILURES;
    },

    async classify(text: string, tier1Result: TierResult): Promise<TierResult> {
      const start = Date.now();
      const timeoutMs = config.timeoutMs || 5000;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        let response: Response;

        if (config.format === 'ollama') {
          response = await fetch(config.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: config.model,
              prompt: `${TIER2_SYSTEM_PROMPT}\n\nText to classify:\n${text.substring(0, 2000)}`,
              stream: false,
              options: { temperature: 0.1 },
            }),
            signal: controller.signal,
          });
        } else {
          // OpenAI-compatible format
          response = await fetch(config.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: config.model,
              messages: [
                { role: 'system', content: TIER2_SYSTEM_PROMPT },
                { role: 'user', content: text.substring(0, 2000) },
              ],
              temperature: 0.1,
              max_tokens: 100,
            }),
            signal: controller.signal,
          });
        }

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Tier 2 LLM returned ${response.status}`);
        }

        const data = await response.json() as any;
        const content = config.format === 'ollama'
          ? data.response
          : data.choices?.[0]?.message?.content;

        if (!content) throw new Error('Empty Tier 2 response');

        // Extract JSON from response (may have surrounding text)
        const jsonMatch = content.match(/\{[^}]+\}/);
        if (!jsonMatch) throw new Error('No JSON in Tier 2 response');

        const parsed = JSON.parse(jsonMatch[0]);
        const score = Math.min(100, Math.max(0, Math.round(parsed.score || 0)));
        const level = validateLevel(parsed.level);
        const latencyMs = Date.now() - start;

        consecutiveFailures = 0;

        return {
          tier: 2,
          score,
          level,
          zone: scoreToZone(score),
          latencyMs,
          source: `client-llm:${config.model}`,
        };
      } catch (err) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          console.warn(`[Iron Gate] Tier 2 disabled after ${MAX_FAILURES} consecutive failures`);
        }
        throw err;
      }
    },
  };
}

/**
 * Probe whether a Tier 2 endpoint is reachable.
 * Used during health checks and initialization.
 */
export async function probeTier2(config: Tier2Config): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    if (config.format === 'ollama') {
      const response = await fetch(config.endpoint.replace('/api/generate', '/api/tags'), {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } else {
      // OpenAI-compatible: just check if the endpoint responds
      const response = await fetch(config.endpoint.replace('/chat/completions', '/models'), {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    }
  } catch {
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function validateLevel(level: string): string {
  const valid = ['low', 'medium', 'high', 'critical'];
  return valid.includes(level) ? level : 'medium';
}
