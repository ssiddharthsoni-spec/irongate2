/**
 * Sensitivity Scoring Algorithm
 * Takes raw entity detection results and produces a 0-100 sensitivity score.
 *
 * Scoring model (v2 — multiplicative contextual):
 *   finalScore = entityRisk × intentWeight × structureMultiplier
 *     × documentTypeMultiplier × coOccurrenceMultiplier
 *
 * New layers (v2):
 *   - Intent Classifier: classifies prompt intent + direction (inward/outward)
 *   - Structure Detector: detects tabular/key-value/email/code patterns
 *   - Entity Contextualizer: tags each entity (credential/public/self/3rd-party/internal)
 *
 * Preserved safety guards:
 *   - Critical floor (SSN/credentials → minimum "high")
 *   - FERPA compliance floor
 *   - Contextual keyword floor (≥20 → minimum 30)
 *   - NaN fail-safe (default to HIGH)
 *   - HIGH_PII immunity from suppression
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
import { classifyIntent, getIntentWeight } from './intent-classifier';
import type { IntentContextResult } from './intent-context-classifier';
import { detectStructure } from './structure-detector';
import { contextualizeEntities, getContextRiskMultiplier } from './entity-contextualizer';
export type SensitivityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SensitivityScore {
  readonly score: number;
  readonly level: SensitivityLevel;
  readonly explanation: string;
  readonly breakdown: Readonly<ScoreBreakdown>;
  readonly entities: readonly DetectedEntity[];
  /** Whether intent suppression identified this as a self-referential task (resume, bio, cover letter) */
  readonly isSelfReferential?: boolean;
  /** Document type from document classifier (e.g., 'litigation_doc', 'financial_data', 'casual_question') */
  readonly documentType?: string;
  /** Context category summarizing the detected intent/context for ownership decisions */
  readonly contextCategory?: string;
}

export interface ScoreBreakdown {
  entityScore: number;
  volumeScore: number;
  contextScore: number;
  legalBoost: number;
  contextualKeywordScore: number;
  documentTypeMultiplier: number;
  intentWeight: number;
  structureMultiplier: number;
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
  // Personal identity
  DATE_OF_BIRTH: 25,
  ADDRESS: 20,
  // Financial
  BANK_ACCOUNT: 30,
  ROUTING_NUMBER: 25,
  EIN: 20,
  // Business metrics (VALUE_TYPES — detected but not pseudonymized)
  // Low weight: only sensitive when combined with named entities
  HEADCOUNT: 5,
  PERCENTAGE: 3,
  EMPLOYEE_ID: 15,
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

// ── Named scoring constants ─────────────────────────────────────────────────
// Thresholds and caps referenced in the scoring pipeline.
// Extracted as named constants for clarity and single-source-of-truth.

/** Minimum score guaranteed for a single always-critical entity (e.g., SSN) */
const SINGLE_CRITICAL_ENTITY_FLOOR = 61;
/** Minimum score guaranteed for two or more always-critical entities */
const MULTI_CRITICAL_ENTITY_FLOOR = 86;
/** Contextual keyword score at which multiplier suppression is disabled */
const CONTEXTUAL_KEYWORD_SAFETY_THRESHOLD = 15;
/** Contextual keyword score that triggers a minimum score floor of 30 */
const CONTEXTUAL_KEYWORD_MEDIUM_FLOOR_THRESHOLD = 20;
/** Floor score when contextual keywords reach CONTEXTUAL_KEYWORD_MEDIUM_FLOOR_THRESHOLD */
const CONTEXTUAL_KEYWORD_MEDIUM_FLOOR = 30;
/** Contextual keyword score that triggers a minimum score floor of 50 */
const CONTEXTUAL_KEYWORD_HIGH_FLOOR_THRESHOLD = 35;
/** Floor score when contextual keywords reach CONTEXTUAL_KEYWORD_HIGH_FLOOR_THRESHOLD */
const CONTEXTUAL_KEYWORD_HIGH_FLOOR = 50;
/** Maximum self-referential score ceiling (resume/bio with all entities suppressed) */
const SELF_REFERENTIAL_CEILING = 20;
/** Entity score cap — prevents single-layer dominance */
const ENTITY_SCORE_CAP = 70;
/** Context score cap */
const CONTEXT_SCORE_CAP = 25;
/** Legal boost cap */
const LEGAL_BOOST_CAP = 25;
/** Co-occurrence boost cap */
const CO_OCCURRENCE_BOOST_CAP = 30;
/** NaN fail-safe score when critical floor is 0 */
const NAN_FAILSAFE_SCORE = 70;
/** Minimum confidence for intent classification to affect scoring */
const INTENT_CONFIDENCE_THRESHOLD = 0.7;
/** Minimum confidence for entity context multiplier to take effect */
const ENTITY_CONTEXT_CONFIDENCE_THRESHOLD = 0.7;
/** Minimum confidence for document type multiplier to take effect */
const DOC_TYPE_CONFIDENCE_THRESHOLD = 0.25;
/** Minimum confidence for critical contextual markers */
const CRITICAL_MARKER_CONFIDENCE = 0.88;
/** Entity proximity distance for co-occurrence boost (chars) */
const CO_OCCURRENCE_PROXIMITY = 100;
/** Type combination bonus multiplier for 3+ unique types */
const TYPE_COMBO_BONUS_3PLUS = 1.3;
/** Type combination bonus multiplier for 2 unique types */
const TYPE_COMBO_BONUS_2 = 1.15;
/** Count bonus multiplier for 10+ entities */
const COUNT_BONUS_10PLUS = 1.4;
/** Count bonus multiplier for 5+ entities */
const COUNT_BONUS_5PLUS = 1.2;
/** Context window around each entity for keyword proximity check (chars) */
const ENTITY_CONTEXT_WINDOW = 200;

/**
 * Compute the sensitivity score for a given text and detected entities.
 *
 * PRIMARY path (when `intentContext` is provided by a confident LLM classifier):
 *   the classifier's zone dictates the outcome. HIGH_PII entities still escalate
 *   for safety. Pattern arithmetic is skipped — the LLM understood intent.
 *
 * FALLBACK path (classifier unavailable, or it fell back to its conservative
 * default): the original pattern-based arithmetic runs. This keeps offline and
 * degraded modes working without silently under-protecting users.
 */
export function computeScore(
  text: string,
  entities: DetectedEntity[],
  customWeights?: Partial<Record<string, number>>,
  intentContext?: IntentContextResult,
): SensitivityScore {
  if (intentContext && !intentContext.fellBack) {
    return composeFromClassifier(text, entities, intentContext);
  }

  const weights: Record<string, number> = { ...ENTITY_WEIGHTS, ...(customWeights || {}) } as Record<string, number>;

  // ── Layer 1: Intent Classification (v2) ────────────────────────────────
  // Classify the prompt's intent (what the user is trying to do) and
  // direction (inward = asking for info, outward = sharing data).
  const intentClassification = classifyIntent(text);
  // Only apply intent weight when classification is confident (≥0.7).
  // Low-confidence classifications (fallback to 'general') should not
  // shift scores — preserves backward compatibility with existing tests.
  const rawIntentWeight = getIntentWeight(intentClassification);
  let intentWeight = intentClassification.confidence >= INTENT_CONFIDENCE_THRESHOLD
    ? rawIntentWeight
    : 1.0;

  // ── Layer 2: Structure Detection (v2) ──────────────────────────────────
  // Detect if the text contains tabular data, key-value pairs, email
  // headers, code blocks, etc. Structure amplifies or suppresses score.
  const structureResult = detectStructure(text);
  let structureMultiplier = structureResult.multiplier;

  // ── Intent Suppression Layer (v1 — retained for compatibility) ─────────
  // Detect when PII is the PURPOSE of the task (horoscope, research,
  // self-intro) vs. incidental data leakage. Suppress intentional PII
  // before scoring so it doesn't inflate the sensitivity score.
  const intentResult = applyIntentSuppression(text, entities, false);
  let intentSuppMultiplier = intentResult.scoreMultiplier;

  // ── Contextual Intelligence Layer ──────────────────────────────────────
  // Apply context-aware detection: suppress code false positives,
  // adjust confidence based on surrounding context (legal vs casual),
  // and compute co-occurrence multiplier (person + SSN = 1.5x)
  const contextAware = applyContextAwareDetection(text, intentResult.entities);
  const contextualEntities = contextAware.entities;
  let coOccurrenceMultiplier = contextAware.scoreMultiplier;

  // ── Layer 3: Entity Contextualization (v2) ─────────────────────────────
  // Tag each entity with semantic context (credential, public_reference,
  // self_reference, third_party_private, internal_business).
  const contextualizedEntities = contextualizeEntities(text, contextualEntities);

  // Compute per-entity context risk adjustment:
  // Sum of (entity weight × context multiplier) vs (entity weight × 1.0)
  // gives us an overall entity context factor.
  // Only apply entity context factor when context classification is
  // confident (≥0.7). Low-confidence defaults (0.4) should not shift
  // scores — preserves backward compatibility.
  let entityContextFactor = 1.0;
  if (contextualizedEntities.length > 0) {
    let weightedSum = 0;
    let baseSum = 0;
    for (const ce of contextualizedEntities) {
      const w = weights[ce.type] || 5;
      const confidence = Number.isFinite(ce.confidence) ? ce.confidence : 0.5;
      const rawMultiplier = getContextRiskMultiplier(ce);
      // Only use context multiplier when confident (≥0.7)
      const effectiveMultiplier = ce.contextConfidence >= ENTITY_CONTEXT_CONFIDENCE_THRESHOLD ? rawMultiplier : 1.0;
      baseSum += w * confidence;
      weightedSum += w * confidence * effectiveMultiplier;
    }
    if (baseSum > 0) {
      entityContextFactor = weightedSum / baseSum;
    }
  }

  // Classify document type for paragraph-level understanding:
  // litigation memo (2.0x), financial data (1.8x), casual question (0.5x), etc.
  const docClassification = classifyDocument(text);
  let documentTypeMultiplier = docClassification.confidence >= DOC_TYPE_CONFIDENCE_THRESHOLD
    ? (DOCUMENT_TYPE_MULTIPLIERS[docClassification.type] ?? 1.0)
    : 1.0;

  // Safety: never let document type classification REDUCE score when high-PII
  // entities are present. "Can you help me format this SSN: 123-45-6789?" is
  // phrased as a question but the data is still critical.
  const hasHighPII = contextualEntities.some(e => HIGH_PII_TYPES.has(e.type));
  if (hasHighPII && documentTypeMultiplier < 1.0) {
    documentTypeMultiplier = 1.0;
  }

  // Safety: credential_sharing intent or outward direction with high-PII
  // → never suppress via intent or structure
  if (hasHighPII) {
    if (intentWeight < 1.0) intentWeight = 1.0;
    if (structureMultiplier < 1.0) structureMultiplier = 1.0;
    entityContextFactor = Math.max(entityContextFactor, 1.0);
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
  let contextualKeywordScore = computeContextualScore(contextualMarkers);

  // Entity-keyword co-occurrence: when entities appear within 100 chars of a
  // contextual keyword match, the combination is stronger evidence of real
  // sensitivity. "John Smith" alone is low risk. "John Smith" + "settlement
  // authority" = much higher risk.
  let coOccurrenceBoost = 0;
  if (contextualMarkers.length > 0 && contextualEntities.length > 0) {
    const MA_CATEGORIES = new Set(['ma_deal', 'financial_intel', 'insider_trading']);
    const MEDICAL_CATEGORIES = new Set(['healthcare_phi', 'clinical_trial', 'medical_records']);

    for (const marker of contextualMarkers) {
      for (const entity of contextualEntities) {
        const distance = Math.min(
          Math.abs(entity.start - marker.end),
          Math.abs(marker.start - entity.end),
        );
        if (distance < CO_OCCURRENCE_PROXIMITY) {
          // Close proximity between entity and keyword → boost
          coOccurrenceBoost += 5;

          // High-risk combo bonuses: specific entity+category pairs
          // PERSON near M&A/financial keywords = insider trading risk
          if (entity.type === 'PERSON' && MA_CATEGORIES.has(marker.category)) {
            coOccurrenceBoost += 15;
          }
          // PERSON near medical keywords = PHI risk
          if (entity.type === 'PERSON' && MEDICAL_CATEGORIES.has(marker.category)) {
            coOccurrenceBoost += 20;
          }
          // ORG near financial/non-public keywords = deal intelligence risk
          if (entity.type === 'ORGANIZATION' && MA_CATEGORIES.has(marker.category)) {
            coOccurrenceBoost += 20;
          }
        }
      }
    }
    coOccurrenceBoost = Math.min(CO_OCCURRENCE_BOOST_CAP, coOccurrenceBoost);
  }

  // Safety: if contextual keywords indicate high sensitivity, don't let
  // any multiplier reduce the score — UNLESS this is a self-referential task.
  // In a resume, "managed $2M revenue at Acme Corp" triggers financial/M&A
  // contextual keywords, but those describe past work experience, not active
  // deals or MNPI. Forcing intentSuppMultiplier back to 1.0 would completely
  // override the user's explicit "improve my resume" intent.
  // selfRefFull: true when self-referential AND all entities suppressed.
  // Used to gate safety overrides that would otherwise force multipliers
  // back to 1.0 (which would undo intent suppression for resumes/bios).
  const selfRefFull = intentResult.isSelfReferential &&
    intentResult.suppressions.length > 0 &&
    intentResult.suppressions.length === entities.length;

  if (contextualKeywordScore >= CONTEXTUAL_KEYWORD_SAFETY_THRESHOLD && !selfRefFull) {
    if (documentTypeMultiplier < 1.0) documentTypeMultiplier = 1.0;
    if (coOccurrenceMultiplier < 1.0) coOccurrenceMultiplier = 1.0;
    if (intentWeight < 1.0) intentWeight = 1.0;
    if (structureMultiplier < 1.0) structureMultiplier = 1.0;
    intentSuppMultiplier = Math.max(intentSuppMultiplier, 1.0);
  }

  // ── Critical-Context Override ──────────────────────────────────────────
  // Certain contextual patterns should guarantee minimum scores regardless
  // of the arithmetic. A CEO/GC would never accept "medium" for these:

  // Floor 1: ALWAYS_CRITICAL entity types (SSN, credentials, classified markings)
  // should NEVER score below "high". Two or more = "critical".
  const alwaysCriticalEntities = contextualEntities.filter(e => HIGH_PII_TYPES.has(e.type));
  let criticalFloor = 0;
  if (alwaysCriticalEntities.length >= 2) {
    criticalFloor = MULTI_CRITICAL_ENTITY_FLOOR;
  } else if (alwaysCriticalEntities.length === 1) {
    criticalFloor = SINGLE_CRITICAL_ENTITY_FLOOR;
  }

  // Floor 2: Critical contextual categories with high confidence.
  // Whistleblower + SEC, clinical trial + undisclosed, classified briefing —
  // these are existential risk regardless of PII presence.
  //
  // IMPORTANT: Business-category markers (ma_deal, financial_intel) only
  // trigger the RED floor when a specific named party is also present.
  // "Confidential: acquiring a competitor for $2B" (no names) is confidential
  // strategy but shouldn't jump to critical red — that's AMBER. Contrast with
  // "Confidential: acquiring Meridian Health for $2B" which correctly hits
  // the floor via the ORG entity. Always-critical floors (classified briefing,
  // whistleblower) still apply regardless of entities.
  const CRITICAL_CATEGORIES = new Set([
    'ma_deal', 'legal_strategy', 'financial_intel',
    'healthcare_phi', 'government_classified',
  ]);
  const BUSINESS_ONLY_CATEGORIES = new Set([
    'ma_deal', 'financial_intel',
  ]);
  const hasNamedParty = contextualEntities.some(e =>
    e.type === 'PERSON' || e.type === 'ORGANIZATION'
  );
  const criticalMarkers = contextualMarkers.filter(
    m => CRITICAL_CATEGORIES.has(m.category) && m.confidence >= CRITICAL_MARKER_CONFIDENCE
  );
  const floorEligibleMarkers = criticalMarkers.filter(m =>
    // Business-only categories need a named party present to hit the red floor.
    // Non-business critical categories (legal_strategy, healthcare_phi,
    // government_classified) still apply regardless.
    !BUSINESS_ONLY_CATEGORIES.has(m.category) || hasNamedParty
  );
  if (floorEligibleMarkers.length >= 2) {
    criticalFloor = Math.max(criticalFloor, MULTI_CRITICAL_ENTITY_FLOOR);
  } else if (floorEligibleMarkers.length === 1 && floorEligibleMarkers[0].weight >= 25) {
    criticalFloor = Math.max(criticalFloor, SINGLE_CRITICAL_ENTITY_FLOOR);
  }

  // Floor 3: Multi-signal amplification — when BOTH PII entities AND contextual
  // markers are present across different risk domains, the combination is more
  // dangerous than either alone. (Person + Deal Codename + Financial Terms)
  // The "entities" that count here are PII — a bare MONETARY_AMOUNT ($2B) is
  // not PII and shouldn't be enough to push a nameless M&A prompt to red.
  const hasEntities = contextualEntities.length > 0;
  const hasContextual = contextualMarkers.length > 0;
  const hasPiiEntity = contextualEntities.some(e =>
    e.type !== 'MONETARY_AMOUNT' && e.type !== 'PERCENTAGE' && e.type !== 'DATE'
  );
  if (hasPiiEntity && hasContextual && contextualKeywordScore >= CONTEXTUAL_KEYWORD_MEDIUM_FLOOR_THRESHOLD) {
    criticalFloor = Math.max(criticalFloor, SINGLE_CRITICAL_ENTITY_FLOOR);
  }

  // Floor 4: FERPA compliance hard-block — education records (student IDs,
  // FERPA markers) combined with person entities must always score HIGH.
  // FERPA violations carry severe federal penalties ($100k+ per incident).
  const hasFerpaKeywords = contextualMarkers.some(m => m.category === 'education_ferpa');
  const hasStudentEntity = contextualEntities.some(e =>
    e.type === 'STUDENT_ID' || e.type === 'EDUCATION_RECORD'
  );
  const hasPersonEntity = contextualEntities.some(e => e.type === 'PERSON');
  if ((hasFerpaKeywords && hasPersonEntity) || hasStudentEntity) {
    criticalFloor = Math.max(criticalFloor, SINGLE_CRITICAL_ENTITY_FLOOR);
  }

  // Safety: don't let intent suppression reduce score when dangerous
  // contextual keywords are present (M&A deal + "research" shouldn't suppress).
  // Exception: self-referential tasks (resume/bio) where keywords describe
  // the user's work history, not active deals.
  if (contextualKeywordScore >= CONTEXTUAL_KEYWORD_SAFETY_THRESHOLD && !selfRefFull) {
    intentSuppMultiplier = Math.max(intentSuppMultiplier, 1.0);
  }

  // Validate multipliers before combining — prevent NaN propagation
  function safeMultiplier(value: number, fallback: number = 1.0): number {
    return (Number.isFinite(value) && value >= 0) ? value : fallback;
  }

  // ── Named-Party Cap on Business-Only Markers ─────────────────────────
  // M&A / financial intel language WITHOUT a named party (person, org, or
  // deal codename) is confidential business strategy but isn't the smoking-
  // gun insider-trading risk that warrants a critical red flag. Cap the
  // contextual keyword contribution so these prompts land in AMBER, not red.
  // Real deals with specific targets ("acquiring Meridian Health for $2.8B")
  // still hit the red zone via the critical floor (floor-eligible markers).
  //
  // Heuristic for "no named party": neither an extracted PERSON/ORG entity
  // nor raw proper-noun density. Some known org names (Microsoft, Activision,
  // Goldman Sachs) aren't caught by the multi-word ORG regex, so we also
  // count capitalized tokens that look like proper nouns and fall back to
  // the critical floor when the text reads like a real news-style deal.
  const bizOnlyMarkers = contextualMarkers.filter(m =>
    m.category === 'ma_deal' || m.category === 'financial_intel'
  );
  const hasDealCodename = contextualMarkers.some(m => m.sensitivityType === 'DEAL_CODENAME');
  // Count capitalized proper-noun-like tokens (2+ letters, not at sentence
  // start). Two or more such tokens in a deal-context prompt strongly
  // implies specific named parties that our regex simply missed.
  const properNounMatches = text.match(/(?<!^|\. |\.\s)\b[A-Z][a-z]{2,}\b/g) || [];
  const COMMON_SENTENCE_WORDS = new Set([
    'The','This','That','These','Those','According','Our','My','Their',
    'We','You','They','He','She','It','A','An','I','Confidential','Privileged',
    'Draft','Please','Help','What','When','Where','Why','How','Q1','Q2','Q3','Q4',
  ]);
  const properNounCount = properNounMatches.filter(w => !COMMON_SENTENCE_WORDS.has(w)).length;
  const looksLikeNamedDeal = properNounCount >= 3;
  const noNamedTarget = !hasNamedParty && !hasDealCodename && !looksLikeNamedDeal;
  const bizOnlyDominant = bizOnlyMarkers.length > 0 &&
    bizOnlyMarkers.length === contextualMarkers.length;
  let effectiveContextualKeywordScore = contextualKeywordScore;
  let bizOnlyAmberCap = false;
  if (noNamedTarget && bizOnlyDominant) {
    // Cap the base contextual keyword contribution so amplifiers can't
    // saturate the score, and record the flag so we can cap the final rawScore
    // at the amber upper bound below.
    effectiveContextualKeywordScore = Math.min(contextualKeywordScore, 45);
    bizOnlyAmberCap = true;
  }

  // ── Multiplicative Scoring with Diminishing Returns (v2.1 — M-17) ─────
  // Pure multiplication of many factors can saturate to 100 too quickly or
  // produce unexpected jumps. Apply diminishing returns: collect all
  // amplifying factors (> 1.0), sort descending, and apply each with
  // decreasing weight. Suppressive factors (< 1.0) are applied directly
  // since they reduce the score (no saturation risk).
  const baseScore = entityScore + volumeScore + contextScore + legalBoost + effectiveContextualKeywordScore + relationshipBoost + coOccurrenceBoost;

  const allMultipliers = [
    safeMultiplier(intentWeight),
    safeMultiplier(structureMultiplier),
    safeMultiplier(entityContextFactor),
    safeMultiplier(documentTypeMultiplier),
    safeMultiplier(coOccurrenceMultiplier),
    safeMultiplier(intentSuppMultiplier),
  ];

  // Separate amplifying (> 1.0) and suppressive (<= 1.0) multipliers
  const amplifying: number[] = [];
  let suppressiveProduct = 1.0;
  for (const m of allMultipliers) {
    if (m > 1.0) {
      amplifying.push(m);
    } else {
      suppressiveProduct *= m;
    }
  }

  // Apply amplifying multipliers with diminishing returns:
  // First factor at full strength, subsequent factors contribute less.
  // Each additional factor's BOOST (amount above 1.0) is dampened by 0.7^n.
  let amplifiedScore = baseScore;
  if (amplifying.length > 0) {
    // Sort descending so strongest amplifier gets full weight
    amplifying.sort((a, b) => b - a);
    let dampening = 1.0;
    for (const factor of amplifying) {
      const boost = factor - 1.0; // The amplification amount (e.g., 1.5 → 0.5)
      amplifiedScore += baseScore * boost * dampening;
      dampening *= 0.7; // Each subsequent factor is 70% as strong
    }
  }

  // Apply suppressive multipliers directly (they reduce score, no saturation risk)
  let rawScore = amplifiedScore * suppressiveProduct;

  // ── Self-Referential Score Ceiling ────────────────────────────────────
  // When intent suppression identified a self-referential task (resume, bio,
  // cover letter) AND suppressed all entities, cap the score at 20.
  // The user IS the data — "improve my resume" with employer names, email,
  // and salary numbers is not a data leak. Without this ceiling, entity
  // weights + volume + contextual keywords can push the score above 25 even
  // with the 0.1 multiplier, causing unnecessary pseudonymization.
  //
  // Safety: this ceiling does NOT apply when NEVER_SUPPRESS entity types
  // are present (SSN, credit card, credentials) — those are always protected.
  // Only apply ceiling when ALL entities were suppressed (full suppression).
  // Partial suppression means some entities are NOT safe (e.g. ACCOUNT_NUMBER
  // in a wire transfer that starts with "format this") — those must still
  // drive the score.
  const allEntitiesSuppressed = intentResult.suppressions.length > 0 &&
    intentResult.suppressions.length === entities.length;
  if (intentResult.isSelfReferential && allEntitiesSuppressed && !hasHighPII) {
    rawScore = Math.min(rawScore, SELF_REFERENTIAL_CEILING);
  }

  // Floor: contextual keywords ≥20 → minimum score of 30
  // If contextual keywords detect real business-sensitive content, never let the
  // score fall below "medium" territory regardless of entity suppression.
  // Exception: self-referential tasks where keywords describe work history.
  const selfRefFullSuppression = intentResult.isSelfReferential && allEntitiesSuppressed;
  if (contextualKeywordScore >= CONTEXTUAL_KEYWORD_MEDIUM_FLOOR_THRESHOLD && rawScore < CONTEXTUAL_KEYWORD_MEDIUM_FLOOR && !selfRefFullSuppression) {
    rawScore = CONTEXTUAL_KEYWORD_MEDIUM_FLOOR;
  }

  // Floor: contextual keywords ≥35 → minimum score of 50
  // Strong keyword signal (M&A, medical, legal) deserves solid medium rating
  // even when entity detection is weak.
  if (contextualKeywordScore >= CONTEXTUAL_KEYWORD_HIGH_FLOOR_THRESHOLD && rawScore < CONTEXTUAL_KEYWORD_HIGH_FLOOR && !selfRefFullSuppression) {
    rawScore = CONTEXTUAL_KEYWORD_HIGH_FLOOR;
  }

  // Apply critical floor — never let arithmetic under-rate existential risks.
  // Strong-fiction framing ("Write a novel scene where...") is the one narrow
  // exception: a fictional SSN in a clearly fictional passage shouldn't be
  // forced into the red zone by the always-critical floor. The entities are
  // still surfaced to the user in the side panel; only the score is relaxed.
  if (!intentResult.isStrongFiction) {
    rawScore = Math.max(rawScore, criticalFloor);
  } else {
    // Under strong fiction framing, cap at the green upper bound so the
    // prompt lands in green zone (≤25). Users still see the detected
    // entities in the side panel; only the score is relaxed.
    rawScore = Math.min(rawScore, 25);
  }

  // Apply the biz-only amber cap AFTER floors. Business-conf prompts without
  // a named target should not exceed the amber upper bound (60) even when
  // amplifying multipliers push them higher. This is the architectural
  // counterpart of the bizOnlyDominant check above: together they keep
  // "Confidential: acquiring a competitor for $2B" in AMBER instead of red.
  if (bizOnlyAmberCap) {
    rawScore = Math.min(rawScore, 60);
  }

  // Guard against NaN from multiplier chain — ALWAYS fail safe (high), never fail open (low)
  if (!Number.isFinite(rawScore)) {
    console.error('[Iron Gate] NaN detected in score chain — defaulting to HIGH (fail-safe)');
    rawScore = Math.max(criticalFloor, NAN_FAILSAFE_SCORE);
  }

  // Clamp to 0-100
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Determine level
  const level = scoreToLevel(score);

  // Generate explanation
  const contextualExplanation = explainContextualMarkers(contextualMarkers);
  const explanation = generateExplanation(score, level, contextualEntities, text, docClassification.type, contextualExplanation);

  // Derive contextCategory from intent classification + document type for ownership decisions.
  // Priority: specific intent > document type > general
  // 'casual_question' is the document classifier's default/fallback type.
  const contextCategory = intentClassification.confidence >= INTENT_CONFIDENCE_THRESHOLD && intentClassification.intent !== 'general'
    ? intentClassification.intent  // e.g., 'resume_review', 'code_review', 'research'
    : docClassification.confidence >= DOC_TYPE_CONFIDENCE_THRESHOLD && docClassification.type !== 'casual_question'
      ? docClassification.type       // e.g., 'litigation_doc', 'financial_data'
      : 'general';

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
      intentWeight,
      structureMultiplier,
    }),
    entities: contextualEntities,
    isSelfReferential: intentResult.isSelfReferential,
    documentType: docClassification.type,
    contextCategory,
  };

  // Freeze to prevent accidental mutation (e.g., result.score = X).
  // Callers that need a modified copy must use spread: { ...result, score: X }
  return Object.freeze(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY path: classifier is authoritative
// ─────────────────────────────────────────────────────────────────────────────
//
// When the local LLM has judged intent + context with confidence, its zone is
// the final answer. We still surface detected entities (so the side panel shows
// what WOULD be pseudonymized) but the score/level comes from the classifier.
//
// Safety escalation: HIGH_PII entities (SSN, credit card, credentials) cannot
// be soft-landed into green. If the classifier says green but a real-looking
// SSN is present, we escalate to RED — this is the bright-line safety net that
// no pattern heuristic can be relied upon to deliver.

const CLASSIFIER_INTENT_TO_CONTEXT: Record<string, string> = {
  research: 'research',
  creative: 'creative_writing',
  meta_discussion: 'policy_discussion',
  work_sharing: 'work_data_sharing',
  code: 'code_review',
  personal: 'self_referential',
  educational: 'educational',
  ambiguous: 'general',
};

function composeFromClassifier(
  text: string,
  entities: DetectedEntity[],
  ctx: IntentContextResult,
): SensitivityScore {
  // Let pattern-side entity contextualization still run for UI annotations
  // (credential / self_reference tags used by the side panel), but we do NOT
  // let it steer scoring — the classifier already decided.
  const contextAware = applyContextAwareDetection(text, entities);
  const contextualEntities = contextualizeEntities(text, contextAware.entities);

  const hasHighPII = contextualEntities.some((e) => HIGH_PII_TYPES.has(e.type));

  let score = ctx.score;
  let zone = ctx.zone;

  // SAFETY ESCALATION: HIGH_PII in a green/amber verdict is a hard override.
  // The classifier may misread fictional framing or "personal" intent, but
  // SSN/CC/credentials must ALWAYS be pseudonymized regardless of context.
  // Regex is the safety net — if it found HIGH_PII, we protect.
  if (hasHighPII && (zone === 'green' || zone === 'amber')) {
    zone = 'red';
    score = Math.max(score, SINGLE_CRITICAL_ENTITY_FLOOR);
  }

  const level = scoreToLevel(score);

  const reasoning = ctx.reasoning || `${ctx.intent} (${ctx.sensitivity})`;
  const explanation = hasHighPII && ctx.zone === 'green'
    ? `SAFETY OVERRIDE: classifier saw benign intent but HIGH_PII detected — escalating. (${reasoning})`
    : `[classifier] ${reasoning}`;

  const contextCategory = CLASSIFIER_INTENT_TO_CONTEXT[ctx.intent] ?? 'general';

  const result: SensitivityScore = {
    score,
    level,
    explanation,
    breakdown: Object.freeze({
      entityScore: 0,
      volumeScore: 0,
      contextScore: 0,
      legalBoost: 0,
      contextualKeywordScore: 0,
      documentTypeMultiplier: 1.0,
      intentWeight: 1.0,
      structureMultiplier: 1.0,
    }),
    entities: contextualEntities,
    // isSelfReferential preserved for UI/telemetry consumers (sidepanel, main-world).
    // A "personal" classifier intent is the direct analog of the old pattern flag.
    isSelfReferential: ctx.intent === 'personal',
    documentType: contextCategory,
    contextCategory,
  };

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
    // Scale by confidence (guard against NaN/undefined confidence)
    const confidence = Number.isFinite(entity.confidence) ? entity.confidence : 0.5;
    score += weight * confidence;
  }

  // Entity combination bonus: multiple different entity types = more risky
  const uniqueTypes = new Set(entities.map((e) => e.type));
  if (uniqueTypes.size >= 3) {
    score *= TYPE_COMBO_BONUS_3PLUS;
  } else if (uniqueTypes.size >= 2) {
    score *= TYPE_COMBO_BONUS_2;
  }

  // Count bonus: many entities = document was likely pasted
  if (entities.length >= 10) {
    score *= COUNT_BONUS_10PLUS;
  } else if (entities.length >= 5) {
    score *= COUNT_BONUS_5PLUS;
  }

  return Math.min(ENTITY_SCORE_CAP, score);
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
    const surroundingStart = Math.max(0, entity.start - ENTITY_CONTEXT_WINDOW);
    const surroundingEnd = Math.min(text.length, entity.end + ENTITY_CONTEXT_WINDOW);
    const surrounding = lowerText.substring(surroundingStart, surroundingEnd);

    for (const keyword of LEGAL_KEYWORDS) {
      if (surrounding.includes(keyword)) {
        score += 5;
        break; // Only count once per entity
      }
    }
  }

  return Math.min(CONTEXT_SCORE_CAP, score);
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

  return Math.min(LEGAL_BOOST_CAP, boost);
}

export function scoreToLevel(score: number): SensitivityLevel {
  if (score <= 25) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 85) return 'high';
  return 'critical';
}

// ── Human-readable explanation templates ────────────────────────────────────
// Map entity types to plain English descriptions users can understand.
const ENTITY_LABELS: Record<string, string> = {
  PERSON: 'a person\'s name',
  ORGANIZATION: 'an organization name',
  SSN: 'a Social Security number',
  CREDIT_CARD: 'a credit card number',
  API_KEY: 'an API key or secret',
  EMAIL: 'an email address',
  PHONE: 'a phone number',
  DATE_OF_BIRTH: 'a date of birth',
  DRIVERS_LICENSE: 'a driver\'s license number',
  PASSPORT: 'a passport number',
  BANK_ACCOUNT: 'a bank account number',
  MEDICAL_RECORD: 'a medical record identifier',
  STUDENT_ID: 'a student identifier',
  EDUCATION_RECORD: 'an education record',
  LOCATION: 'a specific location',
  IP_ADDRESS: 'an IP address',
  AWS_KEY: 'an AWS credential',
  PRIVATE_KEY: 'a private key',
  DATABASE_URI: 'a database connection string',
  AMOUNT: 'a financial amount',
};

const CONTEXT_LABELS: Record<string, string> = {
  ma_activity: 'merger & acquisition language',
  deal_terms: 'deal terms or pricing',
  financial_results: 'non-public financial results',
  hr_sensitive: 'HR-sensitive content',
  legal_privilege: 'attorney-client privileged content',
  medical_clinical: 'medical or clinical information',
  insider_trading: 'potential insider trading signals',
  board_governance: 'board-level governance discussion',
  regulatory_filing: 'pre-public regulatory filing content',
  compensation: 'compensation or benefits details',
};

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
  const typeGroups = new Map<string, number>();
  for (const entity of entities) {
    typeGroups.set(entity.type, (typeGroups.get(entity.type) || 0) + 1);
  }
  const entityTypes = new Set(typeGroups.keys());

  // ── Human-readable co-occurrence explanations ──
  // These tell the user WHY the combination is risky, not just what was found.
  const hasPerson = entityTypes.has('PERSON');
  const hasOrg = entityTypes.has('ORGANIZATION');
  const lowerText = text.toLowerCase();
  const hasMAKeywords = /\b(acqui|merger|takeover|buyout|tender offer|due diligence)\b/i.test(text);
  const hasMedicalKeywords = /\b(diagnosis|patient|treatment|medical|prescription|hipaa)\b/i.test(text);
  const hasFinancialKeywords = /\b(revenue|ebitda|earnings|valuation|ipo|quarterly)\b/i.test(text);
  const hasLegalPrivilege = PRIVILEGE_MARKERS.some((m) => lowerText.includes(m));

  let usedCoOccurrence = false;
  if (hasPerson && hasMAKeywords) {
    parts.push('This prompt contains a person\'s name alongside M&A language \u2014 this may be material non-public information (MNPI)');
    usedCoOccurrence = true;
  } else if (hasPerson && hasMedicalKeywords) {
    parts.push('This prompt links a named individual to medical information \u2014 this may be protected health information (PHI)');
    usedCoOccurrence = true;
  } else if (hasOrg && hasFinancialKeywords) {
    parts.push('This prompt mentions an organization alongside non-public financial details');
    usedCoOccurrence = true;
  } else if (hasPerson && hasLegalPrivilege) {
    parts.push('This prompt contains names within attorney-client privileged content');
    usedCoOccurrence = true;
  }

  // ── Entity summary (if no co-occurrence matched) ──
  if (!usedCoOccurrence && entities.length > 0) {
    const labels = Array.from(typeGroups.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => {
        const label = ENTITY_LABELS[type] || (type ?? '').toLowerCase().replace(/_/g, ' ');
        return count > 1 ? `${count} ${label}${label.endsWith('s') ? '' : 's'}` : label;
      });
    parts.push(`This prompt contains ${labels.join(', ')}`);
  }

  // ── Privilege markers (standalone, even without co-occurrence) ──
  if (hasLegalPrivilege && !usedCoOccurrence) {
    parts.push('Content appears to contain attorney-client privileged material');
  }

  // ── Document type context ──
  const docTypeLabels: Record<string, string> = {
    litigation_doc: 'Content appears to be from a litigation document',
    contract_clause: 'Content appears to be from a contract or legal agreement',
    financial_data: 'Content appears to contain financial data',
    client_memo: 'Content appears to be from a client memo',
    meeting_notes: 'Content appears to be from meeting notes',
    insurance_doc: 'Content appears to be from an insurance document',
    medical_record: 'Content appears to be from a medical record (HIPAA-protected)',
    government_doc: 'Content appears to be from a government document',
    energy_report: 'Content appears to be from an energy/resources report',
    real_estate_doc: 'Content appears to be from a real estate document',
    education_record: 'Content appears to be from an education record (FERPA-protected)',
  };
  if (documentType && docTypeLabels[documentType]) {
    parts.push(docTypeLabels[documentType]);
  }

  // ── Contextual keyword explanation ──
  if (contextualExplanation) {
    parts.push(contextualExplanation);
  }

  // ── Volume warning ──
  if (text.length > VOLUME_THRESHOLDS.LONG) {
    parts.push('The large text volume suggests a pasted document');
  }

  // ── Action guidance based on level ──
  if (level === 'critical') {
    parts.push('Iron Gate has pseudonymized this content to protect sensitive data');
  } else if (level === 'high') {
    parts.push('Consider reviewing before sending to an AI tool');
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
