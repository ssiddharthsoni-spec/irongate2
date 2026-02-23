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

// ─── Duplicate Execution Guard ───────────────────────────────────────────
// Multiple injection methods (manifest, programmatic, <script> tag) may all
// try to run this script. Only the first execution should proceed.
if ((window as any).__IRON_GATE_MAIN_WORLD === 'active' || (window as any).__IRON_GATE_MAIN_WORLD === 'loading') {
  console.log('[Iron Gate MAIN] Already loaded — skipping duplicate injection');
  // Re-send heartbeat so content script knows we're alive
  window.postMessage({
    type: 'IRON_GATE_HEARTBEAT',
    version: '0.2.7-dup',
    timestamp: Date.now(),
    mode: (window as any).__IRON_GATE_MODE || 'audit',
  }, '*');
}

// Use a flag to wrap all initialization — prevents duplicate setup
if (!(window as any).__IRON_GATE_MAIN_WORLD) {

// ─── State ──────────────────────────────────────────────────────────────────

let mode: 'audit' | 'proxy' = 'audit';
let currentReverseMap: Record<string, string> = {};
// Forward map declared near pseudonymizer — referenced here for docs.
// See currentForwardMap near generateFake().

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

  try {
    const parsed = new URL(url, window.location.href);

    // Same-host requests — only match actual API paths, NOT telemetry/assets.
    // Without this filter, every POST on chatgpt.com (telemetry, analytics, etc.)
    // would be treated as an LLM conversation request.
    if (parsed.hostname === window.location.hostname) {
      return /\/api/i.test(parsed.pathname);
    }

    // Cross-domain API hosts used by AI tools
    const CROSS_DOMAIN = [
      'api.openai.com', 'api.anthropic.com',
      'generativelanguage.googleapis.com',
      'sydney.bing.com', 'substrate.office.com',
      'api.perplexity.ai', 'api.groq.com',
    ];
    if (CROSS_DOMAIN.includes(parsed.hostname)) return true;
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
    pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:million|billion|M|B|k|K)?\b/g,
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

  // ─── Business Context Detection (prevents MNPI leakage) ─────────────────

  // Stock tickers with exchange prefix (NYSE: NVTK, NASDAQ: AAPL)
  {
    type: 'TICKER',
    pattern: /\b(?:NYSE|NASDAQ|AMEX|LSE|TSX|NIKKEI|FTSE|DAX|CAC)\s*:\s*[A-Z]{1,5}\b/g,
    confidence: 0.95,
  },
  // Cashtag tickers ($AAPL, $NVTK)
  {
    type: 'TICKER',
    pattern: /\$[A-Z]{2,5}\b/g,
    confidence: 0.8,
  },

  // Percentages — critical for financial MNPI (18%, 14.2%, etc.)
  {
    type: 'PERCENTAGE',
    pattern: /\b\d{1,3}(?:\.\d{1,2})?%/g,
    confidence: 0.8,
  },

  // Written dates (March 5th, January 2024, December 15, 2025)
  {
    type: 'DATE',
    pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
    confidence: 0.75,
  },

  // Fiscal quarters and periods (Q1, Q4 2024, FY2024, H1)
  {
    type: 'FISCAL_PERIOD',
    pattern: /\b(?:[QH][1-4]|FY)\s*(?:'?\d{2,4})?\b/g,
    confidence: 0.75,
  },

  // Project / Operation code names (Project Horizon, Operation Nighthawk)
  {
    type: 'PROJECT_NAME',
    pattern: /\b(?:Project|Operation|Initiative|Program|Codename)\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b/g,
    confidence: 0.9,
  },

  // Organization names — broader suffixes (Elliot Management, Meridian Capital Partners)
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Management|Capital|Partners|Holdings|Securities|Advisors|Consulting|Analytics|Investments|Solutions|Technologies|Financial|Ventures|Research|Services|Labs|Systems|Industries|Dynamics|Media|Health|Pharma|Energy|Realty|Properties)\b/g,
    confidence: 0.8,
  },

  // CamelCase company names (NovaTech, DeepSeek, OpenAI, DataDog)
  {
    type: 'ORGANIZATION',
    pattern: /\b[A-Z][a-z]{1,10}[A-Z][a-zA-Z]{1,10}\b/g,
    confidence: 0.7,
  },

  // Contextual organization (at/firm/company/investor + Proper Noun, 1-3 words)
  // No 'i' flag — trigger words must be lowercase, proper nouns must be capitalized
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:at|firm|company|investor|partner|vendor|supplier|competitor|acquirer|subsidiary|conglomerate|startup|unicorn|acquired|acquiring|target)\s*[,:]?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g,
    confidence: 0.7,
    contextual: true,
  },

  // Contextual organization — business activity (discussions with X, deal with X)
  // No 'i' flag — prevents matching lowercase words as proper nouns
  {
    type: 'ORGANIZATION',
    pattern: /\b(?:discussions?\s+with|partnership\s+with|deal\s+with|investment\s+(?:in|from|by)|acquired\s+by|merger\s+with|contract\s+with|agreement\s+with|lawsuit\s+(?:against|from)|counsel\s+at)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g,
    confidence: 0.75,
    contextual: true,
  },

  // Headcount / workforce numbers (340 headcount, 500 employees, 200 layoffs)
  {
    type: 'HEADCOUNT',
    pattern: /\b\d{2,5}\s*(?:headcount|employees?|people|workers|staff|positions|roles|FTEs?|hires?|cuts?|layoffs?|terminations?)\b/gi,
    confidence: 0.8,
  },

  // Legal section references (Section 13D, Rule 10b-5, Regulation S-K)
  {
    type: 'LEGAL_REFERENCE',
    pattern: /\b(?:Section|Rule|Regulation|Article|Clause)\s+\d+[A-Za-z]?(?:[-]\d+)?\b/g,
    confidence: 0.75,
  },

  // Valuation / market cap amounts without $ sign (3.1B market cap, 1.67B valuation)
  {
    type: 'MONETARY_AMOUNT',
    pattern: /\b\d{1,4}(?:\.\d{1,2})?\s*[BMK]\s*(?:valuation|market\s*cap|revenue|ARR|MRR|EBITDA|profit|loss|deal|round)\b/gi,
    confidence: 0.8,
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
        // Extract the proper noun portion (1-3 capitalized words at end of match)
        const nameMatch = match[0].match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/);
        if (nameMatch) {
          const nameStart = match[0].lastIndexOf(nameMatch[0]);
          matchText = nameMatch[0];
          matchStart = match.index + nameStart;
          matchEnd = matchStart + matchText.length;
        } else {
          // No proper noun found — likely a false positive (e.g., "for the emergency")
          continue;
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

// ─── Realistic Fake Data Generation ─────────────────────────────────────────
// Instead of [PERSON-1] tokens which make LLMs respond robotically,
// we generate realistic-looking fake data. The LLM treats it as real
// content, responds naturally, and we swap the fakes back in the response.

const FAKE_NAMES_F = [
  'Emily Rogers', 'Anna Peterson', 'Lisa Chang', 'Maria Santos', 'Rachel Kim',
  'Diana Walsh', 'Nicole Foster', 'Amanda Brooks', 'Jennifer Liu', 'Stephanie Barnes',
  'Katherine Hayes', 'Laura Bennett', 'Olivia Porter', 'Samantha Reed', 'Victoria Lane',
];
const FAKE_NAMES_M = [
  'James Mitchell', 'David Kumar', 'Robert Chen', 'William Taylor', 'Thomas Garcia',
  'Andrew Watson', 'Daniel Price', 'Christopher Lee', 'Michael Brown', 'Steven Park',
  'Jonathan Reed', 'Matthew Cole', 'Benjamin Hart', 'Patrick Quinn', 'Marcus Webb',
];
const FEMALE_FIRST = new Set([
  'sarah','jennifer','lisa','maria','anna','rachel','diana','nicole','amanda','jessica',
  'emily','laura','stephanie','katherine','olivia','samantha','victoria','helen','jane','margaret',
  'susan','karen','nancy','betty','sandra','ashley','dorothy','kimberly','elizabeth','donna',
]);
const FAKE_ORGS = [
  'Northwind Technologies', 'Contoso Holdings', 'Adatum Corp', 'Fabrikam Industries',
  'Proseware Solutions', 'Woodgrove Financial', 'Tailspin Partners', 'Lucerne Media',
  'Alpine Securities', 'Meridian Dynamics', 'Coastal Ventures', 'Summit Analytics',
  'Vertex Research', 'Pinnacle Systems', 'Horizon Labs',
];
const FAKE_TICKERS = [
  'NWND', 'CTSO', 'ADTM', 'FBRK', 'PRWL', 'WDGV', 'TLSP', 'LCNE', 'ALPS', 'MRDX',
  'CSVT', 'SMTA', 'VTXR', 'PNCL', 'HRZL',
];
const FAKE_PROJECTS = [
  'Project Aurora', 'Project Meridian', 'Project Catalyst', 'Project Zenith',
  'Project Atlas', 'Project Nexus', 'Project Titan', 'Project Vanguard',
  'Project Ember', 'Project Falcon',
];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Track used fakes to avoid collisions within a session
const _usedFakes: Record<string, number> = {};

function _pickUnused(pool: string[], type: string): string {
  if (!_usedFakes[type]) _usedFakes[type] = 0;
  const idx = _usedFakes[type] % pool.length;
  _usedFakes[type]++;
  return pool[idx];
}

function _isFemaleFirst(name: string): boolean {
  const first = name.split(/\s+/)[0].toLowerCase();
  return FEMALE_FIRST.has(first);
}

function _randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function generateFake(type: string, original: string): string {
  switch (type) {
    case 'PERSON': {
      const pool = _isFemaleFirst(original) ? FAKE_NAMES_F : FAKE_NAMES_M;
      return _pickUnused(pool, type + (_isFemaleFirst(original) ? '_F' : '_M'));
    }

    case 'ORGANIZATION':
      return _pickUnused(FAKE_ORGS, type);

    case 'TICKER': {
      // "NYSE: NVTK" → "NYSE: NWND"
      const m = original.match(/^([A-Z]+\s*:\s*)/);
      if (m) return m[1] + _pickUnused(FAKE_TICKERS, type);
      return _pickUnused(FAKE_TICKERS, type);
    }

    case 'PROJECT_NAME':
      return _pickUnused(FAKE_PROJECTS, type);

    case 'MONETARY_AMOUNT': {
      // Preserve magnitude, shift by 0.7-1.4x
      // Parse: "$47M", "$3.1B", "$150,000", "$28M"
      const cleaned = original.replace(/[,$\s]/g, '');
      const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(million|billion|M|B|k|K|dollars?|USD|EUR|GBP)?/i);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const suffix = numMatch[2] || '';
        const shifted = num * _randBetween(0.7, 1.35);
        // Preserve format
        const hasDecimal = numMatch[1].includes('.');
        const decPlaces = hasDecimal ? (numMatch[1].split('.')[1]?.length || 1) : 0;
        const formatted = hasDecimal ? shifted.toFixed(decPlaces) : Math.round(shifted).toString();
        // Reconstruct with original prefix style
        const prefix = original.startsWith('$') ? '$' : '';
        return prefix + formatted + suffix;
      }
      return original; // Can't parse, return original
    }

    case 'PERCENTAGE': {
      // Offset by ±3-8 percentage points
      const numMatch = original.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const offset = _randBetween(3, 8) * (Math.random() > 0.5 ? 1 : -1);
        const shifted = Math.max(0.1, Math.min(99.9, num + offset));
        const hasDecimal = numMatch[1].includes('.');
        return (hasDecimal ? shifted.toFixed(1) : Math.round(shifted).toString()) + '%';
      }
      return original;
    }

    case 'DATE': {
      // Written dates: "March 5th" → shift month and day
      const dateMatch = original.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(.*)$/i);
      if (dateMatch) {
        const monthIdx = MONTHS.findIndex(m => m.toLowerCase() === dateMatch[1].toLowerCase());
        if (monthIdx >= 0) {
          const newMonthIdx = (monthIdx + Math.floor(_randBetween(1, 4))) % 12;
          const newDay = Math.max(1, Math.min(28, parseInt(dateMatch[2]) + Math.floor(_randBetween(-10, 10))));
          const suffix = newDay === 1 || newDay === 21 || newDay === 31 ? 'st' : newDay === 2 || newDay === 22 ? 'nd' : newDay === 3 || newDay === 23 ? 'rd' : 'th';
          return MONTHS[newMonthIdx] + ' ' + newDay + suffix + (dateMatch[3] || '');
        }
      }
      // Numeric dates: shift
      const numDate = original.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{2,4})$/);
      if (numDate) {
        const m = Math.max(1, Math.min(12, parseInt(numDate[1]) + Math.floor(_randBetween(-2, 3))));
        const d = Math.max(1, Math.min(28, parseInt(numDate[3]) + Math.floor(_randBetween(-5, 5))));
        return m + numDate[2] + d + numDate[2] + numDate[4];
      }
      return original;
    }

    case 'FISCAL_PERIOD': {
      // Q4 → Q2, Q1 → Q3 (shift by 1-2)
      const qMatch = original.match(/^([QH])(\d)/);
      if (qMatch) {
        const shifted = ((parseInt(qMatch[2]) + Math.floor(_randBetween(1, 3)) - 1) % 4) + 1;
        return qMatch[1] + shifted + original.substring(2);
      }
      return original;
    }

    case 'EMAIL': {
      // Generate from fake name pool
      const fakeName = _pickUnused(FAKE_NAMES_F.concat(FAKE_NAMES_M), 'EMAIL_NAME');
      const parts = fakeName.toLowerCase().split(' ');
      const domains = ['northwind.com', 'contoso.com', 'fabrikam.net', 'adatum.org', 'proseware.io'];
      const domain = domains[Math.floor(Math.random() * domains.length)];
      return parts[0] + '.' + parts[1] + '@' + domain;
    }

    case 'SSN': {
      // Format-preserving random: 123-45-6789 → 456-78-9012
      const a = Math.floor(_randBetween(100, 899));
      const b = Math.floor(_randBetween(10, 99));
      const c = Math.floor(_randBetween(1000, 9999));
      return a + '-' + b + '-' + c;
    }

    case 'PHONE_NUMBER': {
      const a = Math.floor(_randBetween(200, 899));
      const b = Math.floor(_randBetween(200, 899));
      const c = Math.floor(_randBetween(1000, 9999));
      // Try to preserve format
      if (original.includes('(')) return '(' + a + ') ' + b + '-' + c;
      if (original.includes('-')) return a + '-' + b + '-' + c;
      return a + ' ' + b + ' ' + c;
    }

    case 'CREDIT_CARD': {
      // Format-preserving
      const groups = [
        Math.floor(_randBetween(4000, 4999)),
        Math.floor(_randBetween(1000, 9999)),
        Math.floor(_randBetween(1000, 9999)),
        Math.floor(_randBetween(1000, 9999)),
      ];
      if (original.includes('-')) return groups.join('-');
      if (original.includes(' ')) return groups.join(' ');
      return groups.join('');
    }

    case 'HEADCOUNT': {
      // "340 headcount" → shift number by ±20%
      const hcMatch = original.match(/^(\d+)\s*(.*)/);
      if (hcMatch) {
        const num = parseInt(hcMatch[1]);
        const shifted = Math.round(num * _randBetween(0.7, 1.35));
        return shifted + (hcMatch[2] ? ' ' + hcMatch[2] : '');
      }
      return original;
    }

    case 'LEGAL_REFERENCE': {
      // "Section 13D" → shift number
      const lrMatch = original.match(/^(\w+)\s+(\d+)(.*)/);
      if (lrMatch) {
        const shifted = parseInt(lrMatch[2]) + Math.floor(_randBetween(2, 8));
        return lrMatch[1] + ' ' + shifted + (lrMatch[3] || '');
      }
      return original;
    }

    case 'IP_ADDRESS': {
      const octets = Array.from({ length: 4 }, () => Math.floor(_randBetween(1, 254)));
      return octets.join('.');
    }

    case 'EMPLOYEE_ID':
    case 'RECORD_ID': {
      // Preserve prefix, randomize digits
      const idMatch = original.match(/^([A-Z#-]+)(\d+)$/);
      if (idMatch) {
        const len = idMatch[2].length;
        const newNum = Math.floor(_randBetween(10 ** (len - 1), 10 ** len - 1));
        return idMatch[1] + newNum;
      }
      return original;
    }

    default:
      // Fallback to token style for unknown types
      return `[${type}]`;
  }
}

// ─── Pseudonymizer ──────────────────────────────────────────────────────────

interface PseudonymMapping {
  original: string;
  pseudonym: string;
  type: string;
}

interface PseudonymResult {
  maskedText: string;
  mappings: PseudonymMapping[];
}

// Global forward map: original → fake (persists across messages in a conversation)
let currentForwardMap: Record<string, string> = {};

function pseudonymizeLocal(text: string, entities: DetectedEntity[]): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [] };
  }

  const mappings: PseudonymMapping[] = [];
  const seen = new Map<string, string>();

  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let maskedText = text;

  for (const entity of sorted) {
    const normalizedText = entity.text.trim();
    // Check local seen map first (within this call)
    let pseudonym = seen.get(normalizedText);
    if (!pseudonym) {
      // Check global forward map (from previous messages in conversation)
      pseudonym = currentForwardMap[normalizedText];
    }
    if (!pseudonym) {
      // Generate a new realistic fake
      pseudonym = generateFake(entity.type, normalizedText);
      seen.set(normalizedText, pseudonym);
      currentForwardMap[normalizedText] = pseudonym;
      mappings.push({
        original: normalizedText,
        pseudonym,
        type: entity.type,
      });
    } else if (!mappings.some(m => m.original === normalizedText)) {
      // Already mapped — still record for this call's mappings
      if (!seen.has(normalizedText)) seen.set(normalizedText, pseudonym);
      mappings.push({ original: normalizedText, pseudonym, type: entity.type });
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
  // ── Google Gemini: URL-encoded form body with f.req= containing nested JSON ──
  // Must be checked BEFORE JSON.parse since URL-encoded strings aren't valid JSON.
  // Gemini sends: f.req=[[[\"MfsCee\",\"[\\\"prompt text\\\",...]\",null,\"generic\"]]]&at=...
  if (typeof body === 'string' && (body.includes('f.req=') || body.includes('f.req%3D'))) {
    try {
      const params = new URLSearchParams(body);
      const fReq = params.get('f.req');
      if (fReq) {
        const outer = JSON.parse(fReq);
        // Walk the nested arrays to find the deepest string
        const deep = findDeepestString(Array.isArray(outer) ? outer : [outer]);
        if (deep) {
          // Gemini nests JSON-in-JSON: the string might itself be a JSON array
          try {
            const inner = JSON.parse(deep);
            const innerDeep = findDeepestString(Array.isArray(inner) ? inner : [inner]);
            if (innerDeep && innerDeep.length > 10) {
              console.log(`[Iron Gate MAIN] Gemini prompt extracted from f.req (${innerDeep.length} chars)`);
              return innerDeep;
            }
          } catch { /* not JSON-in-JSON, use the string directly */ }
          if (deep.length > 10) {
            console.log(`[Iron Gate MAIN] Gemini prompt extracted from f.req outer (${deep.length} chars)`);
            return deep;
          }
        }
      }
    } catch (e) {
      console.log('[Iron Gate MAIN] Gemini f.req parse failed:', e);
    }
  }

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
  // ── Google Gemini: URL-encoded form body with f.req= ──
  // The prompt appears JSON-escaped (possibly double-escaped) inside the f.req value.
  // We parse f.req, find the prompt text with appropriate escaping, replace it, and re-encode.
  if (body.includes('f.req=') || body.includes('f.req%3D')) {
    try {
      const params = new URLSearchParams(body);
      const fReq = params.get('f.req');
      if (fReq && originalPrompt.length >= 10) {
        // Try single JSON-escaped match (prompt inside a JSON string)
        const escapedOrig = jsonStringEscape(originalPrompt);
        const escapedRepl = jsonStringEscape(replacement);
        if (fReq.includes(escapedOrig)) {
          const modifiedFReq = fReq.replace(escapedOrig, escapedRepl);
          params.set('f.req', modifiedFReq);
          console.log(`[Iron Gate MAIN] Gemini replacePrompt: single-escaped match`);
          return params.toString();
        }
        // Try double-escaped match (JSON-in-JSON: prompt is escaped twice)
        const doubleEscapedOrig = jsonStringEscape(escapedOrig);
        const doubleEscapedRepl = jsonStringEscape(escapedRepl);
        if (fReq.includes(doubleEscapedOrig)) {
          const modifiedFReq = fReq.replace(doubleEscapedOrig, doubleEscapedRepl);
          params.set('f.req', modifiedFReq);
          console.log(`[Iron Gate MAIN] Gemini replacePrompt: double-escaped match`);
          return params.toString();
        }
        // Try raw text match (prompt appears unescaped)
        if (fReq.includes(originalPrompt)) {
          const modifiedFReq = fReq.replace(originalPrompt, replacement);
          params.set('f.req', modifiedFReq);
          console.log(`[Iron Gate MAIN] Gemini replacePrompt: raw text match`);
          return params.toString();
        }
        console.log(`[Iron Gate MAIN] Gemini replacePrompt: no match found in f.req (${fReq.length} chars)`);
      }
    } catch (e) {
      console.log('[Iron Gate MAIN] Gemini replacePrompt error:', e);
    }
  }

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

function quickScore(entities: Array<{ type: string; confidence: number }>): { level: 'low' | 'medium' | 'high' | 'critical'; score: number } {
  if (entities.length === 0) return { level: 'low', score: 0 };

  const HIGH_RISK_TYPES = new Set(['SSN', 'CREDIT_CARD', 'API_KEY', 'AWS_CREDENTIAL', 'PRIVATE_KEY', 'DATABASE_URI', 'AUTH_TOKEN', 'MEDICAL_RECORD', 'TICKER']);
  const MED_RISK_TYPES = new Set(['PERSON', 'PHONE_NUMBER', 'EMAIL', 'MONETARY_AMOUNT', 'ACCOUNT_NUMBER', 'EMPLOYEE_ID', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE', 'ORGANIZATION', 'PROJECT_NAME', 'PERCENTAGE', 'HEADCOUNT', 'LEGAL_REFERENCE', 'FISCAL_PERIOD']);

  let score = 0;
  for (const e of entities) {
    if (HIGH_RISK_TYPES.has(e.type)) score += 25;
    else if (MED_RISK_TYPES.has(e.type)) score += 10;
    else score += 5;
  }

  const uniqueTypes = new Set(entities.map((e) => e.type)).size;
  if (uniqueTypes >= 3) score += 15;

  // Cap at 100 for display purposes
  score = Math.min(score, 100);

  let level: 'low' | 'medium' | 'high' | 'critical';
  if (score >= 86) level = 'critical';
  else if (score >= 61) level = 'high';
  else if (score >= 26) level = 'medium';
  else level = 'low';

  return { level, score };
}

// ─── Response De-pseudonymization ──────────────────────────────────────────

function replacePseudonyms(text: string, reverseMap: Record<string, string>): string {
  let result = text;
  for (const [pseudonym, original] of Object.entries(reverseMap)) {
    result = result.split(pseudonym).join(original);
  }
  return result;
}

function depseudonymizeResponse(response: Response, reverseMap: Record<string, string>): Response {
  if (!response.body) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Find the longest pseudonym token to size our overlap buffer
  const maxTokenLen = Math.max(...Object.keys(reverseMap).map(k => k.length), 0);
  let buffer = '';

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          // Flush remaining buffer
          if (buffer.length > 0) {
            controller.enqueue(encoder.encode(replacePseudonyms(buffer, reverseMap)));
          }
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        // Output all text except the last maxTokenLen chars (which might contain a split token)
        const safeLen = Math.max(0, buffer.length - maxTokenLen);
        if (safeLen > 0) {
          const safeText = replacePseudonyms(buffer.substring(0, safeLen), reverseMap);
          controller.enqueue(encoder.encode(safeText));
          buffer = buffer.substring(safeLen);
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

// ─── DOM De-pseudonymization (safety net) ───────────────────────────────────
// Catches pseudonym tokens that make it to the DOM via WebSocket, EventSource,
// or any other channel that bypasses our fetch/XHR interception.

let _domObserverActive = false;

function startDomDepseudonymizer(): void {
  if (_domObserverActive) return;
  _domObserverActive = true;

  function replaceInTextNode(node: Text): void {
    if (!node.textContent || Object.keys(currentReverseMap).length === 0) return;

    // Quick check: does the text contain any of the pseudonym strings?
    // (Realistic fakes don't use brackets, so we check against actual keys)
    const keys = Object.keys(currentReverseMap);
    const hasMatch = keys.some(key => node.textContent!.includes(key));
    if (!hasMatch) return;

    const replaced = replacePseudonyms(node.textContent, currentReverseMap);
    if (replaced !== node.textContent) {
      node.textContent = replaced;
    }
  }

  function scanElement(el: Node): void {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      replaceInTextNode(textNode);
    }
  }

  // Watch for new DOM nodes and replace pseudonyms immediately
  const observer = new MutationObserver((mutations) => {
    if (Object.keys(currentReverseMap).length === 0) return;

    for (const mutation of mutations) {
      // Handle added nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          replaceInTextNode(node as Text);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          scanElement(node);
        }
      }
      // Handle direct text changes (characterData)
      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        replaceInTextNode(mutation.target as Text);
      }
    }
  });

  // Start observing once body is available
  const startObserving = () => {
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      console.log('[Iron Gate MAIN] DOM de-pseudonymizer active');
    } else {
      setTimeout(startObserving, 100);
    }
  };
  startObserving();

  // Also do a periodic full scan every 2 seconds as a backstop
  setInterval(() => {
    if (Object.keys(currentReverseMap).length === 0) return;
    if (document.body) {
      scanElement(document.body);
    }
  }, 2000);
}

// Start the DOM de-pseudonymizer immediately
startDomDepseudonymizer();

// ─── Extract body string from any fetch input ─────────────────────────────
// AI tools may call fetch(url, {body}) OR fetch(new Request(url, {body})).
// We need to handle both cases to reliably intercept.

async function getBodyString(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  // Case 1: body is in the init options (most common — covers ~99% of AI tool requests)
  if (init?.body !== undefined && init?.body !== null) {
    if (typeof init.body === 'string') return init.body;
    if (init.body instanceof ArrayBuffer) return new TextDecoder().decode(init.body);
    if (init.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
    if (init.body instanceof Blob) {
      try { return await init.body.text(); } catch { return null; }
    }
    // URLSearchParams — safe to call .toString() (doesn't consume).
    // Gemini sends body as URLSearchParams with f.req= parameter.
    if (typeof URLSearchParams !== 'undefined' && init.body instanceof URLSearchParams) {
      return init.body.toString();
    }
    // FormData — safe to iterate (doesn't consume). Convert to URL-encoded string.
    // Needed for Gemini which may send f.req via FormData.
    if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
      try {
        const params = new URLSearchParams();
        for (const [key, value] of init.body.entries()) {
          if (typeof value === 'string') params.append(key, value);
        }
        const result = params.toString();
        return result.length > 0 ? result : null;
      } catch { return null; }
    }
    // ReadableStream or unknown body type — log type for debugging and skip
    console.log(`[Iron Gate MAIN] getBodyString: unhandled body type: ${Object.prototype.toString.call(init.body)}, constructor: ${init.body?.constructor?.name}`);
    return null;
  }

  // Case 2: input is a Request object with a body
  if (input instanceof Request && !input.bodyUsed) {
    try {
      const cloned = input.clone();
      const text = await cloned.text();
      return (text && text.length > 0) ? text : null;
    } catch { return null; }
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

  _fetchCallCount++;
  if (_fetchCallCount <= 15) {
    console.log(`[Iron Gate MAIN] fetch #${_fetchCallCount}: ${method} ${url.substring(0, 100)}`);
  }

  // Only intercept POST/PUT/PATCH (which carry prompt data in body)
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    return originalFetch.call(window, input, init);
  }

  if (!isLLMEndpoint(url)) {
    return originalFetch.call(window, input, init);
  }

  // Extract the body — NEVER mutates input or init
  let bodyString: string | null = null;
  try {
    bodyString = await getBodyString(input, init);
  } catch {
    // Body read failed — pass through unmodified
  }

  if (!bodyString || bodyString.length < 50) {
    return originalFetch.call(window, input, init);
  }

  // ChatGPT-specific diagnostic
  if (url.includes('/backend-api/conversation') || url.includes('/chat/completions')) {
    console.log(`[Iron Gate MAIN] 🎯 ChatGPT conversation request — body: ${bodyString.length} chars`);
  }

  console.log(`[Iron Gate MAIN] LLM request intercepted — mode: ${mode}, url: ${url.substring(0, 80)}, body: ${bodyString.length} chars`);
  // Diagnostic: log body snippet for debugging
  if (url.includes('gemini') || url.includes('googleapis')) {
    console.log(`[Iron Gate MAIN] Gemini body preview: "${bodyString.substring(0, 300)}"`);
  }
  if (url.includes('copilot') || url.includes('bing') || url.includes('sydney')) {
    console.log(`[Iron Gate MAIN] Copilot body preview: "${bodyString.substring(0, 300)}"`);
    console.log(`[Iron Gate MAIN] Copilot fetch args — input: ${input instanceof Request ? 'Request' : typeof input}, init: ${init ? 'yes' : 'no'}`);
  }

  // ── PROXY MODE: Pseudonymize before sending ──────────────────────────────
  if (mode === 'proxy') {
    try {
      const promptText = extractPrompt(bodyString);

      if (!promptText || promptText.length < 10) {
        console.log(`[Iron Gate MAIN] extractPrompt returned ${promptText === null ? 'null' : `"${promptText?.substring(0, 50)}..." (${promptText?.length} chars)`} — body starts with: "${bodyString.substring(0, 150)}"`);
      }

      if (promptText && promptText.length >= 10) {
        // Detect entities
        const regexEntities = detectWithRegex(promptText);
        const secrets = scanForSecrets(promptText);
        const allEntities = [...regexEntities, ...secrets];

        console.log(`[Iron Gate MAIN] Detected ${allEntities.length} entities in prompt (${promptText.length} chars)`);

        if (allEntities.length > 0) {
          const { level, score } = quickScore(allEntities);
          const pseudoResult = pseudonymizeLocal(promptText, allEntities);

          // Build reverse map for de-pseudonymization (ACCUMULATE, don't replace)
          // This ensures multi-turn conversations can de-pseudonymize across requests
          for (const m of pseudoResult.mappings) {
            currentReverseMap[m.pseudonym] = m.original;
          }
          // Save a snapshot for this request's response de-pseudonymization
          const requestReverseMap = { ...currentReverseMap };

          // Replace prompt in request body — prefer direct string replacement
          // to preserve exact JSON format (avoids re-serialization issues with
          // Copilot, Bing, and other tools that validate body format).
          let modifiedBody: string | null = null;
          const _escapedOrig = jsonStringEscape(promptText);
          const _escapedRepl = jsonStringEscape(pseudoResult.maskedText);
          if (bodyString.includes(_escapedOrig)) {
            modifiedBody = bodyString.replace(_escapedOrig, _escapedRepl);
            console.log('[Iron Gate MAIN] Used direct string replacement (preserves exact body format)');
          } else if (bodyString.includes(promptText)) {
            modifiedBody = bodyString.replace(promptText, pseudoResult.maskedText);
            console.log('[Iron Gate MAIN] Used raw string replacement');
          } else {
            modifiedBody = replacePrompt(bodyString, promptText, pseudoResult.maskedText);
            console.log('[Iron Gate MAIN] Used format-specific replacePrompt fallback');
          }

          if (modifiedBody) {
            console.log(
              `[Iron Gate MAIN] PROXY: Pseudonymized ${allEntities.length} entities (${level}, score=${score}). Entities: ${allEntities.map(e => `${e.type}:"${e.text.substring(0,20)}"`).join(', ')}`
            );
            console.log(`[Iron Gate MAIN] Original prompt snippet: "${promptText.substring(0, 100)}..."`);
            console.log(`[Iron Gate MAIN] Masked prompt snippet: "${pseudoResult.maskedText.substring(0, 100)}..."`);

            // Notify content script (for sidepanel display AND backend event)
            window.postMessage({
              type: 'IRON_GATE_INTERCEPTED',
              originalPrompt: promptText,
              maskedPrompt: pseudoResult.maskedText,
              mappings: pseudoResult.mappings,
              entityCount: allEntities.length,
              level,
              score,
              entities: allEntities.map(e => ({ type: e.type, text: e.text, start: e.start, end: e.end, confidence: e.confidence, source: e.source })),
            }, '*');

            // Send modified request — preserve ALL original fetch arguments.
            // Only override the body to prevent breaking tool-specific properties
            // (CSRF tokens, credentials, referrer policy, etc.).
            let modifiedResponse: Response;
            try {
              if (init) {
                // fetch(url_or_request, init) — spread init, override only body
                let finalInit: RequestInit = { ...init, body: modifiedBody };
                // If original body was FormData but we replaced with URL-encoded string,
                // update Content-Type accordingly
                if (typeof FormData !== 'undefined' && init.body instanceof FormData && typeof modifiedBody === 'string') {
                  const h = new Headers(init.headers);
                  h.set('Content-Type', 'application/x-www-form-urlencoded');
                  finalInit = { ...finalInit, headers: h };
                }
                modifiedResponse = await originalFetch.call(window, input, finalInit);
              } else if (input instanceof Request) {
                // fetch(request) — no init; pass request + body override
                modifiedResponse = await originalFetch.call(window, input, { body: modifiedBody });
              } else {
                // fetch(url) — no init, just URL string
                modifiedResponse = await originalFetch.call(window, input, { method: 'POST', body: modifiedBody });
              }
            } catch (fetchErr) {
              console.warn('[Iron Gate MAIN] Modified request failed, sending original:', fetchErr);
              return originalFetch.call(window, input, init);
            }

            // Log response status for debugging
            console.log(`[Iron Gate MAIN] Modified request response: ${modifiedResponse.status} ${modifiedResponse.statusText} (url: ${url.substring(0, 60)})`);
            if (!modifiedResponse.ok) {
              console.warn(`[Iron Gate MAIN] ⚠️ Modified request got ${modifiedResponse.status} — tool backend may have rejected the modified body`);
            }

            // De-pseudonymize the response stream (use snapshot, not mutable global)
            // Skip for tools with non-standard streaming (SSE, protobuf, nested JSON).
            // DOM MutationObserver handles de-pseudonymization for these tools instead.
            const skipStreamWrap = /copilot\.microsoft\.com|sydney\.bing\.com|bing\.com|gemini\.google\.com|generativelanguage\.googleapis\.com/i.test(url);
            if (Object.keys(requestReverseMap).length > 0 && !skipStreamWrap) {
              console.log(`[Iron Gate MAIN] De-pseudonymizing response with ${Object.keys(requestReverseMap).length} mappings`);
              return depseudonymizeResponse(modifiedResponse, requestReverseMap);
            }
            if (skipStreamWrap && Object.keys(requestReverseMap).length > 0) {
              console.log(`[Iron Gate MAIN] Non-standard streaming tool — skipping response stream wrap, DOM observer will de-pseudonymize`);
            }

            return modifiedResponse;
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
          const { level, score } = quickScore(allEntities);
          const pseudoResult = pseudonymizeLocal(promptText, allEntities);

          console.log(`[Iron Gate MAIN] AUDIT: Detected ${allEntities.length} entities (${level}, score=${score}): ${allEntities.map(e => `${e.type}:"${e.text.substring(0,20)}"`).join(', ')}`);

          window.postMessage({
            type: 'IRON_GATE_AUDIT',
            originalPrompt: promptText,
            maskedPrompt: pseudoResult.maskedText,
            mappings: pseudoResult.mappings,
            entityCount: allEntities.length,
            level,
            score,
            entities: allEntities.map(e => ({ type: e.type, text: e.text, start: e.start, end: e.end, confidence: e.confidence, source: e.source })),
          }, '*');
        }
      }
    } catch {
      // Don't break the original request
    }
  }

  // Pass through to original fetch
  return originalFetch.call(window, input, init);
}

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
  const xhrMethod = meta?.method || 'GET';

  // Diagnostic: log ALL XHR POST requests on Gemini to find the chat endpoint
  if (xhrMethod === 'POST' && (url.includes('gemini') || url.includes('google') || url.includes('googleapis'))) {
    const bodyType = body === null ? 'null' : body === undefined ? 'undefined' : typeof body === 'string' ? `string(${body.length})` : `${body?.constructor?.name || typeof body}`;
    console.log(`[Iron Gate MAIN] XHR POST: ${url.substring(0, 120)} | body: ${bodyType}`);
  }

  // Convert non-string bodies to string for processing
  let bodyStr: string | null = null;
  if (body && typeof body === 'string') {
    bodyStr = body;
  } else if (body instanceof URLSearchParams) {
    bodyStr = body.toString();
  } else if (body instanceof FormData) {
    try {
      const params = new URLSearchParams();
      for (const [key, value] of body.entries()) {
        if (typeof value === 'string') params.append(key, value);
      }
      bodyStr = params.toString();
    } catch { /* ignore */ }
  } else if (body instanceof ArrayBuffer) {
    try { bodyStr = new TextDecoder().decode(body); } catch { /* binary/protobuf — can't parse */ }
  } else if (body instanceof Uint8Array) {
    try { bodyStr = new TextDecoder().decode(body); } catch { /* binary — can't parse */ }
  }

  if (isLLMEndpoint(url) && bodyStr && bodyStr.length >= 50) {
    console.log(`[Iron Gate MAIN] XHR intercepted — mode: ${mode}, url: ${url.substring(0, 80)}, body length: ${bodyStr.length}, originalType: ${body?.constructor?.name}`);
    if (url.includes('gemini') || url.includes('googleapis')) {
      console.log(`[Iron Gate MAIN] XHR Gemini body preview: "${bodyStr.substring(0, 300)}"`);
    }

    if (mode === 'proxy') {
      try {
        const promptText = extractPrompt(bodyStr);
        if (promptText && promptText.length >= 10) {
          const regexEntities = detectWithRegex(promptText);
          const secrets = scanForSecrets(promptText);
          const allEntities = [...regexEntities, ...secrets];

          if (allEntities.length > 0) {
            const { level, score } = quickScore(allEntities);
            const pseudoResult = pseudonymizeLocal(promptText, allEntities);

            // Accumulate mappings (don't overwrite)
            for (const m of pseudoResult.mappings) {
              currentReverseMap[m.pseudonym] = m.original;
            }
            const xhrReverseMap = { ...currentReverseMap };

            const modifiedBody = replacePrompt(bodyStr, promptText, pseudoResult.maskedText);
            if (modifiedBody) {
              console.log(`[Iron Gate MAIN] XHR PROXY: Pseudonymized ${allEntities.length} entities (${level}, score=${score})`);
              console.log(`[Iron Gate MAIN] XHR Masked: "${pseudoResult.maskedText.substring(0, 100)}..."`);

              window.postMessage({
                type: 'IRON_GATE_INTERCEPTED',
                originalPrompt: promptText,
                maskedPrompt: pseudoResult.maskedText,
                mappings: pseudoResult.mappings,
                entityCount: allEntities.length,
                level,
                score,
                entities: allEntities.map(e => ({ type: e.type, text: e.text, start: e.start, end: e.end, confidence: e.confidence, source: e.source })),
              }, '*');

              // Patch the response to de-pseudonymize
              // SKIP for Copilot/Bing — DOM observer handles it instead
              const xhrIsCopilot = /copilot\.microsoft\.com|sydney\.bing\.com|bing\.com/i.test(url);
              if (Object.keys(xhrReverseMap).length > 0 && !xhrIsCopilot) {
                const reverseMap = xhrReverseMap;
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
              } else if (xhrIsCopilot) {
                console.log('[Iron Gate MAIN] XHR Copilot — skipping responseText patch, DOM observer will handle');
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
        const promptText = extractPrompt(bodyStr);
        if (promptText && promptText.length >= 10) {
          const regexEntities = detectWithRegex(promptText);
          const secrets = scanForSecrets(promptText);
          const allEntities = [...regexEntities, ...secrets];
          if (allEntities.length > 0) {
            const { level, score } = quickScore(allEntities);
            const pseudoResult = pseudonymizeLocal(promptText, allEntities);
            console.log(`[Iron Gate MAIN] XHR AUDIT: ${allEntities.length} entities (${level}, score=${score})`);
            window.postMessage({
              type: 'IRON_GATE_AUDIT',
              originalPrompt: promptText,
              maskedPrompt: pseudoResult.maskedText,
              mappings: pseudoResult.mappings,
              entityCount: allEntities.length,
              level,
              score,
              entities: allEntities.map(e => ({ type: e.type, text: e.text, start: e.start, end: e.end, confidence: e.confidence, source: e.source })),
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
// Copilot (Sydney/Bing backend) uses SignalR over WebSocket for chat.
// SignalR messages are separated by \u001e (record separator).
// Message types: 1=Invocation (chat), 3=Completion, 6=Ping, 7=Close.
// We ONLY modify type 1 invocations that contain chat text — all other
// frames (handshake, ping, completion) pass through untouched.

const OriginalWebSocket = window.WebSocket;

/**
 * Check if a SignalR frame is a chat invocation (type 1) with extractable prompt text.
 * Returns the prompt text if found, null otherwise.
 */
function isSignalRChatFrame(frame: string): boolean {
  try {
    const parsed = JSON.parse(frame);
    // SignalR invocation frames have type: 1
    if (parsed?.type !== 1) return false;
    // Must have a target method (e.g., "chat", "Chat", "send")
    if (!parsed?.target) return false;
    // Must have arguments
    if (!Array.isArray(parsed?.arguments) || parsed.arguments.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

// Re-encode string back to binary format if it was originally binary
function _reEncodeBinary(text: string, wasBinary: boolean, format: 'arraybuffer' | 'view' | null): string | ArrayBuffer | Uint8Array {
  if (!wasBinary) return text;
  const encoded = new TextEncoder().encode(text);
  if (format === 'arraybuffer') return encoded.buffer;
  return encoded;
}

const patchedWebSocket = function(this: WebSocket, url: string | URL, protocols?: string | string[]) {
  const urlStr = String(url);
  const ws = protocols
    ? new OriginalWebSocket(url, protocols)
    : new OriginalWebSocket(url);

  const isLLM = /sydney\.bing\.com|copilot\.microsoft\.com|chatgpt\.com|claude\.ai/.test(urlStr);
  // Copilot/Bing use SignalR — we need SignalR-aware proxy that only modifies
  // chat invocation frames (type 1) and passes everything else through.
  const isSignalR = /copilot\.microsoft\.com|sydney\.bing\.com|bing\.com/.test(urlStr);

  if (isLLM) {
    console.log(`[Iron Gate MAIN] WebSocket opened to LLM: ${urlStr.substring(0, 80)}${isSignalR ? ' (SignalR-aware proxy)' : ''}`);

    const originalSend = ws.send.bind(ws);
    ws.send = function(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      // ── Decode binary WebSocket data (ChatGPT 5.2 uses binary frames) ──
      let wasBinary = false;
      let originalBinaryFormat: 'arraybuffer' | 'view' | null = null;
      if (typeof data !== 'string') {
        try {
          if (data instanceof ArrayBuffer) {
            data = new TextDecoder().decode(data) as any;
            wasBinary = true;
            originalBinaryFormat = 'arraybuffer';
          } else if (ArrayBuffer.isView(data)) {
            data = new TextDecoder().decode(data as ArrayBufferView) as any;
            wasBinary = true;
            originalBinaryFormat = 'view';
          } else {
            // Blob — can't decode synchronously
            return originalSend(data);
          }
        } catch {
          return originalSend(data);
        }

        const textLen = (data as unknown as string).length;
        if (textLen < 20) {
          // Too short to contain a prompt — re-encode and send
          return originalSend(_reEncodeBinary(data as unknown as string, wasBinary, originalBinaryFormat));
        }
        console.log(`[Iron Gate MAIN] WS binary decoded → ${textLen} chars (first 150: "${(data as unknown as string).substring(0, 150)}")`);
      }

      // At this point, `data` is always a string (either originally or decoded)
      const strData = data as unknown as string;

      // Helper: re-encode string back to binary if it came in as binary
      function _sendResult(text: string) {
        return originalSend(_reEncodeBinary(text, wasBinary, originalBinaryFormat));
      }

      // ── SignalR-aware proxy for Copilot/Bing ──────────────────────────
      if (isSignalR && mode === 'proxy') {
        try {
          // SignalR messages are separated by \u001e (record separator).
          // A single ws.send may contain multiple frames.
          const RECORD_SEP = '\u001e';
          const frames = strData.split(RECORD_SEP).filter(f => f.length > 0);
          let modified = false;
          const newFrames: string[] = [];

          for (const frame of frames) {
            // Only modify type 1 invocation frames that contain chat text
            if (isSignalRChatFrame(frame)) {
              // Try to extract prompt from the frame
              const promptText = extractPrompt(frame);
              if (promptText && promptText.length >= 10) {
                const regexEntities = detectWithRegex(promptText);
                const secrets = scanForSecrets(promptText);
                const allEntities = [...regexEntities, ...secrets];

                if (allEntities.length > 0) {
                  const { level, score } = quickScore(allEntities);
                  const pseudoResult = pseudonymizeLocal(promptText, allEntities);

                  // Accumulate reverse mappings for de-pseudonymization
                  for (const m of pseudoResult.mappings) {
                    currentReverseMap[m.pseudonym] = m.original;
                  }

                  // Direct string replacement on THIS frame only (preserves SignalR structure)
                  let modifiedFrame: string | null = null;
                  const wsEscOrig = jsonStringEscape(promptText);
                  const wsEscRepl = jsonStringEscape(pseudoResult.maskedText);
                  if (frame.includes(wsEscOrig)) {
                    modifiedFrame = frame.replace(wsEscOrig, wsEscRepl);
                  } else if (frame.includes(promptText)) {
                    modifiedFrame = frame.replace(promptText, pseudoResult.maskedText);
                  }

                  if (modifiedFrame) {
                    console.log(`[Iron Gate MAIN] WS SignalR PROXY: Pseudonymized ${allEntities.length} entities in chat frame (${level}, score=${score})`);
                    newFrames.push(modifiedFrame);
                    modified = true;

                    window.postMessage({
                      type: 'IRON_GATE_INTERCEPTED',
                      originalPrompt: promptText,
                      maskedPrompt: pseudoResult.maskedText,
                      mappings: pseudoResult.mappings,
                      entityCount: allEntities.length,
                      level,
                      score,
                      entities: allEntities.map(e => ({ type: e.type, text: e.text, start: e.start, end: e.end, confidence: e.confidence, source: e.source })),
                    }, '*');
                    continue;
                  }
                }
              }
            }
            // Non-chat frames or frames without entities: pass through unchanged
            newFrames.push(frame);
          }

          if (modified) {
            // Reconstruct the SignalR message with record separators
            const reconstructed = newFrames.join(RECORD_SEP) + RECORD_SEP;
            return _sendResult(reconstructed);
          }
        } catch (err) {
          console.warn('[Iron Gate MAIN] WS SignalR proxy error, sending original:', err);
        }
      }

      // ── Standard proxy for non-SignalR WebSocket tools (incl. ChatGPT 5.2) ──
      if (!isSignalR && mode === 'proxy') {
        try {
          // ChatGPT 5.2 sends binary WebSocket frames — try multiple extraction strategies
          let promptText = extractPrompt(strData);

          // If standard extraction fails, try to find prompt text within the binary payload
          // ChatGPT WS may embed the prompt in a larger structure with non-JSON framing
          if (!promptText && strData.length >= 50) {
            // Look for JSON objects within the data (skip binary header bytes)
            const jsonStart = strData.indexOf('{');
            const jsonArrayStart = strData.indexOf('[');
            const start = jsonStart >= 0 && jsonArrayStart >= 0
              ? Math.min(jsonStart, jsonArrayStart)
              : jsonStart >= 0 ? jsonStart : jsonArrayStart;

            if (start > 0 && start < 100) {
              // There's a binary prefix before JSON — try extracting from the JSON part
              const jsonPart = strData.substring(start);
              promptText = extractPrompt(jsonPart);
              if (promptText) {
                console.log(`[Iron Gate MAIN] WS: Found prompt in JSON at offset ${start} (${promptText.length} chars)`);
              }
            }
          }

          if (promptText && promptText.length >= 10) {
            const regexEntities = detectWithRegex(promptText);
            const secrets = scanForSecrets(promptText);
            const allEntities = [...regexEntities, ...secrets];

            if (allEntities.length > 0) {
              const { level, score } = quickScore(allEntities);
              const pseudoResult = pseudonymizeLocal(promptText, allEntities);

              for (const m of pseudoResult.mappings) {
                currentReverseMap[m.pseudonym] = m.original;
              }

              let modifiedData: string | null = null;
              const wsEscOrig = jsonStringEscape(promptText);
              const wsEscRepl = jsonStringEscape(pseudoResult.maskedText);
              if (strData.includes(wsEscOrig)) {
                modifiedData = strData.replace(wsEscOrig, wsEscRepl);
              } else if (strData.includes(promptText)) {
                modifiedData = strData.replace(promptText, pseudoResult.maskedText);
              } else {
                modifiedData = replacePrompt(strData, promptText, pseudoResult.maskedText);
              }

              if (modifiedData) {
                console.log(`[Iron Gate MAIN] WS PROXY: Pseudonymized ${allEntities.length} entities (${level}, score=${score})`);

                window.postMessage({
                  type: 'IRON_GATE_INTERCEPTED',
                  originalPrompt: promptText,
                  maskedPrompt: pseudoResult.maskedText,
                  mappings: pseudoResult.mappings,
                  entityCount: allEntities.length,
                  level,
                  score,
                  entities: allEntities.map(e => ({ type: e.type, text: e.text, start: e.start, end: e.end, confidence: e.confidence, source: e.source })),
                }, '*');

                return _sendResult(modifiedData);
              }
            }
          }
        } catch (err) {
          console.warn('[Iron Gate MAIN] WS proxy error:', err);
        }
      }

      // ── Audit mode: detect and report WITHOUT modifying ──────────────────
      if (mode === 'audit') {
        try {
          // For SignalR, only audit chat frames
          if (isSignalR) {
            const RECORD_SEP = '\u001e';
            const frames = strData.split(RECORD_SEP).filter(f => f.length > 0);
            for (const frame of frames) {
              if (!isSignalRChatFrame(frame)) continue;
              const promptText = extractPrompt(frame);
              if (promptText && promptText.length >= 10) {
                const regexEntities = detectWithRegex(promptText);
                const secrets = scanForSecrets(promptText);
                const allEntities = [...regexEntities, ...secrets];
                if (allEntities.length > 0) {
                  const { level, score } = quickScore(allEntities);
                  const pseudoResult = pseudonymizeLocal(promptText, allEntities);
                  console.log(`[Iron Gate MAIN] WS SignalR AUDIT: ${allEntities.length} entities (${level}, score=${score})`);
                  window.postMessage({
                    type: 'IRON_GATE_AUDIT',
                    originalPrompt: promptText,
                    maskedPrompt: pseudoResult.maskedText,
                    mappings: pseudoResult.mappings,
                    entityCount: allEntities.length,
                    level,
                    score,
                    entities: allEntities.map(e => ({ type: e.type, text: e.text, start: e.start, end: e.end, confidence: e.confidence, source: e.source })),
                  }, '*');
                }
              }
            }
          } else {
            // Standard audit (ChatGPT WS, etc.)
            let promptText = extractPrompt(strData);
            // Try JSON-offset extraction for binary-framed WebSocket data
            if (!promptText && strData.length >= 50) {
              const jsonStart = strData.indexOf('{');
              if (jsonStart > 0 && jsonStart < 100) {
                promptText = extractPrompt(strData.substring(jsonStart));
              }
            }
            if (promptText && promptText.length >= 10) {
              const regexEntities = detectWithRegex(promptText);
              const secrets = scanForSecrets(promptText);
              const allEntities = [...regexEntities, ...secrets];
              if (allEntities.length > 0) {
                const { level, score } = quickScore(allEntities);
                const pseudoResult = pseudonymizeLocal(promptText, allEntities);
                console.log(`[Iron Gate MAIN] WS AUDIT: ${allEntities.length} entities (${level}, score=${score})`);
                window.postMessage({
                  type: 'IRON_GATE_AUDIT',
                  originalPrompt: promptText,
                  maskedPrompt: pseudoResult.maskedText,
                  mappings: pseudoResult.mappings,
                  entityCount: allEntities.length,
                  level,
                  score,
                  entities: allEntities.map(e => ({ type: e.type, text: e.text, start: e.start, end: e.end, confidence: e.confidence, source: e.source })),
                }, '*');
              }
            }
          }
        } catch { /* don't break */ }
      }

      return _sendResult(strData);
    };

    // Response de-pseudonymization via addEventListener
    // For SignalR: only replace pseudonyms in type 1 completion frames
    const originalAddEventListener = ws.addEventListener.bind(ws);
    ws.addEventListener = function(type: string, listener: any, options?: any) {
      if (type === 'message') {
        const wrappedListener = function(event: MessageEvent) {
          if (Object.keys(currentReverseMap).length === 0) {
            listener.call(ws, event);
            return;
          }

          // Decode response data to string (handles both string and binary WS responses)
          let textData: string | null = null;
          let responseBinary = false;
          if (typeof event.data === 'string') {
            textData = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            try { textData = new TextDecoder().decode(event.data); responseBinary = true; } catch { /* ignore */ }
          } else if (ArrayBuffer.isView(event.data)) {
            try { textData = new TextDecoder().decode(event.data as ArrayBufferView); responseBinary = true; } catch { /* ignore */ }
          }

          if (textData) {
            let resultData = textData;

            if (isSignalR) {
              // De-pseudonymize only within SignalR response frames
              const RECORD_SEP = '\u001e';
              const frames = textData.split(RECORD_SEP).filter((f: string) => f.length > 0);
              let anyReplaced = false;
              const newFrames = frames.map((frame: string) => {
                const replaced = replacePseudonyms(frame, currentReverseMap);
                if (replaced !== frame) anyReplaced = true;
                return replaced;
              });
              if (anyReplaced) {
                resultData = newFrames.join(RECORD_SEP) + RECORD_SEP;
              }
            } else {
              resultData = replacePseudonyms(textData, currentReverseMap);
            }

            if (resultData !== textData) {
              // Re-encode as binary if the original was binary
              const newData = responseBinary ? new TextEncoder().encode(resultData).buffer : resultData;
              const newEvent = new MessageEvent('message', {
                data: newData,
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

    // Also patch onmessage for de-pseudonymization (some tools use ws.onmessage instead of addEventListener)
    if (Object.keys(currentReverseMap).length > 0 || mode === 'proxy') {
      let _onmessageHandler: ((ev: MessageEvent) => any) | null = null;
      Object.defineProperty(ws, 'onmessage', {
        get() { return _onmessageHandler; },
        set(handler: ((ev: MessageEvent) => any) | null) {
          if (!handler) { _onmessageHandler = null; return; }
          _onmessageHandler = function(event: MessageEvent) {
            if (Object.keys(currentReverseMap).length === 0) {
              handler.call(ws, event);
              return;
            }
            // Decode response data (handles string and binary)
            let textData: string | null = null;
            let respBinary = false;
            if (typeof event.data === 'string') {
              textData = event.data;
            } else if (event.data instanceof ArrayBuffer) {
              try { textData = new TextDecoder().decode(event.data); respBinary = true; } catch { /* ignore */ }
            } else if (ArrayBuffer.isView(event.data)) {
              try { textData = new TextDecoder().decode(event.data as ArrayBufferView); respBinary = true; } catch { /* ignore */ }
            }
            if (textData) {
              let resultData = textData;
              if (isSignalR) {
                const RECORD_SEP = '\u001e';
                const frames = textData.split(RECORD_SEP).filter((f: string) => f.length > 0);
                let anyReplaced = false;
                const newFrames = frames.map((frame: string) => {
                  const replaced = replacePseudonyms(frame, currentReverseMap);
                  if (replaced !== frame) anyReplaced = true;
                  return replaced;
                });
                if (anyReplaced) resultData = newFrames.join(RECORD_SEP) + RECORD_SEP;
              } else {
                resultData = replacePseudonyms(textData, currentReverseMap);
              }
              if (resultData !== textData) {
                const newData = respBinary ? new TextEncoder().encode(resultData).buffer : resultData;
                const newEvent = new MessageEvent('message', {
                  data: newData,
                  origin: event.origin,
                  lastEventId: event.lastEventId,
                  source: event.source,
                  ports: [...event.ports],
                });
                handler.call(ws, newEvent);
                return;
              }
            }
            handler.call(ws, event);
          };
        },
        configurable: true,
      });
    }
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
  version: '0.2.7',
  timestamp: Date.now(),
  mode,
}, '*');
(window as any).__IRON_GATE_MAIN_WORLD = 'active';
(window as any).__IRON_GATE_MODE = mode;
console.log('[Iron Gate MAIN] ✅ All interceptors installed. Heartbeat sent. Mode:', mode);
console.log('[Iron Gate MAIN] 💡 Verify in DevTools console: window.__IRON_GATE_MAIN_WORLD →', (window as any).__IRON_GATE_MAIN_WORLD);

} // End of duplicate execution guard
