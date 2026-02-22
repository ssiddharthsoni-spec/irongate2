/**
 * Iron Gate — MAIN World Interceptor
 *
 * This script runs in the PAGE's JavaScript context (world: "MAIN").
 * It patches window.fetch to intercept requests to LLM APIs and:
 *   1. Pseudonymize sensitive entities before they reach the LLM
 *   2. De-pseudonymize the LLM's response before the page sees it
 *
 * IMPORTANT: This file must be 100% self-contained — NO imports.
 * CRXJS MAIN world loaders use relative dynamic imports that resolve
 * against the page's origin (not the extension), causing silent failures.
 * All detection, pseudonymization, and scoring logic is inlined here.
 *
 * Communication with the content script happens via window.postMessage.
 */

// ─── State ──────────────────────────────────────────────────────────────────

let mode: 'audit' | 'proxy' = 'audit';
let currentReverseMap: Record<string, string> = {};

// ─── Communication with content script ──────────────────────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'IRON_GATE_SET_MODE') {
    mode = event.data.mode;
    console.log(`[Iron Gate MAIN] Mode set to: ${mode}`);
  }
});

// ─── LLM Endpoint Detection ────────────────────────────────────────────────

const LLM_API_PATTERNS: RegExp[] = [
  /chatgpt\.com\/backend-api\/conversation/,
  /chat\.openai\.com\/backend-api\/conversation/,
  /api\.openai\.com\/v1\/chat\/completions/,
  /claude\.ai\/api/,
  /api\.anthropic\.com\/v1\/messages/,
  /generativelanguage\.googleapis\.com/,
  /gemini\.google\.com\/app\/_\/api/,
  /copilot\.microsoft\.com\/c\/api/,
  /chat\.deepseek\.com\/api/,
  /poe\.com\/api/,
  /perplexity\.ai\/api/,
  /api\.groq\.com/,
];

function isLLMEndpoint(url: string): boolean {
  return LLM_API_PATTERNS.some((p) => p.test(url));
}

// ─── Inlined Entity Detection (from fallback-regex.ts) ──────────────────────

interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'regex';
}

interface RegexPattern {
  type: string;
  pattern: RegExp;
  confidence: number;
  contextual?: boolean;
}

const REGEX_PATTERNS: RegexPattern[] = [
  // Person Names — titled (Dr. John Smith, Mr. Jane Doe)
  {
    type: 'PERSON',
    pattern: /\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Judge|Hon)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g,
    confidence: 0.9,
  },
  // Person Names — contextual (employee Sarah Chen, patient Maria Gonzalez)
  {
    type: 'PERSON',
    pattern: /\b(?:employee|patient|client|manager|contact|attending|plaintiff|defendant|counsel|attorney|doctor|nurse|therapist|spouse|wife|husband|CEO|CFO|CTO|COO|CMO|VP|director|analyst|engineer)\s*(?::|is|named)?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/gi,
    confidence: 0.85,
    contextual: true,
  },
  // Person Names — before parenthetical contact info: "Sarah Chen (email..." or "Sarah Chen,"
  {
    type: 'PERSON',
    pattern: /\b[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\s*(?=\(|\[|<|,\s*(?:who|our|the|is|at|from))/g,
    confidence: 0.8,
  },
  // Person Names — after "for" / "from" / "to" / "by" / "with" / "about" / "cc" / "re"
  {
    type: 'PERSON',
    pattern: /\b(?:for|from|to|by|with|about|cc|re|dear|hi|hey|hello|regarding)\s+[A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15}\b/gi,
    confidence: 0.75,
    contextual: true,
  },
  // Organization Names
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|LLC|Ltd|LLP|Associates|Partners|Group|Foundation|Hospital|Center|University|College|Bank|Insurance)\b\.?/g,
    confidence: 0.8,
  },
  // Employee / Record IDs
  {
    type: 'EMPLOYEE_ID',
    pattern: /\b(?:EMP|HR|FMLA|RSU|REQ|WO|PO|INV)[-#]?\d{4,8}\b/g,
    confidence: 0.85,
  },
  // Generic reference numbers with prefix labels
  {
    type: 'RECORD_ID',
    pattern: /\b(?:#(?:RSU|HR|FMLA|EMP|REQ|INV|PO|WO|TKT)[-\u2011]?\d{4,10})\b/g,
    confidence: 0.8,
  },
  // Social Security Numbers
  {
    type: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.95,
  },
  // Credit Card Numbers
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    confidence: 0.9,
  },
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d{4}[-\s]){3}\d{4}\b/g,
    confidence: 0.85,
  },
  // Email Addresses
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    confidence: 0.95,
  },
  // Phone Numbers (US formats)
  {
    type: 'PHONE_NUMBER',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.8,
  },
  // IP Addresses (IPv4)
  {
    type: 'IP_ADDRESS',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 0.9,
  },
  // Dates
  {
    type: 'DATE',
    pattern: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g,
    confidence: 0.7,
  },
  // Monetary Amounts
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|M|B|k|K)?\b/g,
    confidence: 0.85,
  },
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:dollars?|USD|EUR|GBP|million|billion)\b/gi,
    confidence: 0.8,
  },
  // Passport Numbers (US format)
  {
    type: 'PASSPORT_NUMBER',
    pattern: /\b[A-Z]\d{8}\b/g,
    confidence: 0.6,
  },
  // Driver's License
  {
    type: 'DRIVERS_LICENSE',
    pattern: /\b[A-Z]\d{7,8}\b/g,
    confidence: 0.5,
  },
  // Account Numbers
  {
    type: 'ACCOUNT_NUMBER',
    pattern: /\b(?:acct?\.?\s*#?\s*|account\s*#?\s*)\d{6,12}\b/gi,
    confidence: 0.8,
  },
  // Medical Record Numbers
  {
    type: 'MEDICAL_RECORD',
    pattern: /\b(?:MRN|medical\s+record(?:\s+number)?)\s*[:#]?\s*\d{4,10}\b/gi,
    confidence: 0.85,
  },
  // Matter / Case Numbers
  {
    type: 'MATTER_NUMBER',
    pattern: /\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d{2,4}[-./]\d{3,6}\b/gi,
    confidence: 0.75,
  },
];

function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const seen = new Set<string>();

  for (const { type, pattern, confidence, contextual } of REGEX_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      let matchText = match[0];
      let matchStart = match.index;
      let matchEnd = match.index + match[0].length;

      if (contextual) {
        const nameMatch = match[0].match(/[A-Z][a-z]+\s+[A-Z][a-z]+$/);
        if (nameMatch) {
          const nameStart = match[0].lastIndexOf(nameMatch[0]);
          matchText = nameMatch[0];
          matchStart = match.index + nameStart;
          matchEnd = matchStart + matchText.length;
        }
      }

      const key = `${matchStart}-${matchEnd}-${type}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({
          type,
          text: matchText,
          start: matchStart,
          end: matchEnd,
          confidence,
          source: 'regex',
        });
      }
    }
  }

  entities.sort((a, b) => a.start - b.start);
  return removeOverlaps(entities);
}

function removeOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
  if (entities.length <= 1) return entities;
  const result: DetectedEntity[] = [entities[0]];
  for (let i = 1; i < entities.length; i++) {
    const current = entities[i];
    const last = result[result.length - 1];
    if (current.start < last.end) {
      if (current.confidence > last.confidence) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }
  return result;
}

// ─── Inlined Secret Scanner (from secret-scanner.ts) ────────────────────────

interface SecretPattern {
  type: string;
  patterns: RegExp[];
  confidence: number;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: 'API_KEY',
    patterns: [
      /\bsk-[a-zA-Z0-9]{20,}\b/g,
      /\bsk_live_[a-zA-Z0-9]{24,}\b/g,
      /\bsk-ant-[a-zA-Z0-9\-]{20,}\b/g,
      /\bghp_[a-zA-Z0-9]{36}\b/g,
      /\bgho_[a-zA-Z0-9]{36}\b/g,
      /\bghs_[a-zA-Z0-9]{36}\b/g,
      /\bxoxb-[0-9]+-[a-zA-Z0-9]+\b/g,
      /\bxoxp-[0-9]+-[a-zA-Z0-9]+\b/g,
      /\bSG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}\b/g,
    ],
    confidence: 0.95,
  },
  {
    type: 'AWS_CREDENTIAL',
    patterns: [
      /\bAKIA[0-9A-Z]{16}\b/g,
      /\bASIA[0-9A-Z]{16}\b/g,
    ],
    confidence: 0.95,
  },
  {
    type: 'GCP_CREDENTIAL',
    patterns: [
      /\bAIza[0-9A-Za-z_-]{35}\b/g,
    ],
    confidence: 0.9,
  },
  {
    type: 'DATABASE_URI',
    patterns: [
      /\b(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis):\/\/[^\s"']+/g,
    ],
    confidence: 0.95,
  },
  {
    type: 'AUTH_TOKEN',
    patterns: [
      /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    ],
    confidence: 0.9,
  },
  {
    type: 'PRIVATE_KEY',
    patterns: [
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    ],
    confidence: 0.99,
  },
];

function scanForSecrets(text: string): DetectedEntity[] {
  const secrets: DetectedEntity[] = [];
  const seen = new Set<string>();

  for (const { type, patterns, confidence } of SECRET_PATTERNS) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const key = `${match.index}-${match.index + match[0].length}-${type}`;
        if (!seen.has(key)) {
          seen.add(key);
          secrets.push({
            type,
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
            confidence,
            source: 'regex',
          });
        }
      }
    }
  }

  return secrets;
}

// ─── Inlined Pseudonymizer (from pseudonymizer.ts) ──────────────────────────

interface PseudonymMapping {
  original: string;
  pseudonym: string;
  type: string;
}

interface PseudonymResult {
  maskedText: string;
  mappings: PseudonymMapping[];
}

function pseudonymizeLocal(text: string, entities: DetectedEntity[]): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [] };
  }

  const counters: Record<string, number> = {};
  const mappings: PseudonymMapping[] = [];
  const seen = new Map<string, string>();

  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let maskedText = text;

  for (const entity of sorted) {
    const normalizedText = entity.text.trim();
    let pseudonym = seen.get(normalizedText);
    if (!pseudonym) {
      counters[entity.type] = (counters[entity.type] || 0) + 1;
      pseudonym = `[${entity.type}-${counters[entity.type]}]`;
      seen.set(normalizedText, pseudonym);
      mappings.push({
        original: normalizedText,
        pseudonym,
        type: entity.type,
      });
    }
    maskedText = maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
  }

  mappings.reverse();
  return { maskedText, mappings };
}

// ─── Prompt Extraction / Replacement ───────────────────────────────────────

function extractPrompt(body: any): string | null {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;

    // ChatGPT backend: { messages: [{ content: { parts: [...] } }] }
    if (parsed?.messages?.[0]?.content?.parts) {
      const last = parsed.messages[parsed.messages.length - 1];
      return last.content.parts.join('\n');
    }

    // OpenAI / Anthropic: { messages: [{ role, content }] }
    if (parsed?.messages && Array.isArray(parsed.messages)) {
      const lastUser = [...parsed.messages].reverse().find((m: any) => m.role === 'user');
      if (lastUser) {
        if (typeof lastUser.content === 'string') return lastUser.content;
        if (Array.isArray(lastUser.content)) {
          return lastUser.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        }
      }
    }

    if (parsed?.prompt) return parsed.prompt;
    if (parsed?.query) return parsed.query;
    if (typeof parsed?.input === 'string') return parsed.input;

    return null;
  } catch {
    return null;
  }
}

function replacePrompt(body: string, replacement: string): string | null {
  try {
    const parsed = JSON.parse(body);

    // ChatGPT backend format
    if (parsed?.messages?.[0]?.content?.parts) {
      const lastIdx = parsed.messages.length - 1;
      parsed.messages[lastIdx].content.parts = [replacement];
      return JSON.stringify(parsed);
    }

    // OpenAI / Anthropic format
    if (parsed?.messages && Array.isArray(parsed.messages)) {
      const lastUserIdx = parsed.messages.map((m: any) => m.role).lastIndexOf('user');
      if (lastUserIdx >= 0) {
        if (typeof parsed.messages[lastUserIdx].content === 'string') {
          parsed.messages[lastUserIdx].content = replacement;
        } else if (Array.isArray(parsed.messages[lastUserIdx].content)) {
          const textParts = parsed.messages[lastUserIdx].content.filter((c: any) => c.type === 'text');
          if (textParts.length > 0) textParts[0].text = replacement;
        }
      }
      return JSON.stringify(parsed);
    }

    if (parsed?.prompt) { parsed.prompt = replacement; return JSON.stringify(parsed); }
    if (parsed?.query) { parsed.query = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.input === 'string') { parsed.input = replacement; return JSON.stringify(parsed); }

    return null;
  } catch {
    return null;
  }
}

// ─── Simplified Scoring ─────────────────────────────────────────────────────

function quickScore(entities: Array<{ type: string; confidence: number }>): 'low' | 'medium' | 'high' | 'critical' {
  if (entities.length === 0) return 'low';

  const HIGH_RISK_TYPES = new Set(['SSN', 'CREDIT_CARD', 'API_KEY', 'AWS_CREDENTIAL', 'PRIVATE_KEY', 'DATABASE_URI', 'AUTH_TOKEN', 'MEDICAL_RECORD']);
  const MED_RISK_TYPES = new Set(['PERSON', 'PHONE_NUMBER', 'EMAIL', 'MONETARY_AMOUNT', 'ACCOUNT_NUMBER', 'EMPLOYEE_ID', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE']);

  let score = 0;
  for (const e of entities) {
    if (HIGH_RISK_TYPES.has(e.type)) score += 25;
    else if (MED_RISK_TYPES.has(e.type)) score += 10;
    else score += 5;
  }

  const uniqueTypes = new Set(entities.map((e) => e.type)).size;
  if (uniqueTypes >= 3) score += 15;

  if (score >= 86) return 'critical';
  if (score >= 61) return 'high';
  if (score >= 26) return 'medium';
  return 'low';
}

// ─── Response De-pseudonymization ──────────────────────────────────────────

function depseudonymizeResponse(response: Response, reverseMap: Record<string, string>): Response {
  if (!response.body) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }

          let text = decoder.decode(value, { stream: true });

          // Replace all pseudonyms with original values
          for (const [pseudonym, original] of Object.entries(reverseMap)) {
            text = text.split(pseudonym).join(original);
          }

          controller.enqueue(encoder.encode(text));
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// ─── Patch window.fetch ────────────────────────────────────────────────────

const originalFetch = window.fetch;

window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  // Only intercept in proxy mode, for LLM endpoints, with a string body
  if (mode === 'proxy' && isLLMEndpoint(url) && init?.body && typeof init.body === 'string') {
    try {
      const promptText = extractPrompt(init.body);

      if (promptText && promptText.length >= 10) {
        // Detect entities
        const regexEntities = detectWithRegex(promptText);
        const secrets = scanForSecrets(promptText);
        const allEntities = [...regexEntities, ...secrets];

        if (allEntities.length > 0) {
          const level = quickScore(allEntities);

          // In PROXY mode, pseudonymize ALL detected entities regardless of score.
          // The user explicitly chose proxy mode — they want protection.
          const pseudoResult = pseudonymizeLocal(promptText, allEntities);

          // Build reverse map for de-pseudonymization
          currentReverseMap = {};
          for (const m of pseudoResult.mappings) {
            currentReverseMap[m.pseudonym] = m.original;
          }

          // Replace prompt in request body
          const modifiedBody = replacePrompt(init.body, pseudoResult.maskedText);

          if (modifiedBody) {
            console.log(
              `[Iron Gate MAIN] Pseudonymized ${allEntities.length} entities (${level}) before sending to ${url.substring(0, 60)}...`
            );

            // Notify content script (for sidepanel display)
            window.postMessage({
              type: 'IRON_GATE_INTERCEPTED',
              originalPrompt: promptText,
              maskedPrompt: pseudoResult.maskedText,
              mappings: pseudoResult.mappings,
              entityCount: allEntities.length,
              level,
            }, '*');

            // Send modified request
            const response = await originalFetch.call(window, input, {
              ...init,
              body: modifiedBody,
            });

            // De-pseudonymize the response stream
            if (Object.keys(currentReverseMap).length > 0) {
              return depseudonymizeResponse(response, currentReverseMap);
            }

            return response;
          }
        }
      }
    } catch (err) {
      console.warn('[Iron Gate MAIN] Intercept error, sending original:', err);
    }
  }

  // Audit mode: still notify content script about the prompt for scoring
  if (mode === 'audit' && isLLMEndpoint(url) && init?.body && typeof init.body === 'string') {
    try {
      const promptText = extractPrompt(init.body);
      if (promptText && promptText.length >= 10) {
        const regexEntities = detectWithRegex(promptText);
        const secrets = scanForSecrets(promptText);
        const allEntities = [...regexEntities, ...secrets];

        if (allEntities.length > 0) {
          const level = quickScore(allEntities);
          const pseudoResult = pseudonymizeLocal(promptText, allEntities);

          window.postMessage({
            type: 'IRON_GATE_AUDIT',
            originalPrompt: promptText,
            maskedPrompt: pseudoResult.maskedText,
            mappings: pseudoResult.mappings,
            entityCount: allEntities.length,
            level,
          }, '*');
        }
      }
    } catch {
      // Don't break the original request
    }
  }

  // Pass through to original fetch
  return originalFetch.call(window, input, init);
};

console.log('[Iron Gate MAIN] Fetch interceptor installed — mode:', mode);
