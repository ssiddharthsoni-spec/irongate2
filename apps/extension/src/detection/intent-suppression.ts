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
  /**
   * True when the user IS the data (resume, bio, cover letter, formatting).
   * These tasks naturally contain many entities and contextual keywords
   * (e.g. "managed $2M revenue at Acme Corp") that describe past work
   * experience, NOT active deals or MNPI. The scorer must not let safety
   * overrides (contextualKeywordScore ≥ 15) force the multiplier back to 1.0.
   */
  isSelfReferential: boolean;
  /**
   * True when the prompt opens with unambiguous "novel scene / story where /
   * for my novel" style fiction framing. When set, the scorer bypasses the
   * always-critical entity floor: a fictional SSN in a clearly fictional
   * scene should not force the prompt into the red zone.
   * Individual entities are still surfaced to the user; only the score
   * ceiling is relaxed.
   */
  isStrongFiction?: boolean;
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

// Patterns where the user is sharing THEIR OWN content for a task.
// Resumes, bios, cover letters, formatting tasks, etc. naturally contain
// many entities (employer, clients, email, locations) and are longer than
// casual queries. These get relaxed length/entity guards because the data
// is inherently the user's own — unlike a data record or DSAR.
// NOTE: 'summarization_task' was intentionally EXCLUDED. Summarizing applies
// to ANY content — a Slack thread of MNPI, a legal memo, financial data.
// Unlike a resume (where the user IS the data), summarization doesn't imply
// the content is the user's own. Same for 'translation_task' — translating
// a confidential document is still confidential.
const SELF_REFERENTIAL_PATTERNS = new Set([
  'personal_bio',
  'resume_improvement',
  'formatting_task',
  'creative_writing',
  'template_draft',
]);

const BENIGN_INTENT_PATTERNS: BenignIntentPattern[] = [
  // ── Personal/Creative Tasks ────────────────────────────────────────────
  {
    name: 'horoscope_request',
    pattern: /\b(?:horoscope|zodiac|astrology|birth\s*chart|natal\s*chart|star\s*sign|sun\s*sign|moon\s*sign|rising\s*sign|kundli|vedic)\b/i,
    safeTypes: new Set(['DATE', 'DATE_OF_BIRTH', 'LOCATION', 'PERSON']),
  },
  {
    name: 'birthday_task',
    pattern: /\b(?:birthday\s*(?:card|message|wish|party|gift|plan|invitation)|happy\s*birthday|born\s*on|celebrate\s*(?:my|their|his|her))\b/i,
    safeTypes: new Set(['DATE', 'DATE_OF_BIRTH', 'PERSON']),
  },
  {
    name: 'self_introduction',
    pattern: /\b(?:my\s+name\s+is|I'?m\s+called|I\s+am\s+called|call\s+me|I\s+go\s+by)\b/i,
    safeTypes: new Set(['PERSON']),
  },
  {
    name: 'personal_bio',
    pattern: /\b(?:write\s+(?:a\s+)?(?:bio|about\s+me|my\s+(?:resume|cv|cover\s+letter|linkedin|profile))|help\s+(?:me\s+)?(?:with\s+)?my\s+(?:resume|cv|cover\s+letter|linkedin|profile))\b/i,
    safeTypes: new Set(['PERSON', 'EMAIL', 'PHONE_NUMBER', 'LOCATION', 'ORGANIZATION', 'DATE', 'MONETARY_AMOUNT']),
  },
  {
    name: 'resume_improvement',
    pattern: /\b(?:(?:improve|update|edit|rewrite|polish|enhance|revise|fix|rework|critique|review|feedback\s+on|can\s+you\s+(?:improve|help|fix|review|rewrite))\s+(?:my\s+|this\s+|the\s+)?(?:resume|cv|cover\s+letter|linkedin\s+(?:profile)?|bio|portfolio)|(?:resume|cv|cover\s+letter)\s+(?:review|feedback|improvement|help|advice|tips?))\b/i,
    safeTypes: new Set(['PERSON', 'EMAIL', 'PHONE_NUMBER', 'LOCATION', 'ORGANIZATION', 'DATE', 'MONETARY_AMOUNT']),
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

  // ── Formatting / Editing Tasks ──────────────────────────────────────────
  {
    name: 'formatting_task',
    pattern: /\b(?:format|reformat|restructure|reorganize|clean\s+up|fix\s+(?:the\s+)?(?:formatting|grammar|spelling|punctuation|typos?)|proofread|make\s+(?:this|it)\s+(?:look|sound)\s+(?:better|professional|cleaner))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE', 'EMAIL']),
  },

  // ── Translation Tasks ──────────────────────────────────────────────────
  {
    name: 'translation_task',
    pattern: /\b(?:translat\w*|(?:convert|change)\s+(?:this\s+)?(?:to|into)\s+(?:english|spanish|french|german|chinese|japanese|korean|arabic|hindi|portuguese|italian|russian|dutch|swedish)|in\s+(?:english|spanish|french|german|chinese|japanese|korean))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE']),
  },

  // ── Summarization Tasks ────────────────────────────────────────────────
  {
    name: 'summarization_task',
    pattern: /\b(?:summariz\w*|(?:give|write|create|provide)\s+(?:a\s+)?(?:summary|synopsis|overview|recap|brief|gist|tldr|tl;dr)|(?:shorten|condense|simplify)\s+(?:this|the\s+following))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE']),
  },

  // ── Creative Writing Tasks ──────────────────────────────────────────────
  {
    name: 'creative_writing',
    pattern: /\b(?:write\s+(?:a\s+)?(?:story|novel|poem|song|haiku|limerick|essay|article|blog\s*post|script|dialogue|monologue|speech|(?:novel|story)\s+(?:scene|chapter|excerpt))|(?:novel|story|fictional)\s+(?:scene|chapter|excerpt|passage)\s+(?:where|in\s+which|about)|(?:creative|fictional|fantasy|sci[\s-]?fi)\s+(?:writing|story|narrative|scene)|make\s+(?:up|it)\s+(?:a\s+)?(?:story|poem))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE']),
  },

  // ── Roleplay / Hypothetical / Fictional Scenarios ─────────────────────
  {
    name: 'roleplay_fictional',
    pattern: /\b(?:(?:let'?s|let\s+us)\s+(?:roleplay|role[\s-]?play|pretend|imagine|say)|(?:roleplay|role[\s-]?play)\s*[:\.!,]|fictional\s+(?:company|person|org\w*|business|startup|firm|scenario|example)|hypothetical(?:ly)?|(?:imagine|pretend|suppose|assume)\s+(?:you\s+are|you're|I\s+am|I'm|we\s+are|we're|that)|(?:for\s+(?:this\s+)?example|as\s+an?\s+example)\s*,?\s+(?:let'?s\s+)?(?:say|assume|imagine|suppose))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE', 'MONETARY_AMOUNT']),
  },

  // ── Test / Sample / Placeholder Data ──────────────────────────────────
  {
    name: 'test_sample_data',
    pattern: /\b(?:(?:this\s+is\s+)?(?:test|sample|dummy|placeholder|fake|mock|example)\s+(?:data|entry|record|input|text|content|value|name|email|address|number)|(?:for\s+)?(?:testing|demonstration|demo)\s+(?:purposes?|only|data)|(?:use|using)\s+(?:test|fake|dummy|sample|placeholder)\s+(?:data|values?|names?|info))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE', 'EMAIL', 'PHONE_NUMBER', 'DATE_OF_BIRTH']),
  },

  // ── Educational / Learning ──────────────────────────────────────────────
  {
    name: 'educational_example',
    pattern: /\b(?:(?:for\s+)?(?:educational|learning|teaching|training|classroom|tutorial)\s+(?:purposes?|example|exercise|use)|(?:teach|learn|study|practice)\s+(?:about|how\s+to)|(?:textbook|coursework|homework|assignment|lecture)\s+(?:example|problem|exercise|question))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE', 'MONETARY_AMOUNT']),
  },

  // ── Templates / Drafts / Boilerplate ────────────────────────────────────
  {
    name: 'template_draft',
    pattern: /\b(?:(?:create|write|draft|make|generate)\s+(?:a\s+)?(?:template|boilerplate|skeleton|outline|placeholder)|(?:template|boilerplate)\s+(?:for|text|content|example)|(?:fill\s+in|populate)\s+(?:this|the)\s+(?:template|form|placeholder))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE', 'EMAIL', 'PHONE_NUMBER']),
  },

  // ── Practice / Exercise ─────────────────────────────────────────────────
  {
    name: 'practice_exercise',
    pattern: /\b(?:(?:practice|exercise|drill|quiz|exam)\s+(?:problem|question|prompt|scenario|example)|(?:work(?:ing)?\s+through|walk\s+(?:me\s+)?through)\s+(?:an?\s+)?example|(?:let'?s|let\s+us)\s+(?:practice|try\s+(?:a|an)\s+example))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE', 'MONETARY_AMOUNT']),
  },

  // ── Code Help Tasks ─────────────────────────────────────────────────────
  {
    name: 'code_help',
    pattern: /\b(?:(?:write|create|build|implement|code|develop|debug|fix)\s+(?:a\s+)?(?:function|class|method|script|program|app|component|module|API|endpoint|query)|(?:refactor|optimize|review)\s+(?:this|the|my)\s+(?:code|function|class)|(?:what\s+does|how\s+does)\s+(?:this|the)\s+(?:code|function|method))\b/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE', 'IP_ADDRESS']),
  },

  // ── Math / Calculation Tasks ───────────────────────────────────────────
  {
    name: 'math_calculation',
    pattern: /\b(?:(?:solve|calculate|compute|derive|simplify|integrate|differentiate|factor|expand|evaluate)\s+(?:this|the|for)?\s*(?:equation|expression|integral|derivative|formula|function|limit|sum|series|polynomial|matrix)?|(?:what\s+is|find)\s+(?:the\s+)?(?:value|answer|result|solution|derivative|integral|limit|sum)\s+(?:of|for|to)|(?:convert|multiply|divide|add|subtract|percentage|ratio|proportion)\b)/i,
    safeTypes: new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'DATE', 'MONETARY_AMOUNT']),
  },
];

// ─── Strong Fiction Framing ───────────────────────────────────────────────
// Matches unambiguous "this is creative writing, the numbers below are props"
// framing at the very start of the prompt. When this hits, we still surface
// detected entities in the side panel (user awareness) but we drop the overall
// score so a fictional "123-45-6789" in a novel scene doesn't alarm the user.
// Guard rails:
//   1. MUST match within the first ~80 characters of the prompt.
//   2. Prompt must be short-ish (≤ 500 chars). Long prompts with fiction
//      wrappers can smuggle real data after the wrapper — we don't trust them.
//   3. Only the score multiplier changes; individual entities are never removed
//      from the activity log so the user still sees what was detected.
const STRONG_FICTION_OPENING = /^[^.?!\n]{0,120}\b(?:write\s+(?:a\s+)?(?:novel|story|fictional|short)\s+(?:scene|chapter|excerpt|passage|story)|(?:novel|story|fictional)\s+(?:scene|chapter|excerpt|passage)\s+(?:where|in\s+which)|(?:write|craft|draft)\s+(?:me\s+)?(?:a\s+)?(?:short\s+)?(?:story|novel|fiction|screenplay|scene)\s+(?:where|about|in\s+which|involving)|for\s+(?:my|a)\s+(?:novel|story|fiction\s+book|screenplay|RPG|game)|(?:detective|protagonist|character|villain|hero|narrator|npc|shopkeeper)\s+[A-Z][a-z]+\s+(?:says|said|reads|reading|sees|hears|thinks|finds|discovers|walks)|roleplay\s+as|in\s+the\s+style\s+of)\b/i;

// ─── First-Person Possessive Patterns ────────────────────────────────────────
// "My DOB is...", "I was born on...", "my email is..." — the user is
// volunteering their own info for the task. Different from "Patient DOB: ..."

const FIRST_PERSON_PATTERNS: RegExp[] = [
  /\b(?:my|I'?m|I\s+am|I\s+was\s+born|I\s+live|I\s+work)\b/i,
];

// ─── Entity types that should NEVER be suppressed regardless of intent ──────
// These are too dangerous to pass through even if the user "intends" to share them.

// H-16: Derive from ALWAYS_CRITICAL_TYPES (single source of truth in types.ts)
// plus domain-specific types that should never be suppressed by intent detection.
const NEVER_SUPPRESS_TYPES: ReadonlySet<string> = new Set([
  ...ALWAYS_CRITICAL_TYPES,
  'SSN',
  'CREDIT_CARD',
  'ACCOUNT_NUMBER',
  'PASSPORT_NUMBER',
  'DRIVERS_LICENSE',
  'MEDICAL_RECORD',
  'AUTH_TOKEN',
  'CLASSIFICATION_MARKING',
  'CUI_MARKING',
  'EXPORT_CONTROL',
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
 * Architecture:
 *   1. Match benign intent patterns in the opening of the prompt
 *   2. THEN apply context-appropriate guards based on what matched
 *   3. Self-referential tasks (resume, bio, formatting) get relaxed guards
 *      because the user IS the data — resumes naturally have many entities
 *   4. Lookup tasks (weather, definition) keep strict guards
 *   5. hasDataRecordContext() is the per-entity safety check (field labels,
 *      tabular format), NOT blunt entity counts
 *
 * @param nliBenign - When true, NLI has classified the prompt as benign
 *   with high confidence. Broadens suppression without needing a regex match.
 */
export function applyIntentSuppression(
  text: string,
  entities: DetectedEntity[],
  nliBenign: boolean = false,
): IntentSuppressionResult {
  if (entities.length === 0) {
    return { entities, scoreMultiplier: 1.0, suppressions: [], isSelfReferential: false };
  }

  // Strong-fiction early gate: when the prompt unambiguously opens with
  // "write a novel scene where…" style framing, we apply an aggressive
  // score reduction regardless of NEVER_SUPPRESS_TYPES. Individual entities
  // are still logged (we don't drop their confidence) so the user sees
  // what IronGate detected, but the prompt won't be red-flagged.
  const strongFictionActive = text.length <= 500 && STRONG_FICTION_OPENING.test(text);

  const suppressions: IntentSuppression[] = [];
  const matchedPatterns: BenignIntentPattern[] = [];

  // Only check the opening portion of the prompt for benign intent.
  // A "what is" buried in paragraph 5 of a legal doc shouldn't suppress anything.
  const opening = text.substring(0, 200);

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

  // NLI CROSS-TALK: When NLI says benign, treat it AS a matched pattern.
  // This is the key change that eliminates whack-a-mole: NLI understands
  // novel benign scenarios without needing a regex for each one.
  if (nliBenign && matchedPatterns.length === 0 && !isFirstPerson) {
    const nliSafeTypes = new Set(['PERSON', 'DATE', 'DATE_OF_BIRTH', 'LOCATION', 'ORGANIZATION', 'EMAIL']);
    const allNeverSuppress = entities.every(e => NEVER_SUPPRESS_TYPES.has(e.type));
    if (!allNeverSuppress) {
      matchedPatterns.push({
        name: 'nli_benign',
        pattern: /./,
        safeTypes: nliSafeTypes,
      });
    }
  }

  if (matchedPatterns.length === 0 && !isFirstPerson) {
    // Even without a soft-match, strong fiction framing at the opening
    // justifies an aggressive score cut — apply it directly here.
    if (strongFictionActive) {
      return {
        entities,
        scoreMultiplier: 0.25,
        suppressions: [],
        isSelfReferential: true,
        isStrongFiction: true,
      };
    }
    return { entities, scoreMultiplier: 1.0, suppressions: [], isSelfReferential: false };
  }

  // ── CONTEXT-AWARE GUARDS ───────────────────────────────────────────────
  //
  // ARCHITECTURE (replaces blunt length/entity limits):
  //
  // The OLD approach applied guards BEFORE pattern matching — a 575-char
  // resume with 7 entities was immediately rejected as a "data dump" without
  // ever checking if the user said "improve my resume."
  //
  // The NEW approach: pattern matching runs FIRST, then guards are calibrated
  // based on what matched. Self-referential task patterns (resume, cover
  // letter, bio, formatting) naturally contain many entities and are long —
  // a resume IS the user's own data. Lookup patterns (weather, definition)
  // keep strict guards.
  //
  // Safety is maintained by hasDataRecordContext() which checks for actual
  // data-record signals (field labels, tabular format) per-entity, not by
  // blunt entity counts that can't distinguish a resume from a DSAR.
  //
  const isSelfReferentialTask = matchedPatterns.some(p =>
    SELF_REFERENTIAL_PATTERNS.has(p.name)
  );

  const lengthLimit = isSelfReferentialTask ? 2000 : nliBenign ? 800 : 500;
  if (text.length > lengthLimit) {
    return { entities, scoreMultiplier: 1.0, suppressions: [], isSelfReferential: false };
  }

  const entityLimit = isSelfReferentialTask ? 15 : nliBenign ? 6 : 4;
  if (entities.length >= entityLimit) {
    return { entities, scoreMultiplier: 1.0, suppressions: [], isSelfReferential: false };
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

  // M-18: Cap entities examined for self-referential suppression at 20.
  // With many entities, checking hasDataRecordContext() for each is O(n×m).
  // Beyond 20 entities, skip suppression for the remainder (treat as unsuppressed).
  const SELF_REF_ENTITY_CAP = 20;

  // Process each entity
  let suppressionChecks = 0;
  const adjusted = entities.map(entity => {
    // NEVER suppress critical/dangerous types
    if (NEVER_SUPPRESS_TYPES.has(entity.type)) {
      return entity;
    }

    // Check if this entity type is safe given the detected intent
    if (safeTypes.has(entity.type)) {
      // M-18: Cap the number of entities we examine for self-referential suppression
      if (isSelfReferentialTask && suppressionChecks >= SELF_REF_ENTITY_CAP) {
        return entity; // Over cap — don't suppress, keep as-is
      }
      suppressionChecks++;

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
    // ALL entities are benign intent → strong suppression.
    // Self-referential tasks (resume, bio, cover letter) get an aggressive
    // multiplier (0.1) because the entities ARE the user's own data, not
    // a data leak. Combined with confidence reduction to 0.2, this
    // guarantees the score drops into green zone (≤25).
    scoreMultiplier = isSelfReferentialTask ? 0.1 : 0.3;
  } else if (suppressedCount > 0) {
    // Some entities suppressed, some remain → moderate reduction
    scoreMultiplier = isSelfReferentialTask ? 0.3 : 0.6;
  }

  // Strong fiction framing overrides: even if a NEVER_SUPPRESS entity
  // (SSN/CC) held the suppression count at 0, we still apply a firm
  // score cut because the framing is unambiguous and short.
  if (strongFictionActive) {
    scoreMultiplier = Math.min(scoreMultiplier, 0.25);
  }

  return {
    entities: adjusted,
    scoreMultiplier,
    suppressions,
    isSelfReferential: isSelfReferentialTask,
    isStrongFiction: strongFictionActive,
  };
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
