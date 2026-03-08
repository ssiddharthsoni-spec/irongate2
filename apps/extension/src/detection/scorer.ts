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
import { HIGH_PII_TYPES } from './types';
import { classifyDocument, DOCUMENT_TYPE_MULTIPLIERS } from './document-classifier';
import { analyzeRelationships, computeRelationshipBoost } from './relationship-analyzer';
import { applyContextAwareDetection } from '../shared/context-analyzer';
import { detectContextualSensitivity, computeContextualScore, explainContextualMarkers } from './contextual-keywords';
import { applyIntentSuppression } from './intent-suppression';

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SensitivityScore {
  readonly score: number;
  readonly level: SensitivityLevel;
  readonly explanation: string;
  readonly breakdown: Readonly<ScoreBreakdown>;
  readonly entities: readonly DetectedEntity[];
}

export interface ScoreBreakdown {
  entityScore: number;
  volumeScore: number;
  contextScore: number;
  legalBoost: number;
  contextualKeywordScore: number;
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
  // International PII entity types
  UK_NINO: 25,
  EU_IBAN: 22,
  CANADIAN_SIN: 25,
  INDIAN_AADHAAR: 25,
  AUSTRALIAN_TFN: 22,
  GERMAN_TAX_ID: 22,
  FRENCH_INSEE: 25,
  // Secret scanner entity types
  API_KEY: 30,
  AWS_CREDENTIAL: 35,
  GCP_CREDENTIAL: 30,
  DATABASE_URI: 35,
  AUTH_TOKEN: 25,
  PRIVATE_KEY: 40,
  // Insurance / actuarial
  POLICY_NUMBER: 15,
  NAIC_CODE: 10,
  // Education (FERPA)
  STUDENT_ID: 20,
  EDUCATION_RECORD: 22,
  // Government / defense
  CLASSIFICATION_MARKING: 40,
  CUI_MARKING: 30,
  EXPORT_CONTROL: 30,
  // Energy
  WELL_IDENTIFIER: 15,
  REGULATORY_DOCKET: 12,
  // Real estate
  PARCEL_NUMBER: 12,
  MLS_NUMBER: 10,
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

  // ── Intent Suppression Layer ──────────────────────────────────────────
  // Detect when PII is the PURPOSE of the task (horoscope, research,
  // self-intro) vs. incidental data leakage. Suppress intentional PII
  // before scoring so it doesn't inflate the sensitivity score.
  const intentResult = applyIntentSuppression(text, entities);
  let intentMultiplier = intentResult.scoreMultiplier;

  // ── Contextual Intelligence Layer ──────────────────────────────────────
  // Apply context-aware detection: suppress code false positives,
  // adjust confidence based on surrounding context (legal vs casual),
  // and compute co-occurrence multiplier (person + SSN = 1.5x)
  const contextAware = applyContextAwareDetection(text, intentResult.entities);
  const contextualEntities = contextAware.entities;
  let coOccurrenceMultiplier = contextAware.scoreMultiplier;

  // Classify document type for paragraph-level understanding:
  // litigation memo (2.0x), financial data (1.8x), casual question (0.5x), etc.
  const docClassification = classifyDocument(text);
  let documentTypeMultiplier = docClassification.confidence >= 0.25
    ? DOCUMENT_TYPE_MULTIPLIERS[docClassification.type]
    : 1.0;

  // Safety: never let document type classification REDUCE score when high-PII
  // entities are present. "Can you help me format this SSN: 123-45-6789?" is
  // phrased as a question but the data is still critical.
  const hasHighPII = contextualEntities.some(e => HIGH_PII_TYPES.has(e.type));
  if (hasHighPII && documentTypeMultiplier < 1.0) {
    documentTypeMultiplier = 1.0;
  }

  // Analyze entity relationships: person+org, org+org (M&A), proximity
  const relationships = analyzeRelationships(text, contextualEntities);
  const relationshipBoost = computeRelationshipBoost(relationships);

  // ── Core Scoring ───────────────────────────────────────────────────────

  // 1. Entity score: sum of weighted entity scores (using context-adjusted entities)
  const entityScore = computeEntityScore(contextualEntities, weights);

  // 2. Volume score: longer text = higher risk (likely pasted document)
  const volumeScore = computeVolumeScore(text);

  // 3. Context score: legal keywords near entities
  const contextScore = computeContextScore(text, contextualEntities);

  // 4. Legal boost: privilege markers
  const legalBoost = computeLegalBoost(text);

  // 5. Contextual keyword score: business-sensitive patterns (deal codenames, MNPI,
  //    litigation strategy, layoff plans, etc.) detected WITHOUT PII entities
  const contextualMarkers = detectContextualSensitivity(text);
  const contextualKeywordScore = computeContextualScore(contextualMarkers);

  // 6. Conversation escalation (placeholder — requires multi-turn state)
  const conversationEscalation = 0;

  // 7. Firm knowledge boost (placeholder — requires server-side data)
  const firmKnowledgeBoost = 0;

  // Safety: if contextual keywords indicate high sensitivity, don't let
  // document type classification or co-occurrence multiplier reduce the score
  if (contextualKeywordScore >= 15) {
    if (documentTypeMultiplier < 1.0) documentTypeMultiplier = 1.0;
    if (coOccurrenceMultiplier < 1.0) coOccurrenceMultiplier = 1.0;
  }

  // ── Critical-Context Override ──────────────────────────────────────────
  // Certain contextual patterns should guarantee minimum scores regardless
  // of the arithmetic. A CEO/GC would never accept "medium" for these:

  // Floor 1: ALWAYS_CRITICAL entity types (SSN, credentials, classified markings)
  // should NEVER score below "high" (61). Two or more = "critical" (86).
  const alwaysCriticalEntities = contextualEntities.filter(e => HIGH_PII_TYPES.has(e.type));
  let criticalFloor = 0;
  if (alwaysCriticalEntities.length >= 2) {
    criticalFloor = 86; // Two SSNs, or SSN + credential = always critical
  } else if (alwaysCriticalEntities.length === 1) {
    criticalFloor = 61; // Single SSN or credential = at minimum "high"
  }

  // Floor 2: Critical contextual categories with high confidence.
  // Whistleblower + SEC, clinical trial + undisclosed, classified briefing —
  // these are existential risk regardless of PII presence.
  const CRITICAL_CATEGORIES = new Set([
    'ma_deal', 'legal_strategy', 'financial_intel',
    'healthcare_phi', 'government_classified',
  ]);
  const criticalMarkers = contextualMarkers.filter(
    m => CRITICAL_CATEGORIES.has(m.category) && m.confidence >= 0.88
  );
  if (criticalMarkers.length >= 2) {
    criticalFloor = Math.max(criticalFloor, 86);
  } else if (criticalMarkers.length === 1 && criticalMarkers[0].weight >= 25) {
    criticalFloor = Math.max(criticalFloor, 61);
  }

  // Floor 3: Multi-signal amplification — when BOTH PII entities AND contextual
  // markers are present across different risk domains, the combination is more
  // dangerous than either alone. (Person + Deal Codename + Financial Terms)
  const hasEntities = contextualEntities.length > 0;
  const hasContextual = contextualMarkers.length > 0;
  if (hasEntities && hasContextual && contextualKeywordScore >= 20) {
    criticalFloor = Math.max(criticalFloor, 61);
  }

  // Safety: don't let intent suppression reduce score when dangerous
  // contextual keywords are present (M&A deal + "research" shouldn't suppress)
  if (contextualKeywordScore >= 15) {
    intentMultiplier = Math.max(intentMultiplier, 1.0);
  }

  // Combine scores with contextual multipliers
  let rawScore =
    (entityScore + volumeScore + contextScore + legalBoost + contextualKeywordScore + relationshipBoost + conversationEscalation + firmKnowledgeBoost) *
    documentTypeMultiplier *
    coOccurrenceMultiplier *
    intentMultiplier;

  // Apply critical floor — never let arithmetic under-rate existential risks
  rawScore = Math.max(rawScore, criticalFloor);

  // Clamp to 0-100
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Determine level
  const level = scoreToLevel(score);

  // Generate explanation
  const contextualExplanation = explainContextualMarkers(contextualMarkers);
  const explanation = generateExplanation(score, level, contextualEntities, text, docClassification.type, contextualExplanation);

  const result: SensitivityScore = {
    score,
    level,
    explanation,
    breakdown: Object.freeze({
      entityScore,
      volumeScore,
      contextScore,
      legalBoost,
      contextualKeywordScore,
      documentTypeMultiplier,
      conversationEscalation,
      firmKnowledgeBoost,
    }),
    entities: contextualEntities,
  };

  // Freeze to prevent accidental mutation (e.g., result.score = X).
  // Callers that need a modified copy must use spread: { ...result, score: X }
  return Object.freeze(result);
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

export function scoreToLevel(score: number): SensitivityLevel {
  if (score <= 25) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 85) return 'high';
  return 'critical';
}

function generateExplanation(
  score: number,
  level: SensitivityLevel,
  entities: DetectedEntity[],
  text: string,
  documentType?: string,
  contextualExplanation?: string
): string {
  if (entities.length === 0 && !contextualExplanation) {
    if (text.length > VOLUME_THRESHOLDS.VERY_LONG) {
      return 'Large text volume detected but no specific entities identified.';
    }
    return 'No sensitive information detected.';
  }

  const parts: string[] = [];

  if (entities.length > 0) {
    const typeGroups = new Map<string, number>();
    for (const entity of entities) {
      typeGroups.set(entity.type, (typeGroups.get(entity.type) || 0) + 1);
    }

    // List entity types found
    const typeDescriptions = Array.from(typeGroups.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${count} ${type.toLowerCase().replace(/_/g, ' ')}${count > 1 ? 's' : ''}`)
      .slice(0, 3);

    parts.push(`Detected ${typeDescriptions.join(', ')}`);
  }

  // Add legal context if relevant
  const lowerText = text.toLowerCase();
  if (PRIVILEGE_MARKERS.some((m) => lowerText.includes(m))) {
    parts.push('Contains privilege markers');
  }

  if (text.length > VOLUME_THRESHOLDS.LONG) {
    parts.push('Large text volume suggests pasted document');
  }

  // Add document type context
  const docTypeLabels: Record<string, string> = {
    litigation_doc: 'Classified as litigation document',
    contract_clause: 'Classified as contract/legal clause',
    financial_data: 'Classified as financial data',
    client_memo: 'Classified as client memo',
    meeting_notes: 'Classified as meeting notes',
    insurance_doc: 'Classified as insurance/actuarial document',
    medical_record: 'Classified as medical record (HIPAA)',
    government_doc: 'Classified as government/classified document',
    energy_report: 'Classified as energy/resources report',
    real_estate_doc: 'Classified as real estate document',
    education_record: 'Classified as education record (FERPA)',
  };
  if (documentType && docTypeLabels[documentType]) {
    parts.push(docTypeLabels[documentType]);
  }

  // Add contextual keyword explanation
  if (contextualExplanation) {
    parts.push(contextualExplanation);
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
