// ============================================================================
// @contracts/evidence — Stage 1 output handed to the judgment layer.
//
// The EvidenceBundle is what the regex/dictionary/heuristic detectors produce.
// It is NOT a verdict. It is structured data that the judgment layer reasons
// over. The distinction matters: evidence can be wrong (false positive) and
// the judgment layer can override it. A verdict cannot be overridden.
// ============================================================================

import type { Detection, EntityType } from './entities';

/** Snapshot of firm policy at evaluation time. */
export interface FirmPolicySnapshot {
  /** Firm identifier */
  firmId: string | null;
  /** Operating mode */
  mode: 'audit' | 'proxy';
  /** Compliance frameworks active for this firm */
  complianceFrameworks: string[];
  /** Firm-specific entity weight overrides */
  entityWeightOverrides: Partial<Record<EntityType, number>>;
  /** Firm lexicon entries (brand names, project codenames, client names) */
  lexiconEntries: string[];
  /** Risk posture */
  riskPosture: 'conservative' | 'balanced' | 'permissive';
}

/** Contextual signals extracted from the prompt (not entities). */
export interface ContextualSignal {
  /** Category of the signal (e.g., 'ma_deal', 'legal_privilege', 'medical_phi') */
  category: string;
  /** Weight contribution to scoring */
  weight: number;
  /** Confidence of the signal match */
  confidence: number;
  /** The text that triggered the signal (optional, for debugging) */
  matchedText?: string;
}

/** Bright-line flag — non-negotiable compliance trigger. */
export interface BrightLineFlag {
  /** Entity type that triggered the flag */
  type: EntityType;
  /** Index into the detections array */
  detectionIndex: number;
  /** Human-readable reason */
  reason: string;
}

/**
 * The complete evidence package handed to the judgment layer.
 *
 * Invariant: contextHash is a deterministic hash of {promptText, detections,
 * firmPolicy}. Two identical bundles must produce identical judgments.
 */
export interface EvidenceBundle {
  /** The raw prompt text (never leaves the device unless firm policy = proxy) */
  promptText: string;
  /** AI tool the prompt was entered into */
  aiToolId: string;
  /** All detections from all detector sources, pre-deduped */
  detections: Detection[];
  /** Bright-line flags (SSN, CC, credentials) — these bypass judgment */
  brightLineFlags: BrightLineFlag[];
  /** Contextual signals (document type, legal markers, financial terms) */
  contextualSignals: ContextualSignal[];
  /** Pattern-based score from the current scorer (Stage 1) */
  patternScore: number;
  /** Pattern-based level */
  patternLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Firm policy snapshot at evaluation time */
  firmPolicy: FirmPolicySnapshot;
  /** Deterministic hash of the bundle for caching and audit */
  contextHash: string;
  /** Stage 1 processing time in milliseconds */
  stage1LatencyMs: number;
}

/** Default firm policy for unmanaged installs. */
export const DEFAULT_FIRM_POLICY: FirmPolicySnapshot = {
  firmId: null,
  mode: 'audit', // Unmanaged installs must not exfiltrate by default
  complianceFrameworks: [],
  entityWeightOverrides: {},
  lexiconEntries: [],
  riskPosture: 'balanced',
};
