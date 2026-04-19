// ============================================================================
// Intent + Context Classifier (LLM-based)
// ============================================================================
//
// The PRIMARY decision layer for IronGate. Replaces pattern-based intent
// suppression. The local LLM (Ollama) reads the user's prompt and returns
// structured JSON telling us:
//
//   1. What is the user trying to do? (intent)
//   2. Are the sensitive-looking values REAL or REFERENTIAL? (values_are_real)
//   3. Therefore, what's the sensitivity? (sensitivity)
//
// Design principle: the LLM reasons about intent, not patterns. We stop
// playing whack-a-mole with individual scenarios. If the model understands
// language, it understands context.
//
// Why a local LLM (not a cloud LLM):
//   - Zero-persistence architecture — prompt content never leaves device
//   - Consistent with IronGate's sovereign-mode guarantee
//   - Low latency (~500ms on-device vs 1-2s over network)
//
// Fallback behavior when Ollama is unavailable:
//   - Return { intent: 'ambiguous', valuesAreReal: true, sensitivity: 'medium' }
//   - This is the conservative default: treat as sensitive, let user proceed
//     with a warning rather than silently leak or silently block.
// ============================================================================

export type ClassifierIntent =
  | 'research'
  | 'creative'
  | 'meta_discussion'
  | 'work_sharing'
  | 'code'
  | 'personal'
  | 'educational'
  | 'ambiguous';

export type ClassifierSensitivity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Named entity detected by the LLM classifier. */
export interface ClassifierNamedEntity {
  type: string; // PERSON, ORGANIZATION, LOCATION, PROJECT_NAME, etc.
  text: string;
  isSensitive: boolean;
}

export interface IntentContextResult {
  intent: ClassifierIntent;
  valuesAreReal: boolean;
  sensitivity: ClassifierSensitivity;
  reasoning: string;
  /** The classifier's own derived zone + action (callers usually use these) */
  zone: 'green' | 'amber' | 'red';
  action: 'pass' | 'warn' | 'block' | 'proxy';
  /** Numeric score for compat with legacy scorer (0-100) */
  score: number;
  /** Source label for audit/logging */
  source: string;
  /** True when Ollama was unavailable and we fell back */
  fellBack: boolean;
  latencyMs: number;
  /** Named entities detected by Gemma (NER). Empty when fellBack=true. */
  namedEntities: ClassifierNamedEntity[];
}

// ============================================================================
// THE SYSTEM PROMPT — the single source of truth for classification behavior
// ============================================================================

export const INTENT_CONTEXT_SYSTEM_PROMPT = `You are a privacy classifier. Output ONLY a JSON object with these EXACT fields and allowed values:
- intent: MUST be one of: research, creative, meta_discussion, work_sharing, code, personal, educational, ambiguous
- values_are_real: true or false
- sensitivity: MUST be one of: none, low, medium, high, critical
- reasoning: one short sentence

RULES:
1. Real names + identifiers (SSN, employee ID, MRN, DOB, account numbers) in work context = work_sharing / high or critical / values_are_real: true
2. Credit cards, CVVs, bank routing numbers = work_sharing / critical / values_are_real: true
3. Phone + address for a third party = work_sharing / high / values_are_real: true
4. Public figures (CEOs, politicians, celebrities) being DISCUSSED = research / none / values_are_real: false
5. Fiction (novel, story, roleplay) even with PII-like patterns = creative / low / values_are_real: false
6. Code with placeholders (000-00-0000, John Doe, test-key) = code / none / values_are_real: false
7. User's OWN data (resume, bio, cover letter) = personal / low / values_are_real: true
8. Policy/compliance DISCUSSION without real data = meta_discussion / none / values_are_real: false
9. Follow-up referencing a named client/matter/deal = ambiguous / medium / values_are_real: true
10. Mixing research framing with real data = work_sharing (protect the data)`;

// Function-calling tool definition for Ollama /api/chat.
// This makes Gemma return structured output including named entities.
const JUDGMENT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'classifyPrompt',
    description: 'Classify a user prompt for privacy sensitivity and identify named entities',
    parameters: {
      type: 'object',
      required: ['intent', 'values_are_real', 'sensitivity', 'reasoning', 'named_entities'],
      properties: {
        intent: {
          type: 'string',
          enum: ['research', 'creative', 'meta_discussion', 'work_sharing', 'code', 'personal', 'educational', 'ambiguous'],
        },
        values_are_real: { type: 'boolean' },
        sensitivity: {
          type: 'string',
          enum: ['none', 'low', 'medium', 'high', 'critical'],
        },
        reasoning: { type: 'string', description: 'One short sentence' },
        named_entities: {
          type: 'array',
          description: 'All named entities detected in the prompt',
          items: {
            type: 'object',
            required: ['type', 'text', 'is_sensitive'],
            properties: {
              type: { type: 'string', enum: ['PERSON', 'ORGANIZATION', 'LOCATION', 'PROJECT_NAME', 'DEAL_CODENAME', 'PRODUCT'] },
              text: { type: 'string' },
              is_sensitive: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
};

// ============================================================================
// Sensitivity → Zone / Action mapping
// ============================================================================

function mapSensitivityToZone(
  sensitivity: ClassifierSensitivity,
  intent: ClassifierIntent,
): { zone: 'green' | 'amber' | 'red'; score: number; action: 'pass' | 'warn' | 'block' | 'proxy' } {
  // Research / meta / educational with sensitivity=none → pure green, no intervention
  if ((intent === 'research' || intent === 'meta_discussion' || intent === 'educational') && sensitivity === 'none') {
    return { zone: 'green', score: 5, action: 'pass' };
  }
  // Creative / code → green by default unless sensitivity escalates
  if ((intent === 'creative' || intent === 'code') && (sensitivity === 'none' || sensitivity === 'low')) {
    return { zone: 'green', score: sensitivity === 'none' ? 5 : 15, action: 'pass' };
  }
  // Personal (user's own data) → green for low; amber if higher
  if (intent === 'personal' && sensitivity === 'low') {
    return { zone: 'green', score: 20, action: 'pass' };
  }

  // Default mapping by sensitivity tier
  switch (sensitivity) {
    case 'none':
      return { zone: 'green', score: 5, action: 'pass' };
    case 'low':
      return { zone: 'green', score: 20, action: 'pass' };
    case 'medium':
      return { zone: 'amber', score: 45, action: 'warn' };
    case 'high':
      return { zone: 'red', score: 75, action: 'proxy' };
    case 'critical':
      return { zone: 'red', score: 95, action: 'proxy' };
  }
}

// ============================================================================
// Parse the LLM's JSON output robustly
// ============================================================================

function parseClassifierOutput(raw: string): Omit<IntentContextResult, 'zone' | 'action' | 'score' | 'source' | 'fellBack' | 'latencyMs'> | null {
  try {
    // LLMs sometimes wrap JSON in markdown code fences. Strip them.
    const cleaned = raw.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const intent = String(parsed.intent ?? '').trim() as ClassifierIntent;
    const validIntents: ClassifierIntent[] = [
      'research', 'creative', 'meta_discussion', 'work_sharing',
      'code', 'personal', 'educational', 'ambiguous',
    ];
    if (!validIntents.includes(intent)) return null;

    const sensitivity = String(parsed.sensitivity ?? '').trim() as ClassifierSensitivity;
    const validSensitivities: ClassifierSensitivity[] = ['none', 'low', 'medium', 'high', 'critical'];
    if (!validSensitivities.includes(sensitivity)) return null;

    const valuesAreReal = Boolean(parsed.values_are_real);
    const reasoning = String(parsed.reasoning ?? '').slice(0, 500);

    // Extract named entities from Gemma's NER output
    const rawEntities = Array.isArray(parsed.named_entities) ? parsed.named_entities : [];
    const namedEntities: ClassifierNamedEntity[] = rawEntities
      .filter((e: any) => e && typeof e.type === 'string' && typeof e.text === 'string')
      .map((e: any) => ({
        type: String(e.type),
        text: String(e.text),
        isSensitive: Boolean(e.is_sensitive),
      }));

    return { intent, valuesAreReal, sensitivity, reasoning, namedEntities };
  } catch {
    return null;
  }
}

// ============================================================================
// Conservative fallback when Ollama is unavailable
// ============================================================================

export function fallbackResult(startTime: number): IntentContextResult {
  return {
    intent: 'ambiguous',
    valuesAreReal: true,
    sensitivity: 'medium',
    reasoning: 'Local LLM unavailable — defaulting to conservative protection',
    zone: 'amber',
    score: 45,
    action: 'warn',
    source: 'fallback',
    fellBack: true,
    latencyMs: Date.now() - startTime,
    namedEntities: [], // Honest: no NER when Gemma is down
  };
}

// ============================================================================
// The classifier itself
// ============================================================================

export interface ClassifierConfig {
  endpoint: string; // e.g., "http://localhost:11434/api/generate"
  model: string; // e.g., "gemma3:4b"
  format: 'ollama' | 'openai-compatible';
  timeoutMs?: number;
  /**
   * Optional API key for the LLM endpoint. If set, it's sent as
   *   Authorization: Bearer <apiKey>
   * Use cases:
   *   - Ollama running behind a reverse proxy (Caddy, nginx) that enforces
   *     a shared-secret header — mitigates the audit concern that any
   *     local process can impersonate localhost:11434.
   *   - OpenAI-compatible endpoints (vLLM, TGI, etc.) that require auth.
   * When unset, no Authorization header is attached. Sr. Engineer Audit · Item 6.
   */
  apiKey?: string;
}

/**
 * Classify a prompt's intent + context using the local LLM.
 * Returns a structured result; falls back conservatively on any failure.
 */
export async function classifyIntentAndContext(
  promptText: string,
  config: ClassifierConfig,
): Promise<IntentContextResult> {
  const start = Date.now();
  const timeout = config.timeoutMs ?? 5000;

  try {
    const userMessage = `Classify:\n"${promptText}"`;
    const response = await callLlm(
      INTENT_CONTEXT_SYSTEM_PROMPT,
      userMessage,
      config,
      timeout,
    );

    const parsed = parseClassifierOutput(response);
    if (!parsed) {
      // LLM returned malformed JSON — fall back
      return fallbackResult(start);
    }

    const mapping = mapSensitivityToZone(parsed.sensitivity, parsed.intent);
    return {
      ...parsed,
      zone: mapping.zone,
      action: mapping.action,
      score: mapping.score,
      source: `intent-context:${config.model}`,
      fellBack: false,
      latencyMs: Date.now() - start,
    };
  } catch {
    return fallbackResult(start);
  }
}

// ============================================================================
// LLM call — supports Ollama + OpenAI-compatible endpoints
// ============================================================================

async function callLlm(
  systemPrompt: string,
  userMessage: string,
  config: ClassifierConfig,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  try {
    if (config.format === 'ollama') {
      // Use /api/generate with format=json for fast structured output.
      // format=json forces Ollama to output valid JSON without wasting
      // tokens on prose, markdown fences, or function-calling overhead.
      // gemma3:4b responds in ~1.7s with this approach vs 12-15s with
      // function-calling on gemma4:e2b.
      // Ensure endpoint ends with /api/generate regardless of input format
      let generateEndpoint = config.endpoint.replace(/\/api\/chat$/, '/api/generate');
      if (!generateEndpoint.endsWith('/api/generate')) {
        generateEndpoint = generateEndpoint.replace(/\/+$/, '') + '/api/generate';
      }
      const response = await fetch(generateEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          system: systemPrompt,
          prompt: userMessage,
          stream: false,
          format: 'json',
          options: { temperature: 0.0, num_predict: 150 },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Ollama ${response.status}`);
      const data = (await response.json()) as any;

      if (typeof data?.response === 'string') {
        return data.response;
      }

      throw new Error('Ollama response missing content');
    }

    // openai-compatible
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}
