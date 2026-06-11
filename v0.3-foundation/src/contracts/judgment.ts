// ============================================================================
// @contracts/judgment — Stage 2 output that drives all downstream behavior.
//
// The Judgment is the SINGLE SOURCE OF TRUTH for what happens to a prompt.
// The sidepanel, the compliance evaluator, the proxy/mask layer, and the
// audit trail all consume this one object. Nothing else.
// ============================================================================

import type { EntityType } from './entities';

/** What the system decides to do with the prompt. */
export const VERDICTS = ['allow', 'warn', 'block', 'redact-and-send'] as const;
export type Verdict = typeof VERDICTS[number];

/** How the judgment was produced. */
export const JUDGMENT_SOURCES = [
  'gemma4',        // Stage 2 LLM produced the verdict
  'bright-line',   // Non-negotiable pattern override (SSN, CC, credentials)
  'pattern-only',  // Stage 2 unavailable, fell back to Stage 1 evidence
  'merged',        // Stage 1 + Stage 2 combined per merge rules
] as const;
export type JudgmentSource = typeof JUDGMENT_SOURCES[number];

/** An entity with the judgment layer's assessment of its sensitivity. */
export interface JudgedEntity {
  /** Entity type */
  type: EntityType | string;
  /** Exact text as it appears in the prompt */
  text: string;
  /** Character offset start */
  start: number;
  /** Character offset end */
  end: number;
  /** Detection confidence from Stage 1 */
  detectionConfidence: number;
  /** Is this entity actually sensitive in context? (Stage 2 assessment) */
  isSensitive: boolean;
  /** LLM's brief note on why (e.g., "public company in research context") */
  contextNote?: string;
  /** Which detector found this entity */
  source: string;
}

/** A span to be pseudonymized. */
export interface AffectedSpan {
  /** Character offset range [start, end) in the original prompt */
  span: [start: number, end: number];
  /** The original text */
  original: string;
  /** The replacement token */
  replacement: string;
  /** Entity type */
  type: EntityType | string;
}

/** Model identity for audit trail. */
export interface ModelIdentity {
  /** Model tag (e.g., "gemma4:e2b") */
  tag: string;
  /** Ollama digest for version pinning */
  digest?: string;
  /** Context window size */
  contextWindow?: number;
}

/**
 * The Judgment — the single authoritative verdict on a prompt.
 *
 * Every downstream consumer reads this and only this. There is no
 * other object that can change what happens to the prompt.
 */
export interface Judgment {
  /** What to do with this prompt */
  verdict: Verdict;
  /** Sensitivity score (0-100) */
  score: number;
  /** Sensitivity level */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** Human-readable rationale */
  rationale: string;
  /** All entities with sensitivity assessment */
  entities: JudgedEntity[];
  /** Spans to pseudonymize (populated when verdict = 'redact-and-send') */
  affectedSpans: AffectedSpan[];
  /** How this judgment was produced */
  source: JudgmentSource;
  /** Model that produced it (null for bright-line / pattern-only) */
  model: ModelIdentity | null;
  /** Whether bright-line flags forced the verdict */
  brightLineOverride: boolean;
  /** Compliance frameworks triggered */
  complianceFrameworks: string[];
  /** Is this a degraded verdict (LLM unavailable, fell back to regex)? */
  degraded: boolean;
  /** Processing latency */
  latency: {
    stage1Ms: number;
    stage2Ms: number;
    totalMs: number;
  };
  /** Confidence in the verdict (0-1) */
  confidence: number;
  /** Model version string for regression attribution */
  modelVersion: string;
}

/**
 * Score → level mapping. One function, used everywhere.
 * No component should have its own copy.
 */
export function scoreToLevel(score: number): Judgment['level'] {
  if (score <= 25) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 85) return 'high';
  return 'critical';
}

/**
 * Score → verdict mapping for pattern-only fallback.
 * Used when Stage 2 is unavailable.
 */
export function scoreToVerdict(score: number): Verdict {
  if (score <= 25) return 'allow';
  if (score <= 60) return 'warn';
  if (score <= 85) return 'redact-and-send';
  return 'block';
}
