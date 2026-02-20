/**
 * Sensitivity Scoring Algorithm
 * Takes raw entity detection results and produces a 0-100 sensitivity score.
 *
 * Score ranges:
 *   0-25:  Low    — Generic queries, no PII
 *  26-60:  Medium — Some identifiable information
 *  61-85:  High   — Multiple entities or sensitive combinations
 *  86-100: Critical — Highly sensitive content (financial, legal, medical)
 */

import type { DetectedEntity } from './types';

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SensitivityScore {
  score: number;
  level: SensitivityLevel;
  explanation: string;
  breakdown: ScoreBreakdown;
  entities: DetectedEntity[];
}

export interface ScoreBreakdown {
  entityScore: number;
  volumeScore: number;
  contextScore: number;
  legalBoost: number;
  documentTypeMultiplier: number;
  conversationEscalation: number;
  firmKnowledgeBoost: number;
}

// Entity type weights — higher = more sensitive
const ENTITY_WEIGHTS: Record<string, number> = {
  PERSON: 10,
  ORGANIZATION: 8,
  LOCATION: 3,
  DATE: 2,
  PHONE_NUMBER: 15,
  EMAIL: 12,
  CREDIT_CARD: 30,
  SSN: 40,
  MONETARY_AMOUNT: 12,
  ACCOUNT_NUMBER: 25,
  IP_ADDRESS: 8,
  MEDICAL_RECORD: 35,
  PASSPORT_NUMBER: 35,
  DRIVERS_LICENSE: 30,
  MATTER_NUMBER: 20,
  CLIENT_MATTER_PAIR: 25,
  PRIVILEGE_MARKER: 30,
  DEAL_CODENAME: 20,
  OPPOSING_COUNSEL: 15,
};

// Legal context keywords that boost scores
const LEGAL_KEYWORDS = [
  'privileged',
  'attorney-client',
  'work product',
  'without prejudice',
  'confidential',
  'under seal',
  'protective order',
  'settlement',
  'mediation',
  'arbitration',
  'deposition',
  'subpoena',
  'motion to compel',
  'discovery',
  'litigation hold',
  'retainer',
  'engagement letter',
];

const PRIVILEGE_MARKERS = [
  'attorney-client privilege',
  'work product doctrine',
  'privileged and confidential',
  'attorney work product',
  'protected communication',
  'legal professional privilege',
];

// Volume scoring thresholds
const VOLUME_THRESHOLDS = {
  SHORT: 100,
  MEDIUM: 500,
  LONG: 2000,
  VERY_LONG: 5000,
};

const VOLUME_SCORES = {
  SHORT: 0,
  MEDIUM: 5,
  LONG: 10,
  VERY_LONG: 20,
};

/**
 * Compute the sensitivity score for a given text and detected entities.
 */
export function computeScore(
  text: string,
  entities: DetectedEntity[],
  customWeights?: Partial<Record<string, number>>
): SensitivityScore {
  const weights: Record<string, number> = { ...ENTITY_WEIGHTS, ...(customWeights || {}) } as Record<string, number>;

  // 1. Entity score: sum of weighted entity scores
  const entityScore = computeEntityScore(entities, weights);

  // 2. Volume score: longer text = higher risk (likely pasted document)
  const volumeScore = computeVolumeScore(text);

  // 3. Context score: legal keywords near entities
  const contextScore = computeContextScore(text, entities);

  // 4. Legal boost: privilege markers
  const legalBoost = computeLegalBoost(text);

  // 5. Document type multiplier (placeholder for Phase 2.5)
  const documentTypeMultiplier = 1.0;

  // 6. Conversation escalation (placeholder for Phase 2.5)
  const conversationEscalation = 0;

  // 7. Firm knowledge boost (placeholder for Phase 2.5)
  const firmKnowledgeBoost = 0;

  // Combine scores
  let rawScore =
    (entityScore + volumeScore + contextScore + legalBoost + conversationEscalation + firmKnowledgeBoost) *
    documentTypeMultiplier;

  // Clamp to 0-100
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Determine level
  const level = scoreToLevel(score);

  // Generate explanation
  const explanation = generateExplanation(score, level, entities, text);

  return {
    score,
    level,
    explanation,
    breakdown: {
      entityScore,
      volumeScore,
      contextScore,
      legalBoost,
      documentTypeMultiplier,
      conversationEscalation,
      firmKnowledgeBoost,
    },
    entities,
  };
}

function computeEntityScore(
  entities: DetectedEntity[],
  weights: Record<string, number>
): number {
  if (entities.length === 0) return 0;

  let score = 0;

  for (const entity of entities) {
    const weight = weights[entity.type] || 5;
    // Scale by confidence
    score += weight * entity.confidence;
  }

  // Entity combination bonus: multiple different entity types = more risky
  const uniqueTypes = new Set(entities.map((e) => e.type));
  if (uniqueTypes.size >= 3) {
    score *= 1.3; // 30% bonus for 3+ different types
  } else if (uniqueTypes.size >= 2) {
    score *= 1.15; // 15% bonus for 2 types
  }

  // Count bonus: many entities = document was likely pasted
  if (entities.length >= 10) {
    score *= 1.4;
  } else if (entities.length >= 5) {
    score *= 1.2;
  }

  return Math.min(70, score); // Cap entity score at 70
}

function computeVolumeScore(text: string): number {
  const len = text.length;

  if (len >= VOLUME_THRESHOLDS.VERY_LONG) return VOLUME_SCORES.VERY_LONG;
  if (len >= VOLUME_THRESHOLDS.LONG) return VOLUME_SCORES.LONG;
  if (len >= VOLUME_THRESHOLDS.MEDIUM) return VOLUME_SCORES.MEDIUM;
  return VOLUME_SCORES.SHORT;
}

function computeContextScore(text: string, entities: DetectedEntity[]): number {
  if (entities.length === 0) return 0;

  const lowerText = text.toLowerCase();
  let score = 0;

  // Check for legal keywords near entities
  for (const entity of entities) {
    const surroundingStart = Math.max(0, entity.start - 200);
    const surroundingEnd = Math.min(text.length, entity.end + 200);
    const surrounding = lowerText.substring(surroundingStart, surroundingEnd);

    for (const keyword of LEGAL_KEYWORDS) {
      if (surrounding.includes(keyword)) {
        score += 5;
        break; // Only count once per entity
      }
    }
  }

  return Math.min(25, score); // Cap context score at 25
}

function computeLegalBoost(text: string): number {
  const lowerText = text.toLowerCase();
  let boost = 0;

  for (const marker of PRIVILEGE_MARKERS) {
    if (lowerText.includes(marker)) {
      boost += 15;
    }
  }

  // Check for case citation patterns (e.g., "Smith v. Jones")
  const caseCitationPattern = /\b[A-Z][a-z]+\s+v\.?\s+[A-Z][a-z]+\b/g;
  const citations = text.match(caseCitationPattern);
  if (citations) {
    boost += citations.length * 5;
  }

  // Check for matter/case number patterns
  const matterPattern = /\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d/gi;
  if (matterPattern.test(text)) {
    boost += 10;
  }

  return Math.min(25, boost); // Cap legal boost at 25
}

function scoreToLevel(score: number): SensitivityLevel {
  if (score <= 25) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 85) return 'high';
  return 'critical';
}

function generateExplanation(
  score: number,
  level: SensitivityLevel,
  entities: DetectedEntity[],
  text: string
): string {
  if (entities.length === 0) {
    if (text.length > VOLUME_THRESHOLDS.VERY_LONG) {
      return 'Large text volume detected but no specific entities identified.';
    }
    return 'No sensitive information detected.';
  }

  const typeGroups = new Map<string, number>();
  for (const entity of entities) {
    typeGroups.set(entity.type, (typeGroups.get(entity.type) || 0) + 1);
  }

  const parts: string[] = [];

  // List entity types found
  const typeDescriptions = Array.from(typeGroups.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type.toLowerCase().replace(/_/g, ' ')}${count > 1 ? 's' : ''}`)
    .slice(0, 3);

  parts.push(`Detected ${typeDescriptions.join(', ')}`);

  // Add legal context if relevant
  const lowerText = text.toLowerCase();
  if (PRIVILEGE_MARKERS.some((m) => lowerText.includes(m))) {
    parts.push('Contains privilege markers');
  }

  if (text.length > VOLUME_THRESHOLDS.LONG) {
    parts.push('Large text volume suggests pasted document');
  }

  return parts.join('. ') + '.';
}

/**
 * Convenience function: detect + score in one call.
 * Uses regex fallback detection.
 */
export async function quickScore(text: string): Promise<SensitivityScore> {
  // Dynamic import to avoid circular deps
  const { detectWithRegex } = await import('./fallback-regex');
  const entities = detectWithRegex(text);
  return computeScore(text, entities);
}
