/**
 * Intent Classifier — Contextual Intelligence Engine Layer 1
 *
 * Classifies user prompts by intent (what the user is TRYING to do)
 * and direction (inward = receiving info, outward = sharing info).
 *
 * This replaces the additive "check every pattern" approach with
 * priority-ordered classification: first match wins.
 *
 * Priority order (most dangerous first):
 *  1. Credential/secret sharing
 *  2. Structural data (tables, records, forms)
 *  3. Disclosure framing ("here is", "attached is", "below is")
 *  4. Organizational possessives ("our client", "our company")
 *  5. Interrogative patterns ("what is", "how do I")
 *  6. Creative writing ("write a story", "compose a poem")
 *  7. Productivity tasks ("summarize", "translate", "proofread")
 *  8. Code signals ("function", "class", "const", "import")
 *  9. Drafting with context ("draft an email to", "write a memo for")
 * 10. Semantic fallback (default to GENERAL)
 *
 * Output: { intent, direction, confidence }
 *   direction:
 *     'outward' = user is SENDING sensitive data to the LLM
 *     'inward'  = user is REQUESTING information from the LLM
 *
 * Clause-level processing: outward signal in ANY clause dominates.
 * "Tell me about Sullivan & Cromwell and here is their financial data"
 *  → clause 1 is inward, clause 2 is outward → final = outward.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type IntentCategory =
  | 'credential_sharing'
  | 'data_record'
  | 'disclosure'
  | 'organizational'
  | 'interrogative'
  | 'creative'
  | 'productivity'
  | 'code'
  | 'drafting'
  | 'general';

export type IntentDirection = 'inward' | 'outward';

export interface IntentClassification {
  intent: IntentCategory;
  direction: IntentDirection;
  confidence: number;
}

// ── Intent weight map for scoring integration ────────────────────────────────
// These map intent categories to score multipliers.
// outward + credential_sharing = 1.5x (amplifies score)
// inward + interrogative = 0.4x (suppresses score)

export const INTENT_WEIGHTS: Record<IntentCategory, { inward: number; outward: number }> = {
  credential_sharing: { inward: 1.0, outward: 1.5 },
  data_record:        { inward: 1.0, outward: 1.4 },
  disclosure:         { inward: 0.8, outward: 1.3 },
  organizational:     { inward: 0.7, outward: 1.2 },
  interrogative:      { inward: 0.4, outward: 1.0 },
  creative:           { inward: 0.3, outward: 0.8 },
  productivity:       { inward: 0.5, outward: 1.0 },
  code:               { inward: 0.3, outward: 0.7 },
  drafting:           { inward: 0.6, outward: 1.1 },
  general:            { inward: 0.6, outward: 1.0 },
};

// ── Pattern definitions ──────────────────────────────────────────────────────

interface IntentPattern {
  intent: IntentCategory;
  direction: IntentDirection;
  confidence: number;
  pattern: RegExp;
}

// Priority-ordered: first match wins. Most dangerous first.
const INTENT_PATTERNS: IntentPattern[] = [
  // ── 1. Credential / Secret Sharing ──────────────────────────────────────
  // User is pasting API keys, passwords, connection strings, etc.
  {
    intent: 'credential_sharing',
    direction: 'outward',
    confidence: 0.95,
    pattern: /(?:(?:api[_\s-]?key|password|secret|token|credential|private[_\s-]?key)\s*[:=]|(?:BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY)|(?:AKIA[A-Z0-9]{12,})|(?:mongodb\+srv:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/))/i,
  },

  // ── 2. Structural Data (tables, records, forms) ─────────────────────────
  // Tabular data, CSV-like rows, form fields — likely pasted documents
  {
    intent: 'data_record',
    direction: 'outward',
    confidence: 0.9,
    pattern: /(?:(?:^|\n)\s*(?:name|ssn|dob|mrn|account|employee\s*id|patient|client)\s*[:=|])/im,
  },
  {
    intent: 'data_record',
    direction: 'outward',
    confidence: 0.85,
    pattern: /(?:(?:^|\n)[\w\s]+\|[\w\s]+\|[\w\s]+(?:\n|$)){2,}/m,
  },
  // Email headers (forwarded emails)
  {
    intent: 'data_record',
    direction: 'outward',
    confidence: 0.85,
    pattern: /(?:^|\n)\s*(?:From|To|Cc|Subject|Date)\s*:\s*.+(?:\n\s*(?:From|To|Cc|Subject|Date)\s*:\s*.+){2,}/im,
  },

  // ── 3. Disclosure Framing ───────────────────────────────────────────────
  // "Here is", "attached is", "below is", "I'm sharing" — user is pushing data outward
  {
    intent: 'disclosure',
    direction: 'outward',
    confidence: 0.85,
    pattern: /\b(?:here\s+(?:is|are)|attached\s+(?:is|are|below)|below\s+(?:is|are)|(?:I(?:'m|\s+am)\s+(?:sharing|sending|providing|pasting|forwarding|including))|please\s+(?:review|analyze|check|look\s+at|examine)\s+(?:this|the\s+following|these))\b/i,
  },
  // "Can you review this contract / memo / document?"
  {
    intent: 'disclosure',
    direction: 'outward',
    confidence: 0.8,
    pattern: /\b(?:review|analyze|check|examine|evaluate|assess)\s+(?:this|the\s+following|these|my)\s+(?:document|contract|agreement|memo|report|email|letter|filing|brief|spreadsheet|statement)\b/i,
  },

  // ── 4. Organizational Possessives ───────────────────────────────────────
  // "Our client", "our company", "our deal" — internal business data going outward
  {
    intent: 'organizational',
    direction: 'outward',
    confidence: 0.8,
    pattern: /\b(?:our\s+(?:client|company|firm|organization|team|department|deal|acquisition|merger|target|portfolio|fund|strategy|board|investors?|shareholders?|counsel))\b/i,
  },
  // "The company's", "Smith's" (third-party possessives about private matters)
  {
    intent: 'organizational',
    direction: 'outward',
    confidence: 0.7,
    pattern: /\b(?:(?:the\s+)?(?:company|firm|client|patient|employee)(?:'s|s')\s+(?:data|records?|information|details?|financials?|salary|compensation|health|medical|performance))\b/i,
  },

  // ── 5. Interrogative Patterns ───────────────────────────────────────────
  // Questions requesting information FROM the LLM — inward direction
  {
    intent: 'interrogative',
    direction: 'inward',
    confidence: 0.85,
    pattern: /^(?:\s*)(?:what\s+(?:is|are|does|do|was|were|can|could|should|would|will|has|have)|who\s+(?:is|are|was|were)|where\s+(?:is|are|do|does|can)|when\s+(?:is|are|was|were|do|does|did|will)|why\s+(?:is|are|do|does|did|would|should)|how\s+(?:do|does|can|could|should|would|is|are|to|much|many|long|often))\b/i,
  },
  // "Tell me about", "Explain", "Describe"
  {
    intent: 'interrogative',
    direction: 'inward',
    confidence: 0.8,
    pattern: /^(?:\s*)(?:tell\s+me\s+(?:about|more)|explain\s+(?:what|how|why|the)|describe\s+(?:the|how|what)|define\s+|look\s*up\s+|search\s+for\s+|find\s+(?:info|information)\s+(?:on|about))\b/i,
  },

  // ── 6. Creative Writing ─────────────────────────────────────────────────
  // Writing fiction, poems, stories — entities are fictional, not real PII
  {
    intent: 'creative',
    direction: 'inward',
    confidence: 0.85,
    pattern: /\b(?:write\s+(?:a\s+)?(?:story|poem|song|haiku|limerick|essay|article|blog\s*post|script|dialogue|monologue|speech|novel|chapter|verse|lyrics)|(?:creative|fictional|fantasy|sci[\s-]?fi)\s+(?:writing|story|narrative)|make\s+(?:up|it)\s+(?:a\s+)?(?:story|poem)|imagine\s+(?:a|that)|(?:fictional|hypothetical)\s+scenario)\b/i,
  },

  // ── 7. Productivity Tasks ───────────────────────────────────────────────
  // Summarize, translate, format, proofread — content-neutral tasks
  {
    intent: 'productivity',
    direction: 'inward',
    confidence: 0.8,
    pattern: /^(?:\s*)(?:summariz|translat|paraphras|proofread|format|reformat|restructur|reorganiz|clean\s+up|fix\s+(?:the\s+)?(?:formatting|grammar|spelling|punctuation|typos?))/i,
  },
  {
    intent: 'productivity',
    direction: 'inward',
    confidence: 0.75,
    pattern: /\b(?:(?:convert|change)\s+(?:this\s+)?(?:to|into)\s+(?:english|spanish|french|german|chinese|japanese|korean|arabic|hindi|portuguese)|make\s+(?:this|it)\s+(?:more\s+)?(?:concise|professional|formal|casual|shorter|longer))\b/i,
  },

  // ── 8. Code Signals ────────────────────────────────────────────────────
  // Code help, debugging, implementation — entities in code are usually examples
  {
    intent: 'code',
    direction: 'inward',
    confidence: 0.8,
    pattern: /\b(?:(?:write|create|build|implement|code|develop|debug|fix)\s+(?:a\s+)?(?:function|class|method|script|program|app|component|module|API|endpoint|query|test)|(?:refactor|optimize|review)\s+(?:this|the|my)\s+(?:code|function|class)|(?:what\s+does|how\s+does)\s+(?:this|the)\s+(?:code|function|method))\b/i,
  },
  // Code block indicators
  {
    intent: 'code',
    direction: 'inward',
    confidence: 0.7,
    pattern: /(?:```(?:js|ts|py|java|go|rust|c|cpp|csharp|ruby|php|swift|kotlin)|(?:^|\n)\s*(?:import\s+\{|from\s+\w+\s+import|const\s+\w+\s*=|function\s+\w+\(|class\s+\w+\s*\{|def\s+\w+\())/m,
  },

  // ── 9. Drafting with Context ────────────────────────────────────────────
  // "Draft an email to John about the merger" — direction depends on content
  // The entity (John) is the RECIPIENT, but the subject may be sensitive
  {
    intent: 'drafting',
    direction: 'outward',
    confidence: 0.7,
    pattern: /\b(?:(?:draft|write|compose|prepare|create)\s+(?:a\s+)?(?:email|message|letter|memo|brief|report|presentation|proposal|response|reply)\s+(?:to|for|about|regarding|re:?))\b/i,
  },
  {
    intent: 'drafting',
    direction: 'inward',
    confidence: 0.65,
    pattern: /\b(?:help\s+(?:me\s+)?(?:draft|write|compose|prepare|create)\s+(?:a\s+)?(?:email|message|letter|note|text|response|reply))\b/i,
  },
];

// ── Clause-level direction signals ───────────────────────────────────────────
// These detect outward signals that can appear in ANY clause of the prompt,
// overriding an otherwise inward classification.

const OUTWARD_CLAUSE_SIGNALS: RegExp[] = [
  // Disclosure verbs with objects
  /\b(?:here\s+(?:is|are)\s+(?:the|my|our|a))\b/i,
  /\b(?:(?:I(?:'m|\s+am)\s+(?:sharing|sending|providing|pasting|forwarding)))\b/i,
  // Data handoff patterns
  /\b(?:take\s+a\s+look\s+at|check\s+(?:this|these)|see\s+(?:below|attached|the\s+following))\b/i,
  // Explicit data push
  /\b(?:(?:the|this)\s+(?:data|information|document|contract|agreement|memo|report)\s+(?:is|contains|includes|shows))\b/i,
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a prompt's intent and direction.
 *
 * Uses priority-ordered pattern matching: first match wins, then
 * clause-level processing checks for outward signals that override
 * an inward classification.
 */
export function classifyIntent(text: string): IntentClassification {
  // Fast path: empty or very short text
  if (!text || text.trim().length < 3) {
    return { intent: 'general', direction: 'inward', confidence: 0.5 };
  }

  // Try each pattern in priority order — first match wins
  let result: IntentClassification | null = null;

  for (const p of INTENT_PATTERNS) {
    p.pattern.lastIndex = 0;
    if (p.pattern.test(text)) {
      result = {
        intent: p.intent,
        direction: p.direction,
        confidence: p.confidence,
      };
      break;
    }
  }

  // Fallback: no pattern matched → general
  if (!result) {
    result = { intent: 'general', direction: 'inward', confidence: 0.5 };
  }

  // ── Clause-level override ──────────────────────────────────────────────
  // If the primary classification is inward, check if ANY clause contains
  // an outward signal. Outward always dominates — sharing data to an LLM
  // is risky even if part of the prompt is a question.
  if (result.direction === 'inward') {
    for (const signal of OUTWARD_CLAUSE_SIGNALS) {
      signal.lastIndex = 0;
      if (signal.test(text)) {
        result = { ...result, direction: 'outward' };
        // Reduce confidence slightly since we overrode
        result.confidence = Math.max(0.6, result.confidence - 0.1);
        break;
      }
    }
  }

  // ── Length heuristic ───────────────────────────────────────────────────
  // Very long prompts (>1000 chars) with inward intent are suspicious —
  // nobody types 1000 chars to ask a question. Likely pasted content.
  if (result.direction === 'inward' && text.length > 1000) {
    // Don't override code intent — code blocks are legitimately long
    if (result.intent !== 'code') {
      result = { ...result, direction: 'outward' };
      result.confidence = Math.max(0.6, result.confidence - 0.15);
    }
  }

  return result;
}

/**
 * Get the score weight for a given intent classification.
 * Used by the scorer to multiply the base entity score.
 */
export function getIntentWeight(classification: IntentClassification): number {
  const weights = INTENT_WEIGHTS[classification.intent];
  if (!weights) return 1.0;
  return weights[classification.direction];
}
