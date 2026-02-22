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

// Execution flag — verifiable from DevTools: window.__IRON_GATE_MAIN_WORLD
(window as any).__IRON_GATE_MAIN_WORLD = 'loading';
console.log('[Iron Gate MAIN] 🚀 Script loaded at', new Date().toISOString(), '— patching fetch/XHR/WebSocket...');

// ─── Communication with content script ──────────────────────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'IRON_GATE_SET_MODE') {
    const oldMode = mode;
    mode = event.data.mode;
    if (oldMode !== mode) {
      console.log(`[Iron Gate MAIN] Mode changed: ${oldMode} → ${mode}`);
    }
  }
});

// Request mode sync from content script immediately
// (content script may not be loaded yet, but if it is, this gets us the mode faster)
window.postMessage({ type: 'IRON_GATE_REQUEST_MODE' }, '*');

// ─── LLM Endpoint Detection ────────────────────────────────────────────────

const LLM_API_PATTERNS: RegExp[] = [
  // ChatGPT
  /chatgpt\.com\/backend-api\/conversation/,
  /chat\.openai\.com\/backend-api\/conversation/,
  /api\.openai\.com\/v1\/chat\/completions/,
  // Claude
  /claude\.ai\/api/,
  /api\.anthropic\.com\/v1\/messages/,
  // Google Gemini
  /generativelanguage\.googleapis\.com/,
  /gemini\.google\.com\/app\/_\/api/,
  // Microsoft Copilot — multiple endpoint patterns
  /copilot\.microsoft\.com\/c\/api/,
  /copilot\.microsoft\.com\/sl\/api/,
  /copilot\.microsoft\.com\/turing\/conversation/,
  /sydney\.bing\.com\/sydney/,
  /bing\.com\/.*\/api\/.*chat/i,
  /copilot\.microsoft\.com\/api/,
  // DeepSeek
  /chat\.deepseek\.com\/api/,
  // Poe
  /poe\.com\/api/,
  // Perplexity
  /perplexity\.ai\/api/,
  /api\.perplexity\.ai/,
  // Groq
  /api\.groq\.com/,
  // HuggingFace
  /huggingface\.co\/chat\/.*\/message/,
  // You.com
  /you\.com\/api/,
];

function isLLMEndpoint(url: string): boolean {
  // Check specific API patterns first
  if (LLM_API_PATTERNS.some((p) => p.test(url))) return true;

  // Broader: since this script only runs on AI tool pages (via manifest matches),
  // any request to the SAME HOST is very likely an AI backend API call.
  // This catches endpoint changes that break specific pattern matching.
  try {
    const reqHost = new URL(url, window.location.href).hostname;
    if (reqHost === window.location.hostname) return true;

    // Also match known cross-domain API hosts used by AI tools
    const CROSS_DOMAIN = [
      'api.openai.com', 'api.anthropic.com',
      'generativelanguage.googleapis.com',
      'sydney.bing.com', 'substrate.office.com',
      'api.perplexity.ai', 'api.groq.com',
    ];
    if (CROSS_DOMAIN.includes(reqHost)) return true;
  } catch {}

  return false;
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
// Handles all major AI tool request body formats.
// Falls back to generic deep-search for unknown formats.

function extractPrompt(body: any): string | null {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;

    // ChatGPT backend: { messages: [{ content: { parts: [...] } }] }
    if (parsed?.messages?.[0]?.content?.parts) {
      const last = parsed.messages[parsed.messages.length - 1];
      return last.content.parts.join('\n');
    }

    // OpenAI / Anthropic / generic: { messages: [{ role, content }] }
    if (parsed?.messages && Array.isArray(parsed.messages)) {
      const lastUser = [...parsed.messages].reverse().find(
        (m: any) => m.role === 'user' || m.author === 'user' || m.author?.role === 'user'
      );
      if (lastUser) {
        if (typeof lastUser.content === 'string') return lastUser.content;
        if (typeof lastUser.text === 'string') return lastUser.text;
        if (Array.isArray(lastUser.content)) {
          return lastUser.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        }
      }
    }

    // Microsoft Copilot: { message, conversationId } or { message: { text } }
    if (parsed?.message) {
      if (typeof parsed.message === 'string') return parsed.message;
      if (typeof parsed.message?.text === 'string') return parsed.message.text;
      if (typeof parsed.message?.content === 'string') return parsed.message.content;
    }

    // Copilot variant: { content, conversationStyle }
    if (typeof parsed?.content === 'string' && parsed.content.length > 5) return parsed.content;

    // Copilot Bing variant: { q, ... } or { question, ... }
    if (typeof parsed?.q === 'string') return parsed.q;
    if (typeof parsed?.question === 'string') return parsed.question;

    // DeepSeek / Poe / Groq: { prompt } or { query }
    if (typeof parsed?.prompt === 'string') return parsed.prompt;
    if (typeof parsed?.query === 'string') return parsed.query;
    if (typeof parsed?.input === 'string') return parsed.input;

    // Perplexity: { text } or { query_str }
    if (typeof parsed?.text === 'string' && parsed.text.length > 5) return parsed.text;
    if (typeof parsed?.query_str === 'string') return parsed.query_str;

    // Google Gemini: nested arrays [ null, [ [ [ prompt ] ] ] ] or reqId format
    if (Array.isArray(parsed) && parsed.length >= 2) {
      const deep = findDeepestString(parsed);
      if (deep && deep.length > 10) return deep;
    }

    // Generic fallback: find the longest string value in the JSON
    const longest = findLongestStringValue(parsed);
    if (longest && longest.length >= 20) {
      console.log(`[Iron Gate MAIN] Using generic extraction — found string of ${longest.length} chars`);
      return longest;
    }

    return null;
  } catch {
    return null;
  }
}

/** Recursively find the longest string value in an object/array */
function findLongestStringValue(obj: any, maxDepth = 5): string | null {
  if (maxDepth <= 0) return null;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) {
    let best: string | null = null;
    for (const item of obj) {
      const found = findLongestStringValue(item, maxDepth - 1);
      if (found && (!best || found.length > best.length)) best = found;
    }
    return best;
  }
  if (obj && typeof obj === 'object') {
    let best: string | null = null;
    for (const val of Object.values(obj)) {
      const found = findLongestStringValue(val, maxDepth - 1);
      if (found && (!best || found.length > best.length)) best = found;
    }
    return best;
  }
  return null;
}

/** Find longest string in deeply nested arrays (Gemini format) */
function findDeepestString(arr: any[]): string | null {
  let best: string | null = null;
  for (const item of arr) {
    if (typeof item === 'string' && (!best || item.length > best.length)) {
      best = item;
    } else if (Array.isArray(item)) {
      const found = findDeepestString(item);
      if (found && (!best || found.length > best.length)) best = found;
    }
  }
  return best;
}

function replacePrompt(body: string, originalPrompt: string, replacement: string): string | null {
  try {
    const parsed = JSON.parse(body);

    // ChatGPT backend format
    if (parsed?.messages?.[0]?.content?.parts) {
      const lastIdx = parsed.messages.length - 1;
      parsed.messages[lastIdx].content.parts = [replacement];
      return JSON.stringify(parsed);
    }

    // OpenAI / Anthropic / generic messages format
    if (parsed?.messages && Array.isArray(parsed.messages)) {
      const lastUserIdx = findLastIndex(parsed.messages,
        (m: any) => m.role === 'user' || m.author === 'user' || m.author?.role === 'user'
      );
      if (lastUserIdx >= 0) {
        const msg = parsed.messages[lastUserIdx];
        if (typeof msg.content === 'string') {
          msg.content = replacement;
        } else if (typeof msg.text === 'string') {
          msg.text = replacement;
        } else if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter((c: any) => c.type === 'text');
          if (textParts.length > 0) textParts[0].text = replacement;
        }
      }
      return JSON.stringify(parsed);
    }

    // Microsoft Copilot: { message, ... }
    if (parsed?.message) {
      if (typeof parsed.message === 'string') { parsed.message = replacement; return JSON.stringify(parsed); }
      if (typeof parsed.message?.text === 'string') { parsed.message.text = replacement; return JSON.stringify(parsed); }
      if (typeof parsed.message?.content === 'string') { parsed.message.content = replacement; return JSON.stringify(parsed); }
    }

    // Copilot variant: { content }
    if (typeof parsed?.content === 'string' && parsed.content.length > 5) {
      parsed.content = replacement; return JSON.stringify(parsed);
    }

    // Simple field formats
    if (typeof parsed?.q === 'string') { parsed.q = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.question === 'string') { parsed.question = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.prompt === 'string') { parsed.prompt = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.query === 'string') { parsed.query = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.input === 'string') { parsed.input = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.text === 'string' && parsed.text.length > 5) { parsed.text = replacement; return JSON.stringify(parsed); }
    if (typeof parsed?.query_str === 'string') { parsed.query_str = replacement; return JSON.stringify(parsed); }

    // ── GENERIC FALLBACK: Direct string replacement in the raw JSON ──
    // If we extracted a prompt but don't recognize the structure,
    // do a targeted string replacement. This handles ANY format as long
    // as the prompt text appears verbatim in the body.
    if (originalPrompt && originalPrompt.length >= 20) {
      // Escape the prompt for use in JSON (it will be inside a JSON string value)
      const escapedOriginal = jsonStringEscape(originalPrompt);
      const escapedReplacement = jsonStringEscape(replacement);

      if (body.includes(escapedOriginal)) {
        console.log(`[Iron Gate MAIN] Using generic string replacement fallback (${escapedOriginal.length} chars)`);
        return body.replace(escapedOriginal, escapedReplacement);
      }

      // Try with partial match (first 100 chars) for very long prompts
      // that might be split across fields
      const shortOriginal = jsonStringEscape(originalPrompt.substring(0, 100));
      if (shortOriginal.length > 20 && body.includes(shortOriginal)) {
        console.log(`[Iron Gate MAIN] Using partial string replacement fallback`);
        return body.split(escapedOriginal).join(escapedReplacement);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Find last index matching a predicate */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

/** Escape a string for safe embedding in JSON (matching how JSON.stringify would escape it) */
function jsonStringEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
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

// ─── Extract body string from any fetch input ─────────────────────────────
// AI tools may call fetch(url, {body}) OR fetch(new Request(url, {body})).
// We need to handle both cases to reliably intercept.

async function getBodyString(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  // Case 1: body is in the init options (most common)
  if (init?.body) {
    if (typeof init.body === 'string') return init.body;
    // ArrayBuffer / Uint8Array
    if (init.body instanceof ArrayBuffer) {
      return new TextDecoder().decode(init.body);
    }
    if (init.body instanceof Uint8Array) {
      return new TextDecoder().decode(init.body);
    }
    // Blob
    if (init.body instanceof Blob) {
      return await init.body.text();
    }
  }

  // Case 2: input is a Request object with a body (fetch(new Request(url, opts)))
  if (input instanceof Request && input.body) {
    try {
      const cloned = input.clone();
      return await cloned.text();
    } catch {
      return null;
    }
  }

  return null;
}

// ─── Patch window.fetch ────────────────────────────────────────────────────

const originalFetch = window.fetch;
let _fetchCallCount = 0;

const patchedFetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

  // Debug: log first 10 fetch calls to verify interceptor is alive
  _fetchCallCount++;
  if (_fetchCallCount <= 10) {
    console.log(`[Iron Gate MAIN] fetch #${_fetchCallCount}: ${method} ${url.substring(0, 100)}`);
  }

  // Only intercept POST/PUT/PATCH (which carry prompt data in body)
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    return originalFetch.call(window, input, init);
  }

  if (!isLLMEndpoint(url)) {
    return originalFetch.call(window, input, init);
  }

  // This is an LLM endpoint — extract the body
  const bodyString = await getBodyString(input, init);

  if (!bodyString) {
    console.log(`[Iron Gate MAIN] LLM request to ${url.substring(0, 60)} — no body found, passing through`);
    return originalFetch.call(window, input, init);
  }

  console.log(`[Iron Gate MAIN] LLM request intercepted — mode: ${mode}, url: ${url.substring(0, 60)}, body length: ${bodyString.length}`);

  // ── PROXY MODE: Pseudonymize before sending ──────────────────────────────
  if (mode === 'proxy') {
    try {
      const promptText = extractPrompt(bodyString);

      if (promptText && promptText.length >= 10) {
        // Detect entities
        const regexEntities = detectWithRegex(promptText);
        const secrets = scanForSecrets(promptText);
        const allEntities = [...regexEntities, ...secrets];

        console.log(`[Iron Gate MAIN] Detected ${allEntities.length} entities in prompt (${promptText.length} chars)`);

        if (allEntities.length > 0) {
          const level = quickScore(allEntities);
          const pseudoResult = pseudonymizeLocal(promptText, allEntities);

          // Build reverse map for de-pseudonymization
          currentReverseMap = {};
          for (const m of pseudoResult.mappings) {
            currentReverseMap[m.pseudonym] = m.original;
          }

          // Replace prompt in request body
          const modifiedBody = replacePrompt(bodyString, promptText, pseudoResult.maskedText);

          if (modifiedBody) {
            console.log(
              `[Iron Gate MAIN] PROXY: Pseudonymized ${allEntities.length} entities (${level}). Entities: ${allEntities.map(e => `${e.type}:"${e.text.substring(0,20)}"`).join(', ')}`
            );
            console.log(`[Iron Gate MAIN] Original prompt snippet: "${promptText.substring(0, 100)}..."`);
            console.log(`[Iron Gate MAIN] Masked prompt snippet: "${pseudoResult.maskedText.substring(0, 100)}..."`);

            // Notify content script (for sidepanel display)
            window.postMessage({
              type: 'IRON_GATE_INTERCEPTED',
              originalPrompt: promptText,
              maskedPrompt: pseudoResult.maskedText,
              mappings: pseudoResult.mappings,
              entityCount: allEntities.length,
              level,
            }, '*');

            // Send modified request — always use (url, init) form so we control the body
            const modifiedInit: RequestInit = {
              method: init?.method || (input instanceof Request ? input.method : 'POST'),
              headers: init?.headers || (input instanceof Request ? Object.fromEntries(input.headers.entries()) : {}),
              body: modifiedBody,
              credentials: init?.credentials || (input instanceof Request ? input.credentials : 'same-origin'),
              mode: init?.mode || (input instanceof Request ? input.mode : undefined),
              signal: init?.signal || (input instanceof Request ? input.signal : undefined),
            };

            const response = await originalFetch.call(window, url, modifiedInit);

            // De-pseudonymize the response stream
            if (Object.keys(currentReverseMap).length > 0) {
              return depseudonymizeResponse(response, currentReverseMap);
            }

            return response;
          } else {
            console.warn('[Iron Gate MAIN] replacePrompt returned null — body format not recognized');
          }
        } else {
          console.log('[Iron Gate MAIN] No entities detected — passing through cleanly');
        }
      } else {
        console.log(`[Iron Gate MAIN] No prompt extracted (${promptText?.length || 0} chars) — passing through`);
      }
    } catch (err) {
      console.warn('[Iron Gate MAIN] Proxy intercept error, sending original:', err);
    }
  }

  // ── AUDIT MODE: Detect and score but don't modify ────────────────────────
  if (mode === 'audit') {
    try {
      const promptText = extractPrompt(bodyString);
      if (promptText && promptText.length >= 10) {
        const regexEntities = detectWithRegex(promptText);
        const secrets = scanForSecrets(promptText);
        const allEntities = [...regexEntities, ...secrets];

        if (allEntities.length > 0) {
          const level = quickScore(allEntities);
          const pseudoResult = pseudonymizeLocal(promptText, allEntities);

          console.log(`[Iron Gate MAIN] AUDIT: Detected ${allEntities.length} entities (${level}): ${allEntities.map(e => `${e.type}:"${e.text.substring(0,20)}"`).join(', ')}`);

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

// ── Install fetch patch via Object.defineProperty (resilient against non-writable) ──
const _fetchDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
console.log('[Iron Gate MAIN] fetch descriptor before patch:', JSON.stringify({
  writable: _fetchDesc?.writable,
  configurable: _fetchDesc?.configurable,
  hasValue: typeof _fetchDesc?.value === 'function',
  hasGetter: typeof _fetchDesc?.get === 'function',
}));

try {
  Object.defineProperty(window, 'fetch', {
    value: patchedFetch,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  console.log('[Iron Gate MAIN] ✅ Fetch patched via Object.defineProperty');
} catch (defineErr) {
  console.warn('[Iron Gate MAIN] Object.defineProperty failed, trying direct assignment:', defineErr);
  try {
    (window as any).fetch = patchedFetch;
    console.log('[Iron Gate MAIN] ✅ Fetch patched via direct assignment (fallback)');
  } catch (assignErr) {
    console.error('[Iron Gate MAIN] ❌ ALL FETCH PATCH METHODS FAILED:', assignErr);
  }
}

// Verify the patch took effect
if (window.fetch === patchedFetch) {
  console.log('[Iron Gate MAIN] ✅ VERIFIED: window.fetch === patchedFetch');
  (window as any).__IRON_GATE_FETCH_PATCHED = true;
} else {
  console.error('[Iron Gate MAIN] ❌ CRITICAL: window.fetch is NOT patchedFetch. Interception WILL NOT WORK.');
  console.error('[Iron Gate MAIN] window.fetch toString:', String(window.fetch).substring(0, 200));
}

console.log('[Iron Gate MAIN] Fetch interceptor setup complete — mode:', mode);

// ─── Patch XMLHttpRequest ──────────────────────────────────────────────────
// Some AI tools (Copilot, Bing) use XHR instead of fetch.

const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

// Store request metadata on the XHR instance
const xhrMetadata = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
  xhrMetadata.set(this, { method: String(method), url: String(url) });
  return originalXHROpen.apply(this, [method, url, ...args] as any);
};

XMLHttpRequest.prototype.send = function(body?: any) {
  const meta = xhrMetadata.get(this);
  const url = meta?.url || '';

  if (isLLMEndpoint(url) && body && typeof body === 'string') {
    console.log(`[Iron Gate MAIN] XHR intercepted — mode: ${mode}, url: ${url.substring(0, 60)}, body length: ${body.length}`);

    if (mode === 'proxy') {
      try {
        const promptText = extractPrompt(body);
        if (promptText && promptText.length >= 10) {
          const regexEntities = detectWithRegex(promptText);
          const secrets = scanForSecrets(promptText);
          const allEntities = [...regexEntities, ...secrets];

          if (allEntities.length > 0) {
            const level = quickScore(allEntities);
            const pseudoResult = pseudonymizeLocal(promptText, allEntities);

            currentReverseMap = {};
            for (const m of pseudoResult.mappings) {
              currentReverseMap[m.pseudonym] = m.original;
            }

            const modifiedBody = replacePrompt(body, promptText, pseudoResult.maskedText);
            if (modifiedBody) {
              console.log(`[Iron Gate MAIN] XHR PROXY: Pseudonymized ${allEntities.length} entities (${level})`);
              console.log(`[Iron Gate MAIN] XHR Masked: "${pseudoResult.maskedText.substring(0, 100)}..."`);

              window.postMessage({
                type: 'IRON_GATE_INTERCEPTED',
                originalPrompt: promptText,
                maskedPrompt: pseudoResult.maskedText,
                mappings: pseudoResult.mappings,
                entityCount: allEntities.length,
                level,
              }, '*');

              // Patch the response to de-pseudonymize
              if (Object.keys(currentReverseMap).length > 0) {
                const reverseMap = { ...currentReverseMap };
                const originalGet = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
                Object.defineProperty(this, 'responseText', {
                  get() {
                    const text = originalGet?.get?.call(this) || '';
                    let result = text;
                    for (const [pseudonym, original] of Object.entries(reverseMap)) {
                      result = result.split(pseudonym).join(original);
                    }
                    return result;
                  },
                  configurable: true,
                });
              }

              return originalXHRSend.call(this, modifiedBody);
            }
          }
        }
      } catch (err) {
        console.warn('[Iron Gate MAIN] XHR proxy error:', err);
      }
    }

    // Audit mode logging for XHR
    if (mode === 'audit') {
      try {
        const promptText = extractPrompt(body);
        if (promptText && promptText.length >= 10) {
          const regexEntities = detectWithRegex(promptText);
          const secrets = scanForSecrets(promptText);
          const allEntities = [...regexEntities, ...secrets];
          if (allEntities.length > 0) {
            const level = quickScore(allEntities);
            const pseudoResult = pseudonymizeLocal(promptText, allEntities);
            console.log(`[Iron Gate MAIN] XHR AUDIT: ${allEntities.length} entities (${level})`);
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
      } catch { /* don't break original */ }
    }
  }

  return originalXHRSend.call(this, body);
};

console.log('[Iron Gate MAIN] XHR interceptor installed');

// ─── Patch WebSocket ───────────────────────────────────────────────────────
// Copilot (Sydney/Bing backend) may use WebSocket for chat.

const OriginalWebSocket = window.WebSocket;

const patchedWebSocket = function(this: WebSocket, url: string | URL, protocols?: string | string[]) {
  const urlStr = String(url);
  const ws = protocols
    ? new OriginalWebSocket(url, protocols)
    : new OriginalWebSocket(url);

  const isLLM = /sydney\.bing\.com|copilot\.microsoft\.com|chatgpt\.com|claude\.ai/.test(urlStr);

  if (isLLM) {
    console.log(`[Iron Gate MAIN] WebSocket opened to LLM: ${urlStr.substring(0, 80)}`);

    const originalSend = ws.send.bind(ws);
    ws.send = function(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data === 'string' && mode === 'proxy') {
        try {
          const promptText = extractPrompt(data);
          if (promptText && promptText.length >= 10) {
            const regexEntities = detectWithRegex(promptText);
            const secrets = scanForSecrets(promptText);
            const allEntities = [...regexEntities, ...secrets];

            if (allEntities.length > 0) {
              const level = quickScore(allEntities);
              const pseudoResult = pseudonymizeLocal(promptText, allEntities);

              currentReverseMap = {};
              for (const m of pseudoResult.mappings) {
                currentReverseMap[m.pseudonym] = m.original;
              }

              const modifiedData = replacePrompt(data, promptText, pseudoResult.maskedText);
              if (modifiedData) {
                console.log(`[Iron Gate MAIN] WS PROXY: Pseudonymized ${allEntities.length} entities (${level})`);

                window.postMessage({
                  type: 'IRON_GATE_INTERCEPTED',
                  originalPrompt: promptText,
                  maskedPrompt: pseudoResult.maskedText,
                  mappings: pseudoResult.mappings,
                  entityCount: allEntities.length,
                  level,
                }, '*');

                return originalSend(modifiedData);
              }
            }
          }
        } catch (err) {
          console.warn('[Iron Gate MAIN] WS proxy error:', err);
        }
      }

      // Audit mode or no entities
      if (typeof data === 'string' && mode === 'audit') {
        try {
          const promptText = extractPrompt(data);
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
        } catch { /* don't break */ }
      }

      return originalSend(data);
    };

    // De-pseudonymize incoming messages
    const originalAddEventListener = ws.addEventListener.bind(ws);
    ws.addEventListener = function(type: string, listener: any, options?: any) {
      if (type === 'message') {
        const wrappedListener = function(event: MessageEvent) {
          if (typeof event.data === 'string' && Object.keys(currentReverseMap).length > 0) {
            let text = event.data;
            for (const [pseudonym, original] of Object.entries(currentReverseMap)) {
              text = text.split(pseudonym).join(original);
            }
            if (text !== event.data) {
              const newEvent = new MessageEvent('message', {
                data: text,
                origin: event.origin,
                lastEventId: event.lastEventId,
                source: event.source,
                ports: [...event.ports],
              });
              listener.call(ws, newEvent);
              return;
            }
          }
          listener.call(ws, event);
        };
        return originalAddEventListener(type, wrappedListener, options);
      }
      return originalAddEventListener(type, listener, options);
    };
  }

  return ws;
} as unknown as typeof WebSocket;

Object.defineProperty(patchedWebSocket, 'prototype', { value: OriginalWebSocket.prototype, writable: false });
Object.defineProperty(patchedWebSocket, 'CONNECTING', { value: 0, writable: false });
Object.defineProperty(patchedWebSocket, 'OPEN', { value: 1, writable: false });
Object.defineProperty(patchedWebSocket, 'CLOSING', { value: 2, writable: false });
Object.defineProperty(patchedWebSocket, 'CLOSED', { value: 3, writable: false });
(window as any).WebSocket = patchedWebSocket;

console.log('[Iron Gate MAIN] WebSocket interceptor installed');

// ─── Heartbeat ──────────────────────────────────────────────────────────────
// Notify content script that MAIN world interceptor is active.
// Content script uses this to confirm the script is executing properly.
window.postMessage({
  type: 'IRON_GATE_HEARTBEAT',
  version: '0.2.3',
  timestamp: Date.now(),
  mode,
}, '*');
(window as any).__IRON_GATE_MAIN_WORLD = 'active';
(window as any).__IRON_GATE_MODE = mode;
console.log('[Iron Gate MAIN] ✅ All interceptors installed. Heartbeat sent. Mode:', mode);
console.log('[Iron Gate MAIN] 💡 Verify in DevTools console: window.__IRON_GATE_MAIN_WORLD →', (window as any).__IRON_GATE_MAIN_WORLD);
