/**
 * Context-Aware Detection — Priority 7
 *
 * Enhances entity detection with:
 * 1. Co-occurrence rules — entities appearing together amplify sensitivity
 * 2. Context window analysis — classify surrounding text for confidence adjustment
 * 3. Code-awareness — suppress false positives in code contexts
 */

import type { DetectedEntity } from '../detection/types';

// ─── 7.1 Co-Occurrence Rules ────────────────────────────────────────────────

export interface CoOccurrenceResult {
  /** Adjusted entities with modified confidence */
  entities: DetectedEntity[];
  /** Score multiplier to apply (>1.0 = more sensitive) */
  scoreMultiplier: number;
  /** Human-readable explanations for adjustments */
  explanations: string[];
}

/** Entity types that are ALWAYS critical regardless of context */
const ALWAYS_CRITICAL_TYPES = new Set([
  'API_KEY', 'PRIVATE_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI',
]);

/** High-PII entity types that escalate when near a PERSON */
const HIGH_PII_TYPES = new Set([
  'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
]);

/**
 * Apply co-occurrence rules to detected entities.
 * Entities appearing together get confidence and score adjustments.
 */
export function applyCoOccurrenceRules(
  text: string,
  entities: DetectedEntity[],
  config?: {
    proximityWindow?: number;
    personPiiMultiplier?: number;
    isolatedPersonReduction?: number;
  }
): CoOccurrenceResult {
  const proximityWindow = config?.proximityWindow ?? 200;
  const personPiiMultiplier = config?.personPiiMultiplier ?? 1.5;
  const isolatedPersonReduction = config?.isolatedPersonReduction ?? 0.6;

  const adjusted = entities.map((e) => ({ ...e }));
  const explanations: string[] = [];
  let scoreMultiplier = 1.0;

  // Rule 1: PERSON near SSN/CREDIT_CARD/MEDICAL_RECORD → escalate both
  const persons = adjusted.filter((e) => e.type === 'PERSON');
  const highPii = adjusted.filter((e) => HIGH_PII_TYPES.has(e.type));

  for (const person of persons) {
    let nearHighPii = false;
    for (const pii of highPii) {
      const distance = Math.abs(person.start - pii.start);
      if (distance <= proximityWindow) {
        person.confidence = Math.min(1.0, 0.95);
        pii.confidence = Math.min(1.0, 0.95);
        nearHighPii = true;
        explanations.push(
          `PERSON "${person.text}" near ${pii.type} — both escalated to 0.95 confidence`
        );
      }
    }

    // Rule 2: Isolated PERSON (no other PII nearby) → reduce score impact
    if (!nearHighPii && adjusted.filter((e) => e !== person && e.type !== 'PERSON').length === 0) {
      scoreMultiplier *= isolatedPersonReduction;
      explanations.push(`Isolated PERSON "${person.text}" — score reduced by ${isolatedPersonReduction}x`);
    }
  }

  // Rule 3: PERSON + HIGH_PII in proximity → apply multiplier
  if (persons.length > 0 && highPii.length > 0) {
    for (const person of persons) {
      for (const pii of highPii) {
        if (Math.abs(person.start - pii.start) <= proximityWindow) {
          scoreMultiplier = Math.max(scoreMultiplier, personPiiMultiplier);
        }
      }
    }
  }

  // Rule 4: ALWAYS_CRITICAL types — never reduce
  for (const e of adjusted) {
    if (ALWAYS_CRITICAL_TYPES.has(e.type)) {
      e.confidence = Math.max(e.confidence, 0.95);
    }
  }

  return { entities: adjusted, scoreMultiplier, explanations };
}

// ─── 7.2 Context Window Analysis ────────────────────────────────────────────

export type ContextCategory = 'casual' | 'data_record' | 'code' | 'legal';

export interface ContextWindowResult {
  category: ContextCategory;
  confidence: number;
  /** Confidence adjustment factor (0.4 = reduce by 60%, 1.2 = boost by 20%) */
  adjustmentFactor: number;
}

const CASUAL_KEYWORDS = [
  'hi', 'hey', 'hello', 'thanks', 'dear', 'meeting', 'lunch', 'schedule',
  'call', 'chat', 'let me know', 'sounds good', 'happy birthday',
];

const LEGAL_KEYWORDS = [
  'privileged', 'attorney-client', 'work product', 'under seal',
  'protective order', 'settlement', 'deposition', 'subpoena',
  'discovery', 'litigation', 'plaintiff', 'defendant', 'counsel',
];

const CODE_INDICATORS = [
  /\bfunction\s+\w+/, /\bconst\s+\w+\s*=/, /\blet\s+\w+\s*=/,
  /\bimport\s+/, /\bexport\s+/, /\bclass\s+\w+/,
  /[{}\[\]();].*[{}\[\]();]/, /=>\s*{/, /\breturn\s+/,
];

const DATA_RECORD_INDICATORS = [
  /\b(name|ssn|dob|account|id|mrn)\s*[:=]/i,
  /\b\d{3}-\d{2}-\d{4}\b/, /\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/,
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\s*[,(]/, // "John Smith," or "John Smith ("
];

/**
 * Classify the context window around an entity.
 * Returns the category and a confidence adjustment factor.
 */
export function classifyContext(text: string, entity: DetectedEntity): ContextWindowResult {
  const windowStart = Math.max(0, entity.start - 100);
  const windowEnd = Math.min(text.length, entity.end + 100);
  const window = text.substring(windowStart, windowEnd).toLowerCase();

  let casualScore = 0;
  let legalScore = 0;
  let codeScore = 0;
  let dataRecordScore = 0;

  // Check casual indicators
  for (const kw of CASUAL_KEYWORDS) {
    if (window.includes(kw)) casualScore += 2;
  }

  // Check legal indicators
  for (const kw of LEGAL_KEYWORDS) {
    if (window.includes(kw)) legalScore += 3;
  }

  // Check code indicators
  for (const pattern of CODE_INDICATORS) {
    if (pattern.test(window)) codeScore += 2;
  }

  // Check data record indicators
  const fullWindow = text.substring(windowStart, windowEnd);
  for (const pattern of DATA_RECORD_INDICATORS) {
    if (pattern.test(fullWindow)) dataRecordScore += 3;
  }

  // Determine category
  const scores: [ContextCategory, number][] = [
    ['casual', casualScore],
    ['legal', legalScore],
    ['code', codeScore],
    ['data_record', dataRecordScore],
  ];

  scores.sort((a, b) => b[1] - a[1]);
  const [category, score] = scores[0];

  if (score === 0) {
    return { category: 'data_record', confidence: 0.3, adjustmentFactor: 1.0 };
  }

  const maxPossible = 12;
  const confidence = Math.min(1.0, score / maxPossible);

  const adjustmentFactors: Record<ContextCategory, number> = {
    casual: 0.6,       // 40% confidence reduction
    code: 0.4,         // 60% confidence reduction
    legal: 1.2,        // 20% confidence boost
    data_record: 1.0,  // No change
  };

  return {
    category,
    confidence,
    adjustmentFactor: adjustmentFactors[category],
  };
}

/**
 * Apply context window analysis to all entities.
 * Returns adjusted entities with modified confidence.
 */
export function applyContextAnalysis(
  text: string,
  entities: DetectedEntity[]
): DetectedEntity[] {
  return entities.map((entity) => {
    // Skip always-critical types
    if (ALWAYS_CRITICAL_TYPES.has(entity.type)) return entity;

    const context = classifyContext(text, entity);

    // Only apply adjustment if context confidence is meaningful
    if (context.confidence < 0.3) return entity;

    const adjustedConfidence = Math.max(0.1, Math.min(1.0,
      entity.confidence * context.adjustmentFactor
    ));

    return { ...entity, confidence: adjustedConfidence };
  });
}

// ─── 7.3 Code Awareness ────────────────────────────────────────────────────

/**
 * Detect whether text is primarily code.
 */
export function isCodeContext(text: string): boolean {
  const indicators = [
    /\bfunction\b/g,
    /\bimport\s+/g,
    /\bexport\s+/g,
    /\bconst\s+\w+\s*=/g,
    /\blet\s+\w+\s*=/g,
    /\bvar\s+\w+\s*=/g,
    /\bclass\s+\w+/g,
    /\breturn\s+/g,
    /=>\s*[{(]/g,
  ];

  let matches = 0;
  for (const pattern of indicators) {
    const found = text.match(pattern);
    if (found) matches += found.length;
  }

  // Density check: curly braces and semicolons
  const braces = (text.match(/[{}]/g) || []).length;
  const semicolons = (text.match(/;/g) || []).length;
  const lines = text.split('\n').length;
  const density = (braces + semicolons) / Math.max(1, lines);

  return matches >= 3 || density > 0.5;
}

/** camelCase or snake_case identifier pattern */
const IDENTIFIER_PATTERN = /^[a-z][a-zA-Z0-9]*$|^[a-z][a-z0-9_]*[a-z0-9]$/;

/** Common test/localhost IPs to suppress */
const SUPPRESS_IPS = new Set([
  '127.0.0.1', '0.0.0.0', '255.255.255.255',
  '192.168.0.1', '192.168.1.1', '10.0.0.1',
]);

/** Placeholder email domains to suppress */
const SUPPRESS_EMAIL_DOMAINS = new Set([
  'example.com', 'test.com', 'localhost', 'example.org',
  'test.org', 'foo.com', 'bar.com', 'example.net',
]);

/**
 * Suppress false positive entities in code contexts.
 * Returns filtered entities with code-context false positives removed.
 */
export function suppressCodeFalsePositives(
  text: string,
  entities: DetectedEntity[]
): DetectedEntity[] {
  if (!isCodeContext(text)) return entities;

  return entities.filter((entity) => {
    // Never suppress critical types
    if (ALWAYS_CRITICAL_TYPES.has(entity.type)) return true;

    // Suppress PERSON detections on camelCase/snake_case identifiers
    if (entity.type === 'PERSON') {
      const trimmed = entity.text.trim();
      if (IDENTIFIER_PATTERN.test(trimmed)) return false;
      // Suppress single-word "names" that look like variable names
      if (!trimmed.includes(' ') && trimmed.length < 15) return false;
    }

    // Suppress IP_ADDRESS on localhost/test IPs
    if (entity.type === 'IP_ADDRESS') {
      const ip = entity.text.trim();
      if (SUPPRESS_IPS.has(ip)) return false;
      // Suppress 192.168.x.x and 10.x.x.x ranges
      if (ip.startsWith('192.168.') || ip.startsWith('10.')) return false;
    }

    // Suppress EMAIL on placeholder domains
    if (entity.type === 'EMAIL') {
      const domain = entity.text.split('@')[1]?.toLowerCase();
      if (domain && SUPPRESS_EMAIL_DOMAINS.has(domain)) return false;
    }

    return true;
  });
}

// ─── Combined Pipeline ──────────────────────────────────────────────────────

export interface ContextAwareResult {
  entities: DetectedEntity[];
  scoreMultiplier: number;
  explanations: string[];
}

/**
 * Full context-aware detection pipeline:
 * 1. Suppress code false positives
 * 2. Apply context window analysis
 * 3. Apply co-occurrence rules
 */
export function applyContextAwareDetection(
  text: string,
  entities: DetectedEntity[],
  config?: {
    proximityWindow?: number;
    personPiiMultiplier?: number;
    isolatedPersonReduction?: number;
  }
): ContextAwareResult {
  // Step 1: Remove code false positives
  const filtered = suppressCodeFalsePositives(text, entities);

  // Step 2: Apply context window analysis
  const contextAdjusted = applyContextAnalysis(text, filtered);

  // Step 3: Apply co-occurrence rules
  const coOccurrence = applyCoOccurrenceRules(text, contextAdjusted, config);

  return {
    entities: coOccurrence.entities,
    scoreMultiplier: coOccurrence.scoreMultiplier,
    explanations: coOccurrence.explanations,
  };
}
