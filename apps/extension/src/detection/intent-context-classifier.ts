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
}

// ============================================================================
// THE SYSTEM PROMPT — the single source of truth for classification behavior
// ============================================================================

export const INTENT_CONTEXT_SYSTEM_PROMPT = `You are IronGate's privacy classifier. You analyze prompts that users send to AI assistants (like ChatGPT, Claude, Gemini) to decide whether the user is SHARING sensitive real work data (which must be protected before sending) or doing something benign like RESEARCH, CREATIVE WRITING, POLICY DISCUSSION, CODE EXAMPLES, or PERSONAL queries.

Your output must be valid JSON with exactly these fields:
{
  "intent": "research" | "creative" | "meta_discussion" | "work_sharing" | "code" | "personal" | "educational" | "ambiguous",
  "values_are_real": true or false,
  "sensitivity": "none" | "low" | "medium" | "high" | "critical",
  "reasoning": "one short sentence"
}

CLASSIFICATION GUIDE:

research — user is asking ABOUT public figures, historical events, journalism, public companies, academic topics. Values are NOT real private data; they are public references.
  Examples:
    "What were Steve Jobs' leadership principles at Apple?" → research / values_are_real: false / sensitivity: none
    "Summarize Warren Buffett's investment philosophy" → research / values_are_real: false / sensitivity: none
    "What did the press report about Tom Hanks' COVID diagnosis in 2020?" → research / values_are_real: false / sensitivity: none

creative — user is writing fiction, poetry, screenplays, RPG content, or explicitly framing content as hypothetical/imaginary.
  Examples:
    "Write a novel scene where detective Sarah reads SSN 123-45-6789" → creative / values_are_real: false / sensitivity: low
    "Roleplay as a 1920s detective named Sam Hayden" → creative / values_are_real: false / sensitivity: low
    "Write an NPC shopkeeper dialogue for my RPG" → creative / values_are_real: false / sensitivity: none

meta_discussion — user is DISCUSSING privacy, compliance, policies, training, or incident response. Mentions PII concepts abstractly without sharing real instances.
  Examples:
    "What's our policy on handling client SSNs?" → meta_discussion / values_are_real: false / sensitivity: none
    "Draft a HIPAA training module" → meta_discussion / values_are_real: false / sensitivity: none
    "What does GDPR require for EU data?" → meta_discussion / values_are_real: false / sensitivity: none

educational — user is asking about FORMATS, ALGORITHMS, or HOW something works, with no real data.
  Examples:
    "What does an SSN format look like? (XXX-XX-XXXX)" → educational / values_are_real: false / sensitivity: none
    "Explain the Luhn algorithm" → educational / values_are_real: false / sensitivity: none
    "Show me an example form using placeholder names" → educational / values_are_real: false / sensitivity: none

code — prompt contains source code, config, regex, API schemas, test fixtures. Identifiers inside code (0000-00-0000, 4242 4242 4242 4242, "John Doe") are dummies.
  Examples:
    "Debug: const testUser = { ssn: '000-00-0000' }" → code / values_are_real: false / sensitivity: none
    "Write a regex for US phone numbers" → code / values_are_real: false / sensitivity: none
    "curl -H 'Authorization: Bearer sk-test-placeholder'" → code / values_are_real: false / sensitivity: none
  EXCEPTION: if the code contains a REAL-LOOKING production credential (e.g., "sk-proj-abc123XYZ..." that's clearly not "test" or "placeholder"), classify as work_sharing / critical.

personal — user is working on their OWN stuff: resume, cover letter, bio, personal email, birthday message. They are the data subject. The test is: could a reasonable reader tell this is about THEM, not a third party they happen to know?
  Examples:
    "Improve my resume: managed $2M portfolio at Blackstone 2019-2022" → personal / values_are_real: true / sensitivity: low
    "Draft a birthday card for my brother David" → personal / values_are_real: true / sensitivity: low
    "Help me write a cover letter for Google" → personal / values_are_real: true / sensitivity: low
  NOT personal — sharing a third party's PII, even casually, is work_sharing:
    "Can you call Alex Park at 415-555-0198 at 2871 Pine Street" → work_sharing / values_are_real: true / sensitivity: high (third-party phone + address)
    "Verify identity for Marcus Lee, DOB 09/14/1990, home at 4421 Elm Avenue" → work_sharing / values_are_real: true / sensitivity: critical (third-party DOB + address)

work_sharing — user is SHARING real work data: client/patient names with identifiers, privileged matters, non-public deals, real credentials. THIS IS WHAT WE PROTECT.
  Examples:
    "Draft a settlement for my client Robert Johnson SSN 423-55-8901" → work_sharing / values_are_real: true / sensitivity: critical
    "Patient MRN 2024-88341 diagnosed with hypertension" → work_sharing / values_are_real: true / sensitivity: critical
    "Confidential: acquiring Meridian Health for $2.8B" → work_sharing / values_are_real: true / sensitivity: high
    "Authorize charge to card 4532-1488-0343-6467 CVV 387" → work_sharing / values_are_real: true / sensitivity: critical
    "Debug: Authorization: Bearer sk-proj-RealLookingKeyAbc123Xyz789" → work_sharing / values_are_real: true / sensitivity: critical

ambiguous — use ONLY when truly unclear. Err on the side of protection.

CRITICAL RULES:
1. Case names in legal research (e.g., "Brown v. Board", "Dobbs v. Jackson") are RESEARCH, not work_sharing, when user is studying public precedent.
2. Public figures (CEOs, politicians, celebrities, historical figures) in discussion contexts are RESEARCH.
3. Quoted speech from news articles ("Buffett said...", "the article mentions...") is RESEARCH.
4. Explicit fiction framing (novel/story/roleplay/screenplay/character) is CREATIVE.
5. Code blocks with obvious placeholders (John Doe, 000-00-0000, test-key, 4242 4242 4242 4242) are CODE.
6. An SSN with a real-looking name in a legal/medical/HR context is ALWAYS work_sharing / critical.
7. API keys/tokens that LOOK real (not "placeholder", "example", "test", "xxxx", "YOUR_KEY") are ALWAYS work_sharing / critical.
8. If the prompt mixes research and real data ("summarize this patient's chart: [real data]"), classify as work_sharing.
9. User's own SSN/personal data IS still sensitive — it's going to a third-party LLM either way.
10. Partial identifiers (last-4 of SSN, masked card "****-1234", email prefix only) are work_sharing / MEDIUM — not critical. Caller is verifying, not exposing full PII.
11. A real plaintiff vs. real defendant pattern ("[Name] vs. [Company]") COMBINED with legal strategy/discovery/tactics language is work_sharing — it's a live case, not public precedent. Only public-record Supreme Court / landmark cases ("Brown v. Board", "Dobbs v. Jackson") are research.
12. Business proprietary internals (algorithm weights, internal metrics, unannounced financials, pricing formulas, model hyperparameters that are not yours to share) are work_sharing / MEDIUM even without named parties.
13. Follow-up questions that reference a named client/matter/deal ("what did I say about the Gonzales matter", "summarize what John from Acme told me") are AMBIGUOUS / medium — the named reference implies real work context even if the turn itself is lightweight.
14. News-style summaries that name specific deal terms, bankers, or advisors for a CURRENT transaction are work_sharing, not research — the prompt is assembling MNPI even if framed as news.
15. Keep "reasoning" to ONE short sentence. Do not repeat the prompt.

OUTPUT FORMAT:
Output ONLY the JSON object. No markdown fences, no prose, no explanation outside the "reasoning" field.`;

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

    return { intent, valuesAreReal, sensitivity, reasoning };
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
  };
}

// ============================================================================
// The classifier itself
// ============================================================================

export interface ClassifierConfig {
  endpoint: string; // e.g., "http://localhost:11434/api/generate"
  model: string; // e.g., "gemma4:e2b"
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
    const userMessage = `Classify this prompt:\n\n---\n${promptText}\n---`;
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
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          prompt: `${systemPrompt}\n\n${userMessage}\n\nJSON:`,
          stream: false,
          format: 'json',
          options: { temperature: 0.1, num_predict: 200 },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Ollama ${response.status}`);
      // Shape validation — mitigates a rogue process binding to :11434 and
      // returning something that looks like a Chrome 200 but isn't actually
      // an Ollama reply. We require the documented Ollama generate-API
      // fields OR at minimum a `response` string. Anything else is rejected
      // and flows through the conservative fallback. Item 6.
      const data = (await response.json()) as {
        response?: unknown;
        model?: unknown;
        done?: unknown;
      };
      if (typeof data?.response !== 'string') {
        throw new Error('Ollama response missing the "response" field — endpoint may not be Ollama');
      }
      // Optional sanity: if model/done are present, they should match the
      // documented shape. We don't fail on their absence (older Ollama
      // versions omit `done` for non-stream responses) but we do fail on
      // wrong types.
      if (data.model !== undefined && typeof data.model !== 'string') {
        throw new Error('Ollama response "model" field has wrong type');
      }
      return data.response;
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
