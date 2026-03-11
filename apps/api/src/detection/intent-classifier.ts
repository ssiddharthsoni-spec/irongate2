/**
 * Intent Classifier — Server-side contextual intelligence.
 *
 * Classifies user prompts by intent and direction:
 *   direction: 'outward' = sharing data to LLM (risky)
 *              'inward'  = requesting info from LLM (safe)
 *
 * Server-side advantage: can use heavier NLP, longer patterns,
 * and firm-specific overrides. Priority-ordered: first match wins.
 *
 * Intent weights determine score multipliers:
 *   research=0.1, creative=0.15, productivity=0.2, coding=0.15,
 *   brainstorming=0.3, data_analysis=1.5, drafting_sensitive=1.3,
 *   communication_sharing=1.5, credential_disclosure=2.0
 */

export type IntentCategory =
  | 'credential_disclosure'
  | 'data_analysis'
  | 'communication_sharing'
  | 'drafting_sensitive'
  | 'brainstorming'
  | 'productivity'
  | 'coding'
  | 'creative'
  | 'research'
  | 'general';

export type IntentDirection = 'inward' | 'outward';

export interface IntentClassification {
  intent: IntentCategory;
  direction: IntentDirection;
  confidence: number;
}

export const INTENT_WEIGHTS: Record<IntentCategory, number> = {
  credential_disclosure: 2.0,
  data_analysis: 1.5,
  communication_sharing: 1.5,
  drafting_sensitive: 1.3,
  brainstorming: 0.3,
  productivity: 0.2,
  coding: 0.15,
  creative: 0.15,
  research: 0.1,
  general: 1.0,
};

interface IntentPattern {
  intent: IntentCategory;
  direction: IntentDirection;
  confidence: number;
  pattern: RegExp;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // ── 1. Credential / Secret Sharing ──────────────────────────────────────
  {
    intent: 'credential_disclosure',
    direction: 'outward',
    confidence: 0.95,
    pattern: /(?:(?:api[_\s-]?key|password|secret|token|credential|private[_\s-]?key)\s*[:=]|(?:BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY)|(?:AKIA[A-Z0-9]{12,})|(?:mongodb\+srv:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/))/i,
  },

  // ── 2. Structural Data / Data Analysis ──────────────────────────────────
  {
    intent: 'data_analysis',
    direction: 'outward',
    confidence: 0.9,
    pattern: /(?:(?:^|\n)\s*(?:name|ssn|dob|mrn|account|employee\s*id|patient|client)\s*[:=|])/im,
  },
  {
    intent: 'data_analysis',
    direction: 'outward',
    confidence: 0.85,
    pattern: /(?:(?:^|\n)[\w\s]+\|[\w\s]+\|[\w\s]+(?:\n|$)){2,}/m,
  },
  // Email headers (forwarded emails)
  {
    intent: 'communication_sharing',
    direction: 'outward',
    confidence: 0.85,
    pattern: /(?:^|\n)\s*(?:From|To|Cc|Subject|Date)\s*:\s*.+(?:\n\s*(?:From|To|Cc|Subject|Date)\s*:\s*.+){2,}/im,
  },

  // ── 3. Disclosure Framing ───────────────────────────────────────────────
  {
    intent: 'communication_sharing',
    direction: 'outward',
    confidence: 0.85,
    pattern: /\b(?:here\s+(?:is|are)|attached\s+(?:is|are|below)|below\s+(?:is|are)|(?:I(?:'m|\s+am)\s+(?:sharing|sending|providing|pasting|forwarding|including))|please\s+(?:review|analyze|check|look\s+at|examine)\s+(?:this|the\s+following|these))\b/i,
  },
  {
    intent: 'communication_sharing',
    direction: 'outward',
    confidence: 0.8,
    pattern: /\b(?:review|analyze|check|examine|evaluate|assess)\s+(?:this|the\s+following|these|my)\s+(?:document|contract|agreement|memo|report|email|letter|filing|brief|spreadsheet|statement)\b/i,
  },

  // ── 4. Organizational Possessives ───────────────────────────────────────
  {
    intent: 'drafting_sensitive',
    direction: 'outward',
    confidence: 0.8,
    pattern: /\b(?:our\s+(?:client|company|firm|organization|team|department|deal|acquisition|merger|target|portfolio|fund|strategy|board|investors?|shareholders?|counsel))\b/i,
  },
  {
    intent: 'drafting_sensitive',
    direction: 'outward',
    confidence: 0.7,
    pattern: /\b(?:(?:the\s+)?(?:company|firm|client|patient|employee)(?:'s|s')\s+(?:data|records?|information|details?|financials?|salary|compensation|health|medical|performance))\b/i,
  },
  // Drafting with context (email/memo to someone about sensitive topics)
  {
    intent: 'drafting_sensitive',
    direction: 'outward',
    confidence: 0.7,
    pattern: /\b(?:(?:draft|write|compose|prepare|create)\s+(?:a\s+)?(?:email|message|letter|memo|brief|report|presentation|proposal|response|reply)\s+(?:to|for|about|regarding|re:?))\b/i,
  },

  // ── 5. Research / Interrogative ─────────────────────────────────────────
  {
    intent: 'research',
    direction: 'inward',
    confidence: 0.85,
    pattern: /^(?:\s*)(?:what\s+(?:is|are|does|do|was|were|can|could|should|would|will|has|have)|who\s+(?:is|are|was|were)|where\s+(?:is|are|do|does|can)|when\s+(?:is|are|was|were|do|does|did|will)|why\s+(?:is|are|do|does|did|would|should)|how\s+(?:do|does|can|could|should|would|is|are|to|much|many|long|often))\b/i,
  },
  {
    intent: 'research',
    direction: 'inward',
    confidence: 0.8,
    pattern: /^(?:\s*)(?:tell\s+me\s+(?:about|more)|explain\s+(?:what|how|why|the)|describe\s+(?:the|how|what)|define\s+|look\s*up\s+|search\s+for\s+|find\s+(?:info|information)\s+(?:on|about))\b/i,
  },

  // ── 6. Creative Writing ─────────────────────────────────────────────────
  {
    intent: 'creative',
    direction: 'inward',
    confidence: 0.85,
    pattern: /\b(?:write\s+(?:a\s+)?(?:story|poem|song|haiku|limerick|essay|article|blog\s*post|script|dialogue|monologue|speech|novel|chapter|verse|lyrics)|(?:creative|fictional|fantasy|sci[\s-]?fi)\s+(?:writing|story|narrative)|imagine\s+(?:a|that)|(?:fictional|hypothetical)\s+scenario)\b/i,
  },

  // ── 7. Productivity ─────────────────────────────────────────────────────
  {
    intent: 'productivity',
    direction: 'inward',
    confidence: 0.8,
    pattern: /^(?:\s*)(?:summariz|translat|paraphras|proofread|format|reformat|restructur|reorganiz|clean\s+up|fix\s+(?:the\s+)?(?:formatting|grammar|spelling|punctuation|typos?))/i,
  },

  // ── 8. Brainstorming ───────────────────────────────────────────────────
  {
    intent: 'brainstorming',
    direction: 'inward',
    confidence: 0.8,
    pattern: /\b(?:brainstorm|ideate|suggest|come\s+up\s+with|think\s+of|generate\s+(?:ideas|options|alternatives|solutions)|what\s+(?:are\s+)?(?:some|good|creative)\s+(?:ideas|ways|options|approaches))\b/i,
  },

  // ── 9. Code ────────────────────────────────────────────────────────────
  {
    intent: 'coding',
    direction: 'inward',
    confidence: 0.8,
    pattern: /\b(?:(?:write|create|build|implement|code|develop|debug|fix)\s+(?:a\s+)?(?:function|class|method|script|program|app|component|module|API|endpoint|query|test)|(?:refactor|optimize|review)\s+(?:this|the|my)\s+(?:code|function|class))\b/i,
  },
  {
    intent: 'coding',
    direction: 'inward',
    confidence: 0.7,
    pattern: /(?:```(?:js|ts|py|java|go|rust|c|cpp|csharp|ruby|php|swift|kotlin)|(?:^|\n)\s*(?:import\s+\{|from\s+\w+\s+import|const\s+\w+\s*=|function\s+\w+\(|class\s+\w+\s*\{|def\s+\w+\())/m,
  },
];

// Outward clause signals that override inward classification
const OUTWARD_CLAUSE_SIGNALS: RegExp[] = [
  /\b(?:here\s+(?:is|are)\s+(?:the|my|our|a))\b/i,
  /\b(?:(?:I(?:'m|\s+am)\s+(?:sharing|sending|providing|pasting|forwarding)))\b/i,
  /\b(?:take\s+a\s+look\s+at|check\s+(?:this|these)|see\s+(?:below|attached|the\s+following))\b/i,
  /\b(?:(?:the|this)\s+(?:data|information|document|contract|agreement|memo|report)\s+(?:is|contains|includes|shows))\b/i,
];

/**
 * Classify a prompt's intent and direction.
 */
export function classifyIntent(text: string): IntentClassification {
  if (!text || text.trim().length < 3) {
    return { intent: 'general', direction: 'inward', confidence: 0.5 };
  }

  let result: IntentClassification | null = null;

  for (const p of INTENT_PATTERNS) {
    p.pattern.lastIndex = 0;
    if (p.pattern.test(text)) {
      result = { intent: p.intent, direction: p.direction, confidence: p.confidence };
      break;
    }
  }

  if (!result) {
    result = { intent: 'general', direction: 'inward', confidence: 0.5 };
  }

  // Clause-level override: outward signal in ANY clause dominates
  if (result.direction === 'inward') {
    for (const signal of OUTWARD_CLAUSE_SIGNALS) {
      signal.lastIndex = 0;
      if (signal.test(text)) {
        result = { ...result, direction: 'outward' };
        result.confidence = Math.max(0.6, result.confidence - 0.1);
        break;
      }
    }
  }

  // Long prompts (>1000 chars) with inward intent are suspicious (pasted content)
  if (result.direction === 'inward' && text.length > 1000 && result.intent !== 'coding') {
    result = { ...result, direction: 'outward' };
    result.confidence = Math.max(0.6, result.confidence - 0.15);
  }

  return result;
}

/**
 * Get the score weight for a given intent.
 * Used to multiply entity risk score.
 */
export function getIntentWeight(classification: IntentClassification): number {
  return INTENT_WEIGHTS[classification.intent] ?? 1.0;
}

/**
 * Quick check: is this prompt clearly inward (safe)?
 * Used by the fast path to skip full detection for 80% of messages.
 */
export function isQuickPassthrough(text: string): boolean {
  if (!text || text.length > 500) return false;
  const result = classifyIntent(text);
  return result.direction === 'inward' &&
    result.confidence >= 0.8 &&
    ['research', 'creative', 'productivity', 'coding', 'brainstorming'].includes(result.intent);
}
