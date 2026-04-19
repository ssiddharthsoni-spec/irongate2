/**
 * Unified Detection Pipeline — Extracted from main-world.ts (Strangler Fig Phase 1)
 *
 * Single function that runs regex detection + secret scanning + scoring.
 * Replaces 8 duplicated call sites in main-world.ts with one canonical path.
 *
 * IMPORTANT: This module runs in MAIN world (page context). No chrome.* APIs.
 */

import { detectWithRegex } from '../../detection/fallback-regex';
import { computeScore, type SensitivityScore } from '../../detection/scorer';
import type { DetectedEntity } from '../../detection/types';

export interface DetectionResult {
  entities: DetectedEntity[];
  allEntities: DetectedEntity[];
  score: SensitivityScore;
}

/**
 * Run the full local detection pipeline on a prompt text.
 * Uses regex detection + scoring. Secret scanning is handled separately
 * by call sites that have access to the secret scanner module.
 *
 * @param text - The prompt text to analyze
 * @param extraEntities - Additional entities (e.g., from secret scanner)
 * @param intentContext - Optional Gemma verdict for context-aware scoring
 * @param customWeights - Optional scoring weight overrides (from policy bundles)
 * @returns Detection result with entities and score
 */
export function runDetection(
  text: string,
  extraEntities: DetectedEntity[] = [],
  intentContext?: any,
  customWeights?: Partial<Record<string, number>>,
): DetectionResult {
  const entities = detectWithRegex(text);
  const allEntities = [...entities, ...extraEntities];
  const score = computeScore(text, allEntities, customWeights, intentContext);

  return { entities, allEntities, score };
}
