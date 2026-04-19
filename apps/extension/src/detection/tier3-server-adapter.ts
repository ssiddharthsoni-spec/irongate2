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
import { assertCloudCallsPermitted, LocalDeploymentError } from './tier2-adapter';
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
  let _recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  const MAX_FAILURES = 3;
  const RECOVERY_MS = 60_000;

  /** Schedule a one-shot recovery timer (only when disabled). Avoids leaked setInterval. */
  function scheduleRecovery() {
    if (_recoveryTimer) return; // already scheduled
    _recoveryTimer = setTimeout(() => {
      _recoveryTimer = null;
      if (_disabled) {
        console.log('[Iron Gate] Tier 3 server adapter auto-recovery: resetting circuit breaker');
        consecutiveFailures = 0;
        _disabled = false;
      }
    }, RECOVERY_MS);
  }

  return {
    tier: 3,
    name: 'server-classify',

    isAvailable(): boolean {
      // P0 ENFORCEMENT: in local-only mode, Tier 3 is never available
      // regardless of config.enabled or circuit-breaker state. We check the
      // locked deployment config and return false for sovereign deployments.
      // This is defense-in-depth on top of the classify() assertion below —
      // callers that gate on isAvailable() get the right answer immediately
      // without throwing.
      try {
        // Import lazily to avoid circular import at module load time
        // getLockedDeploymentConfig throws if not yet initialized; we treat
        // "not initialized" as "permit" (matches the tier2-adapter behavior
        // of allowing dev-mode use without managed config).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getLockedDeploymentConfig } = require('./tier2-adapter');
        const cfg = getLockedDeploymentConfig();
        if (cfg?.deploymentMode === 'local-only') return false;
      } catch { return false; /* fail closed: if deployment config unavailable, block cloud calls */ }
      return (config.enabled !== false) && !_disabled;
    },

    async classify(text: string, tier1Result: TierResult): Promise<TierResult> {
      // P0 ENFORCEMENT: hard-assert this is allowed. In local-only mode this
      // throws LocalDeploymentError with code CLOUD_CALL_IN_LOCAL_MODE before
      // any network request is made. Do NOT wrap in try/catch — the throw
      // must propagate to the caller.
      assertCloudCallsPermitted('tier3-server-adapter.classify');

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
        // Re-throw LocalDeploymentError immediately without incrementing the
        // circuit breaker — it's not a transient failure, it's a contract
        // violation that should surface to the caller as-is.
        if (err instanceof LocalDeploymentError) throw err;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          _disabled = true;
          scheduleRecovery();
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
