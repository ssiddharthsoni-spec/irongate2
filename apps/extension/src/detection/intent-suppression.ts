/**
 * Intent-Aware Suppression
 *
 * Detects when PII entities are the SUBJECT of the user's task (intentional use)
 * vs. incidental data leakage. When PII is intentional, we suppress or reduce
 * its contribution to the sensitivity score.
 *
 * Examples of intentional PII use:
 * - "Create a horoscope for March 15, 1990" → DOB is the purpose
 * - "Do competitive research on Acme Corp" → org name is the task
 * - "Write a birthday card for John" → name is needed
 * - "What's the weather in San Francisco?" → location is the query
 * - "My name is Sarah and I need help with..." → self-intro, not a data record
 *
 * Examples where PII should STILL be protected:
 * - "Patient DOB: 03/15/1990, SSN: 123-45-6789" → data record
 * - "John Smith's salary is $250k" → HR data leak
 * - "Sullivan & Cromwell is acquiring TargetCo for $2B" → M&A MNPI
 */

import type { DetectedEntity } from './types';
import { HIGH_PII_TYPES, ALWAYS_CRITICAL_TYPES } from './types';

export interface IntentSuppressionResult {
  /** Entities with suppressed ones removed or confidence-reduced */
  entities: DetectedEntity[];
  /** Score multiplier (< 1.0 means suppress) */
  scoreMultiplier: number;
  /** Which entities were suppressed and why */
  suppressions: IntentSuppression[];
}

export interface IntentSuppression {
  entity: DetectedEntity;
  reason: string;
  pattern: string;
}

// ─── Benign Intent Patterns ──────────────────────────────────────────────────
// Each pattern: regex that matches the PROMPT context, plus which entity types
// it makes safe to pass through.

interface BenignIntentPattern {
  /** Name for debugging */
  name: string;
  /** Regex that matches the overall prompt */
  pattern: RegExp;
  /** Entity types that are safe when this pattern matches */
  safeTypes: Set<string>;
  /** Only suppress if the entity appears WITHIN or NEAR the pattern match */
  requireProximity?: boolean;
}

const BENIGN_INTENT_PATTERNS: BenignIntentPattern[] = [
  // ── Personal/Creative Tasks ────────────────────────────────────────────
  {
    name: 'horoscope_request',
    pattern: /\b(?:horoscope|zodiac|astrology|birth\s*chart|natal\s*chart|star\s*sign|sun\s*sign|moon\s*sign|rising\s*sign)\b/i,
    safeTypes: new Set(['DATE', 'LOCATION']),
  },
  {
    name: 'birthday_task',
    pattern: /\b(?:birthday\s*(?:card|message|wish|party|gift|plan|invitation)|happy\s*birthday|born\s*on|celebrate\s*(?:my|their|his|her))\b/i,
    safeTypes: new Set(['DATE', 'PERSON']),
  },
  {
    name: 'self_introduction',
    pattern: /\b(?:my\s+name\s+is|I'?m\s+called|I\s+am\s+called|call\s+me|I\s+go\s+by)\b/i,
    safeTypes: new Set(['PERSON']),
  },
  {
    name: 'personal_bio',
    pattern: /\b(?:write\s+(?:a\s+)?(?:bio|about\s+me|my\s+(?:resume|cv|cover\s+letter|linkedin|profile))|help\s+(?:me\s+)?(?:with\s+)?my\s+(?:resume|cv|cover\s+letter|linkedin|profile))\b/i,
    safeTypes: new Set(['PERSON', 'EMAIL', 'PHONE_NUMBER', 'LOCATION', 'ORGANIZATION', 'DATE']),
  },
  {
    name: 'personal_health',
    pattern: /\b(?:(?:my|I)\s+(?:have|had|got|was\s+diagnosed|am\s+experiencing)|symptoms?\s+(?:I|for\s+me)|what\s+(?:should|can)\s+I\s+(?:do|take|eat|avoid))\b/i,
    safeTypes: new Set(['DATE', 'PERSON']),
  },

  // ── Research / Lookup Tasks ────────────────────────────────────────────
  {
    name: 'competitive_research',
    pattern: /\b(?:(?:competitive|competitor|market|industry)\s+(?:research|analysis|intelligence|comparison|landscape|overview)|research\s+(?:on|about|into)\s+(?:the\s+)?(?:company|competitor|market|industry))\b/i,
    safeTypes: new Set(['ORGANIZATION', 'PERSON', 'LOCATION']),
  },
  {
    name: 'company_lookup',
    pattern: /\b(?:(?:tell|know|learn|read)\s+(?:me\s+)?(?:about|more\s+about)|what\s+(?:is|are|does|do)\s+(?:you\s+know\s+about\s+)?|(?:look\s*up|search\s+for|find\s+(?:info|information)\s+(?:on|about))|who\s+(?:is|are|was|were))\b/i,
    safeTypes: new Set(['ORGANIZATION', 'PERSON', 'LOCATION']),
  },
  {
    name: 'weather_location',
    pattern: /\b(?:weather|temperature|forecast|rain|snow|sunny|cloudy|humidity)\b/i,
    safeTypes: new Set(['LOCATION']),
  },
  {
    name: 'travel_planning',
    pattern: /\b(?:(?:plan|planning|book|booking)\s+(?:a\s+)?(?:trip|travel|vacation|flight|hotel)|things\s+to\s+do\s+in|visit(?:ing)?\s+(?:in\s+)?(?:the\s+)?|restaurants?\s+(?:in|near|around)|directions?\s+(?:to|from))\b/i,
    safeTypes: new Set(['LOCATION', 'DATE', 'PERSON']),
  },
  {
    name: 'event_planning',
    pattern: /\b(?:(?:plan|planning|organize|schedule)\s+(?:a\s+)?(?:meeting|event|dinner|lunch|party|conference|wedding)|(?:invite|invitation)\s+(?:for|to)\b)/i,
    safeTypes: new Set(['PERSON', 'DATE', 'LOCATION', 'EMAIL']),
  },
  {
    name: 'public_figure_research',
    pattern: /\b(?:(?:biography|history|career|achievements?|accomplishments?)\s+(?:of|about)|(?:CEO|founder|president|author|actor|politician)\s+(?:of|at))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE']),
  },

  // ── Communication Tasks ────────────────────────────────────────────────
  {
    name: 'write_email_to',
    pattern: /\b(?:write|draft|compose|send)\s+(?:a\s+)?(?:email|message|letter|note|text)\s+(?:to|for)\b/i,
    safeTypes: new Set(['PERSON', 'EMAIL']),
  },
  {
    name: 'contact_lookup',
    pattern: /\b(?:(?:what\s+is|what's)\s+(?:the\s+)?(?:email|phone|number|address)\s+(?:for|of)|(?:contact|reach|get\s+in\s+touch\s+with))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION']),
  },

  // ── Educational / Generic Queries ──────────────────────────────────────
  {
    name: 'definition_query',
    pattern: /\b(?:what\s+(?:is|are|does|do)\s+(?:a\s+)?|define\s+|explain\s+(?:what\s+)?|meaning\s+of)\b/i,
    safeTypes: new Set(['ORGANIZATION', 'LOCATION', 'PERSON']),
  },
  {
    name: 'how_to_query',
    pattern: /\b(?:how\s+(?:do|can|should|to|would)\s+(?:I|we|you)|steps?\s+(?:to|for)|tutorial|guide\s+(?:for|to|on))\b/i,
    safeTypes: new Set(['ORGANIZATION', 'LOCATION']),
  },
];

// ─── First-Person Possessive Patterns ────────────────────────────────────────
// "My DOB is...", "I was born on...", "my email is..." — the user is
// volunteering their own info for the task. Different from "Patient DOB: ..."

const FIRST_PERSON_PATTERNS: RegExp[] = [
  /\b(?:my|I'?m|I\s+am|I\s+was\s+born|I\s+live|I\s+work)\b/i,
];

// ─── Entity types that should NEVER be suppressed regardless of intent ──────
// These are too dangerous to pass through even if the user "intends" to share them.

const NEVER_SUPPRESS_TYPES = new Set([
  'SSN',
  'CREDIT_CARD',
  'ACCOUNT_NUMBER',
  'PASSPORT_NUMBER',
  'DRIVERS_LICENSE',
  'MEDICAL_RECORD',
  'API_KEY',
  'AWS_CREDENTIAL',
  'GCP_CREDENTIAL',
  'DATABASE_URI',
  'AUTH_TOKEN',
  'PRIVATE_KEY',
  'CLASSIFICATION_MARKING',
  'CUI_MARKING',
  'UK_NINO',
  'CANADIAN_SIN',
  'INDIAN_AADHAAR',
  'AUSTRALIAN_TFN',
  'GERMAN_TAX_ID',
  'FRENCH_INSEE',
]);

/**
 * Detect benign intent and suppress entities that are the PURPOSE of the task.
 *
 * This runs BEFORE scoring. Entities that are suppressed get their confidence
 * reduced (not removed entirely) so they still show up in the side panel
 * for user awareness, but don't inflate the sensitivity score.
 *
 * IMPORTANT safety guards:
 * - Only applies to SHORT prompts (≤500 chars) — long text is likely data dumps
 * - Benign intent patterns must appear in the FIRST 150 chars of the prompt
 * - First-person must appear in the first sentence
 * - Multiple entities (≥4) = likely a data record, not a casual query
 */
export function applyIntentSuppression(
  text: string,
  entities: DetectedEntity[],
): IntentSuppressionResult {
  if (entities.length === 0) {
    return { entities, scoreMultiplier: 1.0, suppressions: [] };
  }

  // GUARD 1: Long texts are likely data dumps / documents, not casual queries.
  // Intent suppression is for "create a horoscope for March 15" not for
  // multi-paragraph legal memos that happen to contain "what is".
  if (text.length > 500) {
    return { entities, scoreMultiplier: 1.0, suppressions: [] };
  }

  // GUARD 2: Many entities = structured data record, not a casual question.
  // "Who is Elon Musk?" has 1 entity. A DSAR with 8 entities is a data dump.
  if (entities.length >= 4) {
    return { entities, scoreMultiplier: 1.0, suppressions: [] };
  }

  const suppressions: IntentSuppression[] = [];
  const matchedPatterns: BenignIntentPattern[] = [];

  // Only check the opening portion of the prompt for benign intent.
  // A "what is" buried in paragraph 5 of a legal doc shouldn't suppress anything.
  const opening = text.substring(0, 150);

  // Find matching benign intent patterns IN THE OPENING
  for (const bip of BENIGN_INTENT_PATTERNS) {
    bip.pattern.lastIndex = 0;
    if (bip.pattern.test(opening)) {
      matchedPatterns.push(bip);
    }
  }

  // Check for first-person context IN THE FIRST SENTENCE only
  const firstSentence = text.substring(0, Math.min(text.length, text.indexOf('.') > 0 ? text.indexOf('.') + 1 : 150));
  const isFirstPerson = FIRST_PERSON_PATTERNS.some(p => p.test(firstSentence));

  if (matchedPatterns.length === 0 && !isFirstPerson) {
    return { entities, scoreMultiplier: 1.0, suppressions: [] };
  }

  // Build the set of safe entity types from all matched patterns
  const safeTypes = new Set<string>();
  for (const mp of matchedPatterns) {
    for (const t of mp.safeTypes) {
      safeTypes.add(t);
    }
  }

  // First-person context makes PERSON, DATE, LOCATION, EMAIL safer
  if (isFirstPerson) {
    safeTypes.add('PERSON');
    safeTypes.add('DATE');
    safeTypes.add('LOCATION');
    safeTypes.add('EMAIL');
  }

  // Process each entity
  const adjusted = entities.map(entity => {
    // NEVER suppress critical/dangerous types
    if (NEVER_SUPPRESS_TYPES.has(entity.type)) {
      return entity;
    }

    // Check if this entity type is safe given the detected intent
    if (safeTypes.has(entity.type)) {
      // Additional safety: don't suppress if there are ALSO dangerous
      // context markers (legal keywords, data record patterns, etc.)
      if (hasDataRecordContext(text, entity)) {
        return entity; // Keep it — looks like a data record despite benign intent
      }

      suppressions.push({
        entity,
        reason: `Entity appears to be intentional (${matchedPatterns.map(p => p.name).join(', ')}${isFirstPerson ? ', first_person' : ''})`,
        pattern: matchedPatterns[0]?.name || 'first_person',
      });

      // Reduce confidence rather than removing — user still sees it in side panel
      return {
        ...entity,
        confidence: Math.min(entity.confidence, 0.2),
      };
    }

    return entity;
  });

  // Calculate score multiplier based on how many entities were suppressed
  const suppressedCount = suppressions.length;
  const totalCount = entities.length;

  let scoreMultiplier = 1.0;
  if (suppressedCount > 0 && suppressedCount === totalCount) {
    // ALL entities are benign intent → strong suppression
    scoreMultiplier = 0.3;
  } else if (suppressedCount > 0) {
    // Some entities suppressed, some remain → moderate reduction
    scoreMultiplier = 0.6;
  }

  return { entities: adjusted, scoreMultiplier, suppressions };
}

/**
 * Check if the entity appears in a data-record context that overrides
 * benign intent. Even if the prompt says "look up", structured data
 * like "DOB: 03/15/1990, SSN: 123-45-6789" should still be protected.
 */
function hasDataRecordContext(text: string, entity: DetectedEntity): boolean {
  // Look at 60 chars before the entity for record-like patterns
  const contextStart = Math.max(0, entity.start - 60);
  const contextEnd = Math.min(text.length, entity.end + 60);
  const context = text.substring(contextStart, contextEnd);

  const DATA_RECORD_SIGNALS = [
    /\b(?:name|ssn|dob|mrn|account|id|patient|employee|client)\s*[:=]/i,
    /\b(?:date\s+of\s+birth|social\s+security|medical\s+record)\s*[:=]?\s*$/i,
    /\b(?:record|file|case)\s*#?\s*[:=]/i,
    // Multiple PII fields in close proximity (tabular/form data)
    /\b(?:name|address|phone|email|dob)\b.*?\b(?:name|address|phone|email|dob)\b/i,
  ];

  return DATA_RECORD_SIGNALS.some(p => p.test(context));
}
