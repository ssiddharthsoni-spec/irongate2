/**
 * Three-Zone Confidence Router — Phase 2.1
 *
 * Routes detection results through a confidence-gated system:
 *
 *   GREEN  (score 0-25):   Pass through — no escalation needed
 *   AMBER  (score 26-60):  Escalate to higher-tier detection if available
 *   RED    (score 61-100): Block/warn immediately — no escalation delay
 *
 * Tier escalation path:
 *   Tier 1: Local regex + scorer (always available, < 5ms)
 *   Tier 2: Client-side LLM classifier (if configured, ~200ms)
 *   Tier 2.5: Metadata-only classifier (structural features, no text)
 *   Tier 3: Server-side classification API (sanitized input, ~500ms)
 *
 * Key invariant: RED zone results are NEVER downgraded by higher tiers.
 * Higher tiers can only UPGRADE green/amber results.
 */

import type { SensitivityScore } from './scorer';
import type { SemanticClassification } from './semantic-classifier';

// ── Types ────────────────────────────────────────────────────────────────────

export type Zone = 'green' | 'amber' | 'red';

export type Tier = 1 | 2 | 2.5 | 3;

export interface TierResult {
  tier: Tier;
  score: number;
  level: string;
  zone: Zone;
  latencyMs: number;
  source: string;
}

export interface RoutingDecision {
  /** Final zone after all tier evaluations */
  finalZone: Zone;
  /** Final score (highest across all tiers) */
  finalScore: number;
  /** Final sensitivity level */
  finalLevel: string;
  /** Which tiers were consulted */
  tiersConsulted: TierResult[];
  /** Whether the result was escalated from a lower tier */
  wasEscalated: boolean;
  /** Action to take */
  action: 'pass' | 'warn' | 'block';
  /** Total latency across all tiers */
  totalLatencyMs: number;
}

export interface TierAdapter {
  /** Which tier this adapter serves */
  tier: Tier;
  /** Human-readable name */
  name: string;
  /** Whether this tier is currently available */
  isAvailable(): boolean;
  /** Classify text and return a score. Input may be sanitized. */
  classify(text: string, tier1Result: TierResult): Promise<TierResult>;
}

export interface ConfidenceRouterConfig {
  /** Tier adapters in escalation order (lowest tier first) */
  adapters: TierAdapter[];
  /** Whether to escalate amber zone to higher tiers (default: true) */
  escalateAmber?: boolean;
  /** Timeout for each tier in ms (default: 2000) */
  tierTimeoutMs?: number;
  /** Callback when a tier fails */
  onTierError?: (tier: Tier, error: Error) => void;
  /**
   * Optional semantic classifier function.
   * Runs on ALL prompts (including green zone) to catch semantically
   * sensitive content that regex/keywords miss.
   */
  semanticClassify?: (text: string) => Promise<SemanticClassification>;
}

// ── Zone Classification ──────────────────────────────────────────────────────

export function scoreToZone(score: number): Zone {
  if (score <= 25) return 'green';
  if (score <= 60) return 'amber';
  return 'red';
}

export function zoneToAction(zone: Zone): 'pass' | 'warn' | 'block' {
  switch (zone) {
    case 'green': return 'pass';
    case 'amber': return 'warn';
    case 'red': return 'block';
  }
}

// ── Confidence Router ────────────────────────────────────────────────────────

export function createConfidenceRouter(config: ConfidenceRouterConfig) {
  const {
    adapters,
    escalateAmber = true,
    tierTimeoutMs = 2000,
    onTierError,
    semanticClassify,
  } = config;

  // Sort adapters by tier (lowest first)
  const sortedAdapters = [...adapters].sort((a, b) => a.tier - b.tier);

  /**
   * Route a Tier 1 result through the confidence-gated system.
   * Higher tiers are only consulted for amber-zone results.
   * Red-zone results are never downgraded.
   */
  async function route(
    text: string,
    tier1Score: SensitivityScore,
    tier1LatencyMs: number,
  ): Promise<RoutingDecision> {
    const tier1Result: TierResult = {
      tier: 1,
      score: tier1Score.score,
      level: tier1Score.level,
      zone: scoreToZone(tier1Score.score),
      latencyMs: tier1LatencyMs,
      source: 'local-regex-scorer',
    };

    const tiersConsulted: TierResult[] = [tier1Result];
    let highestScore = tier1Result.score;
    let highestLevel = tier1Result.level;
    let highestZone = tier1Result.zone;
    let wasEscalated = false;

    // ── Semantic boost (runs on ALL zones, including green) ──────────────
    // This catches semantically sensitive content that regex missed.
    // "We want to buy that company before competitors find out" → green by
    // regex, but the semantic classifier recognizes M&A intent.
    if (semanticClassify) {
      try {
        const semantic = await semanticClassify(text);
        if (semantic.totalBoost > 0) {
          const boostedScore = Math.min(100, highestScore + semantic.totalBoost);
          const boostedZone = scoreToZone(boostedScore);
          const boostedLevel = boostedScore <= 25 ? 'low' : boostedScore <= 60 ? 'medium' : boostedScore <= 85 ? 'high' : 'critical';

          tiersConsulted.push({
            tier: 1, // Still Tier 1 (local, no network)
            score: boostedScore,
            level: boostedLevel,
            zone: boostedZone,
            latencyMs: 0,
            source: `semantic:${semantic.topCategory}`,
          });

          if (boostedScore > highestScore) {
            highestScore = boostedScore;
            highestLevel = boostedLevel;
            highestZone = boostedZone;
            wasEscalated = true;
          }
        }
      } catch {
        // Semantic classifier failure is non-fatal
      }
    }

    // RED zone: never escalate, act immediately
    if (tier1Result.zone === 'red') {
      return buildDecision(highestZone, highestScore, highestLevel, tiersConsulted, false);
    }

    // GREEN zone: pass through (no escalation needed)
    if (tier1Result.zone === 'green' && !escalateAmber) {
      return buildDecision(highestZone, highestScore, highestLevel, tiersConsulted, false);
    }

    // AMBER zone (or green with escalation): consult higher tiers
    if (tier1Result.zone === 'amber' || (tier1Result.zone === 'green' && escalateAmber)) {
      // Only escalate amber, not green
      if (tier1Result.zone !== 'amber') {
        return buildDecision(highestZone, highestScore, highestLevel, tiersConsulted, false);
      }

      for (const adapter of sortedAdapters) {
        if (adapter.tier <= 1) continue; // Skip Tier 1 (already done)
        if (!adapter.isAvailable()) continue;

        try {
          const result = await Promise.race([
            adapter.classify(text, tier1Result),
            timeout(tierTimeoutMs, adapter.tier),
          ]);

          tiersConsulted.push(result);

          // Higher tiers can only UPGRADE, never downgrade
          if (result.score > highestScore) {
            highestScore = result.score;
            highestLevel = result.level;
            highestZone = scoreToZone(result.score);
            wasEscalated = true;
          }

          // If we've reached red zone, stop escalating
          if (highestZone === 'red') break;
        } catch (err) {
          onTierError?.(adapter.tier, err instanceof Error ? err : new Error(String(err)));
          // Tier failure = continue with current result (fail-open for amber)
        }
      }
    }

    return buildDecision(highestZone, highestScore, highestLevel, tiersConsulted, wasEscalated);
  }

  return { route };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildDecision(
  zone: Zone,
  score: number,
  level: string,
  tiersConsulted: TierResult[],
  wasEscalated: boolean,
): RoutingDecision {
  return {
    finalZone: zone,
    finalScore: score,
    finalLevel: level,
    tiersConsulted,
    wasEscalated,
    action: zoneToAction(zone),
    totalLatencyMs: tiersConsulted.reduce((sum, t) => sum + t.latencyMs, 0),
  };
}

function timeout(ms: number, tier: Tier): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Tier ${tier} timed out after ${ms}ms`)), ms)
  );
}
