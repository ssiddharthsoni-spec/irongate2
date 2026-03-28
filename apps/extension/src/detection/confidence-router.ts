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

/**
 * Signal detection input — tells the router whether the local stack
 * found ANY signal that warrants server-side classification.
 */
export interface SignalGateInput {
  /** Number of entities detected by regex/dictionary */
  entityCount: number;
  /** Contextual keyword score from contextual-keywords.ts */
  contextualKeywordScore: number;
  /** Document type multiplier from document-classifier.ts */
  documentTypeMultiplier: number;
  /** Conversation boost from conversation-tracker.ts (0 if no tracker) */
  conversationBoost: number;
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
   * Now runs BEFORE the signal gate decision (3.1a).
   */
  semanticClassify?: (text: string) => Promise<SemanticClassification>;
}

// ── Zone Boundary Constants ───────────────────────────────────────────────────
/** Maximum score for green zone (pass through) */
const GREEN_ZONE_MAX = 25;
/** Maximum score for amber zone (escalate) */
const AMBER_ZONE_MAX = 60;

// ── Zone Classification ──────────────────────────────────────────────────────

export function scoreToZone(score: number): Zone {
  if (score <= GREEN_ZONE_MAX) return 'green';
  if (score <= AMBER_ZONE_MAX) return 'amber';
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

export function createConfidenceRouter(config: ConfidenceRouterConfig): { route: (text: string, tier1Score: SensitivityScore, tier1LatencyMs: number, signalGate?: SignalGateInput) => Promise<RoutingDecision> } {
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
   *
   * Signal Gate Logic:
   *   - No signal → GREEN immediately (IronGate is invisible)
   *   - Signal detected → pseudonymize + send to server for AI classification
   *   - RED zone → block immediately (no server call needed)
   *
   * Higher tiers can only UPGRADE, never downgrade.
   */
  async function route(
    text: string,
    tier1Score: SensitivityScore,
    tier1LatencyMs: number,
    signalGate?: SignalGateInput,
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

    // RED zone: never escalate, act immediately — skip semantic + tier routing
    if (tier1Result.zone === 'red') {
      return buildDecision(highestZone, highestScore, highestLevel, tiersConsulted, false);
    }

    // ── Semantic classifier (runs BEFORE signal gate decision — 3.1a) ────
    // Catches semantically sensitive content that regex/keywords miss.
    // "Keep this between us until Thursday" → zero entities, zero keywords,
    // but the semantic classifier recognizes the "confidential/embargoed" cluster.
    let semanticSignal = false;
    if (semanticClassify) {
      try {
        const semantic = await semanticClassify(text);
        if (semantic.totalBoost > 0) {
          semanticSignal = true;
          const boostedScore = Math.min(100, highestScore + semantic.totalBoost);
          const boostedZone = scoreToZone(boostedScore);
          const boostedLevel = boostedScore <= GREEN_ZONE_MAX ? 'low' : boostedScore <= AMBER_ZONE_MAX ? 'medium' : boostedScore <= 85 ? 'high' : 'critical';

          tiersConsulted.push({
            tier: 1,
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
        // Semantic classifier failure is non-fatal — gate falls back to other signals
      }
    }

    // If semantic boost pushed us into RED, return immediately
    if (highestZone === 'red') {
      return buildDecision(highestZone, highestScore, highestLevel, tiersConsulted, wasEscalated);
    }

    // ── Signal Gate (3.1) ─────────────────────────────────────────────────
    // Determine if ANY signal was detected. No signal = IronGate is invisible.
    const gate = signalGate || { entityCount: 0, contextualKeywordScore: 0, documentTypeMultiplier: 1.0, conversationBoost: 0 };
    const signalDetected =
      gate.entityCount > 0 ||
      gate.contextualKeywordScore > 0 ||
      gate.documentTypeMultiplier > 1.0 ||
      gate.conversationBoost > 0 ||
      semanticSignal;

    // No signal: pass through immediately (horoscope, code help, weather)
    if (!signalDetected && highestZone === 'green') {
      return buildDecision(highestZone, highestScore, highestLevel, tiersConsulted, wasEscalated);
    }

    // ── Tier escalation ────────────────────────────────────────────────────
    // Signal detected (or AMBER/RED): consult higher tiers for AI classification.
    // GREEN with signal → still send to server for validation.
    // AMBER → send to server for upgrade/confirm.
    const shouldEscalate = signalDetected || highestZone === 'amber';
    if (shouldEscalate) {
      for (const adapter of sortedAdapters) {
        if (adapter.tier <= 1) continue;
        if (!adapter.isAvailable()) continue;

        try {
          const result = await Promise.race([
            adapter.classify(text, tier1Result),
            timeout(tierTimeoutMs, adapter.tier),
          ]);

          // Validate tier adapter result before using it (H-15: NaN/Infinity guard)
          if (!result || typeof result.score !== 'number' || !Number.isFinite(result.score)) {
            onTierError?.(adapter.tier, new Error(`Tier ${adapter.tier} returned invalid result`));
            continue;
          }
          const validatedResult: TierResult = {
            ...result,
            score: Math.max(0, Math.min(100, result.score)),
            level: result.level || 'low',
            zone: scoreToZone(Math.max(0, Math.min(100, result.score))),
          };
          tiersConsulted.push(validatedResult);

          // Higher tiers can only UPGRADE, never downgrade
          if (validatedResult.score > highestScore) {
            highestScore = validatedResult.score;
            highestLevel = validatedResult.level;
            highestZone = validatedResult.zone;
            wasEscalated = true;
          }

          // If we've reached red zone, stop escalating
          if (highestZone === 'red') break;
        } catch (err) {
          onTierError?.(adapter.tier, err instanceof Error ? err : new Error(String(err)));
          // Tier failure = continue with current result (fail-open for green/amber)
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
