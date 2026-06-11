// ============================================================================
// Iron Gate — Judgment Contract (Phase 0/1)
// ============================================================================
//
// The two-stage detection pipeline:
//   Stage 1 (regex): prompt → Evidence (structured signals, no verdict)
//   Stage 2 (Gemma 4): Evidence + prompt → Judgment (verdict + pseudonym map)
//
// Everything downstream — side panel, compliance evaluator, proxy/mask layer,
// activity feed — consumes Judgment. Nothing consumes raw regex output.
// ============================================================================

import type { EntityType, DetectedEntity, SensitivityLevel, AIToolId } from './index';

// ── Stage 1 Output: Evidence ────────────────────────────────────────────────

/** Structured output from the regex/pattern detection stage. */
export interface Evidence {
  /** Detected entities with spans and confidence */
  entities: DetectedEntity[];
  /** Bright-line flags that override any LLM judgment */
  brightLineFlags: BrightLineFlag[];
  /** Contextual signals (document type, legal markers, financial terms) */
  contextualSignals: ContextualSignal[];
  /** Raw sensitivity score from pattern-based scoring */
  patternScore: number;
  /** Pattern-based level */
  patternLevel: SensitivityLevel;
  /** Processing time for Stage 1 */
  stage1LatencyMs: number;
}

/** Non-negotiable compliance triggers — these bypass LLM judgment entirely */
export interface BrightLineFlag {
  type: 'SSN' | 'CREDIT_CARD' | 'API_KEY' | 'AWS_CREDENTIAL' | 'DATABASE_URI'
    | 'PRIVATE_KEY' | 'CLASSIFICATION_MARKING' | 'EXPORT_CONTROL';
  entityIndex: number;
  /** Why this is non-negotiable */
  reason: string;
}

export interface ContextualSignal {
  category: string;
  weight: number;
  confidence: number;
  matchedText?: string;
}

// ── Stage 2 Output: Judgment ────────────────────────────────────────────────

/** The verdict that drives all downstream behavior. */
export interface Judgment {
  /** What to do with this prompt */
  verdict: JudgmentVerdict;
  /** Final sensitivity score (0-100) */
  score: number;
  /** Final sensitivity level */
  level: SensitivityLevel;
  /** Human-readable explanation of the verdict */
  reasoning: string;
  /** Entity-level annotations from the LLM */
  entities: JudgmentEntity[];
  /** Pseudonym map for masking (only populated when verdict === 'mask') */
  pseudonymMap: JudgmentPseudonymEntry[];
  /** Which stage produced this judgment */
  source: JudgmentSource;
  /** Processing latencies */
  latency: JudgmentLatency;
  /** Model identity (for audit trail) */
  model: ModelIdentity;
  /** Whether any bright-line flags forced the verdict */
  brightLineOverride: boolean;
  /** Compliance framework tags triggered */
  complianceFrameworks: string[];
  /** AI tool context */
  aiToolId: AIToolId;
  /** Timestamp */
  timestamp: string;
}

export type JudgmentVerdict = 'allow' | 'nudge' | 'mask' | 'block';

export interface JudgmentEntity {
  type: EntityType | string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  /** LLM's assessment: is this entity actually sensitive in context? */
  isSensitive: boolean;
  /** LLM's reasoning for the sensitivity assessment */
  contextNote?: string;
}

// Renamed from PseudonymEntry: pseudonym-map.ts exports a structurally
// different interface of the same name, and both are `export *`-ed from
// the package barrel — the collision broke fresh-clone builds (TS2308).
export interface JudgmentPseudonymEntry {
  /** Character span in the original text */
  span: [number, number];
  /** The original sensitive text */
  original: string;
  /** The replacement token */
  pseudonym: string;
  /** Entity type */
  type: EntityType | string;
}

export type JudgmentSource =
  | 'gemma4'           // Stage 2 LLM produced the verdict
  | 'bright-line'      // Non-negotiable pattern override
  | 'pattern-only'     // Stage 2 unavailable, fell back to Stage 1
  | 'merged';          // Stage 1 + Stage 2 combined

export interface JudgmentLatency {
  stage1Ms: number;
  stage2Ms: number;
  totalMs: number;
}

export interface ModelIdentity {
  tag: string;          // e.g., "gemma4:e2b"
  digest?: string;      // Ollama model digest for version pinning
  contextWindow?: number;
}

// ── Gemma 4 Function-Calling Schema ─────────────────────────────────────────
// This is the JSON schema passed to Ollama's tools parameter so Gemma 4
// returns structured output instead of free-form text.

export const JUDGMENT_FUNCTION_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'submitJudgment',
    description: 'Submit a sensitivity judgment for the user prompt',
    parameters: {
      type: 'object',
      required: ['verdict', 'score', 'reasoning', 'entities'],
      properties: {
        verdict: {
          type: 'string',
          enum: ['allow', 'nudge', 'mask', 'block'],
          description: 'What to do: allow (safe), nudge (warn user), mask (pseudonymize entities), block (prevent sending)',
        },
        score: {
          type: 'number',
          description: 'Sensitivity score 0-100. 0-25=low, 26-60=medium, 61-85=high, 86-100=critical',
        },
        reasoning: {
          type: 'string',
          description: 'One-sentence explanation of why this verdict was chosen',
        },
        entities: {
          type: 'array',
          description: 'Entities detected in the prompt with sensitivity assessment',
          items: {
            type: 'object',
            required: ['type', 'text', 'isSensitive'],
            properties: {
              type: {
                type: 'string',
                description: 'Entity type: PERSON, ORGANIZATION, SSN, CREDIT_CARD, EMAIL, PHONE_NUMBER, ADDRESS, API_KEY, MONETARY_AMOUNT, DATE, etc.',
              },
              text: {
                type: 'string',
                description: 'The exact text of the entity as it appears in the prompt',
              },
              isSensitive: {
                type: 'boolean',
                description: 'Is this entity actually sensitive in context? "Google" in a research question = false. "John Smith" in a complaint letter = true.',
              },
              contextNote: {
                type: 'string',
                description: 'Brief note on why this entity is or is not sensitive',
              },
            },
          },
        },
      },
    },
  },
} as const;

// ── Merge Rules ─────────────────────────────────────────────────────────────
// Trust hierarchy for combining Stage 1 Evidence with Stage 2 Judgment.

export const MERGE_RULES = {
  /** Bright-line flags always win — no LLM can override SSN/CC/credentials */
  BRIGHT_LINE_WINS: true,
  /** Gemma wins on ambiguous entity classification (person vs org, sensitive vs not) */
  LLM_WINS_ON_AMBIGUOUS: true,
  /** Admin-configured firm dictionaries override both regex and LLM */
  FIRM_DICTIONARY_WINS: true,
  /** If Stage 2 is unavailable, fall back to Stage 1 (never fail open) */
  FAIL_CLOSED_ON_STAGE2_FAILURE: true,
} as const;
