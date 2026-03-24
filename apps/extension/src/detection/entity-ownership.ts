/**
 * Iron Gate Entity Ownership Classifier (Extension-side)
 *
 * Determines WHO each detected entity belongs to:
 * - self: the user's own data (their name, employer, email, address)
 * - third_party: someone else's data (client email, patient name)
 * - public: publicly known info being discussed/researched (CEO of Google)
 * - internal: organization's confidential data (deal codenames, revenue)
 * - unknown: can't determine ownership
 *
 * This is the critical missing piece — without it, a resume gets all
 * company names pseudonymized even though they're the user's own employers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OwnershipType = 'self' | 'third_party' | 'public' | 'internal' | 'unknown';

export interface EntityOwnership {
  entityText: string;
  entityType: string;
  start: number;
  end: number;
  ownership: OwnershipType;
  confidence: number;
  signal: string;
}

interface EntityInput {
  type: string;
  text: string;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTEXT_WINDOW = 100;

// ---------------------------------------------------------------------------
// Signal pattern type
// ---------------------------------------------------------------------------

interface SignalPattern {
  regex: RegExp;
  confidence: number;
  signal: string;
}

// ---------------------------------------------------------------------------
// Self-referential patterns
// ---------------------------------------------------------------------------

const SELF_PATTERNS: SignalPattern[] = [
  { regex: /\bmy\s+name\s+is\b/i, confidence: 0.95, signal: 'possessive_my_name' },
  { regex: /\b(?:I\s+am|I'm)\b/i, confidence: 0.80, signal: 'self_introduction' },
  { regex: /\bmy\s+(?:email|phone|address|number|cell|contact)\b/i, confidence: 0.90, signal: 'possessive_my_contact' },
  { regex: /\b(?:reach|contact)\s+me\s+at\b/i, confidence: 0.90, signal: 'reach_me_at' },
  { regex: /\bI\s+(?:work|worked|joined|left|started|manage|managed)\s+(?:at|for)\b/i, confidence: 0.90, signal: 'self_employment' },
  { regex: /\bmy\s+(?:experience|time|role|position|tenure|career|work)\s+(?:at|with)\b/i, confidence: 0.90, signal: 'possessive_experience' },
  { regex: /\bI\s+(?:managed|led|built|developed|designed|created|oversaw|directed|launched|spearheaded|implemented|architected|established)\b/i, confidence: 0.75, signal: 'self_achievement' },
  { regex: /\(\s*\d{4}\s*[-–—]\s*(?:\d{4}|[Pp]resent)\s*\)/i, confidence: 0.90, signal: 'job_date_range' },
  { regex: /\b(?:worked|employed)\s+(?:at|by)\b/i, confidence: 0.80, signal: 'employment_context' },
  { regex: /\b(?:experience|education|employment\s+history|work\s+history|professional\s+summary)\b/i, confidence: 0.70, signal: 'resume_section' },
];

// ---------------------------------------------------------------------------
// Third-party patterns
// ---------------------------------------------------------------------------

const THIRD_PARTY_PATTERNS: SignalPattern[] = [
  { regex: /\b(?:his|her|their)\s+(?:email|phone|name|address|number|contact)\b/i, confidence: 0.90, signal: 'other_person_possessive' },
  { regex: /\b(?:client\s+contact|patient|customer|recipient|vendor|contractor|applicant|candidate)\s*:/i, confidence: 0.95, signal: 'labeled_third_party' },
  { regex: /\b(?:from|sent\s+by|cc|bcc|forwarded\s+from|forwarded\s+by)\s*:/i, confidence: 0.80, signal: 'forwarded_attribution' },
  { regex: /'\s*s\s+(?:email|phone|address|number|contact)\s+(?:is|was)\b/i, confidence: 0.85, signal: 'attributed_contact' },
  { regex: /\bcontact\s+\w+\s+at\b/i, confidence: 0.80, signal: 'contact_person_at' },
  { regex: /\bon\s+behalf\s+of\b/i, confidence: 0.75, signal: 'on_behalf_of' },
  { regex: /\b(?:belonging|associated|assigned)\s+to\b/i, confidence: 0.70, signal: 'belonging_to' },
];

// ---------------------------------------------------------------------------
// Public-entity patterns
// ---------------------------------------------------------------------------

const PUBLIC_PATTERNS: SignalPattern[] = [
  { regex: /\b(?:tell\s+me\s+about|who\s+is|what\s+(?:does|is|are)|explain|describe|look\s+up|search\s+for|find\s+info\s+(?:on|about))\b/i, confidence: 0.85, signal: 'research_framing' },
  { regex: /\b(?:CEO|CTO|CFO|COO|founder|co-founder|president|chairman|director|secretary|minister|governor|senator|mayor)\s+of\b/i, confidence: 0.90, signal: 'public_title' },
  { regex: /\b(?:according\s+to|reported\s+by|announced\s+by|published\s+by|stated\s+by)\b/i, confidence: 0.80, signal: 'news_attribution' },
  { regex: /\b(?:is|was)\s+(?:an?\s+)?(?:American|British|Canadian|French|German|Indian|Chinese|Japanese|Australian)\b/i, confidence: 0.75, signal: 'biographical_context' },
  { regex: /\b(?:historically|in\s+(?:the\s+)?history\s+of|famous\s+for)\b/i, confidence: 0.70, signal: 'historical_context' },
];

// ---------------------------------------------------------------------------
// Internal/confidential patterns
// ---------------------------------------------------------------------------

const INTERNAL_PATTERNS: SignalPattern[] = [
  { regex: /\bour\s+(?:client|deal|contract|project|account|partner|vendor|customer|team|company|firm)\b/i, confidence: 0.85, signal: 'organizational_possessive' },
  { regex: /\b(?:Project|Operation|Initiative|Program|Codename)\s+[A-Z]\w*\b/, confidence: 0.80, signal: 'project_codename' },
  { regex: /\b(?:confidential|proprietary|internal\s+only|do\s+not\s+distribute|not\s+for\s+external|privileged|trade\s+secret)\b/i, confidence: 0.90, signal: 'confidentiality_marker' },
  { regex: /\$[\d,]+(?:\.\d+)?[MBK]?\s+(?:deal|acquisition|contract|revenue|funding)\b/i, confidence: 0.80, signal: 'deal_value' },
];

// ---------------------------------------------------------------------------
// Context-category defaults
// ---------------------------------------------------------------------------

const CONTEXT_DEFAULTS: Record<string, { ownership: OwnershipType; confidence: number }> = {
  personal_task: { ownership: 'self', confidence: 0.50 },
  resume_review: { ownership: 'self', confidence: 0.50 },
  personal_bio: { ownership: 'self', confidence: 0.50 },
  contract_review: { ownership: 'internal', confidence: 0.40 },
  customer_data: { ownership: 'third_party', confidence: 0.50 },
  hr_matters: { ownership: 'third_party', confidence: 0.50 },
  code_review: { ownership: 'self', confidence: 0.40 },
  creative_writing: { ownership: 'self', confidence: 0.40 },
  medical_health: { ownership: 'third_party', confidence: 0.50 },
  legal_strategy: { ownership: 'internal', confidence: 0.40 },
  financial_analysis: { ownership: 'internal', confidence: 0.40 },
  competitive_intel: { ownership: 'public', confidence: 0.40 },
  internal_comms: { ownership: 'internal', confidence: 0.40 },
  general: { ownership: 'unknown', confidence: 0.20 },
};

// ---------------------------------------------------------------------------
// Special entity-type handlers
// ---------------------------------------------------------------------------

function classifyEmailSpecial(windowBefore: string): { ownership: OwnershipType; confidence: number; signal: string } | null {
  const lower = windowBefore.toLowerCase();
  if (/\bmy\s+(?:email|e-mail|address)\b/.test(lower)) {
    return { ownership: 'self', confidence: 0.95, signal: 'my_email_prefix' };
  }
  if (/\breach\s+me\s+at\b/.test(lower)) {
    return { ownership: 'self', confidence: 0.90, signal: 'reach_me_prefix' };
  }
  if (/\bcontact\s+me\s+at\b/.test(lower)) {
    return { ownership: 'self', confidence: 0.90, signal: 'contact_me_prefix' };
  }
  if (/\b(?:client\s+contact|patient|customer|recipient)\s*:/.test(lower)) {
    return { ownership: 'third_party', confidence: 0.95, signal: 'labeled_contact_email' };
  }
  if (/\b(?:his|her|their)\s+(?:email|e-mail|address)\b/.test(lower)) {
    return { ownership: 'third_party', confidence: 0.90, signal: 'other_person_email' };
  }
  return null;
}

function classifyPhoneSpecial(windowBefore: string): { ownership: OwnershipType; confidence: number; signal: string } | null {
  const lower = windowBefore.toLowerCase();
  if (/\bmy\s+(?:phone|cell|number|mobile)\b/.test(lower)) {
    return { ownership: 'self', confidence: 0.95, signal: 'my_phone_prefix' };
  }
  if (/\b(?:his|her|their)\s+(?:phone|cell|number|mobile)\b/.test(lower)) {
    return { ownership: 'third_party', confidence: 0.90, signal: 'other_person_phone' };
  }
  if (/\b(?:client|patient|customer)\s*(?:'s)?\s+(?:phone|cell|number|mobile)\b/.test(lower)) {
    return { ownership: 'third_party', confidence: 0.90, signal: 'labeled_contact_phone' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resume-specific heuristic
// ---------------------------------------------------------------------------

function isResumeFirstEntity(entity: EntityInput, entities: EntityInput[]): boolean {
  if (entity.type !== 'PERSON') return false;

  const personEntities = entities.filter((e) => e.type === 'PERSON');
  if (personEntities.length === 0) return false;

  const firstPerson = personEntities.reduce((a, b) => (a.start <= b.start ? a : b));
  if (entity.start !== firstPerson.start) return false;

  // First PERSON in the first ~300 chars is likely the resume owner
  return entity.start < 300;
}

// ---------------------------------------------------------------------------
// Main classification function
// ---------------------------------------------------------------------------

/**
 * Classify ownership of each entity based on surrounding text context.
 *
 * For each entity, extracts a window of text around it (±100 chars),
 * checks for self-referential, third-party, public, and internal signals,
 * then falls back to context-category defaults.
 *
 * @param text - The full prompt/document text.
 * @param entities - Detected entities with type, text, start, end.
 * @param contextCategory - The prompt's context category (e.g. 'personal_task').
 * @returns Array of EntityOwnership objects, one per input entity.
 */
export function classifyEntityOwnership(
  text: string,
  entities: Array<{ type: string; text: string; start: number; end: number }>,
  contextCategory: string,
): EntityOwnership[] {
  const results: EntityOwnership[] = [];
  const textLen = text.length;
  const isResumeContext = ['personal_task', 'resume_review', 'personal_bio'].includes(contextCategory);

  for (const entity of entities) {
    const entityText = entity.text;
    const entityType = entity.type;
    const { start, end } = entity;

    // Extract context window
    const windowStart = Math.max(0, start - CONTEXT_WINDOW);
    const windowEnd = Math.min(textLen, end + CONTEXT_WINDOW);
    const windowBefore = text.slice(windowStart, start);
    const fullWindow = text.slice(windowStart, windowEnd);

    // ------------------------------------------------------------------
    // Step 1: Special entity-type handling (EMAIL, PHONE)
    // ------------------------------------------------------------------
    let specialResult: { ownership: OwnershipType; confidence: number; signal: string } | null = null;
    if (entityType === 'EMAIL') {
      specialResult = classifyEmailSpecial(windowBefore);
    } else if (entityType === 'PHONE_NUMBER' || entityType === 'PHONE') {
      specialResult = classifyPhoneSpecial(windowBefore);
    }

    if (specialResult) {
      results.push({
        entityText,
        entityType,
        start,
        end,
        ownership: specialResult.ownership,
        confidence: specialResult.confidence,
        signal: specialResult.signal,
      });
      continue;
    }

    // ------------------------------------------------------------------
    // Step 2: Resume first-entity heuristic
    // ------------------------------------------------------------------
    if (isResumeContext && isResumeFirstEntity(entity, entities)) {
      results.push({
        entityText,
        entityType,
        start,
        end,
        ownership: 'self',
        confidence: 0.90,
        signal: 'resume_header_person',
      });
      continue;
    }

    // ------------------------------------------------------------------
    // Step 3: Check signal patterns — proximity-weighted scoring
    //
    // When multiple signals match within the context window, we
    // combine base confidence with a proximity bonus (up to 0.15) so that a
    // pattern matched right next to the entity beats one matched
    // at the edge of the window (e.g. "(2018-2021)" next to an ORG
    // should beat a distant "client contact:" label).
    // ------------------------------------------------------------------
    let bestOwnership: OwnershipType | null = null;
    let bestScore = 0;
    let bestConfidence = 0;
    let bestSignal = '';

    const entityOffsetInWindow = start - windowStart;
    const windowLen = fullWindow.length;

    const patternGroups: Array<{ patterns: SignalPattern[]; ownership: OwnershipType }> = [
      { patterns: SELF_PATTERNS, ownership: 'self' },
      { patterns: THIRD_PARTY_PATTERNS, ownership: 'third_party' },
      { patterns: PUBLIC_PATTERNS, ownership: 'public' },
      { patterns: INTERNAL_PATTERNS, ownership: 'internal' },
    ];

    for (const group of patternGroups) {
      for (const pat of group.patterns) {
        const m = pat.regex.exec(fullWindow);
        // Reset lastIndex for regexes with global flag (safety measure)
        pat.regex.lastIndex = 0;
        if (m) {
          // Proximity bonus: closer match to entity wins tiebreakers
          const matchMid = (m.index + m.index + m[0].length) / 2;
          const distance = Math.abs(matchMid - entityOffsetInWindow);
          const proximity = 1.0 - distance / Math.max(windowLen, 1);
          const score = pat.confidence + proximity * 0.15;
          if (score > bestScore) {
            bestOwnership = group.ownership;
            bestScore = score;
            bestConfidence = pat.confidence;
            bestSignal = pat.signal;
          }
        }
      }
    }

    if (bestOwnership !== null) {
      results.push({
        entityText,
        entityType,
        start,
        end,
        ownership: bestOwnership,
        confidence: bestConfidence,
        signal: bestSignal,
      });
      continue;
    }

    // ------------------------------------------------------------------
    // Step 4: Context-based default
    // ------------------------------------------------------------------
    const defaults = CONTEXT_DEFAULTS[contextCategory] ?? CONTEXT_DEFAULTS.general;

    results.push({
      entityText,
      entityType,
      start,
      end,
      ownership: defaults.ownership,
      confidence: defaults.confidence,
      signal: `context_default_${contextCategory}`,
    });
  }

  return results;
}
