/**
 * Tier 3 Server Adapter — Server-Side AI Classification
 *
 * Implements the TierAdapter interface for the confidence router.
 * Sends pseudonymized+sanitized text to /v1/classify for GPT-4o-mini
 * classification. The server never sees original PII.
 *
 * Circuit breaker: 3 consecutive failures → disable for 60 seconds → auto-retry.
 * Timeout: 3 seconds (server classification is fast with caching).
 */

import type { TierAdapter, TierResult } from './confidence-router';
import { scoreToZone } from './confidence-router';
import type { SanitizedResult } from './sanitize-for-classify';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Tier3Config {
  /** Function to make authenticated API calls. Returns parsed JSON. */
  apiFetch: (path: string, body: Record<string, unknown>) => Promise<any>;
  /** Timeout per request in ms (default: 3000) */
  timeoutMs?: number;
  /** Whether this tier is enabled (default: true) */
  enabled?: boolean;
}

interface ClassifyResponse {
  sensitivity: string; // 'low' | 'medium' | 'high' | 'critical'
  score: number;
  reason?: string;
  categories?: string[];
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export function createTier3ServerAdapter(config: Tier3Config): TierAdapter {
  let consecutiveFailures = 0;
  let _disabled = false;
  const MAX_FAILURES = 3;
  const RECOVERY_MS = 60_000;

  // Auto-recovery timer
  setInterval(() => {
    if (_disabled) {
      console.log('[Iron Gate] Tier 3 server adapter auto-recovery: resetting circuit breaker');
      consecutiveFailures = 0;
      _disabled = false;
    }
  }, RECOVERY_MS);

  return {
    tier: 3,
    name: 'server-classify',

    isAvailable(): boolean {
      return (config.enabled !== false) && !_disabled;
    },

    async classify(text: string, tier1Result: TierResult): Promise<TierResult> {
      const timeoutMs = config.timeoutMs ?? 3000;
      const start = performance.now();

      try {
        // Race the API call against a timeout
        const classifyPromise = config.apiFetch('/classify', {
          text,
          entityTypes: [], // Server infers from [TYPE_N] tokens
          tier1Score: tier1Result.score,
          tier1Level: tier1Result.level,
        });

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tier 3 classify timed out after ${timeoutMs}ms`)), timeoutMs),
        );

        const response: ClassifyResponse = await Promise.race([classifyPromise, timeoutPromise]);
        consecutiveFailures = 0;

        const latencyMs = performance.now() - start;

        // Map server response to TierResult
        const score = typeof response.score === 'number' && Number.isFinite(response.score)
          ? Math.max(0, Math.min(100, response.score))
          : mapLevelToScore(response.sensitivity);

        const level = response.sensitivity || 'low';
        const zone = scoreToZone(score);

        return {
          tier: 3,
          score,
          level,
          zone,
          latencyMs,
          source: `server-classify:${response.sensitivity}${response.reason ? `:${response.reason}` : ''}`,
        };
      } catch (err) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          _disabled = true;
          console.warn(`[Iron Gate] Tier 3 server adapter disabled after ${MAX_FAILURES} failures (auto-recovery in ${RECOVERY_MS / 1000}s)`);
        }
        throw err;
      }
    },
  };
}

/**
 * Map a sensitivity level string to a numeric score.
 * Used when the server returns a level but no numeric score.
 */
function mapLevelToScore(level: string): number {
  switch (level?.toLowerCase()) {
    case 'critical': return 90;
    case 'high': return 75;
    case 'medium': return 45;
    case 'low': return 15;
    default: return 30; // Unknown → amber
  }
}
