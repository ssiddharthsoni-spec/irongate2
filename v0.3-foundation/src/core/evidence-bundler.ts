// ============================================================================
// Evidence Bundler — assembles Detection[] into a complete EvidenceBundle.
//
// Pure function. Runs after all detectors have returned and after the
// dedupe resolver has collapsed overlapping spans. The bundler adds
// bright-line flags, contextual signals, and the pattern-based score.
// ============================================================================

import type { Detection } from '../contracts/entities';
import { BRIGHT_LINE_TYPES } from '../contracts/entities';
import type { EvidenceBundle, BrightLineFlag, ContextualSignal, FirmPolicySnapshot } from '../contracts/evidence';
import { DEFAULT_FIRM_POLICY } from '../contracts/evidence';

/**
 * Score a set of detections using a simplified version of the v0.2 scorer.
 * This is a pure function — no side effects, no imports from the extension.
 *
 * In production, this would call the actual scorer from @core/scoring/.
 * For Phase 0/1, this is a reasonable approximation.
 */
function computePatternScore(detections: Detection[]): number {
  if (detections.length === 0) return 0;

  const weights: Record<string, number> = {
    PERSON: 10, ORGANIZATION: 8, LOCATION: 3, DATE: 2,
    PHONE_NUMBER: 15, EMAIL: 12, CREDIT_CARD: 30, SSN: 40,
    MONETARY_AMOUNT: 12, ACCOUNT_NUMBER: 25, IP_ADDRESS: 8,
    MEDICAL_RECORD: 35, PASSPORT_NUMBER: 35, DRIVERS_LICENSE: 30,
    API_KEY: 30, AWS_CREDENTIAL: 35, DATABASE_URI: 35,
    AUTH_TOKEN: 25, PRIVATE_KEY: 40,
    CLASSIFICATION_MARKING: 40, EXPORT_CONTROL: 30,
    DATE_OF_BIRTH: 25, ADDRESS: 20, BANK_ACCOUNT: 30,
    ROUTING_NUMBER: 25, EIN: 20, STUDENT_ID: 20,
    EMPLOYEE_ID: 15, PERCENTAGE: 3, HEADCOUNT: 5,
    DEAL_CODENAME: 20, PROJECT_NAME: 15, MATTER_NUMBER: 20,
    TICKER: 10, POLICY_NUMBER: 15,
  };

  let score = 0;
  for (const d of detections) {
    const w = weights[d.type] ?? 5;
    score += w * d.confidence;
  }

  // Type diversity bonus
  const uniqueTypes = new Set(detections.map(d => d.type));
  if (uniqueTypes.size >= 3) score *= 1.3;
  else if (uniqueTypes.size >= 2) score *= 1.15;

  // Volume bonus
  if (detections.length >= 10) score *= 1.4;
  else if (detections.length >= 5) score *= 1.2;

  // Bright-line floor
  const hasBrightLine = detections.some(d => BRIGHT_LINE_TYPES.has(d.type as any));
  if (hasBrightLine) score = Math.max(score, 61);
  if (detections.filter(d => BRIGHT_LINE_TYPES.has(d.type as any)).length >= 2) {
    score = Math.max(score, 86);
  }

  return Math.min(100, Math.round(score));
}

function scoreToLevel(score: number): EvidenceBundle['patternLevel'] {
  if (score <= 25) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 85) return 'high';
  return 'critical';
}

/**
 * Build an EvidenceBundle from deduped detections.
 *
 * @param promptText - The raw prompt text.
 * @param detections - Deduped detections from the detector registry.
 * @param aiToolId - AI tool the prompt was entered into.
 * @param firmPolicy - Firm policy snapshot (optional, defaults to unmanaged).
 * @param contextualSignals - Contextual signals (optional).
 * @param stage1LatencyMs - Stage 1 processing time.
 */
export function buildEvidenceBundle(
  promptText: string,
  detections: Detection[],
  aiToolId: string,
  firmPolicy: FirmPolicySnapshot = DEFAULT_FIRM_POLICY,
  contextualSignals: ContextualSignal[] = [],
  stage1LatencyMs: number = 0,
): EvidenceBundle {
  // Identify bright-line flags
  const brightLineFlags: BrightLineFlag[] = [];
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i]!;
    if (BRIGHT_LINE_TYPES.has(d.type as any)) {
      brightLineFlags.push({
        type: d.type as any,
        detectionIndex: i,
        reason: `${d.type} is a non-negotiable compliance trigger`,
      });
    }
  }

  const patternScore = computePatternScore(detections);

  // Deterministic context hash
  const hashInput = JSON.stringify({
    prompt: promptText.substring(0, 500), // Truncate for performance
    detectionTypes: detections.map(d => d.type).sort(),
    firmId: firmPolicy.firmId,
  });
  const contextHash = simpleHash(hashInput);

  return {
    promptText,
    aiToolId,
    detections,
    brightLineFlags,
    contextualSignals,
    patternScore,
    patternLevel: scoreToLevel(patternScore),
    firmPolicy,
    contextHash,
    stage1LatencyMs,
  };
}

/** Simple string hash for deterministic context hashing. Not cryptographic. */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return 'ctx_' + Math.abs(hash).toString(36);
}
