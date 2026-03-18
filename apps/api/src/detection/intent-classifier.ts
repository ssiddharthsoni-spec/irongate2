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
  /** Detected language code (ISO 639-1). 'en' for English, 'unknown' for undetermined. */
  detectedLanguage?: string;
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
    pattern: /(?:(?:api[_\s-]?key|password|secret|token|credential|private[_\s-]?key)\s*(?:[:=]|\s+is\s)|(?:BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY)|(?:AKIA[A-Z0-9]{12,})|(?:mongodb\+srv:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/))/i,
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

// Organizational possessives near business terms — strongest outward signal
// "our revenue", "my employee", "we plan to acquire", "the company's roadmap"
const ORG_POSSESSIVE_PATTERN = /\b(?:our|we(?:'re|\s+are|\s+plan|\s+will)?|the\s+(?:company|firm|organization|team)(?:'s)?)\s+(?:\w+\s+){0,3}(?:revenue|income|profit|margin|salary|salaries|compensation|headcount|valuation|forecast|roadmap|pipeline|acquisition|merger|target|deal|strategy|budget|layoff|restructur|employee|client|customer|patient|partner|contract|agreement|settlement|litigation|IP|patent|trade\s*secret|proprietary)/i;

/**
 * Split text into clauses for per-clause intent analysis.
 * Splits on sentence boundaries (. ! ? ;) and newlines.
 */
function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map(c => c.trim())
    .filter(c => c.length >= 5);
}

/**
 * Classify a single clause's intent (internal helper).
 */
function classifyClause(clause: string): IntentClassification {
  for (const p of INTENT_PATTERNS) {
    p.pattern.lastIndex = 0;
    if (p.pattern.test(clause)) {
      return { intent: p.intent, direction: p.direction, confidence: p.confidence };
    }
  }
  return { intent: 'general', direction: 'inward', confidence: 0.5 };
}

/**
 * Classify a prompt's intent and direction.
 *
 * Uses clause-level analysis: splits text into sentences/clauses and
 * classifies each independently. Outward signal in ANY clause dominates —
 * the damage is done the moment internal data appears, regardless of
 * what follows ("Our revenue was $42M, what trends do you see?").
 */
export function classifyIntent(text: string): IntentClassification {
  if (!text || text.trim().length < 3) {
    return { intent: 'general', direction: 'inward', confidence: 0.5 };
  }

  // ── First: full-message classification (priority patterns) ──
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

  // ── Second: clause-level analysis — outward in ANY clause dominates ──
  if (result.direction === 'inward') {
    const clauses = splitClauses(text);
    for (const clause of clauses) {
      // Check outward clause signals
      for (const signal of OUTWARD_CLAUSE_SIGNALS) {
        signal.lastIndex = 0;
        if (signal.test(clause)) {
          result = { ...result, direction: 'outward' };
          result.confidence = Math.max(0.6, result.confidence - 0.1);
          break;
        }
      }
      if (result.direction === 'outward') break;

      // Check if any clause individually classifies as outward
      const clauseResult = classifyClause(clause);
      if (clauseResult.direction === 'outward') {
        // Outward clause found — escalate the overall classification
        // Use the outward intent if it's more specific than current
        const outwardWeight = INTENT_WEIGHTS[clauseResult.intent] ?? 1.0;
        const currentWeight = INTENT_WEIGHTS[result.intent] ?? 1.0;
        if (outwardWeight > currentWeight) {
          result = { ...clauseResult }; // adopt the outward clause's classification
        } else {
          result = { ...result, direction: 'outward' };
          result.confidence = Math.max(0.6, result.confidence - 0.1);
        }
        break;
      }
    }
  }

  // ── Third: organizational possessives — strongest outward signal ──
  // "our revenue", "my employee", "we plan to acquire" within 3 tokens of business terms
  if (result.direction === 'inward') {
    if (ORG_POSSESSIVE_PATTERN.test(text)) {
      result = { intent: 'drafting_sensitive', direction: 'outward', confidence: 0.8 };
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
  if (!text || text.length > 2000) return false;
  const result = classifyIntent(text);
  return result.direction === 'inward' &&
    result.confidence >= 0.8 &&
    ['research', 'creative', 'productivity', 'coding', 'brainstorming'].includes(result.intent);
}

// ---------------------------------------------------------------------------
// Second pass: NLP parsing with compromise.js for ambiguous cases (~10%)
// Uses sentence structure analysis to determine if entities are subjects of
// questions (inward) or declarative statements (outward).
// ---------------------------------------------------------------------------

let nlpInstance: any = null;
async function loadNlp(): Promise<any> {
  if (!nlpInstance) {
    const mod = await import('compromise');
    nlpInstance = mod.default || mod;
  }
  return nlpInstance;
}

/**
 * NLP-enhanced intent classification for ambiguous messages.
 * Analyzes sentence structure: is the entity the subject of a question
 * (research/inward) or a declarative statement (disclosure/outward)?
 *
 * Only called when regex-based classifyIntent() returns confidence < 0.7.
 */
export async function classifyIntentNlp(text: string): Promise<IntentClassification> {
  // Start with regex result
  const regexResult = classifyIntent(text);

  // Only enhance ambiguous cases
  if (regexResult.confidence >= 0.7) return regexResult;

  try {
    const nlpFn = await loadNlp();
    const doc = nlpFn(text);
    const sentences = doc.sentences();

    let outwardSignals = 0;
    let inwardSignals = 0;
    let totalSentences = 0;

    sentences.forEach((sent: any) => {
      totalSentences++;
      const sentText = sent.text();
      const verbs = sent.verbs();

      // Question sentences → inward
      if (sentText.trim().endsWith('?') || sent.has('#QuestionWord')) {
        inwardSignals++;
        return;
      }

      // Imperative sentences with creative/productivity verbs → inward
      if (sent.has('#Imperative') && /\b(write|create|explain|describe|translate|summarize|debug|fix|code|build|brainstorm)\b/i.test(sentText)) {
        inwardSignals++;
        return;
      }

      // Declarative with first-person plural possessive + business noun → outward
      if (/\b(?:our|we|the\s+company)\b/i.test(sentText)) {
        // Check if the verb is presenting/sharing (was, is, are, has, earned)
        const verbTexts = verbs.text().toLowerCase();
        if (/\b(?:is|are|was|were|has|had|earned|makes?|generated|reported|achieved|lost|grew|declined)\b/.test(verbTexts)) {
          outwardSignals++;
          return;
        }
      }

      // Sentences with listed data (Name: Value patterns) → outward
      if (/^[\w\s]{2,30}[:]\s*\S/m.test(sentText)) {
        outwardSignals++;
        return;
      }

      // Third-person declarative with person/org as subject → check context
      if (sent.has('#Person') || sent.has('#Organization')) {
        // "Sarah Chen in our engineering team" → outward (internal reference)
        if (/\b(?:our|internal|team|department|firm|company)\b/i.test(sentText)) {
          outwardSignals++;
        } else {
          // "Tim Cook at Apple" → likely inward (public reference)
          inwardSignals++;
        }
      }
    });

    if (totalSentences === 0) return regexResult;

    // Determine direction based on signal ratio
    const outwardRatio = outwardSignals / totalSentences;
    const inwardRatio = inwardSignals / totalSentences;

    if (outwardRatio > 0.3 && outwardRatio > inwardRatio) {
      // NLP confirms outward — boost confidence
      return {
        intent: regexResult.intent === 'general' ? 'communication_sharing' : regexResult.intent,
        direction: 'outward',
        confidence: Math.min(0.85, regexResult.confidence + 0.15),
      };
    } else if (inwardRatio > 0.5) {
      // NLP confirms inward — boost confidence
      return {
        intent: regexResult.intent === 'general' ? 'research' : regexResult.intent,
        direction: 'inward',
        confidence: Math.min(0.85, regexResult.confidence + 0.15),
      };
    }

    // NLP inconclusive — return regex result with slight confidence drop
    return regexResult;
  } catch {
    // NLP unavailable — fall back to regex result
    return regexResult;
  }
}

// ---------------------------------------------------------------------------
// Third pass: LLM fallback for truly ambiguous cases (~3-5%)
// Calls GPT-4o-mini (or compatible) in parallel with entity detection.
// Only fires when both regex and NLP return confidence < 0.6.
// ---------------------------------------------------------------------------

export interface LlmClassifierConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * LLM-enhanced intent classification for truly ambiguous messages.
 * Sends a short prompt to GPT-4o-mini asking: is the user disclosing
 * private/internal information, or using the LLM for research/productivity?
 *
 * Returns a classification or null if the call fails/times out.
 */
export async function classifyIntentLlm(
  text: string,
  config: LlmClassifierConfig,
): Promise<IntentClassification | null> {
  const { apiKey, baseUrl = 'https://api.openai.com/v1', model = 'gpt-4o-mini', timeoutMs = 1500 } = config;

  // Truncate to avoid token limits (first 1500 chars is enough for classification)
  const truncated = text.length > 1500 ? text.substring(0, 1500) + '...' : text;

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a data classification assistant. Classify the user's text into exactly one category.
Reply with ONLY the category name, nothing else.

Categories:
- research: User is asking about public knowledge, looking up facts, or researching a topic
- creative: User wants creative writing (poem, story, script)
- productivity: User wants translation, reformatting, proofreading, summarizing
- coding: User wants help with code
- brainstorming: User wants ideas or suggestions
- data_analysis: User is sharing internal/private data for analysis
- drafting_sensitive: User is drafting a document involving private information
- communication_sharing: User is sharing internal communications, emails, or documents
- credential_disclosure: User is sharing passwords, API keys, or secrets
- general: None of the above clearly apply`,
          },
          { role: 'user', content: truncated },
        ],
        max_tokens: 20,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) return null;

    const result = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = result.choices?.[0]?.message?.content?.trim().toLowerCase();
    if (!reply) return null;

    // Map LLM reply to our types
    const OUTWARD_INTENTS = new Set([
      'data_analysis', 'drafting_sensitive', 'communication_sharing', 'credential_disclosure',
    ]);
    const validIntents = new Set(Object.keys(INTENT_WEIGHTS));
    const intent = (validIntents.has(reply) ? reply : 'general') as IntentCategory;
    const direction: IntentDirection = OUTWARD_INTENTS.has(intent) ? 'outward' : 'inward';

    return { intent, direction, confidence: 0.85 };
  } catch {
    return null;
  }
}

/**
 * Full three-pass intent classification.
 * Pass 1: Regex patterns (~85% of messages, <1ms)
 * Pass 2: NLP parsing for ambiguous cases (~10%, ~5ms)
 * Pass 3: LLM fallback for truly ambiguous (~5%, ~500ms)
 *
 * The LLM pass is optional — requires llmConfig. If not provided,
 * falls back to the best result from passes 1+2.
 */
/**
 * Detect primary language of text using Unicode script analysis.
 * Returns ISO 639-1 code or 'unknown'. Lightweight — no external deps.
 */
export function detectLanguage(text: string): string {
  const sample = text.substring(0, 1000);
  const totalChars = sample.replace(/[\s\d\p{P}\p{S}]/gu, '').length;
  if (totalChars < 5) return 'unknown';

  // Count chars by script
  const latinChars = (sample.match(/[\p{Script=Latin}]/gu) || []).length;
  const cjkChars = (sample.match(/[\p{Script=Han}]/gu) || []).length;
  const cyrillicChars = (sample.match(/[\p{Script=Cyrillic}]/gu) || []).length;
  const arabicChars = (sample.match(/[\p{Script=Arabic}]/gu) || []).length;
  const devanagariChars = (sample.match(/[\p{Script=Devanagari}]/gu) || []).length;
  const hangulChars = (sample.match(/[\p{Script=Hangul}]/gu) || []).length;
  const kanaChars = (sample.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;

  const latinRatio = latinChars / totalChars;

  // Non-Latin script detection (high confidence)
  if (kanaChars > 0 && (kanaChars + cjkChars) / totalChars > 0.3) return 'ja';
  if (cjkChars / totalChars > 0.3) return 'zh';
  if (hangulChars / totalChars > 0.3) return 'ko';
  if (cyrillicChars / totalChars > 0.3) return 'ru';
  if (arabicChars / totalChars > 0.3) return 'ar';
  if (devanagariChars / totalChars > 0.3) return 'hi';

  // Latin-script language detection via common words
  if (latinRatio > 0.5) {
    const lower = sample.toLowerCase();
    if (/\b(der|die|das|und|ist|ein|nicht|mit|ich|auf)\b/.test(lower)) return 'de';
    if (/\b(le|la|les|des|est|une|pas|avec|dans|pour)\b/.test(lower)) return 'fr';
    if (/\b(el|la|los|las|una|del|por|con|que|para)\b/.test(lower)) return 'es';
    if (/\b(il|la|dei|della|che|con|per|una|sono|nel)\b/.test(lower)) return 'it';
    if (/\b(de|het|een|van|voor|met|dat|niet|zijn|ook)\b/.test(lower)) return 'nl';
    if (/\b(o|a|os|as|um|uma|do|da|no|na|que|para)\b/.test(lower)) return 'pt';
    return 'en';
  }

  return 'unknown';
}

export async function classifyIntentFull(
  text: string,
  llmConfig?: LlmClassifierConfig,
): Promise<IntentClassification> {
  const detectedLanguage = detectLanguage(text);

  // Pass 1: regex
  const regexResult = classifyIntent(text);
  regexResult.detectedLanguage = detectedLanguage;

  // Non-English: reduce confidence of regex patterns (they're English-trained)
  const isNonEnglish = detectedLanguage !== 'en' && detectedLanguage !== 'unknown';
  const adjustedConfidence = isNonEnglish
    ? regexResult.confidence * 0.5
    : regexResult.confidence;

  if (adjustedConfidence >= 0.7) return regexResult;

  // Pass 2: NLP
  const nlpResult = await classifyIntentNlp(text);
  nlpResult.detectedLanguage = detectedLanguage;
  if (nlpResult.confidence >= 0.7) return nlpResult;

  // Pass 3: LLM (optional) — especially valuable for non-English text
  if (llmConfig?.apiKey && (isNonEnglish || nlpResult.confidence < 0.7)) {
    const llmResult = await classifyIntentLlm(text, llmConfig);
    if (llmResult) {
      llmResult.detectedLanguage = detectedLanguage;
      return llmResult;
    }
  }

  // Return best result from passes 1-2
  const best = nlpResult.confidence >= regexResult.confidence ? nlpResult : regexResult;
  best.detectedLanguage = detectedLanguage;
  return best;
}
