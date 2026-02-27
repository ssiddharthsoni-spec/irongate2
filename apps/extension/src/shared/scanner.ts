/**
 * Shared Scanner Module
 *
 * Unified entry point for entity detection and risk scoring.
 * Re-exports types and provides high-level detectEntities() and computeRiskScore().
 */

export type { DetectedEntity, DetectionResult, ModelStatus } from '../detection/types';
export { DEFAULT_ENTITY_TYPES } from '../detection/types';

export type { SensitivityLevel, SensitivityScore, ScoreBreakdown } from '../detection/scorer';
export { computeScore } from '../detection/scorer';

export { detectWithRegex } from '../detection/fallback-regex';

import type { DetectedEntity } from '../detection/types';
import type { SensitivityScore } from '../detection/scorer';
import { detectWithRegex } from '../detection/fallback-regex';
import { computeScore } from '../detection/scorer';

/**
 * Detect entities in text using regex-based fallback detection.
 * Returns typed entity objects with confidence scores.
 */
export function detectEntities(text: string): DetectedEntity[] {
  return detectWithRegex(text);
}

/**
 * Compute a risk score for detected entities in context.
 * Returns score (0-100), level, explanation, and breakdown.
 */
export function computeRiskScore(
  entities: DetectedEntity[],
  text: string,
  customWeights?: Partial<Record<string, number>>
): SensitivityScore {
  return computeScore(text, entities, customWeights);
}
