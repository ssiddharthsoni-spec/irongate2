/**
 * Agent Detector — LLM-Based Context-Aware Entity Detection
 *
 * PRIMARY detection layer. Uses a language model to deeply understand
 * text context and identify ALL sensitive entities. Regex is the FALLBACK
 * for when no LLM is available, and a SUPPLEMENT for structured patterns
 * (SSN, credit cards, API keys) that regex catches more reliably.
 *
 * Architecture:
 *   1. Try LLM detection first (Chrome AI → Client LLM → fallback)
 *   2. Always run regex for structured patterns (SSN, CC, API keys, etc.)
 *   3. Merge: LLM entities + regex-only structured patterns → final list
 *   4. If LLM unavailable: fall back to pure regex mode
 *
 * What the LLM catches that regex fundamentally can't:
 *   - "Goldman Sachs" is an ORGANIZATION, not two PERSON names
 *   - "Project Phoenix" is a codename, not a person or place
 *   - "John's wife" implies another person without naming them
 *   - "the Titan deal" is a deal name in M&A context
 *   - A job title + department + company together = re-identification risk
 *   - "our client" refers to a specific entity in legal context
 *
 * The LLM NEVER rewrites or modifies text. It only outputs a JSON array
 * of detected entities with positions and types.
 *
 * SECURITY: Chrome AI and client LLM are fully local — no PII leaves
 * the device. The API tier only sends sanitized text as a last resort.
 */

import type { DetectedEntity } from '../detection/types';
import type { ModelRuntime } from './model-runtime';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentDetectorOptions {
  /** Timeout for the LLM call (default: 5000ms) */
  timeoutMs?: number;
  /** Minimum confidence to accept an agent-detected entity (default: 0.5) */
  minConfidence?: number;
  /** Mode: 'primary' scans for everything, 'supplement' finds what regex missed */
  mode?: 'primary' | 'supplement';
}

interface LLMEntityOutput {
  type: string;
  text: string;
  confidence: number;
  reasoning?: string;
}

// ── System Prompt ────────────────────────────────────────────────────────────

const PRIMARY_SYSTEM_PROMPT = `You are Iron Gate, an enterprise PII and sensitive data detection system. Your job is to identify EVERY piece of sensitive information in the text.

OUTPUT FORMAT: Return ONLY a valid JSON array. No markdown, no explanation, no code fences.

Each entity object:
{"type": "ENTITY_TYPE", "text": "exact verbatim substring from input", "confidence": 0.0-1.0}

ENTITY TYPES:
- PERSON: Any person name — full, partial, titled (Dr. Smith), informal (my boss Sarah)
- ORGANIZATION: Companies, law firms, funds, agencies, institutions. "Goldman Sachs" is an org, NOT two person names
- LOCATION: Places that identify specific facilities, offices, addresses. NOT generic references like "the office"
- PROJECT_NAME: Internal codenames, project titles ("Project Phoenix", "Operation Blue Sky")
- DEAL_NAME: M&A deal names, transaction codenames ("the Titan deal", "Maple acquisition")
- CLIENT_NAME: Client references identifiable in context
- FINANCIAL_FIGURE: Dollar amounts, percentages tied to specific deals/people/firms
- EMPLOYEE_INFO: Employee IDs, compensation, performance data
- MEDICAL_INFO: Diagnoses, treatments, conditions tied to individuals
- LEGAL_MATTER: Case names, docket numbers, privilege markers, litigation details
- TRADE_SECRET: Proprietary info, unreleased product names, internal formulas
- CONFIDENTIAL_TERM: Deal terms, contractual specifics, board decisions not yet public
- EMAIL: Email addresses
- PHONE_NUMBER: Phone numbers
- SSN: Social security numbers
- CREDIT_CARD: Credit card numbers
- ACCOUNT_NUMBER: Bank/financial account numbers
- IP_ADDRESS: IP addresses in sensitive context
- API_KEY: API keys, tokens, credentials
- DATE: Dates that are sensitive in context (DOB, deal closing dates)
- MONETARY_AMOUNT: Money amounts

CRITICAL RULES:
1. "text" MUST be an exact verbatim substring of the input. Copy it exactly.
2. Detect ALL instances — if "Sarah Chen" appears 3 times, return all 3 with positions.
3. "Goldman Sachs" is ORGANIZATION. "New York" is LOCATION. Do NOT misclassify common phrases as PERSON.
4. When two capitalized words follow a preposition ("from Goldman Sachs"), classify correctly — org vs person.
5. Look for INDIRECT identifiers: "the VP of Engineering at [company]" can re-identify someone.
6. Financial figures are only sensitive when tied to specific entities or deals.
7. Return [] if nothing sensitive found. Do NOT invent entities.`;

const SUPPLEMENT_SYSTEM_PROMPT = `You are a PII detection agent. The text below has already been partially scanned. Find sensitive entities that were MISSED.

OUTPUT FORMAT: Return ONLY a valid JSON array. No markdown, no explanation, no code fences.
Each object: {"type": "ENTITY_TYPE", "text": "exact verbatim substring", "confidence": 0.0-1.0}

Focus on:
- Names mentioned informally or partially
- Organizations referenced indirectly ("the firm", "our client")
- Code names, deal names, project names
- Contextual sensitivity (data sensitive because of surrounding context)
- Indirect identifiers that together could re-identify someone
- Anything the existing detections missed

Return [] if nothing additional found.`;

// ── Structured Pattern Types ─────────────────────────────────────────────────
// These entity types are better detected by regex (format-based patterns).
// Even when LLM is primary, regex results for these types are always kept.

const REGEX_SUPERIOR_TYPES = new Set([
  'SSN', 'CREDIT_CARD', 'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL',
  'AZURE_CREDENTIAL', 'DATABASE_URI', 'AUTH_TOKEN', 'PRIVATE_KEY',
  'EU_IBAN', 'UK_NINO', 'CANADIAN_SIN', 'INDIAN_AADHAAR',
  'AUSTRALIAN_TFN', 'GERMAN_TAX_ID', 'FRENCH_INSEE',
  'ENCODED_PII', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'EMPLOYEE_ID', 'RECORD_ID', 'POLICY_NUMBER', 'NAIC_CODE',
  'STUDENT_ID', 'CLASSIFICATION_MARKING', 'CUI_MARKING',
  'EXPORT_CONTROL', 'WELL_IDENTIFIER', 'REGULATORY_DOCKET',
  'PARCEL_NUMBER', 'MLS_NUMBER', 'MATTER_NUMBER',
  'TICKER',
]);

// ── Agent Detector ───────────────────────────────────────────────────────────

export function createAgentDetector(runtime: ModelRuntime) {
  let _consecutiveFailures = 0;
  const MAX_FAILURES = 5;
  let _available: boolean | null = null;
  let _availableCheckTime = 0;

  /**
   * Detect entities using the LLM.
   *
   * In 'primary' mode: comprehensive scan — finds everything.
   * In 'supplement' mode: only finds what existingEntities missed.
   */
  async function detect(
    text: string,
    existingEntities: DetectedEntity[],
    options?: AgentDetectorOptions,
  ): Promise<DetectedEntity[]> {
    if (_consecutiveFailures >= MAX_FAILURES) return [];
    if (text.length < 30) return [];

    const timeoutMs = options?.timeoutMs ?? 5000;
    const minConfidence = options?.minConfidence ?? 0.5;
    const mode = options?.mode ?? 'primary';

    const systemPrompt = mode === 'primary' ? PRIMARY_SYSTEM_PROMPT : SUPPLEMENT_SYSTEM_PROMPT;
    const userPrompt = mode === 'primary'
      ? buildPrimaryPrompt(text)
      : buildSupplementPrompt(text, existingEntities);

    try {
      const response = await Promise.race([
        runtime.complete({
          systemPrompt,
          userPrompt,
          temperature: 0.05,
          maxTokens: 4096,
        }),
        timeoutPromise(timeoutMs),
      ]);

      _consecutiveFailures = 0;

      const parsed = parseLLMOutput(response.text);
      if (!parsed || parsed.length === 0) return [];

      // In primary mode, return ALL valid entities
      // In supplement mode, skip entities already covered
      const skipExisting = mode === 'supplement';
      return validateAndConvert(parsed, text, skipExisting ? existingEntities : [], minConfidence);
    } catch (err) {
      _consecutiveFailures++;
      if (_consecutiveFailures >= MAX_FAILURES) {
        console.warn('[Iron Gate] Agent detector disabled after', MAX_FAILURES, 'consecutive failures');
      }
      throw err;
    }
  }

  async function isAvailable(): Promise<boolean> {
    // Cache availability for 30 seconds
    const now = Date.now();
    if (_available !== null && now - _availableCheckTime < 30000) return _available;

    if (_consecutiveFailures >= MAX_FAILURES) {
      _available = false;
      _availableCheckTime = now;
      return false;
    }

    try {
      const backends = await runtime.getAvailableBackends();
      _available = backends.length > 0;
    } catch {
      _available = false;
    }
    _availableCheckTime = now;
    return _available;
  }

  function reset(): void {
    _consecutiveFailures = 0;
    _available = null;
  }

  return { detect, isAvailable, reset, REGEX_SUPERIOR_TYPES };
}

// ── Prompt Building ─────────────────────────────────────────────────────────

function buildPrimaryPrompt(text: string): string {
  const truncated = text.length > 6000 ? text.substring(0, 6000) + '\n[...truncated]' : text;
  return `Identify ALL sensitive entities in this text:\n\n${truncated}`;
}

function buildSupplementPrompt(text: string, existingEntities: DetectedEntity[]): string {
  const truncated = text.length > 4000 ? text.substring(0, 4000) + '\n[...truncated]' : text;

  let prompt = `TEXT:\n\n${truncated}`;

  if (existingEntities.length > 0) {
    const existing = existingEntities
      .slice(0, 20)
      .map(e => `  - "${e.text}" (${e.type})`)
      .join('\n');
    prompt += `\n\nALREADY FOUND:\n${existing}\n\nWhat's MISSING?`;
  }

  return prompt;
}

// ── Output Parsing ──────────────────────────────────────────────────────────

function parseLLMOutput(output: string): LLMEntityOutput[] | null {
  let cleaned = output.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return null;

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return null;

    return parsed.filter(
      (e: any): e is LLMEntityOutput =>
        typeof e === 'object' &&
        typeof e.type === 'string' &&
        typeof e.text === 'string' &&
        typeof e.confidence === 'number' &&
        e.confidence >= 0 && e.confidence <= 1
    );
  } catch {
    return null;
  }
}

// ── Validation & Conversion ─────────────────────────────────────────────────

const VALID_TYPES = new Set([
  'PERSON', 'ORGANIZATION', 'LOCATION', 'PROJECT_NAME', 'DEAL_NAME',
  'CLIENT_NAME', 'FINANCIAL_FIGURE', 'DATE_OF_BIRTH', 'EMPLOYEE_INFO',
  'MEDICAL_INFO', 'LEGAL_MATTER', 'TRADE_SECRET', 'CONFIDENTIAL_TERM',
  'SSN', 'CREDIT_CARD', 'EMAIL', 'PHONE_NUMBER', 'IP_ADDRESS',
  'MONETARY_AMOUNT', 'ACCOUNT_NUMBER', 'MEDICAL_RECORD', 'PASSPORT_NUMBER',
  'DRIVERS_LICENSE', 'API_KEY', 'DATE', 'EMPLOYEE_ID',
]);

function validateAndConvert(
  llmEntities: LLMEntityOutput[],
  originalText: string,
  existingEntities: DetectedEntity[],
  minConfidence: number,
): DetectedEntity[] {
  const result: DetectedEntity[] = [];
  const lowerText = originalText.toLowerCase();

  for (const entity of llmEntities) {
    if (entity.confidence < minConfidence) continue;
    if (!VALID_TYPES.has(entity.type)) continue;

    // Find the entity text in the original (case-insensitive)
    const entityLower = entity.text.toLowerCase().trim();
    if (entityLower.length < 2) continue;

    // Find ALL occurrences in the text, not just the first
    let searchFrom = 0;
    while (searchFrom < lowerText.length) {
      const index = lowerText.indexOf(entityLower, searchFrom);
      if (index === -1) break;

      const exactText = originalText.substring(index, index + entityLower.length);

      // Skip if already covered by an existing entity
      const alreadyCovered = existingEntities.some(e =>
        e.start <= index && e.end >= index + entityLower.length
      );

      if (!alreadyCovered) {
        result.push({
          type: entity.type,
          text: exactText,
          start: index,
          end: index + entityLower.length,
          confidence: Math.min(entity.confidence, 0.95),
          source: 'keyword',
        });
      }

      searchFrom = index + entityLower.length;
    }
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent detector timed out after ${ms}ms`)), ms)
  );
}
