/**
 * Metadata Classifier — Tier 2.5
 *
 * Classifies sensitivity using ONLY structural metadata — no raw text
 * is processed. This tier sits between client LLM (Tier 2) and server
 * classification (Tier 3) and is useful when:
 *
 *   - Tier 2 (client LLM) is unavailable
 *   - Text is too sensitive to send even sanitized to the server
 *   - A fast structural check can resolve amber-zone ambiguity
 *
 * Features used for classification:
 *   1. Entity type vector (counts by type)
 *   2. Entity density (entities per 100 chars)
 *   3. Text length bucket
 *   4. Unique entity type count
 *   5. High-PII type presence
 *   6. Co-occurrence patterns (PERSON+SSN, ORG+MONETARY_AMOUNT)
 *
 * Implements TierAdapter from confidence-router.ts.
 */

import type { TierAdapter, TierResult } from './confidence-router';
import { scoreToZone } from './confidence-router';
import { HIGH_PII_TYPES } from './types';
import type { DetectedEntity } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MetadataFeatures {
  entityTypeCounts: Record<string, number>;
  totalEntities: number;
  uniqueTypes: number;
  textLength: number;
  entityDensity: number;
  hasHighPII: boolean;
  highPIICount: number;
  coOccurrences: string[];
}

// ── Risk Co-occurrence Patterns ──────────────────────────────────────────────
// These pairs of entity types significantly increase risk when found together.

const RISK_PAIRS: Array<[string, string, number]> = [
  ['PERSON', 'SSN', 30],
  ['PERSON', 'CREDIT_CARD', 25],
  ['PERSON', 'MEDICAL_RECORD', 25],
  ['PERSON', 'ACCOUNT_NUMBER', 20],
  ['PERSON', 'DRIVERS_LICENSE', 20],
  ['PERSON', 'PASSPORT_NUMBER', 20],
  ['ORGANIZATION', 'MONETARY_AMOUNT', 15],
  ['PERSON', 'EMAIL', 10],
  ['PERSON', 'PHONE_NUMBER', 10],
  ['API_KEY', 'DATABASE_URI', 25],
  ['AWS_CREDENTIAL', 'DATABASE_URI', 30],
];

// ── Feature Extraction ───────────────────────────────────────────────────────

export function extractFeatures(
  entities: DetectedEntity[],
  textLength: number,
): MetadataFeatures {
  const entityTypeCounts: Record<string, number> = {};
  for (const e of entities) {
    entityTypeCounts[e.type] = (entityTypeCounts[e.type] || 0) + 1;
  }

  const uniqueTypes = Object.keys(entityTypeCounts).length;
  const highPIICount = entities.filter(e => HIGH_PII_TYPES.has(e.type)).length;

  // Detect co-occurrences
  const typeSet = new Set(Object.keys(entityTypeCounts));
  const coOccurrences: string[] = [];
  for (const [a, b] of RISK_PAIRS) {
    if (typeSet.has(a) && typeSet.has(b)) {
      coOccurrences.push(`${a}+${b}`);
    }
  }

  return {
    entityTypeCounts,
    totalEntities: entities.length,
    uniqueTypes,
    textLength,
    entityDensity: textLength > 0 ? (entities.length / textLength) * 100 : 0,
    hasHighPII: highPIICount > 0,
    highPIICount,
    coOccurrences,
  };
}

// ── Classification ───────────────────────────────────────────────────────────

export function classifyFromMetadata(features: MetadataFeatures): {
  score: number;
  level: string;
} {
  let score = 0;

  // Base score from entity count
  if (features.totalEntities >= 10) score += 30;
  else if (features.totalEntities >= 5) score += 20;
  else if (features.totalEntities >= 2) score += 10;
  else if (features.totalEntities >= 1) score += 5;

  // High-PII presence
  if (features.highPIICount >= 2) score += 40;
  else if (features.highPIICount >= 1) score += 25;

  // Type diversity bonus
  if (features.uniqueTypes >= 4) score += 15;
  else if (features.uniqueTypes >= 3) score += 10;
  else if (features.uniqueTypes >= 2) score += 5;

  // Co-occurrence boost (most important signal)
  for (const pair of features.coOccurrences) {
    const riskPair = RISK_PAIRS.find(([a, b]) => pair === `${a}+${b}`);
    if (riskPair) score += riskPair[2];
  }

  // Entity density (high density = bulk data paste)
  if (features.entityDensity > 5) score += 15;
  else if (features.entityDensity > 2) score += 8;

  // Long text with entities = document paste
  if (features.textLength > 2000 && features.totalEntities > 3) score += 10;

  score = Math.min(100, score);
  const level = score <= 25 ? 'low' : score <= 60 ? 'medium' : score <= 85 ? 'high' : 'critical';

  return { score, level };
}

// ── Tier Adapter ─────────────────────────────────────────────────────────────

export function createMetadataClassifierAdapter(
  entitiesGetter: () => DetectedEntity[],
  textLengthGetter: () => number,
): TierAdapter {
  return {
    tier: 2.5,
    name: 'metadata-classifier',

    isAvailable(): boolean {
      return true; // Always available — no external dependencies
    },

    async classify(_text: string, tier1Result: TierResult): Promise<TierResult> {
      const start = Date.now();
      const entities = entitiesGetter();
      const textLength = textLengthGetter();

      const features = extractFeatures(entities, textLength);
      const result = classifyFromMetadata(features);

      return {
        tier: 2.5,
        score: result.score,
        level: result.level,
        zone: scoreToZone(result.score),
        latencyMs: Date.now() - start,
        source: 'metadata-classifier',
      };
    },
  };
}
