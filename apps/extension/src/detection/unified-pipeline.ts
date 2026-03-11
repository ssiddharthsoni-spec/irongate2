/**
 * Unified Detection Pipeline
 *
 * Orchestrates ALL detection and intelligence layers into a single call.
 * This is the "combined brain" — every model working together.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  TEXT INPUT                                                         │
 * │                                                                     │
 * │  ┌──────────────────── PARALLEL (<5ms) ───────────────────────┐    │
 * │  │  Layer 1: Regex          — SSN, CC, API keys, emails       │    │
 * │  │  Layer 2: Keywords       — document classification signals │    │
 * │  │  Layer 3: Dictionary     — admin-configured known entities │    │
 * │  │  Layer 4: Doc Classifier — what type of document is this?  │    │
 * │  └────────────────────────────────────────────────────────────┘    │
 * │                              │                                     │
 * │  ┌──────────────────── LLM (~200ms) ──────────────────────────┐   │
 * │  │  Layer 5: Agent Detector — names, orgs, context entities   │    │
 * │  │  (4-tier fallback: Chrome AI → Client LLM → WASM → API)   │    │
 * │  └────────────────────────────────────────────────────────────┘    │
 * │                              │                                     │
 * │  ┌──────────────────── MERGE ─────────────────────────────────┐   │
 * │  │  Entity Merger — dedup, priority: dict > LLM > regex       │    │
 * │  └────────────────────────────────────────────────────────────┘    │
 * │                              │                                     │
 * │  ┌──────────────────── SCORE ─────────────────────────────────┐   │
 * │  │  Scorer — entity weights + context + legal + doc type      │    │
 * │  └────────────────────────────────────────────────────────────┘    │
 * │                              │                                     │
 * │  ┌──────────────────── INTELLIGENCE (~300ms, conditional) ────┐   │
 * │  │  Layer 6: Risk Assessor — the "General Counsel Review"     │    │
 * │  │                                                             │    │
 * │  │  Fast (rule-based, always):                                │    │
 * │  │    CEO lens:  MNPI, deal risk, shareholder liability       │    │
 * │  │    CTO lens:  credentials, infrastructure exposure         │    │
 * │  │    CIO lens:  HIPAA, GDPR, ITAR, FERPA compliance         │    │
 * │  │    CISO lens: active threats, attack vectors               │    │
 * │  │                                                             │    │
 * │  │  Deep (LLM, when uncertain):                               │    │
 * │  │    Indirect identifiers, consequence chains,               │    │
 * │  │    regulatory reasoning, relationship analysis             │    │
 * │  └────────────────────────────────────────────────────────────┘    │
 * │                              │                                     │
 * │                              ▼                                     │
 * │  ┌──────────────────── OUTPUT ────────────────────────────────┐   │
 * │  │  UnifiedResult {                                            │    │
 * │  │    entities,     — all detected entities (merged)          │    │
 * │  │    score,        — sensitivity score (0-100)               │    │
 * │  │    level,        — low / medium / high / critical          │    │
 * │  │    risks,        — categorized risk signals                │    │
 * │  │    action,       — ALLOW / WARN / REDACT / BLOCK           │    │
 * │  │    headline,     — one-sentence CEO summary                │    │
 * │  │    regulations,  — applicable laws/regulations             │    │
 * │  │    latency,      — end-to-end processing time              │    │
 * │  │  }                                                          │    │
 * │  └────────────────────────────────────────────────────────────┘    │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import type { DetectedEntity } from './types';
import type { SensitivityScore } from './scorer';
import type { RiskAssessment, RiskAssessorInput } from '../agent/risk-assessor';
import type { ModelRuntime } from '../agent/model-runtime';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UnifiedResult {
  /** All detected entities from all sources, merged and deduplicated */
  entities: DetectedEntity[];
  /** Sensitivity score from the scorer (0-100) */
  score: number;
  /** Sensitivity level */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** Risk assessment from the intelligence layer */
  riskAssessment: RiskAssessment;
  /** Final recommended action (highest of scorer + risk assessor) */
  action: 'ALLOW' | 'WARN' | 'REDACT' | 'BLOCK';
  /** One-sentence summary */
  headline: string;
  /** Applicable regulations */
  regulations: string[];
  /** Which detection layers contributed */
  layersUsed: string[];
  /** End-to-end latency */
  latencyMs: number;
  /** Per-layer latency breakdown */
  latencyBreakdown: Record<string, number>;
}

export interface UnifiedPipelineConfig {
  /** Enable/disable agent entity detection (LLM) */
  agentDetection?: boolean;
  /** Enable/disable deep risk assessment (LLM) */
  deepRiskAssessment?: boolean;
  /** Timeout for LLM operations */
  llmTimeoutMs?: number;
  /** Entity dictionary entries (from admin config) */
  dictionaryEntries?: Array<{ name: string; aliases: string[]; category: string }>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createUnifiedPipeline(runtime?: ModelRuntime, config?: UnifiedPipelineConfig) {

  /**
   * Run the full detection + intelligence pipeline.
   *
   * This is the single entry point that combines:
   *   - Regex detection (always, instant)
   *   - Contextual keywords (always, instant)
   *   - Document classification (always, instant)
   *   - Agent entity detection (if LLM available, ~200ms)
   *   - Entity merger (dedup all sources)
   *   - Sensitivity scoring (always, instant)
   *   - Risk assessment (fast always + deep if uncertain, ~300ms)
   */
  async function analyze(text: string): Promise<UnifiedResult> {
    const start = performance.now();
    const timings: Record<string, number> = {};
    const layersUsed: string[] = [];

    // ── PHASE 1: Parallel fast detection (<5ms total) ──────────────────

    const phase1Start = performance.now();

    // Import detection modules (dynamic to avoid circular deps in workers)
    const [
      { detectWithRegex },
      { detectContextualSensitivity },
      { classifyDocument },
      { mergeEntities },
      { computeScore },
      { createRiskAssessor },
    ] = await Promise.all([
      import('./fallback-regex'),
      import('./contextual-keywords'),
      import('./document-classifier'),
      import('./entity-merger'),
      import('./scorer'),
      import('../agent/risk-assessor'),
    ]);

    // Run all fast detectors in parallel
    const regexEntities = detectWithRegex(text);
    const contextualMarkers = detectContextualSensitivity(text);
    const docClassification = classifyDocument(text);

    layersUsed.push('regex', 'contextual-keywords', 'document-classifier');
    timings['phase1_fast'] = performance.now() - phase1Start;

    // ── PHASE 2: LLM agent entity detection (~200ms) ───────────────────

    let agentEntities: DetectedEntity[] = [];

    if (config?.agentDetection !== false && runtime) {
      const phase2Start = performance.now();
      try {
        const { createAgentDetector } = await import('../agent/agent-detector');
        const detector = createAgentDetector(runtime);

        if (await detector.isAvailable()) {
          // Agent runs as PRIMARY — finds what regex can't
          agentEntities = await detector.detect(text, regexEntities, {
            mode: 'primary',
            timeoutMs: config?.llmTimeoutMs ?? 5000,
          });
          layersUsed.push('agent-detector');
        }
      } catch (err) {
        console.warn('[IronGate Pipeline] Agent detector failed:', err instanceof Error ? err.message : String(err));
        layersUsed.push('agent-detector:failed');
      }
      timings['phase2_agent'] = performance.now() - phase2Start;
    }

    // ── PHASE 3: Entity merge ──────────────────────────────────────────

    const phase3Start = performance.now();
    const mergedEntities = mergeEntities(regexEntities, agentEntities);
    timings['phase3_merge'] = performance.now() - phase3Start;

    // ── PHASE 4: Sensitivity scoring ───────────────────────────────────

    const phase4Start = performance.now();
    const scoreResult = computeScore(text, mergedEntities);
    timings['phase4_score'] = performance.now() - phase4Start;

    // ── PHASE 5: Intelligence layer (risk assessment) ──────────────────

    const phase5Start = performance.now();
    const assessor = createRiskAssessor(
      config?.deepRiskAssessment !== false ? runtime : undefined
    );

    const riskInput: RiskAssessorInput = {
      text,
      entities: mergedEntities,
      documentType: docClassification.type,
      contextualMarkers: contextualMarkers.map(m => ({
        category: m.category,
        weight: m.weight,
        confidence: m.confidence,
        matched: m.matchedText,
      })),
    };

    const riskAssessment = await assessor.assess(riskInput);
    layersUsed.push('risk-assessor-fast');
    if (riskAssessment.usedDeepAnalysis) {
      layersUsed.push('risk-assessor-deep');
    }
    timings['phase5_risk'] = performance.now() - phase5Start;

    // ── PHASE 6: Final decision (highest severity wins) ────────────────

    const actionRank: Record<string, number> = { ALLOW: 0, WARN: 1, REDACT: 2, BLOCK: 3 };
    const levelToAction: Record<string, string> = { low: 'ALLOW', medium: 'WARN', high: 'REDACT', critical: 'BLOCK' };

    const scorerAction = levelToAction[scoreResult.level] || 'ALLOW';
    const riskAction = riskAssessment.action;

    // Take the MORE restrictive action
    const finalAction = (actionRank[riskAction] || 0) >= (actionRank[scorerAction] || 0)
      ? riskAction
      : scorerAction as 'ALLOW' | 'WARN' | 'REDACT' | 'BLOCK';

    // Final level: higher of scorer vs risk assessor
    const levelRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const finalLevel = (levelRank[riskAssessment.level] || 0) >= (levelRank[scoreResult.level] || 0)
      ? riskAssessment.level
      : scoreResult.level;

    // Final score: higher of the two
    const finalScore = Math.max(scoreResult.score, riskAssessment.score);

    // Headline: risk assessor provides better context
    const headline = riskAssessment.risks.length > 0
      ? riskAssessment.headline
      : scoreResult.explanation;

    const totalLatency = performance.now() - start;

    return {
      entities: mergedEntities,
      score: finalScore,
      level: finalLevel as 'low' | 'medium' | 'high' | 'critical',
      riskAssessment,
      action: finalAction,
      headline,
      regulations: riskAssessment.regulations,
      layersUsed,
      latencyMs: totalLatency,
      latencyBreakdown: timings,
    };
  }

  return { analyze };
}
