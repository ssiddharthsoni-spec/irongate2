/**
 * Tier 2 GLiNER Adapter — On-Device NER for Confidence Router
 *
 * Implements the TierAdapter interface to plug GLiNER NER into the
 * three-zone confidence routing system.
 *
 * Architecture:
 *   Service Worker → (message) → Offscreen Document → GLiNER ONNX → entities
 *
 * The adapter:
 *   1. Manages the offscreen document lifecycle (create/destroy)
 *   2. Sends text to the offscreen NER worker
 *   3. Converts entity detections into a TierResult score
 *   4. Implements circuit breaker (disable after 3 consecutive failures)
 *
 * Gated behind:
 *   - Feature flag: `tier2_ner`
 *   - Managed config: `localNer.enabled`
 */

import type { TierAdapter, TierResult } from './confidence-router';
import { scoreToZone } from './confidence-router';
import type { DetectedEntity } from './types';
import { HIGH_PII_TYPES } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GLiNERAdapterConfig {
  /** Whether Tier 2 NER is enabled */
  enabled: boolean;
  /** Confidence threshold for entity detection (default: 0.5) */
  confidenceThreshold?: number;
  /** Timeout for NER inference in ms (default: 10000) */
  timeoutMs?: number;
}

// ── Offscreen Document Management ────────────────────────────────────────────

let _offscreenCreated = false;

async function ensureOffscreen(): Promise<void> {
  if (_offscreenCreated) return;

  // Check if an offscreen document already exists
  const existingContexts = await (chrome.runtime as any).getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen/ner-offscreen.html')],
  }).catch(() => []);

  if (existingContexts?.length > 0) {
    _offscreenCreated = true;
    return;
  }

  try {
    await (chrome.offscreen as any).createDocument({
      url: 'offscreen/ner-offscreen.html',
      reasons: ['WORKERS'], // ONNX inference
      justification: 'GLiNER NER model requires DOM context for ONNX Runtime Web',
    });
    _offscreenCreated = true;
  } catch (err: any) {
    // If already exists, that's fine
    if (err?.message?.includes('already exists')) {
      _offscreenCreated = true;
      return;
    }
    throw err;
  }
}

/**
 * Send a classification request to the offscreen NER worker.
 */
async function classifyViaOffscreen(
  text: string,
  confidenceThreshold: number,
  timeoutMs: number,
): Promise<{ entities: DetectedEntity[]; latencyMs: number }> {
  await ensureOffscreen();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`GLiNER NER timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    chrome.runtime.sendMessage(
      {
        type: 'NER_CLASSIFY',
        text,
        confidenceThreshold,
      },
      (response: any) => {
        clearTimeout(timer);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response?.type === 'NER_ERROR') {
          reject(new Error(response.error || 'NER classification failed'));
          return;
        }

        if (response?.type === 'NER_RESULT') {
          resolve({
            entities: response.entities || [],
            latencyMs: response.latencyMs || 0,
          });
          return;
        }

        reject(new Error('Invalid NER response'));
      },
    );
  });
}

// ── Score Computation ────────────────────────────────────────────────────────

/**
 * Compute a sensitivity score from GLiNER entity detections.
 *
 * Scoring heuristic:
 *   - 0 entities → no change from Tier 1
 *   - 1-2 low-sensitivity entities → 30-45
 *   - 3+ entities or high-sensitivity type → 60-85
 *   - 5+ entities (bulk PII) → 85-100
 */
function computeNERScore(entities: DetectedEntity[]): { score: number; level: string } {
  if (entities.length === 0) return { score: 0, level: 'low' };

  let score = 0;
  let hasHighPII = false;

  for (const entity of entities) {
    if (HIGH_PII_TYPES.has(entity.type)) {
      hasHighPII = true;
      score += 25;
    } else {
      score += 12;
    }
  }

  // Bulk PII bonus
  if (entities.length >= 5) {
    score += 20;
  }

  // High PII floor
  if (hasHighPII && score < 61) {
    score = 61;
  }

  score = Math.min(100, score);

  const level = score <= 25 ? 'low'
    : score <= 60 ? 'medium'
    : score <= 85 ? 'high'
    : 'critical';

  return { score, level };
}

// ── Tier 2 Adapter ───────────────────────────────────────────────────────────

export function createGLiNERAdapter(config: GLiNERAdapterConfig): TierAdapter & {
  /** Get entities from the last classification */
  getLastEntities(): DetectedEntity[];
} {
  let consecutiveFailures = 0;
  const MAX_FAILURES = 3;
  let lastEntities: DetectedEntity[] = [];

  return {
    tier: 2,
    name: 'gliner-ner',

    isAvailable(): boolean {
      return config.enabled && consecutiveFailures < MAX_FAILURES;
    },

    async classify(text: string, tier1Result: TierResult): Promise<TierResult> {
      const confidenceThreshold = config.confidenceThreshold ?? 0.5;
      const timeoutMs = config.timeoutMs ?? 10000;

      try {
        const result = await classifyViaOffscreen(text, confidenceThreshold, timeoutMs);
        consecutiveFailures = 0;

        lastEntities = result.entities;
        const { score, level } = computeNERScore(result.entities);

        // Only return if NER score is higher than Tier 1
        const finalScore = Math.max(score, tier1Result.score);
        const finalLevel = finalScore <= 25 ? 'low'
          : finalScore <= 60 ? 'medium'
          : finalScore <= 85 ? 'high'
          : 'critical';

        return {
          tier: 2,
          score: finalScore,
          level: finalLevel,
          zone: scoreToZone(finalScore),
          latencyMs: result.latencyMs,
          source: `gliner-ner:${result.entities.length}`,
        };
      } catch (err) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          console.warn(`[Iron Gate] GLiNER Tier 2 disabled after ${MAX_FAILURES} consecutive failures`);
        }
        throw err;
      }
    },

    getLastEntities(): DetectedEntity[] {
      return lastEntities;
    },
  };
}

/**
 * Preload the GLiNER model in the offscreen document.
 * Call on extension install or when feature flag is enabled.
 */
export async function preloadGLiNERModel(): Promise<void> {
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: 'NER_PRELOAD' }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Iron Gate] GLiNER preload failed:', chrome.runtime.lastError.message);
      }
    });
  } catch (err) {
    console.warn('[Iron Gate] GLiNER preload error:', err);
  }
}
