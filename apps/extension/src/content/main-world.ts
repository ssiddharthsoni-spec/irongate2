/**
 * Iron Gate — MAIN World Interceptor
 *
 * This script runs in the PAGE's JavaScript context (world: "MAIN").
 * It patches window.fetch to intercept requests to LLM APIs and:
 *   1. Pseudonymize sensitive entities before they reach the LLM
 *   2. De-pseudonymize the LLM's response before the page sees it
 *
 * The adapter system (./adapters/) provides per-platform knowledge:
 * selectors, transport types, extraction/replacement methods.
 * Vite bundles all imports into a single IIFE for MAIN world execution.
 *
 * Communication with the content script happens via window.postMessage.
 */

// ─── Adapter System ─────────────────────────────────────────────────────────
// Platform-specific knowledge is encapsulated in SiteAdapter objects.
// The registry auto-selects the active adapter based on the current hostname.
import { getAdapter, isLLMEndpoint as adapterIsLLMEndpoint, shouldSkipFetchProxy, shouldSkipXhrProxy, getAllAdapters } from './adapters';
import type { SiteAdapter } from './adapters';

// ─── Duplicate Execution Guard ───────────────────────────────────────────
// Multiple injection methods (manifest, programmatic, <script> tag) may all
// try to run this script. Only the first execution should proceed.
// Uses a crypto-random token stored on a non-enumerable Symbol property
// so page scripts cannot easily detect or spoof the guard.
const _IG_GUARD_SYM = Symbol.for('__ig_main_world_guard');
const _IG_GUARD_STATE = (window as any)[_IG_GUARD_SYM] as { status: string; since: number; token: string } | undefined;

if (_IG_GUARD_STATE?.status === 'active') {
  console.log('[Iron Gate MAIN] Already active — skipping duplicate injection');
  window.postMessage({
    type: 'IRON_GATE_HEARTBEAT',
    version: '0.2.7-dup',
    timestamp: Date.now(),
    mode: (window as any).__IRON_GATE_MODE || 'proxy',
    _nonce: 'dup',
  }, window.location.origin);
} else if (_IG_GUARD_STATE?.status === 'loading') {
  const elapsed = Date.now() - (_IG_GUARD_STATE.since || 0);
  if (elapsed < 5000) {
    console.log(`[Iron Gate MAIN] Init in progress (${elapsed}ms ago) — skipping`);
  } else {
    // Previous injection crashed — reset and allow retry
    console.warn(`[Iron Gate MAIN] ⚠️ Previous init stuck at 'loading' for ${elapsed}ms — RESETTING for retry`);
    delete (window as any)[_IG_GUARD_SYM];
  }
}

// Use a flag to wrap all initialization — prevents duplicate setup
if (!(window as any)[_IG_GUARD_SYM]) {

// ─── Hashing ─────────────────────────────────────────────────────────────────
// SHA-256 hash — raw PII is hashed before leaving via postMessage so that
// no other page script can intercept the original sensitive text.

async function igHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Minimize entities for safe postMessage — replace raw text with hash + length */
async function minimizeEntitiesForTransit(entities: Array<{ type: string; text: string; start: number; end: number; confidence: number; source: string }>) {
  return Promise.all(entities.map(async e => ({
    type: e.type,
    textHash: await igHash(e.text),
    length: e.text.length,
    start: e.start,
    end: e.end,
    confidence: e.confidence,
    source: e.source,
  })));
}

// ─── Cryptographically Secure Random ────────────────────────────────────────
// Replace Math.random() with CSPRNG for all fake data generation.

function _secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / (0xFFFFFFFF + 1);
}

function _secureRandBetween(min: number, max: number): number {
  return min + _secureRandom() * (max - min);
}

// ─── Challenge-Response Nonce for postMessage Validation ─────────────────────
// Generates a one-time nonce that the content script must echo back.
// Prevents other page scripts from injecting fake IRON_GATE_* messages.
const _IG_MSG_NONCE = crypto.getRandomValues(new Uint8Array(16))
  .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');

/**
 * Secure postMessage wrapper that auto-includes the cryptographic nonce.
 * Content script validates this nonce — messages without it are rejected.
 */
function igPostMessage(data: Record<string, unknown>): void {
  window.postMessage({ ...data, _nonce: _IG_MSG_NONCE }, window.location.origin);
}

// ─── State ──────────────────────────────────────────────────────────────────

let mode: 'audit' | 'proxy' = 'proxy';
let currentReverseMap: Record<string, string> = {};
let _lastConversationPath: string = window.location.pathname;

// ─── Private LLM config (set via IRON_GATE_SET_PRIVATE_LLM from content script)
let _privateLlmEndpoint: string | null = null;
let _privateLlmModel: string | null = null;

// ─── Reverse Map: Encrypted Session Persistence ──────────────────────────────
// The reverse map (pseudonym → original PII) lives in `currentReverseMap`.
// On each update, map entries are sent to the content script (extension context)
// via postMessage, which stores them encrypted in chrome.storage.session.
// On page refresh, the content script sends persisted mappings back.
// chrome.storage.session is NOT accessible to page scripts (unlike sessionStorage)
// and is cleared when the browser closes.

// Execution flag — uses Symbol-keyed property to prevent page-script spoofing
const _igGuardToken = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
Object.defineProperty(window, _IG_GUARD_SYM, {
  value: { status: 'loading', since: Date.now(), token: _igGuardToken },
  writable: true,
  enumerable: false,
  configurable: true,
});
(window as any).__IRON_GATE_MAIN_WORLD = 'loading';

// Always-visible startup log (not gated behind debug flag)
console.log(
  '%c[Iron Gate MAIN] 🚀 Initializing...',
  'color: #6366f1; font-weight: bold',
  `host=${window.location.hostname}`
);

// Wrap entire initialization in try-catch — if ANYTHING crashes,
// reset the flag so a retry injection can proceed.
try {

// Debug logging — compile-time constant, never controllable from page scripts
const _IG_DEBUG = false;
function igLog(...args: any[]) { if (_IG_DEBUG) console.log('[Iron Gate MAIN]', ...args); }

// Reverse map starts empty each page load (in-memory only, see security note above)

// ─── Adapter Selection ───────────────────────────────────────────────────────
const activeAdapter: SiteAdapter | null = getAdapter();
igLog(`🚀 Script loaded at ${new Date().toISOString()} — adapter: ${activeAdapter?.name || 'none'} — patching fetch/XHR/WebSocket...`);


// ─── Communication with content script ──────────────────────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'IRON_GATE_SET_MODE') {
    // Only accept known mode values — prevents injection of arbitrary modes
    if (event.data.mode !== 'audit' && event.data.mode !== 'proxy') return;
    const oldMode = mode;
    mode = event.data.mode;
    (window as any).__IRON_GATE_MODE = mode;
    if (oldMode !== mode) {
      // Always-visible mode change log — critical for diagnosing proxy issues
      console.log(
        `%c[Iron Gate MAIN] Mode changed: ${oldMode} → ${mode}`,
        mode === 'proxy'
          ? 'color: #f97316; font-weight: bold; font-size: 13px'
          : 'color: #6699ff; font-weight: bold',
      );
    }
  }
  // Receive private LLM config from content script
  if (event.data?.type === 'IRON_GATE_SET_PRIVATE_LLM') {
    _privateLlmEndpoint = event.data.endpoint || null;
    _privateLlmModel = event.data.model || null;
    if (_privateLlmEndpoint) {
      igLog('Private LLM configured:', _privateLlmEndpoint, _privateLlmModel);
    }
  }
  // Receive persisted reverse map from content script (after page refresh)
  if (event.data?.type === 'IRON_GATE_RESTORE_REVERSE_MAP') {
    const restored = event.data.map;
    // Validate: must be a plain object with string→string entries, bounded size
    if (restored && typeof restored === 'object' && !Array.isArray(restored)) {
      const entries = Object.entries(restored);
      const count = entries.length;
      if (count > 0 && count <= 5000 && entries.every(([k, v]) => typeof k === 'string' && typeof v === 'string')) {
        Object.assign(currentReverseMap, restored);
        console.log(
          `%c[Iron Gate MAIN] Restored ${count} reverse pseudonym mappings from session`,
          'color: #22c55e; font-weight: bold',
        );
      }
    }
  }
});

// Request mode sync and persisted reverse map from content script
// (content script may not be loaded yet, but if it is, this gets us the mode faster)
igPostMessage({ type: 'IRON_GATE_REQUEST_MODE' });
igPostMessage({ type: 'IRON_GATE_REQUEST_REVERSE_MAP' });

// Retry mode sync after 2s — content script may not have been ready for the first request
setTimeout(() => {
  if (mode === 'audit') {
    igPostMessage({ type: 'IRON_GATE_REQUEST_MODE' });
  }
}, 2000);

// ─── LLM Endpoint Detection ────────────────────────────────────────────────

const LLM_API_PATTERNS: RegExp[] = [
  // ChatGPT — match both absolute and relative URLs
  /chatgpt\.com\/backend-api\/conversation/,
  /chat\.openai\.com\/backend-api\/conversation/,
  /\/backend-api\/conversation/,   // ← relative URL used by ChatGPT on-page
  /api\.openai\.com\/v1\/chat\/completions/,
  // Claude
  /claude\.ai\/api/,
  /api\.anthropic\.com\/v1\/messages/,
  // Google Gemini — batchexecute is the main chat endpoint
  /generativelanguage\.googleapis\.com/,
  /gemini\.google\.com\/app\/_\/api/,
  /gemini\.google\.com.*\/batchexecute/,
  /gemini\.google\.com.*\/StreamGenerate/,
  // Microsoft Copilot — chat-specific endpoint patterns only
  // (broad patterns like /c/api/ match settings, config, tasks — causing false intercepts)
  /copilot\.microsoft\.com\/c\/api\/conversations\b/,
  /copilot\.microsoft\.com\/c\/api\/chat\b/,
  /copilot\.microsoft\.com\/sl\/api\/chat\b/,
  /copilot\.microsoft\.com\/turing\/conversation/,
  /sydney\.bing\.com\/sydney/,
  /bing\.com\/.*\/api\/.*chat/i,
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
      return /\/api|backend-api\/|\/conversation|\/batchexecute|StreamGenerate/i.test(parsed.pathname);
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

// CamelCase words that are known products/tech terms, NOT real organizations.
// Prevents false-positive ORGANIZATION detection and pseudonymization flicker.
const CAMELCASE_ALLOWLIST = new Set([
  // Iron Gate itself
  'irongate', 'irongateai',
  // AI tools the extension monitors
  'chatgpt', 'openai', 'deepseek', 'copilot', 'huggingface', 'huggingchat',
  'gemini', 'claude', 'anthropic', 'perplexity', 'phind', 'mistral',
  // Common tech / product names
  'javascript', 'typescript', 'postgresql', 'mongodb', 'mysql', 'graphql',
  'github', 'gitlab', 'bitbucket', 'stackoverflow', 'youtube', 'linkedin',
  'facebook', 'instagram', 'tiktok', 'snapchat', 'whatsapp', 'telegram',
  'powerpoint', 'powerbi', 'onenote', 'onedrive', 'sharepoint', 'outlook',
  'webpack', 'nextjs', 'nodejs', 'expressjs', 'reactjs', 'vuejs', 'angularjs',
  'tailwindcss', 'tensorflow', 'pytorch', 'jupyter', 'colab',
  'codecademy', 'freecodecamp', 'leetcode', 'hackerrank',
  'macos', 'iphone', 'ipad', 'macbook', 'airpods', 'appstore', 'playstore',
  'dockerfile', 'kubernetes', 'localhost', 'vercel', 'netlify', 'cloudflare',
  'datadog', 'pagerduty', 'elasticsearch', 'logstash', 'opensearch',
  'redis', 'dynamodb', 'couchdb', 'firebase', 'supabase', 'cockroachdb',
  'chatbot', 'midjourney', 'stablediffusion',
  // Enterprise / business software (common false positives in enterprise prompts)
  'salesforce', 'hubspot', 'marketo', 'workday', 'servicenow', 'zendesk',
  'jira', 'confluence', 'asana', 'monday', 'clickup', 'basecamp',
  'docusign', 'adobesign', 'dropbox', 'slack', 'microsoft', 'google',
  'quickbooks', 'netsuite', 'sap', 'oracle', 'snowflake', 'databricks',
  'tableau', 'looker', 'mixpanel', 'amplitude', 'segment', 'twilio',
  // Infrastructure / DevOps terms
  'terraform', 'ansible', 'jenkins', 'circleci', 'travisci', 'argocd',
  'prometheus', 'grafana', 'kibana', 'splunk', 'newrelic', 'sentry',
  'heroku', 'digitalocean', 'linode', 'vultr', 'hetzner',
  'nginx', 'apache', 'caddy', 'envoy', 'istio', 'consul', 'nomad',
  // Programming languages / frameworks
  'python', 'golang', 'kotlin', 'swift', 'flutter', 'django', 'fastapi',
  'springboot', 'dotnet', 'blazor', 'svelte', 'nuxtjs', 'gatsby', 'remix',
  // Finance / legal terms that look like org names
  'bloomberg', 'reuters', 'moody', 'nasdaq', 'finra',
]);

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
  {
    type: 'SSN',
    pattern: /\b\d{3}\s\d{2}\s\d{4}\b/g,
    confidence: 0.9,
  },
  {
    type: 'SSN',
    pattern: /(?<=(?:ssn|social\s*security(?:\s*(?:number|num|no|#))?|ss#)\s*(?:is|:|=|#)?\s*)\d{9}(?!\d)/gi,
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

/**
 * Determines whether extracted text looks like natural language (user content)
 * vs protocol/control data (Socket.IO frames, JSON metadata, heartbeats).
 * Used to filter WS frame extraction before running entity detection.
 */
function isNaturalLanguage(text: string): boolean {
  const trimmed = text.trim();

  // Too short to be meaningful user content
  if (trimmed.length < 15) return false;

  // Pure numeric / hex — likely protocol frame IDs or timestamps
  if (/^[\d\s.,:;%\-+#/\\]+$/.test(trimmed)) return false;

  // JSON structure — protocol metadata, not user text
  if (/^\s*[\[{]/.test(trimmed) && /[\]}]\s*$/.test(trimmed)) return false;

  // Socket.IO control frames: digits followed by optional JSON
  if (/^\d{1,3}(\[|$)/.test(trimmed)) return false;

  // Must contain at least one space (natural text has word boundaries)
  // Exception: very short single-word queries are fine if they look like words
  if (!trimmed.includes(' ') && trimmed.length < 30) return false;

  // Count ratio of alphanumeric + space chars vs total — protocol data has lots of punctuation/special chars
  const alphaSpaceCount = (trimmed.match(/[a-zA-Z\s]/g) || []).length;
  const ratio = alphaSpaceCount / trimmed.length;
  if (ratio < 0.4) return false;

  return true;
}

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

      // Skip known product/tech names that the CamelCase pattern over-matches
      if (type === 'ORGANIZATION' && CAMELCASE_ALLOWLIST.has(matchText.toLowerCase())) {
        continue;
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
  return _secureRandBetween(min, max);
}

function generateFake(type: string, original: string): string {
  switch (type) {
    case 'PERSON': {
      const pool = _isFemaleFirst(original) ? FAKE_NAMES_F : FAKE_NAMES_M;
      const origFirst = original.split(/\s+/)[0].toLowerCase();
      // Avoid first-name collisions: pick a fake that doesn't share the first name
      const genderKey = type + (_isFemaleFirst(original) ? '_F' : '_M');
      let candidate = _pickUnused(pool, genderKey);
      let attempts = 0;
      while (candidate.split(/\s+/)[0].toLowerCase() === origFirst && attempts < pool.length) {
        candidate = _pickUnused(pool, genderKey);
        attempts++;
      }
      return candidate;
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
        // Use 0.85-1.35x range to avoid producing very short fakes (e.g., $48→$4)
        // that are too generic and cause false matches during de-pseudonymization
        const shifted = num * _randBetween(0.85, 1.35);
        // Ensure fake has at least as many digits as original to prevent
        // short pseudonyms like "$4" matching inside "$400", "$4.5B", etc.
        const origDigitCount = numMatch[1].replace('.', '').length;
        let formatted: string;
        const hasDecimal = numMatch[1].includes('.');
        const decPlaces = hasDecimal ? (numMatch[1].split('.')[1]?.length || 1) : 0;
        formatted = hasDecimal ? shifted.toFixed(decPlaces) : Math.round(shifted).toString();
        // Pad if needed to maintain digit count (e.g., 48→41 is OK, 48→4 is not)
        while (formatted.replace('.', '').length < origDigitCount) {
          formatted = hasDecimal ? (shifted * 1.1).toFixed(decPlaces) : Math.round(shifted * 1.1).toString();
          break; // One attempt to bump up
        }
        // Reconstruct with original prefix style
        const prefix = original.startsWith('$') ? '$' : '';
        return prefix + formatted + suffix;
      }
      // Fallback: randomize digits and letters to prevent leaking unparseable amounts
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString())
                     .replace(/[a-zA-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + Math.floor(_randBetween(-3, 3))));
    }

    case 'PERCENTAGE': {
      // Offset by ±3-8 percentage points
      const numMatch = original.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const offset = _randBetween(3, 8) * (_secureRandom() > 0.5 ? 1 : -1);
        const shifted = Math.max(0.1, Math.min(99.9, num + offset));
        const hasDecimal = numMatch[1].includes('.');
        return (hasDecimal ? shifted.toFixed(1) : Math.round(shifted).toString()) + '%';
      }
      return Math.floor(_randBetween(10, 90)) + '%';
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
      // Numeric dates: shift — preserve leading-zero format
      const numDate = original.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{2,4})$/);
      if (numDate) {
        const m = Math.max(1, Math.min(12, parseInt(numDate[1]) + Math.floor(_randBetween(-2, 3))));
        const d = Math.max(1, Math.min(28, parseInt(numDate[3]) + Math.floor(_randBetween(-5, 5))));
        // Preserve leading zeros: if original "02" had 2 digits, pad the fake too
        const mStr = numDate[1].length === 2 ? m.toString().padStart(2, '0') : m.toString();
        const dStr = numDate[3].length === 2 ? d.toString().padStart(2, '0') : d.toString();
        return mStr + numDate[2] + dStr + numDate[2] + numDate[4];
      }
      // ISO dates (YYYY-MM-DD) and other formats
      const isoDate = original.match(/^(\d{4})([\/\-])(\d{1,2})\2(\d{1,2})$/);
      if (isoDate) {
        const y = parseInt(isoDate[1]) + Math.floor(_randBetween(-2, 2));
        const m = Math.max(1, Math.min(12, parseInt(isoDate[3]) + Math.floor(_randBetween(-2, 3))));
        const d = Math.max(1, Math.min(28, parseInt(isoDate[4]) + Math.floor(_randBetween(-5, 5))));
        return y + isoDate[2] + m.toString().padStart(2, '0') + isoDate[2] + d.toString().padStart(2, '0');
      }
      // Last resort: randomize digits to prevent leak
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
    }

    case 'FISCAL_PERIOD': {
      // Q4 → Q2, Q1 → Q3 (shift by 1-2)
      const qMatch = original.match(/^([QH])(\d)/);
      if (qMatch) {
        const shifted = ((parseInt(qMatch[2]) + Math.floor(_randBetween(1, 3)) - 1) % 4) + 1;
        return qMatch[1] + shifted + original.substring(2);
      }
      // FY2024 → FY20XX (shift year)
      const fyMatch = original.match(/^(FY\s*'?)(\d{2,4})$/i);
      if (fyMatch) {
        const year = parseInt(fyMatch[2]);
        const shifted = year + Math.floor(_randBetween(-2, 2));
        return fyMatch[1] + shifted;
      }
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
    }

    case 'EMAIL': {
      // Generate from fake name pool
      const fakeName = _pickUnused(FAKE_NAMES_F.concat(FAKE_NAMES_M), 'EMAIL_NAME');
      const parts = fakeName.toLowerCase().split(' ');
      const domains = ['northwind.com', 'contoso.com', 'fabrikam.net', 'adatum.org', 'proseware.io'];
      const domain = domains[Math.floor(_secureRandom() * domains.length)];
      return parts[0] + '.' + parts[1] + '@' + domain;
    }

    case 'SSN': {
      // Format-preserving random SSN
      const a = Math.floor(_randBetween(100, 899));
      const b = Math.floor(_randBetween(10, 99));
      const c = Math.floor(_randBetween(1000, 9999));
      // Preserve original format: dashes, spaces, or bare digits
      if (original.includes('-')) return a + '-' + b + '-' + c;
      if (original.includes(' ')) return a + ' ' + b + ' ' + c;
      return '' + a + b + c;
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

    case 'MEDICAL_RECORD': {
      // Preserve format: "4829-7103" → "XXXX-XXXX", "MRN-12345" → "MRN-XXXXX"
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
    }

    case 'INSURANCE_ID':
    case 'AUTHORIZATION': {
      // Preserve format, randomize digits
      return original.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
    }

    case 'API_KEY':
    case 'AWS_CREDENTIAL':
    case 'GCP_CREDENTIAL':
    case 'AUTH_TOKEN': {
      // Fully replace with a safe placeholder — preserve length and prefix only
      const prefixMatch = original.match(/^([a-zA-Z_\-]{2,10}[-_])/);
      const prefix = prefixMatch ? prefixMatch[1] : 'key-';
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const fakeLen = Math.max(16, original.length - prefix.length);
      let fake = prefix;
      for (let i = 0; i < fakeLen; i++) fake += chars[Math.floor(_secureRandom() * chars.length)];
      return fake;
    }

    case 'DATABASE_URI': {
      // Replace with a safe fake URI preserving the scheme
      const scheme = original.match(/^([a-z+]+:\/\/)/)?.[1] || 'db://';
      return scheme + 'testuser:fakepwd@db-' + Math.floor(_secureRandom() * 9000 + 1000) + '.example.com:5432/testdb';
    }

    case 'PRIVATE_KEY': {
      // Replace entire key material — never leak
      const headerMatch = original.match(/^(-----BEGIN [A-Z ]+-----)/);
      const footerMatch = original.match(/(-----END [A-Z ]+-----)$/);
      if (headerMatch || footerMatch) {
        const header = headerMatch?.[1] || '-----BEGIN PRIVATE KEY-----';
        const footer = footerMatch?.[1] || '-----END PRIVATE KEY-----';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let fakeBody = '';
        for (let i = 0; i < 64; i++) fakeBody += chars[Math.floor(_secureRandom() * chars.length)];
        return header + '\n' + fakeBody + '\n' + footer;
      }
      // Non-PEM key material: fully randomize
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let fake = '';
      for (let i = 0; i < original.length; i++) fake += chars[Math.floor(_secureRandom() * chars.length)];
      return fake;
    }

    default: {
      // Fallback: randomize digits AND alphabetic characters to prevent any PII leak
      let result = original;
      if (/\d/.test(result)) {
        result = result.replace(/\d/g, () => Math.floor(_secureRandom() * 10).toString());
      }
      if (result === original && /[a-zA-Z]/.test(result)) {
        // No digits were changed — randomize letters too to prevent leak
        result = result.replace(/[a-zA-Z]/g, c => {
          const base = c >= 'a' ? 97 : 65;
          return String.fromCharCode(base + Math.floor(_secureRandom() * 26));
        });
      }
      return result;
    }
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

/**
 * Prepare mappings for transit to the side panel.
 * The original value is included so the Map tab can show what was replaced.
 * This only travels extension-internal channels (content script → worker → side panel).
 */
function sanitizeMappingsForTransit(mappings: PseudonymMapping[]): Array<{ original: string; pseudonym: string; type: string; length: number }> {
  return mappings.map(m => ({ original: m.original, pseudonym: m.pseudonym, type: m.type, length: m.original.length }));
}

// Global forward map: original → fake (persists across messages in a conversation)
let currentForwardMap: Record<string, string> = {};

function pseudonymizeLocal(text: string, entities: DetectedEntity[]): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [] };
  }

  // Evict oldest entries if forward map grows too large
  const fwdKeys = Object.keys(currentForwardMap);
  if (fwdKeys.length > MAX_MAP_SIZE) {
    for (let i = 0; i < 100; i++) {
      delete currentForwardMap[fwdKeys[i]];
    }
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
      // Generate a new realistic fake — ensure uniqueness so two different
      // originals (e.g., "$8M" revenue, "$5M" profit) never collide on the
      // same fake value (which would make reverse mapping ambiguous).
      const usedFakes = new Set(Object.values(currentForwardMap));
      let candidate = generateFake(entity.type, normalizedText);
      let attempts = 0;
      while (usedFakes.has(candidate) && attempts < 5) {
        candidate = generateFake(entity.type, normalizedText);
        attempts++;
      }
      pseudonym = candidate;
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
              igLog(`Gemini prompt extracted from f.req (${innerDeep.length} chars)`);
              return innerDeep;
            }
          } catch { /* not JSON-in-JSON, use the string directly */ }
          if (deep.length > 10) {
            igLog(`Gemini prompt extracted from f.req outer (${deep.length} chars)`);
            return deep;
          }
        }
      }
    } catch (e) {
      igLog('Gemini f.req parse failed:', e);
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

    // Perplexity Socket.IO: ["perplexity_ask", "query text", {options}]
    // The first element is the event name; the second is the user query.
    if (Array.isArray(parsed) && parsed.length >= 2 &&
        typeof parsed[0] === 'string' && /^perplexity_/i.test(parsed[0]) &&
        typeof parsed[1] === 'string' && parsed[1].length > 0) {
      igLog(`Perplexity Socket.IO prompt extracted (${parsed[1].length} chars)`);
      return parsed[1];
    }

    // Google Gemini: nested arrays [ null, [ [ [ prompt ] ] ] ] or reqId format
    if (Array.isArray(parsed) && parsed.length >= 2) {
      const deep = findDeepestString(parsed);
      if (deep && deep.length > 10) return deep;
    }

    // Generic fallback: find the longest string value in the JSON
    const longest = findLongestStringValue(parsed);
    if (longest && longest.length >= 20) {
      igLog(`Using generic extraction — found string of ${longest.length} chars`);
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
          const modifiedFReq = fReq.split(escapedOrig).join(escapedRepl);
          params.set('f.req', modifiedFReq);
          igLog(`Gemini replacePrompt: single-escaped match`);
          return params.toString();
        }
        // Try double-escaped match (JSON-in-JSON: prompt is escaped twice)
        const doubleEscapedOrig = jsonStringEscape(escapedOrig);
        const doubleEscapedRepl = jsonStringEscape(escapedRepl);
        if (fReq.includes(doubleEscapedOrig)) {
          const modifiedFReq = fReq.split(doubleEscapedOrig).join(doubleEscapedRepl);
          params.set('f.req', modifiedFReq);
          igLog(`Gemini replacePrompt: double-escaped match`);
          return params.toString();
        }
        // Try raw text match (prompt appears unescaped)
        if (fReq.includes(originalPrompt)) {
          const modifiedFReq = fReq.split(originalPrompt).join(replacement);
          params.set('f.req', modifiedFReq);
          igLog(`Gemini replacePrompt: raw text match`);
          return params.toString();
        }
        igLog(`Gemini replacePrompt: no match found in f.req (${fReq.length} chars)`);
      }
    } catch (e) {
      igLog('Gemini replacePrompt error:', e);
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
        igLog(`Using generic string replacement fallback (${escapedOriginal.length} chars)`);
        return body.split(escapedOriginal).join(escapedReplacement);
      }

      // Try raw (unescaped) match for prompts encoded differently than expected
      if (originalPrompt.length > 20 && body.includes(originalPrompt)) {
        igLog(`Using raw string replacement fallback`);
        return body.split(originalPrompt).join(replacement);
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

// Simplified scorer for MAIN world — weights aligned with scorer.ts ENTITY_WEIGHTS.
// MAIN world can't import from content script modules, so this is a lightweight
// approximation. Keep weights in sync with apps/extension/src/detection/scorer.ts.
const _ENTITY_WEIGHTS: Record<string, number> = {
  SSN: 40, PRIVATE_KEY: 40,
  MEDICAL_RECORD: 35, PASSPORT_NUMBER: 35, AWS_CREDENTIAL: 35, DATABASE_URI: 35,
  CREDIT_CARD: 30, DRIVERS_LICENSE: 30, API_KEY: 30, GCP_CREDENTIAL: 30, PRIVILEGE_MARKER: 30,
  ACCOUNT_NUMBER: 25, CLIENT_MATTER_PAIR: 25, AUTH_TOKEN: 25,
  MATTER_NUMBER: 20, DEAL_CODENAME: 20,
  PHONE_NUMBER: 15, OPPOSING_COUNSEL: 15,
  EMAIL: 12, MONETARY_AMOUNT: 12,
  PERSON: 10, ORGANIZATION: 8, IP_ADDRESS: 8,
  LOCATION: 3, DATE: 2,
};

function quickScore(entities: Array<{ type: string; confidence: number }>): { level: 'low' | 'medium' | 'high' | 'critical'; score: number } {
  if (entities.length === 0) return { level: 'low', score: 0 };

  let score = 0;
  for (const e of entities) {
    score += (_ENTITY_WEIGHTS[e.type] ?? 5) * e.confidence;
  }

  // Diversity bonus — aligned with scorer.ts multiplicative bonuses
  const uniqueTypes = new Set(entities.map((e) => e.type)).size;
  if (uniqueTypes >= 3) score *= 1.3;
  else if (uniqueTypes >= 2) score *= 1.15;

  // Count bonus — aligned with scorer.ts
  if (entities.length >= 10) score *= 1.4;
  else if (entities.length >= 5) score *= 1.2;

  score = Math.min(score, 100);

  // Thresholds match scoreToLevel() in scorer.ts: 0-25 low, 26-60 med, 61-85 high, 86+ critical
  let level: 'low' | 'medium' | 'high' | 'critical';
  if (score >= 86) level = 'critical';
  else if (score >= 61) level = 'high';
  else if (score >= 26) level = 'medium';
  else level = 'low';

  return { level, score };
}

// ─── Executive Lens (client-side industry routing) ──────────────────────────
// Compact version of executive-lens.ts for MAIN world execution.
// Determines whether to send pseudonymized to cloud, route to private LLM,
// or passthrough based on industry signals and content analysis.

type RouteDecision = 'pseudonymize' | 'passthrough' | 'private_llm';

const _INDUSTRY_RULES: Record<string, Array<{ name: string; action: RouteDecision; patterns: RegExp[] }>> = {
  manufacturing: [
    { name: 'Proprietary Formula', action: 'private_llm', patterns: [
      /\d+(\.\d+)?%\s*(sodium|potassium|sulfate|chloride|hydroxide|acid)/i,
      /\bpH\s*[:=]?\s*\d/i, /\bformul(a|ation)\b/i, /\bproprietary\s+(blend|formula|process|recipe)\b/i, /\bviscosity\b/i,
    ]},
    { name: 'Process Parameters', action: 'private_llm', patterns: [
      /\b(reactor|batch|mixing|curing|distill|extrusion)\b.*\b(temp|time|duration)\b/i,
      /\b\d+\s*(RPM|psi|bar|cP|mPa)\b/i, /\d+\s*°[CF]\b/, /\byield\s*[:=]?\s*\d+(\.\d+)?%/i,
    ]},
  ],
  legal: [
    { name: 'Litigation Strategy', action: 'private_llm', patterns: [
      /\b(our|we|firm'?s)\s+(strategy|position|argument|approach|theory)\b/i,
      /\bwe\s+(plan|intend|will|should)\s+(argue|file|settle|motion|depose)\b/i,
      /\bsettlement\s+(demand|offer|position|range|authority)\b/i,
    ]},
    { name: 'Attorney-Client Privilege', action: 'private_llm', patterns: [
      /\battorney[- ]client\s+privilege\b/i, /\bprivileged and confidential\b/i, /\bwork product\b/i,
    ]},
  ],
  healthcare: [
    { name: 'Patient Data (HIPAA)', action: 'pseudonymize', patterns: [
      /\bpatient\b.*\b(diagnos|condition|medication|treatment|procedure)\b/i, /\bprotected health\b/i, /\bHIPAA\b/i,
    ]},
    { name: 'Unpublished Clinical IP', action: 'private_llm', patterns: [
      /\bproprietary\s+(drug|compound|therapy|formulation|protocol)\b/i, /\bclinical trial\s+(data|results|phase)\b/i,
    ]},
  ],
  finance: [
    { name: 'MNPI', action: 'private_llm', patterns: [
      /\bnon-public\b/i, /\bunreleased\b/i, /\bpre-announcement\b/i, /\binsider\b/i,
      /\bacquisition target\b/i, /\bunder NDA\b/i, /\bcap table\b/i, /\bwire\s+(instructions|transfer)\b/i,
    ]},
    { name: 'Client Positions', action: 'private_llm', patterns: [
      /\d+\s*shares?\s*@\s*\$/i, /\bface value\b/i, /\bcurrent positions\b/i, /\btarget allocation\b/i,
    ]},
  ],
  consulting: [
    { name: 'Strategic Recommendations', action: 'private_llm', patterns: [
      /\b(recommend|advise|propose)\b.*\b(divest|acquire|merge|restructur|expand|exit)\b/i,
      /\bstrategic\s+(assessment|recommendation|option|direction)\b/i,
      /\bboard\s+(talking points|presentation|meeting|materials)\b/i,
    ]},
    { name: 'Competitive Intelligence', action: 'private_llm', patterns: [
      /\bmarket share\s+(declined|grew|gained|lost|dropped|increased)\b/i,
      /\bcompetitor\s+(revenue|margin|pricing|strategy|share)\b/i,
    ]},
  ],
  government: [
    { name: 'Classified Information', action: 'private_llm', patterns: [
      /\bclassified\b/i, /\btop secret\b/i, /\bSCI\b/, /\bspecial access program\b/i,
    ]},
    { name: 'ITAR/Export Control', action: 'private_llm', patterns: [
      /\bITAR\b/, /\bexport control\b/i, /\bmunitions list\b/i, /\bECCN\b/,
    ]},
  ],
  insurance: [
    { name: 'Claims Reserves/IBNR', action: 'private_llm', patterns: [
      /\bclaims?\s+reserve\b/i, /\bIBNR\b/, /\bloss\s+reserve\b/i, /\badverse\s+development\b/i,
    ]},
  ],
  energy: [
    { name: 'Reserve Data', action: 'private_llm', patterns: [
      /\b(proved|probable|possible)\s+reserves\b/i, /\bseismic\s+(data|survey|interpretation)\b/i, /\bdecline curve\b/i,
    ]},
  ],
  education: [
    { name: 'Title IX Matters', action: 'private_llm', patterns: [
      /\bTitle IX\b/i, /\bsexual\s+(misconduct|harassment|assault)\b/i,
    ]},
  ],
};

const _INDUSTRY_SIGNALS: Record<string, RegExp[]> = {
  legal: [/\battorney\b/i, /\blitigation\b/i, /\bcounsel\b/i, /\bdeposition\b/i, /\bplaintiff\b/i, /\bdefendant\b/i, /\bprivilege\b/i],
  healthcare: [/\bpatient\b/i, /\bdiagnos/i, /\bmedication\b/i, /\bMRN\b/, /\bclinical\b/i, /\bHIPAA\b/i],
  finance: [/\bportfolio\b/i, /\bEBITDA\b/i, /\bacquisition\b/i, /\bvaluation\b/i, /\bIPO\b/i, /\bcap table\b/i],
  consulting: [/\bengagement\b/i, /\bmarket share\b/i, /\bTAM\b/, /\bSWOT\b/i, /\bboard meeting\b/i],
  manufacturing: [/\bformul/i, /\bbatch\b/i, /\breactor\b/i, /\bviscosity\b/i, /\bsupplier\b/i, /\bchemical\b/i],
  insurance: [/\bactuarial\b/i, /\bclaims reserve\b/i, /\bIBNR\b/, /\breinsurance\b/i, /\bcatastrophe model\b/i],
  energy: [/\breserves\b/i, /\bBOE\b/, /\bseismic\b/i, /\bdrilling\b/i, /\bpipeline\b/i],
  education: [/\bFERPA\b/, /\bTitle IX\b/i, /\bstudent record\b/i, /\btranscript\b/i],
  government: [/\bclassified\b/i, /\btop secret\b/i, /\bITAR\b/, /\bexport control\b/i, /\bFedRAMP\b/],
};

const _CONFIDENTIALITY_PATS: RegExp[] = [
  /\bprivileged\b/i, /\bconfidential\b/i, /\battorney[- ]client\b/i,
  /\bwork product\b/i, /\bdo not distribute\b/i, /\bunder seal\b/i, /\bNDA\b/,
];
const _COMPUTATION_PATS: RegExp[] = [
  /\bcalculate\b/i, /\bcompute\b/i, /\btotal\b/i, /\bhow much\b/i,
  /\bwhat is\b.*\$/i, /\bROI\b/i, /\bbreak[\s-]even\b/i,
];
const _PERSON_TYPES = new Set(['PERSON', 'SSN', 'EMAIL', 'CREDIT_CARD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE', 'MEDICAL_RECORD', 'PHONE_NUMBER']);

function executiveLensRoute(text: string, entities: DetectedEntity[]): { route: RouteDecision; industry: string | null; explanation: string } {
  // Detect industry
  let bestIndustry: string | null = null;
  let bestHits = 0;
  for (const [ind, pats] of Object.entries(_INDUSTRY_SIGNALS)) {
    let hits = 0;
    for (const p of pats) { if (p.test(text)) hits++; }
    if (hits > bestHits) { bestHits = hits; bestIndustry = ind; }
  }
  if (bestHits < 2) bestIndustry = null;

  // Evaluate industry-specific rules
  const triggered: { name: string; action: RouteDecision }[] = [];
  if (bestIndustry && _INDUSTRY_RULES[bestIndustry]) {
    for (const rule of _INDUSTRY_RULES[bestIndustry]) {
      let hits = 0;
      for (const p of rule.patterns) { if (p.test(text)) hits++; }
      if (hits >= 2) triggered.push({ name: rule.name, action: rule.action });
    }
  }

  const hasPrivateRule = triggered.some(r => r.action === 'private_llm');
  const hasPseudoRule = triggered.some(r => r.action === 'pseudonymize');
  const hasPersons = entities.some(e => _PERSON_TYPES.has(e.type));
  const isConfidential = _CONFIDENTIALITY_PATS.some(p => p.test(text));
  const needsCompute = _COMPUTATION_PATS.some(p => p.test(text));

  if (hasPrivateRule) {
    const rule = triggered.find(r => r.action === 'private_llm')!;
    return { route: 'private_llm', industry: bestIndustry, explanation: `${bestIndustry}: "${rule.name}" → private LLM` };
  }
  if (hasPseudoRule) {
    const rule = triggered.find(r => r.action === 'pseudonymize')!;
    return { route: 'pseudonymize', industry: bestIndustry, explanation: `${bestIndustry}: "${rule.name}" → pseudonymize` };
  }
  if (hasPersons && needsCompute) {
    return { route: 'private_llm', industry: bestIndustry, explanation: 'Persons + computation → private LLM' };
  }
  if (hasPersons || isConfidential) {
    return { route: 'pseudonymize', industry: bestIndustry, explanation: hasPersons ? 'Persons detected → pseudonymize' : 'Confidential markers → pseudonymize' };
  }
  if (entities.length > 0) {
    return { route: 'pseudonymize', industry: bestIndustry, explanation: `${entities.length} entities → pseudonymize` };
  }
  return { route: 'passthrough', industry: bestIndustry, explanation: 'No sensitive content → passthrough' };
}

// ─── Response De-pseudonymization ──────────────────────────────────────────

/**
 * Add a mapping to the reverse map, including common LLM reformatting variants.
 * E.g., "June 4th" → also adds "June 4"; percentages add "X percent" variant.
 */
const MAX_MAP_SIZE = 500;

// Debounced persistence: batch map updates to content script
let _mapPersistTimer: ReturnType<typeof setTimeout> | null = null;
let _mapPersistPending = false;

function _scheduleMapPersist(): void {
  if (_mapPersistPending) return;
  _mapPersistPending = true;
  if (_mapPersistTimer) clearTimeout(_mapPersistTimer);
  _mapPersistTimer = setTimeout(() => {
    _mapPersistPending = false;
    // Send current reverse map to content script for chrome.storage.session persistence
    igPostMessage({
      type: 'IRON_GATE_PERSIST_REVERSE_MAP',
      map: { ...currentReverseMap },
    });
  }, 500);
}

function addReverseMapping(map: Record<string, string>, pseudonym: string, original: string, entityType?: string): void {
  // Evict oldest entries if map grows too large to prevent memory leaks
  const keys = Object.keys(map);
  if (keys.length > MAX_MAP_SIZE) {
    for (let i = 0; i < 100; i++) {
      delete map[keys[i]];
    }
  }

  map[pseudonym] = original;

  // Schedule persistence to chrome.storage.session via content script
  if (map === currentReverseMap) {
    _scheduleMapPersist();
  }

  // Known org suffixes — these should NEVER be mapped as standalone partial words.
  // Mapping "Corp" → "Salesforce" causes "TechCorp" → "TechSalesforce" and other garbling.
  const ORG_SUFFIX_SET = new Set([
    'corporation', 'corp', 'corp.', 'inc', 'inc.', 'llc', 'ltd', 'ltd.',
    'partners', 'group', 'holdings', 'capital', 'enterprises', 'associates',
    'international', 'technologies', 'solutions', 'services', 'consulting',
    'management', 'investments', 'advisors', 'advisory', 'fund', 'trust',
    'bank', 'labs', 'co', 'co.', 'company', 'industries', 'foundation',
  ]);

  // Common English words that appear in fake org names (Alpine Securities, Summit Analytics, etc.)
  // These must NEVER be reverse-map keys — they'd match normal prose and garble the response.
  const COMMON_WORD_BLOCKLIST = new Set([
    'alpine', 'summit', 'horizon', 'coastal', 'beacon', 'pinnacle', 'vertex',
    'meridian', 'crestline', 'ridgepoint', 'oakmont', 'silverleaf', 'tailspin',
    'woodgrove', 'northwind', 'contoso', 'adatum', 'fabrikam', 'proseware',
    'lucerne', 'aurora', 'catalyst', 'zenith', 'atlas', 'nexus', 'titan',
    'vanguard', 'ember', 'falcon', 'dynamics', 'ventures', 'analytics',
    'research', 'systems', 'strategies', 'securities', 'media', 'financial',
  ]);

  // Multi-word name variants: LLMs often abbreviate or drop suffixes.
  // "Adatum Corporation" → also map "Adatum"
  // "Meridian Capital Partners" → also map "Meridian Capital", "Meridian"
  //
  // IMPORTANT: Skip fragment mappings for PERSON names entirely.
  // LLMs freely recombine first/last names (e.g., "Emily Kumar" from
  // two different fake people) and fragment mappings produce garbled output
  // like "Sarah Chen Michael Torres" or "Sarah Torres". The full-name
  // mapping is sufficient for persons — if the LLM abbreviates to just
  // a first/last name, a visible pseudonym is better than a garbled mix.
  const isPerson = entityType === 'PERSON';
  const words = pseudonym.split(/\s+/);
  const origWords = original.split(/\s+/);
  if (words.length >= 2 && !isPerson) {
    // Map the first word ONLY if:
    // 1. It's distinctive (not a common suffix or common English word)
    // 2. The corresponding original word is >= 4 chars (avoid "JP", "GE" etc.)
    // 3. Map to the FULL original (not just the first word) to prevent garbling
    // GUARD: Never create a fragment mapping where the fragment word appears
    // inside the original value. This causes recursive expansion:
    // e.g., "Project" → "Project Horizon" would turn "Project Horizon" →
    // "Project Horizon Horizon" on each observer cycle.
    const origLower = original.toLowerCase();

    const firstWord = words[0];
    const firstOrig = origWords[0] || original;
    if (firstWord.length >= 4 && firstOrig.length >= 4 && !map[firstWord]
        && !ORG_SUFFIX_SET.has(firstWord.toLowerCase())
        && !COMMON_WORD_BLOCKLIST.has(firstWord.toLowerCase())
        && !origLower.includes(firstWord.toLowerCase())) {
      map[firstWord] = original;
    }
    // For 3+ word names, also map the first two words
    if (words.length >= 3) {
      const firstTwo = words.slice(0, 2).join(' ');
      if (!map[firstTwo] && !origLower.includes(firstTwo.toLowerCase())) {
        map[firstTwo] = original;
      }
    }
    // Map the last word ONLY if it's NOT a common suffix/word,
    // the corresponding original word is >= 4 chars,
    // AND the fragment doesn't appear in the original (prevents recursive expansion)
    const lastWord = words[words.length - 1];
    const lastOrig = origWords[origWords.length - 1] || original;
    if (lastWord.length >= 4 && lastOrig.length >= 4 && !map[lastWord]
        && !ORG_SUFFIX_SET.has(lastWord.toLowerCase())
        && !COMMON_WORD_BLOCKLIST.has(lastWord.toLowerCase())
        && !origLower.includes(lastWord.toLowerCase())) {
      map[lastWord] = original;
    }
    // Drop common org suffixes: "Adatum Corporation" → "Adatum"
    const ORG_SUFFIXES = /\s+(Corporation|Corp\.?|Inc\.?|LLC|Ltd\.?|Partners|Group|Holdings|Capital|Enterprises|Associates|International|Technologies|Solutions|Services|Consulting|Management|Investments|Advisors|Advisory|Fund|Trust|Bank|Labs|Co\.?)$/i;
    const withoutSuffix = pseudonym.replace(ORG_SUFFIXES, '');
    if (withoutSuffix !== pseudonym && withoutSuffix.length >= 3) {
      if (!map[withoutSuffix] && !COMMON_WORD_BLOCKLIST.has(withoutSuffix.toLowerCase())
          && !origLower.includes(withoutSuffix.toLowerCase())) {
        map[withoutSuffix] = original;
      }
    }
  }

  // Date ordinal suffix variants: "June 4th" ↔ "June 4"
  const stripped = pseudonym.replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1');
  if (stripped !== pseudonym) map[stripped] = original;
  const withOrdinal = pseudonym.replace(/\b(\d+)\b(?!st|nd|rd|th)/g, (_, d) => {
    const n = parseInt(d);
    const s = (n === 1 || n === 21 || n === 31) ? 'st' : (n === 2 || n === 22) ? 'nd' : (n === 3 || n === 23) ? 'rd' : 'th';
    return d + s;
  });
  if (withOrdinal !== pseudonym) map[withOrdinal] = original;
  // Percentage variants: "21%" → "21 percent", "21.0%", etc.
  if (pseudonym.endsWith('%')) {
    const noPercent = pseudonym.slice(0, -1).trim();
    map[noPercent + ' percent'] = original;
    map[noPercent + ' %'] = original;
    // "21%" → "21.0%" and vice versa
    if (!noPercent.includes('.')) {
      map[noPercent + '.0%'] = original;
      map[noPercent + '.0 percent'] = original;
    } else {
      const intPart = noPercent.split('.')[0];
      map[intPart + '%'] = original;
      map[intPart + ' percent'] = original;
    }
    // "approximately 21%" variants
    const approxPrefixes = ['approximately ', 'about ', 'around ', 'roughly ', 'nearly '];
    for (const ap of approxPrefixes) {
      map[ap + pseudonym] = original;
    }
  }
  // Monetary amount format variants: "$349M" ↔ "$349 million" ↔ "349M" etc.
  const moneyMatch = pseudonym.match(/^(\$?)\s*([\d,.]+)\s*(million|billion|M|B|k|K|mn|bn|m|b)?$/i);
  if (moneyMatch) {
    const prefix = moneyMatch[1] || '';       // "$" or ""
    const numStr = moneyMatch[2];             // "349" or "1,200"
    const suffix = (moneyMatch[3] || '');     // "M", "million", etc.

    // Also parse the original to generate correct original-side variants
    const origMoneyMatch = original.match(/^(\$?)\s*([\d,.]+)\s*(million|billion|M|B|k|K|mn|bn|m|b)?$/i);
    const origPrefix = origMoneyMatch?.[1] || '';
    const origNum = origMoneyMatch?.[2] || original.replace(/[^\d,.]/g, '');
    const origSuffix = origMoneyMatch?.[3] || '';

    // Suffix expansion map
    const suffixVariants: Record<string, string[]> = {
      'm': ['M', 'm', 'million', 'mn', ' million', ' mn', ' M'],
      'million': ['M', 'm', 'million', 'mn', ' million', ' mn', ' M'],
      'mn': ['M', 'm', 'million', 'mn', ' million', ' mn', ' M'],
      'b': ['B', 'b', 'billion', 'bn', ' billion', ' bn', ' B'],
      'billion': ['B', 'b', 'billion', 'bn', ' billion', ' bn', ' B'],
      'bn': ['B', 'b', 'billion', 'bn', ' billion', ' bn', ' B'],
      'k': ['K', 'k', ' thousand', ',000'],
      '': [''],
    };

    const normalizedSuffix = suffix.toLowerCase().trim();
    const variants = suffixVariants[normalizedSuffix] || [suffix];

    for (const sv of variants) {
      // With $ prefix
      const pKey = '$' + numStr + sv;
      if (pKey !== pseudonym && !map[pKey]) map[pKey] = original;
      // Without $ prefix
      const nKey = numStr + sv;
      if (nKey !== pseudonym && !map[nKey]) map[nKey] = original;
      // With space between number and suffix
      if (sv && !sv.startsWith(' ') && sv.length > 1) {
        const sKey = '$' + numStr + ' ' + sv;
        if (!map[sKey]) map[sKey] = original;
      }
    }

    // "approximately $349" / "about $349" / "around $349" — LLMs love these
    const approxPrefixes = ['approximately ', 'about ', 'around ', 'roughly ', 'nearly '];
    for (const ap of approxPrefixes) {
      const apKey = ap + prefix + numStr + suffix;
      if (!map[apKey]) map[apKey] = original;
    }
  }

  // Headcount / plain number variants: "1,200" ↔ "1200", "1,200 employees" etc.
  const headcountMatch = pseudonym.match(/^([\d,]+)\s*(employees?|staff|people|workers|positions?|roles?|headcount)?$/i);
  if (headcountMatch && !moneyMatch) {
    const numPart = headcountMatch[1];
    const unitPart = headcountMatch[2] || '';
    // With and without commas
    const withCommas = numPart.includes(',') ? numPart : numPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const withoutCommas = numPart.replace(/,/g, '');
    const suffixVariants = unitPart ? [unitPart, ''] : [''];
    for (const sv of suffixVariants) {
      const sep = sv ? ' ' : '';
      if (!map[withCommas + sep + sv]) map[withCommas + sep + sv] = original;
      if (!map[withoutCommas + sep + sv]) map[withoutCommas + sep + sv] = original;
    }
  }

  // Numeric date format variants: "4/15/2026" ↔ "04/15/2026"
  const numDateMatch = pseudonym.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{2,4})$/);
  if (numDateMatch) {
    const withZeros = numDateMatch[1].padStart(2, '0') + numDateMatch[2] + numDateMatch[3].padStart(2, '0') + numDateMatch[2] + numDateMatch[4];
    const withoutZeros = parseInt(numDateMatch[1]) + numDateMatch[2] + parseInt(numDateMatch[3]) + numDateMatch[2] + numDateMatch[4];
    if (withZeros !== pseudonym) map[withZeros] = original;
    if (withoutZeros !== pseudonym) map[withoutZeros] = original;
  }

  // Persist to sessionStorage when modifying the global map (not snapshots)
  // Reverse map is in-memory only — no persistence to sessionStorage (security)
}

function replacePseudonyms(text: string, reverseMap: Record<string, string>): string {
  let result = text;
  // Sort entries by length descending — longest pseudonyms first to prevent
  // partial matches (e.g., "Adatum Corp" replaces before "Adatum" or "Corp")
  const entries = Object.entries(reverseMap)
    .filter(([k]) => k && k.length >= 2)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [pseudonym, original] of entries) {
    if (pseudonym === original) continue; // Skip identity mappings

    // Strategy 1: Boundary-aware exact match (case-sensitive)
    // IMPORTANT: Use arrow function as replacer to avoid $ being interpreted
    // as special replacement patterns ($1, $$, $&, etc.). Without this,
    // originals containing "$" (like "$48M") produce garbled "$$$$$" output.
    try {
      const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const startsWithAlpha = /^[a-zA-Z]/.test(pseudonym);
      const endsWithAlpha = /[a-zA-Z]$/.test(pseudonym);
      const startsWithDigit = /^\d/.test(pseudonym);
      const endsWithDigit = /\d$/.test(pseudonym);
      const prefix = startsWithDigit ? '(?<!\\d)' : startsWithAlpha ? '(?<![a-zA-Z])' : '';
      const suffix = endsWithDigit ? '(?!\\d)' : endsWithAlpha ? '(?![a-zA-Z])' : '';
      const regex = new RegExp(prefix + escaped + suffix, 'g');
      if (regex.test(result)) {
        regex.lastIndex = 0;
        result = result.replace(regex, () => original);
        continue;
      }
    } catch { /* regex failed, fall through */ }

    // Strategy 2: JSON-escaped match (SSE streams contain JSON-encoded strings)
    // Also handles double-escaped JSON (Gemini batchexecute responses use nested escaping)
    const jsonPseudo = jsonStringEscape(pseudonym);
    const jsonOrig = jsonStringEscape(original);
    if (jsonPseudo !== pseudonym && result.includes(jsonPseudo)) {
      result = result.split(jsonPseudo).join(jsonOrig);
      continue;
    }
    // Double-escaped: e.g., "Bentworth" → "Bentworth" (inner) → "Bentworth" (outer)
    // Gemini wraps responses in f.req with multiple JSON.stringify layers
    const json2Pseudo = jsonStringEscape(jsonPseudo);
    const json2Orig = jsonStringEscape(jsonOrig);
    if (json2Pseudo !== jsonPseudo && result.includes(json2Pseudo)) {
      result = result.split(json2Pseudo).join(json2Orig);
      continue;
    }

    // Strategy 3: Case-insensitive boundary-aware match
    try {
      const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const startsWithAlpha = /^[a-zA-Z]/.test(pseudonym);
      const endsWithAlpha = /[a-zA-Z]$/.test(pseudonym);
      const startsWithDigit = /^\d/.test(pseudonym);
      const endsWithDigit = /\d$/.test(pseudonym);
      const prefix = startsWithDigit ? '(?<!\\d)' : startsWithAlpha ? '(?<![a-zA-Z])' : '';
      const suffix = endsWithDigit ? '(?!\\d)' : endsWithAlpha ? '(?![a-zA-Z])' : '';
      const regex = new RegExp(prefix + escaped + suffix, 'gi');
      if (regex.test(result)) {
        regex.lastIndex = 0;
        result = result.replace(regex, () => original);
        continue;
      }
    } catch { /* ignore */ }

    // Strategy 4: Plain substring fallback (no word-boundary requirement).
    // LLMs sometimes concatenate pseudonyms with adjacent words (no space),
    // e.g., "Bentworthminimizing" instead of "Bentworth minimizing".
    // The boundary-aware regex above won't match, leaving pseudonyms visible.
    // Minimum 8 chars to avoid false-positive partial matches on short words.
    // (Shorter pseudonyms are handled by the boundary-aware strategies above.)
    if (pseudonym.length >= 8 && result.includes(pseudonym)) {
      result = result.split(pseudonym).join(original);
    } else if (pseudonym.length >= 8) {
      // Case-insensitive plain substring
      const lowerResult = result.toLowerCase();
      const lowerPseudo = pseudonym.toLowerCase();
      if (lowerResult.includes(lowerPseudo)) {
        // Replace preserving surrounding text
        let idx = lowerResult.indexOf(lowerPseudo);
        while (idx !== -1) {
          result = result.substring(0, idx) + original + result.substring(idx + pseudonym.length);
          idx = result.toLowerCase().indexOf(lowerPseudo, idx + original.length);
        }
      }
    }
  }
  return result;
}

function depseudonymizeResponse(response: Response, reverseMap: Record<string, string>): Response {
  if (!response.body) {
    igLog('depseudonymizeResponse: no response body — skipping');
    return response;
  }

  const mapKeys = Object.keys(reverseMap);
  igLog(`depseudonymizeResponse: wrapping stream with ${mapKeys.length} mappings`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Find the longest pseudonym token to size our overlap buffer
  const maxTokenLen = Math.max(...mapKeys.map(k => k.length), 0);
  let buffer = '';
  let chunkCount = 0;
  let totalReplacements = 0;

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          // Flush remaining buffer
          if (buffer.length > 0) {
            const flushed = replacePseudonyms(buffer, reverseMap);
            if (flushed !== buffer) totalReplacements++;
            controller.enqueue(encoder.encode(flushed));
          }
          igLog(`depseudonymizeResponse: stream complete — ${chunkCount} chunks, ${totalReplacements} chunks had replacements`);
          controller.close();
          return;
        }

        chunkCount++;
        const chunkText = decoder.decode(value, { stream: true });
        buffer += chunkText;

        // Log first few chunks and any that contain pseudonyms
        if (chunkCount <= 3 || chunkCount % 50 === 0) {
          igLog(`depseudonymizeResponse chunk #${chunkCount}: ${chunkText.length} chars, buffer: ${buffer.length} chars`);
        }
        // Check if any pseudonym appears in current buffer
        const foundInChunk = mapKeys.some(k => buffer.toLowerCase().includes(k.toLowerCase()));
        if (foundInChunk && chunkCount <= 20) {
          igLog(`depseudonymizeResponse: pseudonym FOUND in chunk #${chunkCount}!`);
        }

        // Output all text except the last maxTokenLen chars (which might contain a split token)
        const safeLen = Math.max(0, buffer.length - maxTokenLen);
        if (safeLen > 0) {
          const original = buffer.substring(0, safeLen);
          const safeText = replacePseudonyms(original, reverseMap);
          if (safeText !== original) {
            totalReplacements++;
            if (totalReplacements <= 5) {
              igLog(`depseudonymizeResponse: REPLACED in chunk #${chunkCount}!`);
            }
          }
          controller.enqueue(encoder.encode(safeText));
          buffer = buffer.substring(safeLen);
        }
      } catch (err) {
        console.error('[Iron Gate MAIN] depseudonymizeResponse: stream error:', err);
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
// Also serves as the PRIMARY de-pseudonymizer for ChatGPT since React
// re-renders overwrite stream-level replacements.

let _domObserverActive = false;
let _domReplacing = false; // re-entry guard
let _domReplacementCount = 0;

function startDomDepseudonymizer(): void {
  if (_domObserverActive) return;
  _domObserverActive = true;

  // Inject CSS anti-flicker: smooth text opacity during streaming so that
  // pseudonym→real swaps are visually masked by a subtle fade transition.
  // Only targets actively-streaming containers; static text is unaffected.
  try {
    const style = document.createElement('style');
    style.textContent = `
      [class*="result-streaming"] *,
      .response-streaming * {
        transition: opacity 0.08s ease-out;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  } catch {}

  // The de-identification notice — strip from DOM so users don't see it.
  // Matches both [NOTICE: ...] and [All personally identifiable ...] bracketed forms,
  // as well as the unbracketed plain-text form.
  const NOTICE_REGEX = /\[(?:NOTICE:\s*)?All personally identifiable information[^\]]*\]\s*/g;
  const NOTICE_UNBRACKET = /All personally identifiable information in the following text[\s\S]*?Please process this request normally\.\s*/g;
  // Catch LLM paraphrases of the notice (e.g., "Note: PII has been replaced...")
  const NOTICE_PARAPHRASE = /\*?\*?(?:Note|Notice|Disclaimer|Important)\s*:?\s*(?:All\s+)?(?:personally\s+identifiable\s+information|PII|personal\s+data|sensitive\s+data)\s+(?:has\s+been|was)\s+(?:automatically\s+)?replaced[\s\S]*?(?:fictional|fake|synthetic)\s+equivalents\.?\s*\*?\*?\s*/gi;

  // Cooldown timestamp — observer-triggered scans are suppressed until this time.
  // Prevents flicker loops where: we mutate → observer fires → re-scan → mutate → …
  let _domMutationCooldown = 0;

  function replaceInTextNode(node: Text): void {
    if (_domReplacing) return; // prevent infinite loop from our own mutations
    if (isCurrentlyGenerating()) return; // NEVER touch DOM during React render cycle
    if (!node.textContent || node.textContent.length < 2) return;

    let text = node.textContent;
    let changed = false;

    // Strip the de-identification notice from displayed text
    if (text.includes('personally identifiable information') || text.includes('enterprise privacy tool') || text.includes('PII') || text.includes('personal data')) {
      text = text.replace(NOTICE_REGEX, '');
      text = text.replace(NOTICE_UNBRACKET, '');
      text = text.replace(NOTICE_PARAPHRASE, '');
      if (text !== node.textContent) changed = true;
    }

    // De-pseudonymize if reverse map has entries.
    // For WIRE-LEVEL platforms (ChatGPT, Claude), skip user message containers —
    // the server echoes pseudonymized text in user bubbles, and de-pseudonymizing
    // fights React re-renders (server state has pseudonym → replaceChild duplicates).
    // For DOM PRE-SUBMIT platforms (Gemini, Copilot), we MUST de-pseudo user messages
    // because the pseudonymized text was written directly to the editor and displayed.
    const isDomPresubmitPlatform = activeAdapter?.interception === 'dom-presubmit' ||
      activeAdapter?.interception === 'dom-capture-wire';
    const isUserMessage = !isDomPresubmitPlatform && node.parentElement?.closest?.(
      '[data-message-author-role="user"], .whitespace-pre-wrap'
    );
    if (!isUserMessage && Object.keys(currentReverseMap).length > 0) {
      const keys = Object.keys(currentReverseMap);
      const textLower = text.toLowerCase();
      const hasMatch = keys.some(key => textLower.includes(key.toLowerCase()));
      if (hasMatch) {
        const replaced = replacePseudonyms(text, currentReverseMap);
        if (replaced !== text) {
          text = replaced;
          changed = true;
        }
      }
    }

    if (changed) {
      _domReplacing = true;
      _domMutationCooldown = Date.now() + 100; // cooldown to skip our own microtask
      try {
        // Use replaceChild with a new text node instead of mutating textContent.
        // React 19's replaceTextWithDirectives tracks specific text node references;
        // mutating textContent on a tracked node causes reconciliation failures.
        // Replacing the node entirely avoids the conflict — React loses its reference
        // but doesn't get a mismatched-content error.
        if (node.parentNode) {
          const newNode = document.createTextNode(text);
          node.parentNode.replaceChild(newNode, node);
        } else {
          node.textContent = text;
        }
      } catch {
        // Swallow errors from React reconciliation conflicts —
        // React may have removed or replaced this node between our check and mutation.
      }
      _domReplacing = false;
      _domReplacementCount++;
      if (_domReplacementCount <= 10) {
        igLog(`DOM de-pseudo: replaced text node (${text.length} chars)`);
        console.log(
          `%c[Iron Gate DEBUG] De-pseudonymized text node:`,
          'color: #00ccff; font-weight: bold',
          `\n  Before: "${node.textContent?.substring(0, 120)}..."`,
          `\n  After:  "${text.substring(0, 120)}..."`,
        );
      }

      // Re-apply for several frames to override React re-renders.
      // React may re-render from server state (which has pseudonymized text)
      // and overwrite our replacement. By re-checking for a few animation frames,
      // we ensure the de-pseudonymized text "sticks" without visible flicker.
      const expectedText = text;
      let retries = 0;
      const reapply = () => {
        if (retries >= 6 || !node.parentNode) return; // node removed or max retries
        if (isCurrentlyGenerating()) return; // stop re-applying during React render
        retries++;
        if (node.textContent !== expectedText && node.textContent && node.textContent.length >= 2) {
          // React reverted the text — re-check and re-apply
          const current = node.textContent;
          const hasNotice = current.includes('personally identifiable information') || current.includes('enterprise privacy tool');
          let fixedText = hasNotice ? current.replace(NOTICE_REGEX, '').replace(NOTICE_UNBRACKET, '').replace(NOTICE_PARAPHRASE, '') : current;
          if (Object.keys(currentReverseMap).length > 0) {
            const textLower = fixedText.toLowerCase();
            const keys = Object.keys(currentReverseMap);
            if (keys.some(key => textLower.includes(key.toLowerCase()))) {
              fixedText = replacePseudonyms(fixedText, currentReverseMap);
            }
          }
          if (fixedText !== current) {
            _domReplacing = true;
            _domMutationCooldown = Date.now() + 100;
            try {
              if (node.parentNode) {
                const newNode = document.createTextNode(fixedText);
                node.parentNode.replaceChild(newNode, node);
              } else {
                node.textContent = fixedText;
              }
            } catch {}
            _domReplacing = false;
          }
        }
        requestAnimationFrame(reapply);
      };
      requestAnimationFrame(reapply);
    }
  }

  function scanElement(el: Node): void {
    if (_domReplacing) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      replaceInTextNode(textNode);
    }
  }

  // ChatGPT-specific: scan ALL message containers (assistant AND user)
  function scanChatGPTResponses(): void {
    const mapSize = Object.keys(currentReverseMap).length;
    if (mapSize > 0 && _domReplacementCount <= 3) {
      const sample = Object.entries(currentReverseMap).slice(0, 3).map(([k, v]) => `"${k.substring(0, 20)}" → "${v.substring(0, 20)}"`).join(', ');
      igLog(`DOM scan: reverseMap has ${mapSize} entries. Sample: ${sample}`);
    }
    // Always scan for notice stripping; only scan for de-pseudo if map has entries
    const selectors = [
      // ── Assistant response containers ──
      '[class*="markdown"]',           // ChatGPT markdown response blocks
      '[class*="result-streaming"]',    // actively streaming response
      '[data-message-author-role="assistant"]', // ChatGPT assistant message blocks
      '.agent-turn',                    // ChatGPT agent turns
      'article',                        // generic article containers
      '[class*="prose"]',               // Perplexity / generic prose containers
      'main [class*="text-base"]',      // text content in main area
      // Claude response containers
      '[data-is-streaming]',            // Claude streaming response
      '.font-claude-message',           // Claude message blocks
      '[class*="message-content"]',     // Claude message content
      // Gemini response containers
      'model-response',                 // Gemini model response web component
      '.response-container',            // Gemini response container
      'message-content',                // Gemini message content web component
      // Copilot response containers
      '.ac-container',                  // Copilot adaptive card container
      '[class*="response"]',            // generic response class
      // DeepSeek / Poe / Groq / HuggingFace
      '[class*="answer"]',              // DeepSeek answer blocks
      '[class*="Message"]',             // Poe message blocks
      // ── User message containers (notice stripping + de-pseudo for DOM pre-submit) ──
      '[data-message-author-role="user"]', // ChatGPT user message blocks
      '.whitespace-pre-wrap',           // ChatGPT user message text wrapper
      '[class*="user-message"]',        // user message class variants
      // Catch-all for main content area
      'main',                           // entire main content
    ];
    for (const sel of selectors) {
      try {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          scanElement(el);
        }
      } catch { /* selector may not be valid on all pages */ }
    }

    // Shadow DOM scan for Copilot — MutationObserver on document.body doesn't
    // pierce shadow boundaries. Copilot's cib-* web components use shadow roots,
    // so we must explicitly traverse into them to find response text nodes.
    if (activeAdapter?.usesShadowDom) {
      try {
        scanShadowRoots(document.body);
      } catch { /* shadow DOM not available */ }
    }
  }

  /**
   * Recursively scan shadow DOM trees for text nodes containing pseudonyms.
   * Necessary for Copilot and other platforms that use Web Components.
   */
  function scanShadowRoots(root: Element): void {
    // Check this element's shadow root
    if (root.shadowRoot) {
      scanElement(root.shadowRoot as unknown as Node);
      // Also scan shadow root children for nested shadow DOMs
      const children = root.shadowRoot.querySelectorAll('*');
      for (const child of children) {
        if (child.shadowRoot) {
          scanShadowRoots(child);
        }
      }
    }
    // Check children in light DOM
    const lightChildren = root.querySelectorAll('*');
    for (const child of lightChildren) {
      if (child.shadowRoot) {
        scanShadowRoots(child);
      }
    }
  }

  // ── Streaming-aware DOM de-pseudonymization ──────────────────────────────
  // CRITICAL: We must NOT modify text nodes while React is actively rendering.
  // The MutationObserver callback fires SYNCHRONOUSLY inside React's commit
  // phase when React adds/removes DOM nodes. Even deferring the scan with
  // requestIdleCallback doesn't help because the observer callback itself
  // runs during React's mutation flush.
  //
  // Strategy: DISCONNECT the observer entirely when generation starts,
  // and only RECONNECT + scan after generation fully stops (with a long delay
  // to ensure React's reconciliation is completely done).

  let _observing = false;
  let _generationCheckInterval: ReturnType<typeof setInterval> | null = null;

  function isCurrentlyGenerating(): boolean {
    if (activeAdapter?.isGenerating()) return true;
    return !!(
      // ChatGPT streaming indicators
      document.querySelector('[class*="result-streaming"]') ||
      document.querySelector('button[aria-label="Stop generating"]') ||
      document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('.response-streaming') ||
      // Claude streaming indicators
      document.querySelector('[data-is-streaming="true"]') ||
      document.querySelector('button[aria-label="Stop Response"]') ||
      // Gemini streaming indicators
      document.querySelector('.loading-indicator') ||
      document.querySelector('button[aria-label="Stop"]') ||
      // Copilot streaming indicators
      document.querySelector('[aria-label="Stop Responding"]') ||
      document.querySelector('.typing-indicator') ||
      // Perplexity streaming indicator
      document.querySelector('.animate-spin')
    );
  }

  const observer = new MutationObserver(() => {
    if (_domReplacing) return;

    // Skip observer-triggered scans during cooldown after our own mutations.
    // This prevents flicker: our mutation → observer fires → re-scan → mutate → loop.
    if (Date.now() < _domMutationCooldown) return;

    // If generation started, disconnect immediately to stop ALL observer callbacks
    // during React's render cycle. This is the ONLY way to prevent
    // replaceTextWithDirectives errors — deferring isn't enough.
    if (isCurrentlyGenerating()) {
      disconnectObserver();
      startGenerationMonitor();
      return;
    }

    // Not streaming — debounced scan via setTimeout (NOT synchronous)
    // Use setTimeout to get completely out of React's mutation commit phase.
    // 80ms debounce balances responsiveness (preventing flicker from React
    // re-renders that overwrite our de-pseudonymized text) with performance.
    if (!_scanQueued) {
      _scanQueued = true;
      setTimeout(() => {
        _scanQueued = false;
        if (!isCurrentlyGenerating() && Date.now() >= _domMutationCooldown) {
          try { scanChatGPTResponses(); } catch {}
        }
      }, 80);
    }
  });

  let _scanQueued = false;

  function connectObserver(): void {
    if (_observing || !document.body) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true, // catch React in-place text mutations (not just node add/remove)
    });
    _observing = true;
  }

  function disconnectObserver(): void {
    if (!_observing) return;
    observer.disconnect();
    _observing = false;
    igLog('DOM observer disconnected (generation started)');
  }

  /**
   * While generation is active, poll every 200ms to detect when it stops.
   * Faster polling (200ms vs 500ms) cuts worst-case pseudonym visibility
   * from 500ms to 200ms with negligible CPU impact (TreeWalker is cheap).
   * When generation stops, run multiple scan passes at staggered intervals
   * to catch React's post-generation re-renders.
   */
  function startGenerationMonitor(): void {
    if (_generationCheckInterval) return; // Already monitoring

    _generationCheckInterval = setInterval(() => {
      // While generating, do NOT scan any DOM elements. React manages ALL message
      // nodes (not just the streaming one) and mutating any text node during React's
      // render cycle causes "Failed replaceTextWithDirectives" errors. The multi-pass
      // sweep after generation completes will catch everything.

      if (!isCurrentlyGenerating()) {
        // Generation stopped — clear the monitor
        clearInterval(_generationCheckInterval!);
        _generationCheckInterval = null;

        // Multi-pass scan: React re-renders at unpredictable times after
        // generation stops. Run passes at staggered intervals.
        // First pass at 300ms (not 50ms) to avoid React 19's post-generation
        // reconciliation (replaceTextWithDirectives). Later passes catch
        // delayed React reconciliation (markdown, code highlighting).
        const scanDelays = [300, 600, 1200, 2000, 3500];
        for (const delay of scanDelays) {
          setTimeout(() => {
            if (!isCurrentlyGenerating()) {
              try { scanChatGPTResponses(); } catch {}
            }
          }, delay);
        }

        // Reconnect observer after first scan pass completes
        setTimeout(() => {
          igLog('DOM de-pseudo: generation complete — reconnecting observer');
          connectObserver();
        }, 500);
      }
    }, 200);
  }

  // Start observing once body is available
  const startObserving = () => {
    if (document.body) {
      connectObserver();
      igLog('DOM de-pseudonymizer active (disconnect-during-generation mode)');
    } else {
      setTimeout(startObserving, 100);
    }
  };
  startObserving();

  // Periodic backstop scan — only when NOT generating.
  // Catches any pseudonyms that leak through stream-level de-pseudo
  // or appear after React re-renders.
  // Shadow DOM platforms (Copilot, Gemini) need faster scanning (500ms)
  // because MutationObserver doesn't pierce shadow roots.
  const backstopInterval = activeAdapter?.usesShadowDom ? 500 : 1000;
  const backstopTimer = setInterval(() => {
    if (Object.keys(currentReverseMap).length === 0) return;
    if (isCurrentlyGenerating()) return;
    if (Date.now() < _domMutationCooldown) return;
    setTimeout(() => {
      if (!isCurrentlyGenerating() && Date.now() >= _domMutationCooldown) {
        try { scanChatGPTResponses(); } catch {}
      }
    }, 50);
  }, backstopInterval);

  // Clean up intervals when the content script is replaced or page navigates away
  window.addEventListener('iron-gate-cs-replaced', () => {
    clearInterval(backstopTimer);
    if (_generationCheckInterval) {
      clearInterval(_generationCheckInterval);
      _generationCheckInterval = null;
    }
    observer.disconnect();
  }, { once: true });

  window.addEventListener('pagehide', () => {
    clearInterval(backstopTimer);
    if (_generationCheckInterval) {
      clearInterval(_generationCheckInterval);
      _generationCheckInterval = null;
    }
    observer.disconnect();
  }, { once: true });
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
    // ReadableStream — consume the stream to read the body (ChatGPT may use this)
    if (typeof ReadableStream !== 'undefined' && init.body instanceof ReadableStream) {
      try {
        const reader = init.body.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const combined = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
        const text = new TextDecoder().decode(combined);
        igLog(`getBodyString: consumed ReadableStream body (${text.length} chars)`);
        // Store the consumed text so the caller can use it as the new body
        (init as any).__ironGateConsumedBody = text;
        return text;
      } catch (streamErr) {
        igLog('getBodyString: ReadableStream read failed:', streamErr);
        return null;
      }
    }
    // Unknown body type — log for debugging
    igLog(`getBodyString: unhandled body type: ${Object.prototype.toString.call(init.body)}, constructor: ${init.body?.constructor?.name}`);
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

// ─── File Upload Detection in Fetch ───────────────────────────────────────
// Detects file uploads in fetch bodies and notifies the content script via
// postMessage. The content script bridges this to the service worker for
// scanning. Works across all platforms regardless of DOM structure.

const _processedFileKeys = new Set<string>();

// ─── File Scan Gate — State & Overlay ─────────────────────────────────────
// Tracks pending file scans and gates the submit action when a high-risk
// document is detected. The content script relays FILE_SCAN_RESULT from the
// service worker via postMessage; we listen for those results here.

interface PendingFileScan {
  status: 'scanning' | 'complete';
  fileName: string;
  result?: { score: number; level: string; entities: Array<{ type: string; count: number }>; explanation: string; entitiesFound: number };
  startedAt: number;
}

const pendingFileScans = new Map<string, PendingFileScan>();

// ─── Scanning Indicator (ghost loading) ──────────────────────────────────
// Shows a small floating pill when a file is detected and being scanned.
const SCAN_INDICATOR_HOST_ID = 'iron-gate-scan-indicator';

function showScanIndicator(fileName: string): void {
  // Remove existing indicator if any
  const existing = document.getElementById(SCAN_INDICATOR_HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = SCAN_INDICATOR_HOST_ID;
  host.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483646;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    @keyframes igScanSlideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
    @keyframes igScanPulse { 0%,100% { opacity:0.6; } 50% { opacity:1; } }
    @keyframes igScanSpin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
    @keyframes igScanFadeOut { from { opacity:1; } to { opacity:0; transform:translateY(-8px); } }
  `;
  shadow.appendChild(style);

  const pill = document.createElement('div');
  pill.style.cssText = 'display:inline-flex;align-items:center;gap:10px;background:#1e293b;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:500;padding:10px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.25);animation:igScanSlideUp 0.25s ease-out;';

  // Spinner
  const spinner = document.createElement('div');
  spinner.style.cssText = 'width:16px;height:16px;border:2px solid #475569;border-top-color:#60a5fa;border-radius:50%;animation:igScanSpin 0.8s linear infinite;flex-shrink:0;';

  // Shield icon (Iron Gate brand)
  const shield = document.createElement('span');
  shield.textContent = '\u{1F6E1}';
  shield.style.cssText = 'font-size:14px;animation:igScanPulse 1.5s ease-in-out infinite;';

  // Text
  const text = document.createElement('span');
  const truncatedName = fileName.length > 30 ? fileName.substring(0, 27) + '...' : fileName;
  text.textContent = `Scanning ${truncatedName}`;
  text.style.cssText = 'white-space:nowrap;';

  pill.appendChild(shield);
  pill.appendChild(spinner);
  pill.appendChild(text);
  shadow.appendChild(pill);
  document.body.appendChild(host);

  // Store references for updating
  (host as any).__igPill = pill;
  (host as any).__igText = text;
  (host as any).__igSpinner = spinner;
}

function updateScanIndicator(level: string, score: number, fileName: string): void {
  const host = document.getElementById(SCAN_INDICATOR_HOST_ID);
  if (!host) return;

  const pill = (host as any).__igPill as HTMLElement;
  const text = (host as any).__igText as HTMLElement;
  const spinner = (host as any).__igSpinner as HTMLElement;
  if (!pill || !text) return;

  // Remove spinner
  if (spinner) spinner.remove();

  const levelConfig: Record<string, { bg: string; icon: string; label: string }> = {
    low: { bg: '#166534', icon: '\u2714\uFE0F', label: 'Clean' },
    medium: { bg: '#854d0e', icon: '\u26A0\uFE0F', label: 'Medium Risk' },
    high: { bg: '#9a3412', icon: '\u26A0\uFE0F', label: 'High Risk' },
    critical: { bg: '#991b1b', icon: '\u26D4', label: 'Critical Risk' },
  };
  const config = levelConfig[level] || levelConfig.low;

  pill.style.background = config.bg;
  text.textContent = `${config.icon} ${config.label} — ${score}`;

  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    pill.style.animation = 'igScanFadeOut 0.3s ease-out forwards';
    setTimeout(() => host.remove(), 350);
  }, 3000);
}

function dismissScanIndicator(): void {
  const host = document.getElementById(SCAN_INDICATOR_HOST_ID);
  if (host) {
    const pill = (host as any).__igPill as HTMLElement;
    if (pill) pill.style.animation = 'igScanFadeOut 0.3s ease-out forwards';
    setTimeout(() => host.remove(), 350);
  }
}

// Register a file scan when a file is detected (called from _readFileToBase64AndPost)
function registerPendingFileScan(fileName: string, fileKey: string): void {
  pendingFileScans.set(fileKey, { status: 'scanning', fileName, startedAt: Date.now() });
  igLog(`File scan registered: ${fileName} (key: ${fileKey})`);
  showScanIndicator(fileName);
}

// Listen for scan results relayed from content script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'IRON_GATE_FILE_SCAN_RESULT') return;
  const p = event.data.payload;
  if (!p || !p.fileName) return;

  igLog(`File scan result received: ${p.fileName} — level=${p.level}, score=${p.score}`);

  // Update the scanning indicator with the result
  updateScanIndicator(p.level ?? 'low', p.score ?? 0, p.fileName ?? '');

  // Match by fileName (best-effort — the scan result payload includes fileName)
  let matched = false;
  for (const [key, scan] of pendingFileScans) {
    if (scan.fileName === p.fileName && scan.status === 'scanning') {
      pendingFileScans.set(key, {
        ...scan,
        status: 'complete',
        result: {
          score: p.score ?? 0,
          level: p.level ?? 'low',
          entities: p.entities ?? [],
          explanation: p.explanation ?? '',
          entitiesFound: p.entitiesFound ?? 0,
        },
      });
      matched = true;
      break;
    }
  }
  if (!matched) {
    // Result arrived but we don't have a pending entry (e.g., from prototype patches)
    // Create one so the gate can still check it
    const fallbackKey = `result:${p.fileName}:${Date.now()}`;
    pendingFileScans.set(fallbackKey, {
      status: 'complete',
      fileName: p.fileName,
      startedAt: Date.now(),
      result: {
        score: p.score ?? 0,
        level: p.level ?? 'low',
        entities: p.entities ?? [],
        explanation: p.explanation ?? '',
        entitiesFound: p.entitiesFound ?? 0,
      },
    });
  }
});

// ─── Conversation Boundary Reset ──────────────────────────────────────────
// SPAs (ChatGPT, Claude, etc.) navigate via pushState without triggering popstate.
// When the URL path changes (new conversation), clear pseudonym maps to prevent
// stale mappings from one conversation leaking into another's de-pseudonymization.
function _checkConversationBoundary(): void {
  const currentPath = window.location.pathname;
  if (currentPath !== _lastConversationPath) {
    const prevPath = _lastConversationPath;
    _lastConversationPath = currentPath;

    // Only clear pseudonym maps when navigating between DIFFERENT conversations.
    // Preserve maps for: "/" → "/c/id" (new chat getting ID), settings, GPT store, etc.
    //
    // Conversation ID extraction for each platform:
    //   ChatGPT:    /c/{uuid}
    //   Claude:     /chat/{uuid}
    //   Gemini:     /app/{uuid}
    //   Copilot:    /c/{threadId}
    //   Perplexity: /search/{uuid}
    //   DeepSeek:   /a/chat/s/{uuid}
    //   Poe:        /chat/{botName}/{chatId}
    const convIdPatterns = [
      /\/c\/([^/?#]+)/,             // ChatGPT, Copilot
      /\/chat\/([^/?#]+)/,          // Claude, Poe
      /\/app\/([^/?#]+)/,           // Gemini
      /\/search\/([^/?#]+)/,        // Perplexity
      /\/a\/chat\/s\/([^/?#]+)/,    // DeepSeek
    ];

    function extractConvId(path: string): string | null {
      for (const pattern of convIdPatterns) {
        const m = path.match(pattern);
        if (m) return m[1];
      }
      return null;
    }

    const prevConvId = extractConvId(prevPath);
    const currConvId = extractConvId(currentPath);

    // Clear ONLY when switching from one conversation to a DIFFERENT conversation
    const isSwitchingConversations = prevConvId && currConvId && prevConvId !== currConvId;
    // Also clear when navigating from a conversation back to new-chat root
    const isLeavingConvForNewChat = prevConvId && !currConvId && (currentPath === '/' || currentPath === '');

    if (isSwitchingConversations || isLeavingConvForNewChat) {
      igLog(`URL changed: ${prevPath} → ${currentPath} — different conversation, resetting pseudonym maps`);
      currentReverseMap = {};
      currentForwardMap = {};
      pendingFileScans.clear();
      dismissScanIndicator();
    } else {
      igLog(`URL changed: ${prevPath} → ${currentPath} — keeping pseudonym maps`);
    }
  }
}

// Intercept pushState/replaceState for SPA navigation detection
const _origPushState = history.pushState.bind(history);
const _origReplaceState = history.replaceState.bind(history);
history.pushState = function(...args: Parameters<typeof history.pushState>) {
  _origPushState(...args);
  _checkConversationBoundary();
};
history.replaceState = function(...args: Parameters<typeof history.replaceState>) {
  _origReplaceState(...args);
  _checkConversationBoundary();
};

// Clean up old scans on URL change
window.addEventListener('popstate', () => { _checkConversationBoundary(); });
window.addEventListener('hashchange', () => { _checkConversationBoundary(); });

// ─── Inline Document Block Overlay ────────────────────────────────────────
// Shown in MAIN world (page context) when a high-risk document is detected.
// Built inline (not imported) because MAIN world can't import content script modules.

const DOC_OVERLAY_HOST_ID = 'iron-gate-doc-block-overlay';

function _formatEntityTypeName(type: string): string {
  return type.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function showDocumentBlockOverlay(options: {
  fileName: string;
  score: number;
  level: string;
  entities: Array<{ type: string; count: number }>;
  explanation: string;
}): Promise<'allow' | 'block'> {
  // Remove any existing overlay
  const existing = document.getElementById(DOC_OVERLAY_HOST_ID);
  if (existing) existing.remove();

  return new Promise<'allow' | 'block'>((resolve) => {
    const { fileName, score, level, entities, explanation } = options;

    const levelColors: Record<string, { bg: string; text: string; border: string }> = {
      low: { bg: '#dcfce7', text: '#166534', border: '#22c55e' },
      medium: { bg: '#fef9c3', text: '#854d0e', border: '#eab308' },
      high: { bg: '#fed7aa', text: '#9a3412', border: '#f97316' },
      critical: { bg: '#fecaca', text: '#991b1b', border: '#ef4444' },
    };
    const colors = levelColors[level] || levelColors.high;
    const levelIcons: Record<string, string> = { low: '\u2714', medium: '\u26A0', high: '\u26A0', critical: '\u26D4' };
    const icon = levelIcons[level] || '\u26A0';
    const levelLabels: Record<string, string> = { low: 'Low Risk', medium: 'Medium Risk', high: 'High Risk', critical: 'Critical Risk' };

    const host = document.createElement('div');
    host.id = DOC_OVERLAY_HOST_ID;
    host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      @keyframes igDocFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes igDocSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      * { box-sizing: border-box; }
    `;
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;animation:igDocFadeIn 0.2s ease-out;`;

    const card = document.createElement('div');
    card.style.cssText = `background:#fff;border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,0.3);max-width:520px;width:90vw;max-height:85vh;overflow-y:auto;animation:igDocSlideUp 0.25s ease-out;`;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `background:${colors.bg};border-bottom:2px solid ${colors.border};border-radius:16px 16px 0 0;padding:24px;text-align:center;`;
    // Build header using DOM APIs instead of innerHTML to prevent XSS via fileName
    const iconDiv = document.createElement('div');
    iconDiv.style.cssText = 'font-size:36px;margin-bottom:8px;';
    iconDiv.textContent = icon;

    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = `font-size:20px;font-weight:700;color:${colors.text};margin-bottom:4px;`;
    titleDiv.textContent = 'Sensitive Document Detected';

    const fileNameDiv = document.createElement('div');
    fileNameDiv.style.cssText = `font-size:14px;color:${colors.text};opacity:0.8;margin-bottom:12px;`;
    fileNameDiv.textContent = fileName;

    const badgeDiv = document.createElement('div');
    badgeDiv.style.cssText = `display:inline-flex;align-items:center;gap:8px;background:${colors.text};color:#fff;font-size:14px;font-weight:600;padding:6px 16px;border-radius:20px;`;
    const scoreSpan = document.createElement('span');
    scoreSpan.style.cssText = 'font-size:22px;font-weight:800;';
    scoreSpan.textContent = String(score);
    const levelSpan = document.createElement('span');
    levelSpan.textContent = levelLabels[level] || 'Unknown';
    badgeDiv.appendChild(scoreSpan);
    badgeDiv.appendChild(levelSpan);

    header.appendChild(iconDiv);
    header.appendChild(titleDiv);
    header.appendChild(fileNameDiv);
    header.appendChild(badgeDiv);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:24px;';

    if (explanation) {
      const explEl = document.createElement('p');
      explEl.style.cssText = 'font-size:14px;line-height:1.6;color:#374151;margin:0 0 20px 0;';
      explEl.textContent = explanation;
      body.appendChild(explEl);
    }

    // Warning message
    const warning = document.createElement('div');
    warning.style.cssText = 'font-size:13px;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin-bottom:20px;line-height:1.5;';
    warning.textContent = 'This document contains sensitive information that may be exposed to the AI model. Consider removing confidential data before sending.';
    body.appendChild(warning);

    // Override reason
    const overrideSection = document.createElement('div');
    overrideSection.style.cssText = 'margin-bottom:20px;';

    const overrideLabel = document.createElement('label');
    overrideLabel.style.cssText = 'display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;';
    overrideLabel.textContent = 'Override Reason (required to proceed)';

    const overrideInput = document.createElement('textarea');
    overrideInput.style.cssText = 'width:100%;min-height:72px;padding:10px 12px;font-size:14px;font-family:inherit;color:#1f2937;background:#f9fafb;border:1px solid #d1d5db;border-radius:8px;resize:vertical;outline:none;box-sizing:border-box;';
    overrideInput.placeholder = 'Explain why this document should be sent despite the sensitivity score...';

    const overrideHint = document.createElement('div');
    overrideHint.style.cssText = 'font-size:12px;color:#9ca3af;margin-top:4px;';
    overrideHint.textContent = 'This will be logged for compliance review.';

    overrideSection.appendChild(overrideLabel);
    overrideSection.appendChild(overrideInput);
    overrideSection.appendChild(overrideHint);
    body.appendChild(overrideSection);

    // Error message (hidden)
    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'display:none;font-size:13px;color:#dc2626;margin-bottom:16px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;';
    errorMsg.textContent = 'Please provide an override reason before proceeding.';
    body.appendChild(errorMsg);

    // Buttons
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:600;font-family:inherit;color:#374151;background:#fff;border:1px solid #d1d5db;border-radius:8px;cursor:pointer;';
    cancelBtn.textContent = 'Cancel Send';
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = '#f3f4f6'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = '#fff'; });

    const sendBtn = document.createElement('button');
    sendBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:600;font-family:inherit;color:#fff;background:#dc2626;border:none;border-radius:8px;cursor:pointer;';
    sendBtn.textContent = 'Send Anyway';
    sendBtn.addEventListener('mouseenter', () => { sendBtn.style.background = '#b91c1c'; });
    sendBtn.addEventListener('mouseleave', () => { sendBtn.style.background = '#dc2626'; });

    footer.appendChild(cancelBtn);
    footer.appendChild(sendBtn);
    body.appendChild(footer);

    card.appendChild(header);
    card.appendChild(body);
    overlay.appendChild(card);
    shadow.appendChild(overlay);
    document.body.appendChild(host);

    function cleanup() {
      document.removeEventListener('keydown', onEsc, { capture: true } as EventListenerOptions);
      host.remove();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') { cleanup(); resolve('block'); }
    }
    document.addEventListener('keydown', onEsc, { capture: true });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve('block'); } });

    cancelBtn.addEventListener('click', () => { cleanup(); resolve('block'); });
    sendBtn.addEventListener('click', () => {
      const reason = overrideInput.value.trim();
      if (!reason) {
        errorMsg.style.display = 'block';
        overrideInput.style.borderColor = '#dc2626';
        overrideInput.focus();
        return;
      }
      cleanup();
      // Post override event for audit logging
      igPostMessage({
        type: 'IRON_GATE_DOC_OVERRIDE',
        fileName: options.fileName,
        score: options.score,
        level: options.level,
        overrideReason: reason,
      });
      resolve('allow');
    });

    overrideInput.addEventListener('input', () => {
      if (overrideInput.value.trim()) {
        errorMsg.style.display = 'none';
        overrideInput.style.borderColor = '#d1d5db';
      }
    });

    requestAnimationFrame(() => overrideInput.focus());
  });
}

// ─── File Upload Gate ─────────────────────────────────────────────────────
// Called before submit (both fetch interceptor and DOM pre-submit) to check
// if any recently uploaded files have high-risk scan results.

const FILE_SCAN_GATE_WINDOW = 120_000; // consider scans from last 2 minutes
const FILE_SCAN_WAIT_TIMEOUT = 15_000; // max wait for pending scan

async function checkFileUploadGate(): Promise<'allow' | 'block'> {
  const now = Date.now();

  // Clean up old entries
  for (const [key, scan] of pendingFileScans) {
    if (now - scan.startedAt > FILE_SCAN_GATE_WINDOW) {
      pendingFileScans.delete(key);
    }
  }

  if (pendingFileScans.size === 0) return 'allow';

  // Check if any scans are still pending — wait for them
  const pendingEntries = Array.from(pendingFileScans.entries()).filter(([, s]) => s.status === 'scanning');
  if (pendingEntries.length > 0) {
    igLog(`Waiting for ${pendingEntries.length} file scan(s) to complete...`);

    // Wait up to FILE_SCAN_WAIT_TIMEOUT for all pending scans
    const waitStart = Date.now();
    while (Date.now() - waitStart < FILE_SCAN_WAIT_TIMEOUT) {
      await new Promise(r => setTimeout(r, 500));
      const stillPending = Array.from(pendingFileScans.values()).some(s => s.status === 'scanning');
      if (!stillPending) break;
    }
  }

  // Now check completed results — find the highest-risk file
  let highestScore = 0;
  let highestScan: PendingFileScan | null = null;
  let hasErrorResult = false;
  let errorFileName = '';

  for (const [, scan] of pendingFileScans) {
    if (scan.status === 'complete' && scan.result) {
      // Detect scan errors (API unreachable, auth failure, etc.)
      if (scan.result.level === 'error') {
        hasErrorResult = true;
        errorFileName = scan.fileName;
      }
      if (scan.result.score > highestScore) {
        highestScore = scan.result.score;
        highestScan = scan;
      }
    }
  }

  // FAIL-CLOSED: If any scan failed with an error, block the submission.
  // A security product must not allow potentially sensitive documents through
  // just because the scanning infrastructure is unavailable.
  if (hasErrorResult) {
    igLog(`File gate triggered: scan error for "${errorFileName}" — blocking (fail-closed)`);
    dismissScanIndicator();

    const decision = await showDocumentBlockOverlay({
      fileName: errorFileName,
      score: 100,
      level: 'critical',
      entities: [],
      explanation: `Document scan failed — could not verify "${errorFileName}" is safe to share. Please check your Iron Gate API connection in the extension settings and try again.`,
    });

    pendingFileScans.clear();
    return decision;
  }

  // Gate on HIGH (61+) or CRITICAL (86+) scores
  if (highestScan && highestScan.result && highestScore >= 61) {
    igLog(`File gate triggered: ${highestScan.fileName} scored ${highestScore} (${highestScan.result.level})`);

    // Dismiss the scan indicator before showing block overlay
    dismissScanIndicator();

    const decision = await showDocumentBlockOverlay({
      fileName: highestScan.fileName,
      score: highestScan.result.score,
      level: highestScan.result.level,
      entities: highestScan.result.entities || [],
      explanation: highestScan.result.explanation || `This document contains sensitive information with a risk score of ${highestScore}.`,
    });

    // Clear the scans after the decision so they don't re-trigger
    pendingFileScans.clear();

    return decision;
  }

  return 'allow';
}

/**
 * Synchronous file gate check for WebSocket.send (which can't be async).
 * Returns true if a high-risk document scan has completed (score >= 61).
 * Does NOT wait for pending scans — use the async checkFileUploadGate() for that.
 */
function hasHighRiskFileScanSync(): boolean {
  const now = Date.now();
  for (const [key, scan] of pendingFileScans) {
    if (now - scan.startedAt > FILE_SCAN_GATE_WINDOW) {
      pendingFileScans.delete(key);
      continue;
    }
    if (scan.status === 'complete' && scan.result && scan.result.score >= 61) {
      return true;
    }
  }
  return false;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

const SUPPORTED_FILE_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'txt', 'csv', 'pptx', 'rtf', 'html', 'md', 'json']);
const MAX_SCAN_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Save pristine Blob.prototype.arrayBuffer before any patches ───────────
// Used by all file detection patches below to read file content without
// triggering our own patched version (avoids infinite recursion).
const _pristineBlobArrayBuffer = Blob.prototype.arrayBuffer;

// Helper: read a File to base64 using the pristine (unpatched) Blob.arrayBuffer
function _readFileToBase64AndPost(file: File, source: string): void {
  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!SUPPORTED_FILE_EXTENSIONS.has(ext)) return;
    if (file.size > MAX_SCAN_FILE_SIZE || file.size === 0) return;

    const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (_processedFileKeys.has(fileKey)) return;
    _processedFileKeys.add(fileKey);
    setTimeout(() => _processedFileKeys.delete(fileKey), 30_000);

    igLog(`File detected via ${source}: ${file.name} (${file.size} bytes)`);

    // Register this file for the submit gate
    registerPendingFileScan(file.name, fileKey);

    _pristineBlobArrayBuffer.call(file).then((buf: ArrayBuffer) => {
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      igPostMessage({
        type: 'IRON_GATE_FILE_UPLOAD',
        fileName: file.name,
        fileSize: file.size,
        fileType: ext,
        fileBase64: base64,
        url: window.location.href,
        timestamp: Date.now(),
      });
    }).catch(() => {});
  } catch { /* don't break the caller */ }
}

function detectFilesInFormData(formData: FormData, url: string): void {
  try {
    for (const [, value] of formData.entries()) {
      if (!(value instanceof File) || value.size === 0) continue;

      const ext = (value.name.split('.').pop() || '').toLowerCase();
      if (!SUPPORTED_FILE_EXTENSIONS.has(ext)) continue;
      if (value.size > MAX_SCAN_FILE_SIZE) continue;

      // Deduplicate by name + size + lastModified
      const fileKey = `${value.name}:${value.size}:${value.lastModified}`;
      if (_processedFileKeys.has(fileKey)) continue;
      _processedFileKeys.add(fileKey);
      setTimeout(() => _processedFileKeys.delete(fileKey), 30_000);

      igLog(`File detected in FormData: ${value.name} (${value.size} bytes) → ${url.substring(0, 80)}`);

      // Register for the submit gate
      registerPendingFileScan(value.name, fileKey);

      // Read file async and postMessage to content script (don't block the fetch)
      const file = value;
      fileToBase64(file).then((base64) => {
        igPostMessage({
          type: 'IRON_GATE_FILE_UPLOAD',
          fileName: file.name,
          fileSize: file.size,
          fileType: ext,
          fileBase64: base64,
          url,
          timestamp: Date.now(),
        });
      }).catch((err) => {
        igLog('Failed to read file from FormData:', err);
      });
    }
  } catch {
    // Don't break the fetch on errors
  }
}

function isFileUploadEndpoint(url: string): boolean {
  // Check adapter-specific file upload patterns first
  if (activeAdapter?.fileUploadPatterns) {
    for (const pattern of activeAdapter.fileUploadPatterns) {
      if (pattern.test(url)) return true;
    }
  }
  // Fallback: heuristic URL matching
  return /file|upload|document|convert|kblob|attach/i.test(url);
}

function detectFileMetadataInJson(body: string, url: string): void {
  try {
    // Only check URLs that look like file upload endpoints
    if (!isFileUploadEndpoint(url)) return;

    const parsed = JSON.parse(body);
    const fileName = parsed.file_name || parsed.fileName || parsed.filename;
    const fileSize = parsed.file_size || parsed.fileSize || parsed.size;

    if (fileName && typeof fileName === 'string') {
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      if (SUPPORTED_FILE_EXTENSIONS.has(ext)) {
        igLog(`File metadata in JSON: ${fileName} (${fileSize || '?'} bytes) → ${url.substring(0, 80)}`);
        igPostMessage({
          type: 'IRON_GATE_FILE_METADATA',
          fileName,
          fileSize: fileSize || 0,
          fileType: ext,
          url,
          timestamp: Date.now(),
        });
      }
    }
  } catch {
    // Not JSON or no file metadata — ignore
  }
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
    igLog(`fetch #${_fetchCallCount}: ${method} ${url.substring(0, 100)}`);
  }

  // Only intercept POST/PUT/PATCH (which carry prompt data in body)
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    return originalFetch.call(window, input, init);
  }

  // ─── File Upload Detection (runs before LLM endpoint check) ──────────
  // Detect File objects in FormData bodies on any POST/PUT to the same origin.
  // File uploads go to platform-specific endpoints (e.g., /backend-api/files,
  // /api/convert_document, /images/kblob) that may not match LLM API patterns.
  //
  // Handle BOTH patterns:
  //   fetch(url, { body })    → body is in init
  //   fetch(new Request(...)) → body is in the Request object
  // ─── File Upload Detection (runs before LLM endpoint check) ──────────
  // IMPORTANT: All detection is deferred via setTimeout(0) so it NEVER
  // interferes with the actual fetch — the browser sends the request first,
  // and we scan the file asynchronously afterwards.
  const bodyRef = init?.body ?? null;
  if (bodyRef instanceof FormData) {
    setTimeout(() => detectFilesInFormData(bodyRef, url), 0);
  }
  if (bodyRef instanceof File) {
    // ChatGPT uploads files via fetch(presignedUrl, { method: 'PUT', body: file })
    const fileRef = bodyRef;
    setTimeout(() => _readFileToBase64AndPost(fileRef, 'fetch body (File)'), 0);
  }
  if (bodyRef && typeof bodyRef === 'string' && isFileUploadEndpoint(url)) {
    const bodySnapshot = bodyRef;
    setTimeout(() => detectFileMetadataInJson(bodySnapshot, url), 0);
  }

  if (!adapterIsLLMEndpoint(url, activeAdapter)) {
    return originalFetch.call(window, input, init);
  }

  // Extract the body — NEVER mutates input or init
  let bodyString: string | null = null;
  try {
    bodyString = await getBodyString(input, init);
  } catch {
    // Body read failed — pass through unmodified
  }

  // If we consumed a ReadableStream, we must now use the consumed text as body
  // (the original stream is exhausted)
  const consumedBody = init && (init as any).__ironGateConsumedBody;
  if (consumedBody && init) {
    init = { ...init, body: consumedBody };
    delete (init as any).__ironGateConsumedBody;
  }

  if (!bodyString || bodyString.length < 50) {
    return originalFetch.call(window, input, init);
  }

  // ChatGPT-specific diagnostic — ALWAYS log (not limited to first 15 calls)
  if (url.includes('chatgpt.com') || url.includes('chat.openai.com') || url.includes('/backend-api/') || url.includes('/conversation')) {
    igLog(`ChatGPT fetch: ${method} ${url.substring(0, 80)} — body: ${bodyString.length} chars, bodyType: ${init?.body?.constructor?.name || 'unknown'}`);
  }

  igLog(`LLM request intercepted — mode: ${mode}, url: ${url.substring(0, 80)}, body: ${bodyString.length} chars`);

  // ════════════════════════════════════════════════════════════════════════
  // DIAGNOSTIC: Always-on logging — shows exactly what hits the LLM wire
  // Check Chrome DevTools Console for these [Iron Gate WIRE] messages.
  // ════════════════════════════════════════════════════════════════════════
  igLog(`LLM fetch intercepted — Mode: ${mode}, URL: ${url.substring(0, 80)}, Adapter: ${activeAdapter?.name || 'none'}, Body: ${bodyString.length} chars`);
  // ════════════════════════════════════════════════════════════════════════

  // Diagnostic: log metadata for debugging (no raw body content)
  if (url.includes('gemini') || url.includes('googleapis')) {
    igLog(`Gemini fetch: body ${bodyString.length} chars`);
  }
  if (url.includes('copilot') || url.includes('bing') || url.includes('sydney')) {
    igLog(`Copilot fetch: body ${bodyString.length} chars, input: ${input instanceof Request ? 'Request' : typeof input}, init: ${init ? 'yes' : 'no'}`);
  }

  // ── Skip fetch BODY modification for platforms where DOM/WS handles request ──
  // Gemini: DOM pre-submit handles pseudonymization; batchexecute body is opaque
  // Copilot: SignalR WS handles pseudonymization via WebSocket.prototype.send
  //
  // BUT we still need to:
  //   1. Run the file upload gate (block dangerous documents)
  //   2. Wrap the RESPONSE for de-pseudonymization (the LLM response contains
  //      pseudonyms from the dom-presubmit'd request — replace them in the stream
  //      so the framework renders de-pseudonymized text without flicker)
  if (shouldSkipFetchProxy(url, activeAdapter)) {
    // File upload gate — must run even for skipped adapters
    if (mode === 'proxy') {
      const skipGateDecision = await checkFileUploadGate();
      if (skipGateDecision === 'block') {
        igLog('File upload gate BLOCKED (skipFetchProxy adapter)');
        return new Response(JSON.stringify({ blocked: true, reason: 'Document sensitivity gate' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const skipResponse = await originalFetch.call(window, input, init);

    // Wrap response for de-pseudonymization if reverse map has entries
    // BUT skip if adapter opts out of stream wrapping (annotation-offset safety)
    if (mode === 'proxy' && Object.keys(currentReverseMap).length > 0 && !activeAdapter?.skipResponseStreamWrap) {
      igLog(`De-pseudonymizing response for skipFetchProxy adapter (${Object.keys(currentReverseMap).length} mappings)`);
      return depseudonymizeResponse(skipResponse, { ...currentReverseMap });
    }

    return skipResponse;
  }

  // ── File Upload Gate — block send if a high-risk document was uploaded ────
  const fileGateDecision = await checkFileUploadGate();
  if (fileGateDecision === 'block') {
    igLog('File upload gate BLOCKED — returning empty response');
    return new Response(JSON.stringify({ blocked: true, reason: 'Document sensitivity gate' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── PROXY MODE: Pseudonymize before sending ──────────────────────────────
  if (mode === 'proxy') {
    // DOM pre-submit adapters (e.g., Gemini) handle pseudonymization by
    // writing to the input BEFORE submit. The platform then builds the request
    // with the already-pseudonymized text. Modifying the fetch body on top of
    // that causes double-pseudonymization.
    // → Skip fetch-level body modification for dom-presubmit adapters.
    // Note: ChatGPT uses 'wire' interception (fetch body modification) to
    // prevent flicker — user message bubble shows original text from React state.
    if (activeAdapter?.interception === 'dom-presubmit') {
      igLog('DOM pre-submit adapter — skipping fetch body modification (DOM layer handles proxy)');
      return originalFetch.call(window, input, init);
    }

    // Prevent double pseudonymization: if this body was already proxied
    // (e.g., ChatGPT sends /prepare then /conversation with same data),
    // skip the second interception.
    const PROXY_MARKER = 'enterprise privacy tool';
    if (bodyString.includes(PROXY_MARKER)) {
      igLog('Body already contains proxy marker — skipping double pseudonymization');
      return originalFetch.call(window, input, init);
    }

    try {
      // Adapter-first extraction: use the active adapter's platform-specific
      // parser, falling back to the generic multi-format extractor.
      const promptText = activeAdapter?.extractPrompt(bodyString) ?? extractPrompt(bodyString);

      if (!promptText || promptText.length < 10) {
        igLog(`extractPrompt returned ${promptText === null ? 'null' : `${promptText?.length} chars`} — body: ${bodyString.length} chars`);
      }

      if (promptText && promptText.length >= 10) {
        // Detect entities
        const regexEntities = detectWithRegex(promptText);
        const secrets = scanForSecrets(promptText);
        const allEntities = [...regexEntities, ...secrets];

        igLog(`Detected ${allEntities.length} entities in prompt (${promptText.length} chars)`);

        if (allEntities.length > 0) {
          const { level, score } = quickScore(allEntities);
          const pseudoResult = pseudonymizeLocal(promptText, allEntities);

          // ── Executive Lens: determine routing ──
          const lensRoute = executiveLensRoute(promptText, allEntities);
          const effectiveRoute = (lensRoute.route === 'private_llm' && _privateLlmEndpoint)
            ? 'private_llm' : 'pseudonymize';
          if (lensRoute.industry || lensRoute.route !== 'pseudonymize') {
            console.log(
              `%c[Iron Gate LENS] ${lensRoute.explanation}`,
              'color: #a855f7; font-weight: bold',
              effectiveRoute === 'private_llm'
                ? `→ Routing to private LLM (${_privateLlmEndpoint})`
                : lensRoute.route === 'private_llm'
                  ? '→ Private LLM not configured, falling back to pseudonymize'
                  : '',
            );
          }

          // Build reverse map for de-pseudonymization (ACCUMULATE, don't replace)
          // This ensures multi-turn conversations can de-pseudonymize across requests
          for (const m of pseudoResult.mappings) {
            addReverseMapping(currentReverseMap, m.pseudonym, m.original, m.type);
          }
          // Log the full reverse map for diagnostics
          const mapEntries = Object.entries(currentReverseMap);
          igLog(`Reverse map: ${mapEntries.length} entries`);
          // Save a snapshot for this request's response de-pseudonymization
          const requestReverseMap = { ...currentReverseMap };

          // ── Private LLM Routing ──
          // When Executive Lens routes to private_llm and an endpoint is configured,
          // send the pseudonymized prompt to the on-premise LLM instead of the AI tool.
          // The response is de-pseudonymized and injected as if the AI tool responded.
          if (effectiveRoute === 'private_llm' && _privateLlmEndpoint) {
            igLog(`PRIVATE LLM: Routing pseudonymized prompt to ${_privateLlmEndpoint}`);

            // Notify content script about the interception
            const _ph = await igHash(promptText);
            const _me = await minimizeEntitiesForTransit(allEntities);
            igPostMessage({
              type: 'IRON_GATE_INTERCEPTED',
              promptHash: _ph,
              promptLength: promptText.length,
              maskedPrompt: pseudoResult.maskedText,
              mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
              entityCount: allEntities.length,
              level,
              score,
              entities: _me,
              executiveRoute: 'private_llm',
              executiveIndustry: lensRoute.industry,
            });

            try {
              // Build OpenAI-compatible request for private LLM (Ollama, vLLM, etc.)
              const privateLlmBody = JSON.stringify({
                model: _privateLlmModel || 'llama3.2:3b',
                messages: [
                  { role: 'system', content: 'You are a helpful assistant. The user\'s message may contain pseudonymized names and values for privacy. Respond naturally.' },
                  { role: 'user', content: pseudoResult.maskedText },
                ],
                stream: false,
              });

              const privateLlmResponse = await originalFetch.call(window, `${_privateLlmEndpoint}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: privateLlmBody,
              });

              if (!privateLlmResponse.ok) {
                console.warn(`[Iron Gate LENS] Private LLM returned ${privateLlmResponse.status} — falling back to cloud pseudonymized`);
                // Fall through to normal pseudonymized cloud path below
              } else {
                const privateLlmData = await privateLlmResponse.json() as any;
                let responseText = privateLlmData?.choices?.[0]?.message?.content
                  || privateLlmData?.message?.content  // Ollama format
                  || '';

                // De-pseudonymize the private LLM response
                responseText = replacePseudonyms(responseText, requestReverseMap);

                console.log(
                  `%c[Iron Gate LENS] Private LLM response received and de-pseudonymized`,
                  'color: #22c55e; font-weight: bold',
                  `(${responseText.length} chars)`,
                );

                // Return a synthetic response that the AI tool's frontend can consume.
                // This is SSE-formatted for ChatGPT compatibility.
                const syntheticSSE = `data: ${JSON.stringify({
                  id: 'ig-private-llm',
                  object: 'chat.completion.chunk',
                  choices: [{ index: 0, delta: { content: responseText }, finish_reason: 'stop' }],
                })}\n\ndata: [DONE]\n\n`;

                return new Response(syntheticSSE, {
                  status: 200,
                  headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                  },
                });
              }
            } catch (privateLlmErr) {
              console.warn('[Iron Gate LENS] Private LLM request failed:', privateLlmErr, '— falling back to cloud pseudonymized');
              // Fall through to normal pseudonymized cloud path
            }
          }

          // Replace prompt in request body.
          // For ChatGPT: inject notice as a SYSTEM message (invisible in UI)
          // so the notice never appears in the user's prompt bubble.
          // For other tools: prepend notice to user message text.
          let modifiedBody: string | null = null;
          const isChatGPT = url.includes('/backend-api/conversation') || (url.includes('/backend-anon/') && url.includes('/conversation'));

          if (isChatGPT) {
            try {
              const parsed = JSON.parse(bodyString);
              if (parsed?.messages && Array.isArray(parsed.messages)) {
                // Replace only the text parts in the last user message — preserve
                // non-string parts (file references, image pointers, etc.)
                // which ChatGPT's backend requires for file-attached messages.
                //
                // The pseudonymized text replaces the user's original text directly.
                // No de-identification notice is prepended — realistic fakes don't
                // need it, and the notice would show in the user's chat bubble.
                const lastIdx = parsed.messages.length - 1;
                const parts = parsed.messages[lastIdx]?.content?.parts;
                if (Array.isArray(parts)) {
                  let textReplaced = false;
                  for (let i = 0; i < parts.length; i++) {
                    if (typeof parts[i] === 'string') {
                      parts[i] = textReplaced ? '' : pseudoResult.maskedText;
                      textReplaced = true;
                    }
                  }
                  if (!textReplaced) {
                    parts.unshift(pseudoResult.maskedText);
                  }
                }
                modifiedBody = JSON.stringify(parsed);
                igLog('ChatGPT: replaced text parts with pseudonymized version (preserved file refs)');
              }
            } catch (e) {
              igLog('ChatGPT JSON parse failed, falling back to string replacement:', e);
            }
          }

          // Fallback for non-ChatGPT sites, or if ChatGPT JSON parsing failed
          if (!modifiedBody) {
            const maskedText = pseudoResult.maskedText;
            const _escapedOrig = jsonStringEscape(promptText);
            const _escapedRepl = jsonStringEscape(maskedText);
            if (bodyString.includes(_escapedOrig)) {
              modifiedBody = bodyString.split(_escapedOrig).join(_escapedRepl);
              igLog('Used direct string replacement (preserves exact body format)');
            } else if (bodyString.includes(promptText)) {
              modifiedBody = bodyString.split(promptText).join(maskedText);
              igLog('Used raw string replacement');
            } else {
              // Adapter-first replacement, then generic fallback
              modifiedBody = activeAdapter?.replacePrompt(bodyString, promptText, maskedText) ?? replacePrompt(bodyString, promptText, maskedText);
              igLog(`Used ${activeAdapter ? 'adapter' : 'generic'} replacePrompt fallback`);
            }
          }

          if (modifiedBody) {
            // ════════════════════════════════════════════════════════════
            // DIAGNOSTIC: THE TRUTH — what actually goes to the LLM
            // ════════════════════════════════════════════════════════════
            const _finalPromptForDiag = activeAdapter?.extractPrompt(modifiedBody) ?? '(could not re-extract)';
            console.log(
              `%c[Iron Gate WIRE] PROXY ACTIVE — request modified`,
              'color: #00cc00; font-weight: bold; font-size: 13px',
              `\n\n  📊 Stats: ${allEntities.length} entities pseudonymized, score=${score}, level=${level}`,
              `\n  📤 Original: ${promptText.length} chars`,
              `\n  🔒 Pseudonymized: ${pseudoResult.maskedText.length} chars`,
              `\n  🔄 ${pseudoResult.mappings.length} mappings applied`,
            );
            // ════════════════════════════════════════════════════════════

            igLog(`PROXY: Pseudonymized ${allEntities.length} entities (${level}, score=${score}). Types: ${allEntities.map(e => e.type).join(', ')}`);

            // Notify content script (for sidepanel display AND backend event)
            // SECURITY: hash prompt and entity text before postMessage — no raw PII leaves via postMessage
            const _ph = await igHash(promptText);
            const _me = await minimizeEntitiesForTransit(allEntities);
            igPostMessage({
              type: 'IRON_GATE_INTERCEPTED',
              promptHash: _ph,
              promptLength: promptText.length,
              // SECURITY: raw prompt removed from postMessage — any page script can listen.
              maskedPrompt: pseudoResult.maskedText,
              mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
              entityCount: allEntities.length,
              level,
              score,
              entities: _me,
            });

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
              console.error(
                '%c[Iron Gate WIRE] ❌ Modified request FAILED — BLOCKING to protect sensitive data',
                'color: #ef4444; font-weight: bold; font-size: 13px',
                '\nError:', fetchErr
              );
              // Fail CLOSED: never send raw PII to the AI tool on proxy failure
              return new Response(JSON.stringify({ error: 'Iron Gate: request blocked due to proxy failure. Your sensitive data was NOT sent.' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
              });
            }

            // Always-visible response status
            console.log(
              `%c[Iron Gate WIRE] Response: ${modifiedResponse.status} ${modifiedResponse.statusText}`,
              modifiedResponse.ok ? 'color: #22c55e' : 'color: #ef4444; font-weight: bold',
              `(${url.substring(0, 60)})`
            );

            // If ChatGPT rejected the modified body (4xx or 5xx), retry with
            // a simple string replacement as fallback.
            if (!modifiedResponse.ok && isChatGPT && modifiedResponse.status >= 400) {
              console.warn(`[Iron Gate MAIN] ChatGPT rejected modified body (${modifiedResponse.status}) — retrying with simple replacement`);
              try {
                const fallbackMasked = pseudoResult.maskedText;
                const _eo = jsonStringEscape(promptText);
                const _er = jsonStringEscape(fallbackMasked);
                let fallbackBody: string | null = null;
                if (bodyString.includes(_eo)) {
                  fallbackBody = bodyString.split(_eo).join(_er);
                } else {
                  fallbackBody = replacePrompt(bodyString, promptText, fallbackMasked);
                }
                if (fallbackBody && init) {
                  modifiedResponse = await originalFetch.call(window, input, { ...init, body: fallbackBody });
                  igLog(`Fallback response: ${modifiedResponse.status}`);
                }
              } catch (retryErr) {
                console.warn('[Iron Gate MAIN] Fallback retry also failed:', retryErr);
              }
            }
            if (!modifiedResponse.ok && modifiedResponse.status >= 500) {
              console.warn(`[Iron Gate MAIN] ⚠️ Modified request got ${modifiedResponse.status} — BLOCKING to protect sensitive data`);
              // Fail CLOSED: never send raw PII on server error
              return new Response(JSON.stringify({ error: 'Iron Gate: request blocked due to server error. Your sensitive data was NOT sent.' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            if (!modifiedResponse.ok) {
              console.warn(`[Iron Gate MAIN] ⚠️ Modified request got ${modifiedResponse.status} — tool backend may have rejected the modified body`);
            }

            // De-pseudonymize the response stream (use snapshot, not mutable global)
            // Skip for tools with non-standard streaming (SSE, protobuf, nested JSON)
            // AND for adapters that set skipResponseStreamWrap (e.g. ChatGPT whose SSE
            // includes displayedContentReferences with char-offset annotations —
            // length-changing replacements corrupt these offsets, garbling the render).
            // DOM MutationObserver handles de-pseudonymization for these tools instead.
            const skipStreamWrap = shouldSkipFetchProxy(url, activeAdapter) || !!activeAdapter?.skipResponseStreamWrap;
            if (Object.keys(requestReverseMap).length > 0 && !skipStreamWrap) {
              igLog(`De-pseudonymizing response with ${Object.keys(requestReverseMap).length} mappings`);
              return depseudonymizeResponse(modifiedResponse, requestReverseMap);
            }
            if (skipStreamWrap && Object.keys(requestReverseMap).length > 0) {
              igLog(`Skipping response stream wrap (adapter: ${activeAdapter?.id || 'none'}) — DOM observer will de-pseudonymize`);
            }

            return modifiedResponse;
          } else {
            console.warn('[Iron Gate MAIN] replacePrompt returned null — body format not recognized');
          }
        } else {
          igLog(`PROXY MODE — no entities found in prompt, sending original text`);
        }
      } else {
        igLog(`PROXY MODE — no prompt extracted from body (${bodyString.length} chars), passing through`);
      }
    } catch (err) {
      console.warn('[Iron Gate MAIN] Proxy intercept error, sending original:', err);
    }
  }

  // ── AUDIT MODE: Detect and score but don't modify ────────────────────────
  // IMPORTANT: Run analysis ASYNC (fire-and-forget) so the fetch is NOT delayed.
  // The original request is returned immediately; entity detection + reporting
  // happens in the background.
  if (mode === 'audit') {
    console.log(`%c[Iron Gate WIRE] 👁️ AUDIT MODE — request passes through UNMODIFIED (original text goes to LLM)`, 'color: #6699ff; font-weight: bold');
    const _auditBody = bodyString;
    (async () => {
      try {
        const promptText = activeAdapter?.extractPrompt(_auditBody) ?? extractPrompt(_auditBody);
        if (promptText && promptText.length >= 10) {
          const regexEntities = detectWithRegex(promptText);
          const secrets = scanForSecrets(promptText);
          const allEntities = [...regexEntities, ...secrets];

          if (allEntities.length > 0) {
            const { level, score } = quickScore(allEntities);

            igLog(`AUDIT: Detected ${allEntities.length} entities (${level}, score=${score}). Types: ${allEntities.map(e => e.type).join(', ')}`);

            const _aph = await igHash(promptText);
            const _ame = await minimizeEntitiesForTransit(allEntities);
            igPostMessage({
              type: 'IRON_GATE_AUDIT',
              promptHash: _aph,
              promptLength: promptText.length,
              // SECURITY: raw prompt removed from postMessage — any page script can listen.
              maskedPrompt: '', // Don't pseudonymize in audit — unnecessary overhead
              mappings: [],
              entityCount: allEntities.length,
              level,
              score,
              entities: _ame,
            });
          }
        }
      } catch {
        // Don't break anything
      }
    })();
  }

  // Pass through to original fetch — no delay
  return originalFetch.call(window, input, init);
}

// ── Install fetch patch via Object.defineProperty (resilient against non-writable) ──
const _fetchDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
igLog('fetch descriptor before patch:', JSON.stringify({
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
  igLog('✅ Fetch patched via Object.defineProperty');
} catch (defineErr) {
  console.warn('[Iron Gate MAIN] Object.defineProperty failed, trying direct assignment:', defineErr);
  try {
    (window as any).fetch = patchedFetch;
    igLog('✅ Fetch patched via direct assignment (fallback)');
  } catch (assignErr) {
    console.error('[Iron Gate MAIN] ❌ ALL FETCH PATCH METHODS FAILED:', assignErr);
  }
}

// Verify the patch took effect
if (window.fetch === patchedFetch) {
  igLog('✅ VERIFIED: window.fetch === patchedFetch');
  (window as any).__IRON_GATE_FETCH_PATCHED = true;
  (window as any).__IRON_GATE_MAIN_WORLD = 'active';
} else {
  console.error('[Iron Gate MAIN] ❌ CRITICAL: window.fetch is NOT patchedFetch. Interception WILL NOT WORK.');
  console.error('[Iron Gate MAIN] window.fetch toString:', String(window.fetch).substring(0, 200));
}

igLog('Fetch interceptor setup complete — mode:', mode);

// ─── Patch HTMLInputElement for file inputs ────────────────────────────────
// Some sites create <input type="file">, programmatically click(), and read
// the files without ever attaching the input to the DOM. This patch intercepts
// the 'files' getter on file inputs to detect file selection.
try {
  const origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function() {
    if (this.type === 'file') {
      const onFileChange = () => {
        this.removeEventListener('change', onFileChange);
        if (this.files && this.files.length > 0) {
          for (const file of Array.from(this.files)) {
            _readFileToBase64AndPost(file, 'input.click()');
          }
        }
      };
      this.addEventListener('change', onFileChange);
    }
    return origClick.call(this);
  };
  igLog('✅ HTMLInputElement.click patched for file detection');
} catch {
  igLog('HTMLInputElement.click patch failed (non-critical)');
}

// ─── Patch showOpenFilePicker (modern File System Access API) ─────────────
// ChatGPT and other modern apps may use window.showOpenFilePicker() instead
// of <input type="file"> for file selection. This API returns FileHandle objects.
if (typeof (window as any).showOpenFilePicker === 'function') {
  try {
    const origShowOpenFilePicker = (window as any).showOpenFilePicker;
    (window as any).showOpenFilePicker = async function(...args: any[]) {
      const handles = await origShowOpenFilePicker.apply(window, args);
      if (handles && Array.isArray(handles)) {
        for (const handle of handles) {
          try {
            const file = await handle.getFile();
            _readFileToBase64AndPost(file, 'showOpenFilePicker');
          } catch { /* ignore individual file errors */ }
        }
      }
      return handles;
    };
    igLog('✅ showOpenFilePicker patched for file detection');
  } catch {
    igLog('showOpenFilePicker patch failed (non-critical)');
  }
}

// ─── Patch FileReader (most robust file detection) ─────────────────────────
// ChatGPT and other platforms MUST read file content before uploading.
// By patching FileReader.prototype.readAs*, we catch files regardless of:
// - Whether the <input type="file"> is attached to the DOM
// - Whether the site captured native APIs before our script
// - Whether uploads use FormData, presigned URLs, or raw binary PUT
// This is the most reliable interception layer.
try {
  const _origReadAsDataURL = FileReader.prototype.readAsDataURL;
  const _origReadAsArrayBuffer = FileReader.prototype.readAsArrayBuffer;
  const _origReadAsBinaryString = FileReader.prototype.readAsBinaryString;
  const _origReadAsText = FileReader.prototype.readAsText;

  function _handleFileReaderBlob(blob: Blob, method: string): void {
    if (!(blob instanceof File)) return;
    _readFileToBase64AndPost(blob as File, `FileReader.${method}`);
  }

  FileReader.prototype.readAsDataURL = function(blob: Blob) {
    _handleFileReaderBlob(blob, 'readAsDataURL');
    return _origReadAsDataURL.call(this, blob);
  };

  FileReader.prototype.readAsArrayBuffer = function(blob: Blob) {
    _handleFileReaderBlob(blob, 'readAsArrayBuffer');
    return _origReadAsArrayBuffer.call(this, blob);
  };

  FileReader.prototype.readAsBinaryString = function(blob: Blob) {
    _handleFileReaderBlob(blob, 'readAsBinaryString');
    return _origReadAsBinaryString.call(this, blob);
  };

  FileReader.prototype.readAsText = function(blob: Blob, encoding?: string) {
    _handleFileReaderBlob(blob, 'readAsText');
    return _origReadAsText.call(this, blob, encoding as any);
  };

  igLog('✅ FileReader patched for file detection (readAsDataURL, readAsArrayBuffer, readAsBinaryString, readAsText)');
} catch {
  igLog('FileReader patch failed (non-critical)');
}

// ─── Patch Blob.prototype.arrayBuffer / File.prototype.arrayBuffer ────────
// Modern apps (ChatGPT) may skip FileReader entirely and use the async
// blob.arrayBuffer() or blob.text() APIs to read file content directly.
try {
  const _origBlobText = Blob.prototype.text;

  Blob.prototype.arrayBuffer = function() {
    if (this instanceof File) _readFileToBase64AndPost(this as File, 'Blob.arrayBuffer');
    return _pristineBlobArrayBuffer.call(this);
  };

  Blob.prototype.text = function() {
    if (this instanceof File) _readFileToBase64AndPost(this as File, 'Blob.text');
    return _origBlobText.call(this);
  };

  igLog('✅ Blob.arrayBuffer/text patched for file detection');
} catch {
  igLog('Blob.arrayBuffer/text patch failed (non-critical)');
}

// ─── Patch File.prototype.slice for chunked uploads ────────────────────────
// Some platforms (ChatGPT) slice files into chunks for resumable uploads.
// Detect when a File object is sliced, which indicates upload preparation.
try {
  const _origFileSlice = File.prototype.slice;

  File.prototype.slice = function(start?: number, end?: number, contentType?: string): Blob {
    _readFileToBase64AndPost(this, 'File.slice');
    return _origFileSlice.call(this, start, end, contentType);
  };

  igLog('✅ File.slice patched for chunked upload detection');
} catch {
  igLog('File.slice patch failed (non-critical)');
}

// ─── Document-level file input capture (capture phase) ─────────────────────
// Listen for 'change' events on the document in CAPTURE phase. This catches
// file input changes even when the input is in Shadow DOM or detached,
// as long as the event fires on the element (change events don't bubble from
// detached elements, but capture-phase on document catches attached ones early).
try {
  document.addEventListener('change', (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (!target || target.type !== 'file' || !target.files || target.files.length === 0) return;
    for (const file of Array.from(target.files)) {
      _readFileToBase64AndPost(file, 'document capture-phase change');
    }
  }, true); // ← capture phase
  igLog('✅ Document capture-phase change listener installed');
} catch {
  igLog('Document capture-phase change listener failed (non-critical)');
}

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
    igLog(`XHR POST: ${url.substring(0, 120)} | body: ${bodyType}`);
  }

  // ─── File Upload Detection in XHR (deferred to avoid blocking) ─────────
  if (body instanceof FormData) {
    setTimeout(() => detectFilesInFormData(body, url), 0);
  } else if (body instanceof File) {
    const fileRef = body;
    setTimeout(() => _readFileToBase64AndPost(fileRef, 'XHR body (File)'), 0);
  } else if (body && typeof body === 'string' && isFileUploadEndpoint(url)) {
    const bodySnapshot = body;
    setTimeout(() => detectFileMetadataInJson(bodySnapshot, url), 0);
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

  if (adapterIsLLMEndpoint(url, activeAdapter) && bodyStr && bodyStr.length >= 50) {
    igLog(`XHR intercepted — mode: ${mode}, url: ${url.substring(0, 80)}, body length: ${bodyStr.length}, originalType: ${body?.constructor?.name}`);

    // Skip XHR proxy for platforms where DOM/WS handles interception.
    // Adapter registry checks active adapter flags + cross-domain patterns.
    if (shouldSkipXhrProxy(url, activeAdapter)) {
      return originalXHRSend.call(this, body);
    }

    if (url.includes('gemini') || url.includes('googleapis')) {
      igLog(`XHR Gemini: body ${bodyStr.length} chars`);
    }

    if (mode === 'proxy') {
      try {
        const promptText = activeAdapter?.extractPrompt(bodyStr) ?? extractPrompt(bodyStr);
        if (promptText && promptText.length >= 10) {
          const regexEntities = detectWithRegex(promptText);
          const secrets = scanForSecrets(promptText);
          const allEntities = [...regexEntities, ...secrets];

          if (allEntities.length > 0) {
            const { level, score } = quickScore(allEntities);
            const pseudoResult = pseudonymizeLocal(promptText, allEntities);

            // Accumulate mappings (don't overwrite)
            for (const m of pseudoResult.mappings) {
              addReverseMapping(currentReverseMap, m.pseudonym, m.original, m.type);
            }
            const xhrReverseMap = { ...currentReverseMap };

            const modifiedBody = activeAdapter?.replacePrompt(bodyStr, promptText, pseudoResult.maskedText) ?? replacePrompt(bodyStr, promptText, pseudoResult.maskedText);
            if (modifiedBody) {
              igLog(`XHR PROXY: Pseudonymized ${allEntities.length} entities (${level}, score=${score}), masked: ${pseudoResult.maskedText.length} chars`);

              // SECURITY: hash before postMessage — fire-and-forget async
              Promise.all([igHash(promptText), minimizeEntitiesForTransit(allEntities)])
                .then(([ph, me]) => {
                  igPostMessage({
                    type: 'IRON_GATE_INTERCEPTED',
                    promptHash: ph,
                    promptLength: promptText.length,
                    maskedPrompt: pseudoResult.maskedText,
                    mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                    entityCount: allEntities.length,
                    level,
                    score,
                    entities: me,
                  });
                });

              // Patch the response to de-pseudonymize
              // SKIP for platforms where DOM observer handles de-pseudo
              const xhrSkipDePseudo = shouldSkipXhrProxy(url, activeAdapter);
              if (Object.keys(xhrReverseMap).length > 0 && !xhrSkipDePseudo) {
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
              } else if (xhrSkipDePseudo) {
                igLog('XHR: skipping responseText patch — DOM observer will handle');
              }

              return originalXHRSend.call(this, modifiedBody);
            }
          }
        }
      } catch (err) {
        console.warn('[Iron Gate MAIN] XHR proxy error — blocking to protect sensitive data:', err);
        // Fail CLOSED: do not send original body with PII
        return;
      }
    }

    // Audit mode logging for XHR
    if (mode === 'audit') {
      try {
        const promptText = activeAdapter?.extractPrompt(bodyStr) ?? extractPrompt(bodyStr);
        if (promptText && promptText.length >= 10) {
          const regexEntities = detectWithRegex(promptText);
          const secrets = scanForSecrets(promptText);
          const allEntities = [...regexEntities, ...secrets];
          if (allEntities.length > 0) {
            const { level, score } = quickScore(allEntities);
            const pseudoResult = pseudonymizeLocal(promptText, allEntities);
            igLog(`XHR AUDIT: ${allEntities.length} entities (${level}, score=${score})`);
            Promise.all([igHash(promptText), minimizeEntitiesForTransit(allEntities)])
              .then(([ph, me]) => {
                igPostMessage({
                  type: 'IRON_GATE_AUDIT',
                  promptHash: ph,
                  promptLength: promptText.length,
                  // SECURITY: raw prompt removed from postMessage — any page script can listen.
                  maskedPrompt: pseudoResult.maskedText,
                  mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                  entityCount: allEntities.length,
                  level,
                  score,
                  entities: me,
                });
              });
          }
        }
      } catch { /* don't break original */ }
    }
  }

  return originalXHRSend.call(this, body);
};

igLog('XHR interceptor installed');

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

// ── Copilot SignalR WebSocket.send interception layer ──────────────────────
// DOM text replacement doesn't work for Copilot because React's internal state
// overwrites DOM changes. Instead, we let Copilot submit normally and intercept
// the outgoing SignalR WebSocket frame to pseudonymize the text at wire level.
// We patch WebSocket.prototype.send (not individual instances) because modifying
// instance properties (send, addEventListener, onmessage) breaks SignalR.

let pendingCopilotPseudo: { original: string; maskedText: string } | null = null;
let pendingCopilotTimer: ReturnType<typeof setTimeout> | null = null;

function setPendingCopilotPseudo(pseudo: { original: string; maskedText: string }) {
  pendingCopilotPseudo = pseudo;
  if (pendingCopilotTimer) clearTimeout(pendingCopilotTimer);
  // 30s TTL — Copilot's SignalR can be slow (reconnects, Azure edge latency).
  // 10s was too short and caused pseudonymization to silently fail on slow connections.
  pendingCopilotTimer = setTimeout(() => {
    if (pendingCopilotPseudo === pseudo) {
      igLog('Copilot WS: Pending pseudo expired (30s timeout)');
      pendingCopilotPseudo = null;
    }
    pendingCopilotTimer = null;
  }, 30000);
}

function applyCopilotSignalRPseudo(data: string): string {
  if (!pendingCopilotPseudo) return data;
  const { original, maskedText } = pendingCopilotPseudo;

  // JSON-escape the text (strip wrapping quotes from JSON.stringify)
  const escapedOriginal = JSON.stringify(original).slice(1, -1);
  const escapedMasked = JSON.stringify(maskedText).slice(1, -1);

  // Try exact match first
  if (data.includes(escapedOriginal)) {
    igLog(`Copilot WS: Pseudonymized SignalR frame (exact match, ${original.length} chars)`);
    return data.split(escapedOriginal).join(escapedMasked);
  }

  // Fallback: normalized line breaks
  const normOriginal = original.replace(/\r\n/g, '\n').trim();
  const escapedNorm = JSON.stringify(normOriginal).slice(1, -1);
  if (escapedNorm !== escapedOriginal && data.includes(escapedNorm)) {
    const normMasked = maskedText.replace(/\r\n/g, '\n').trim();
    const escapedNormMasked = JSON.stringify(normMasked).slice(1, -1);
    igLog(`Copilot WS: Pseudonymized SignalR frame (normalized match)`);
    return data.split(escapedNorm).join(escapedNormMasked);
  }

  // Fallback 2: parse SignalR frames and walk arguments for entity-level detection
  const RS = '\x1e';
  const frames = data.split(RS);
  let modified = false;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i].trim();
    if (!frame) continue;
    try {
      const parsed = JSON.parse(frame);
      if (parsed?.type !== 1 || !Array.isArray(parsed?.arguments)) continue;
      const walked = _walkPseudoSignalR(parsed.arguments);
      if (walked.changed) {
        parsed.arguments = walked.value;
        frames[i] = JSON.stringify(parsed);
        modified = true;
      }
    } catch { continue; }
  }
  if (modified) {
    igLog(`Copilot WS: Pseudonymized SignalR frame (deep walk fallback)`);
    return frames.join(RS);
  }

  igLog(`Copilot WS: No match in SignalR frame (frame=${data.length}c, orig=${original.length}c)`);
  return data;
}

function _walkPseudoSignalR(obj: any): { value: any; changed: boolean } {
  if (typeof obj === 'string' && obj.length > 50) {
    const entities = detectWithRegex(obj);
    const secrets = scanForSecrets(obj);
    const all = [...entities, ...secrets];
    if (all.length > 0) {
      const result = pseudonymizeLocal(obj, all);
      if (result.maskedText !== obj) {
        for (const m of result.mappings) addReverseMapping(currentReverseMap, m.pseudonym, m.original, m.type);
        return { value: result.maskedText, changed: true };
      }
    }
    return { value: obj, changed: false };
  }
  if (Array.isArray(obj)) {
    let changed = false;
    const arr = obj.map(item => { const r = _walkPseudoSignalR(item); if (r.changed) changed = true; return r.value; });
    return { value: arr, changed };
  }
  if (obj && typeof obj === 'object') {
    let changed = false;
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) { const r = _walkPseudoSignalR(v); if (r.changed) changed = true; out[k] = r.value; }
    return { value: out, changed };
  }
  return { value: obj, changed: false };
}

// Patch WebSocket.prototype.send for Copilot SignalR pseudonymization.
const _origWsSend = OriginalWebSocket.prototype.send;
OriginalWebSocket.prototype.send = function(this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
  // File upload gate — block WS frames if a high-risk document was detected
  if (hasHighRiskFileScanSync() && activeAdapter?.isWsEndpoint?.(this.url)) {
    igLog('WS.prototype.send BLOCKED — high-risk document detected');
    return;
  }
  if (mode === 'proxy' && pendingCopilotPseudo &&
      activeAdapter?.id === 'copilot' && activeAdapter.isWsEndpoint?.(this.url)) {
    if (typeof data === 'string') {
      const modified = applyCopilotSignalRPseudo(data);
      if (modified !== data) {
        pendingCopilotPseudo = null;
        if (pendingCopilotTimer) { clearTimeout(pendingCopilotTimer); pendingCopilotTimer = null; }
        return _origWsSend.call(this, modified);
      }
    }
  }
  return _origWsSend.call(this, data);
};

const patchedWebSocket = function(this: WebSocket, url: string | URL, protocols?: string | string[]) {
  const urlStr = String(url);
  const ws = protocols
    ? new OriginalWebSocket(url, protocols)
    : new OriginalWebSocket(url);

  // Copilot/Bing use SignalR over WebSocket. We do NOT patch individual WS
  // instance properties (send, addEventListener, onmessage) — that breaks
  // SignalR's internal validation and causes Copilot to hang. Instead,
  // pseudonymization is handled by the WebSocket.prototype.send patch above,
  // which modifies the SignalR frame content without touching instance properties.
  // NOTE: Copilot WS used to return early here, skipping onmessage/addEventListener
  // patching. This meant OUTGOING pseudonymization worked (via prototype.send patch)
  // but INCOMING response de-pseudonymization was completely skipped.
  // Now we fall through to the standard WS patching below so that Copilot responses
  // also get de-pseudonymized via the onmessage/addEventListener wrappers.
  const isCopilotWS = activeAdapter?.id === 'copilot' && activeAdapter.isWsEndpoint?.(urlStr);
  if (isCopilotWS) {
    igLog(`WebSocket opened: ${urlStr.substring(0, 80)} — Copilot/Bing: prototype.send patch handles outgoing, falling through for response de-pseudo`);
    // Don't return — fall through to patch onmessage for de-pseudonymization
  }

  // Check if this WS endpoint belongs to an AI platform (active or any adapter)
  const isLLM = activeAdapter?.isWsEndpoint?.(urlStr) ||
    getAllAdapters().some(a => a.isWsEndpoint?.(urlStr));

  if (isLLM) {
    igLog(`WebSocket opened to LLM: ${urlStr.substring(0, 80)}`);

    // For Copilot, outgoing pseudonymization is handled by WebSocket.prototype.send
    // patch — do NOT also patch ws.send on the instance (would double-pseudonymize).
    // For all other platforms, patch ws.send on the instance.
    if (!isCopilotWS) {
    const originalSend = ws.send.bind(ws);
    ws.send = function(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      // File upload gate — block WS frames if a high-risk document was detected
      if (hasHighRiskFileScanSync()) {
        igLog('WS instance send BLOCKED — high-risk document detected');
        return;
      }
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
        igLog(`WS binary decoded → ${textLen} chars`);
      }

      // At this point, `data` is always a string (either originally or decoded)
      const strData = data as unknown as string;

      // Helper: re-encode string back to binary if it came in as binary
      function _sendResult(text: string) {
        return originalSend(_reEncodeBinary(text, wasBinary, originalBinaryFormat));
      }

      // ── WebSocket proxy for ChatGPT/Claude (binary WS frames) ──────────
      // Copilot/Bing connections are returned early (no WS instrumentation).
      // ChatGPT uses binary WS frames — try all extraction/replacement strategies.
      // The DOM pre-submit interceptor runs first; if it already pseudonymized the
      // text, this proxy won't find entities and passes through harmlessly.
      if (mode === 'proxy') {
        try {
          // Skip very short frames — Socket.IO heartbeats/acks (e.g. "2", "3", "40", "42")
          if (strData.length < 20 && /^\d{1,3}$/.test(strData.trim())) {
            return _sendResult(strData);
          }

          igLog(`WS PROXY: processing frame (${strData.length} chars, binary=${wasBinary}, url=${urlStr.substring(0,60)})`);


          // Try adapter-specific WS frame extraction first, then generic strategies
          let promptText = activeAdapter?.extractFromWsFrame?.(strData) ?? activeAdapter?.extractPrompt(strData) ?? extractPrompt(strData);
          let extractionMethod = promptText ? 'adapter-or-json' : 'none';

          // Strategy 2: JSON at offset (binary header before JSON body)
          if (!promptText && strData.length >= 50) {
            const jsonStart = strData.indexOf('{');
            const jsonArrayStart = strData.indexOf('[');
            const start = jsonStart >= 0 && jsonArrayStart >= 0
              ? Math.min(jsonStart, jsonArrayStart)
              : jsonStart >= 0 ? jsonStart : jsonArrayStart;

            if (start > 0 && start < 200) {
              const jsonPart = strData.substring(start);
              promptText = extractPrompt(jsonPart);
              if (promptText) {
                extractionMethod = `json-at-offset-${start}`;
                igLog(`WS: Found prompt in JSON at offset ${start} (${promptText.length} chars)`);
              }
            }
          }

          // Strategy 3: Look for prompt text in binary data using longest contiguous text runs
          // ChatGPT may use protobuf-like encoding where text fields are embedded in binary
          if (!promptText && strData.length >= 100) {
            // Find the longest run of printable ASCII characters (possible prompt text)
            const textRunRegex = /[\x20-\x7e\u00a0-\uffff]{50,}/g;
            let bestRun = '';
            let m: RegExpExecArray | null;
            while ((m = textRunRegex.exec(strData)) !== null) {
              if (m[0].length > bestRun.length) bestRun = m[0];
            }
            if (bestRun.length >= 50) {
              // Try to extract a prompt from this text run
              promptText = extractPrompt(bestRun);
              if (!promptText && bestRun.length >= 100) {
                // The text run itself might BE the prompt (no JSON wrapping)
                promptText = bestRun;
              }
              if (promptText) {
                extractionMethod = 'text-run';
                igLog(`WS: Found prompt via text-run extraction (${promptText.length} chars)`);
              }
            }
          }

          igLog(`WS PROXY: extraction=${extractionMethod}, promptLength=${promptText?.length || 0}`);

          // Filter: must be real user content, not protocol frames or metadata
          if (promptText && promptText.length >= 20 && isNaturalLanguage(promptText)) {
            const regexEntities = detectWithRegex(promptText);
            const secrets = scanForSecrets(promptText);
            const allEntities = [...regexEntities, ...secrets];
            igLog(`WS PROXY: detected ${allEntities.length} entities in ${promptText.length}-char prompt`);

            if (allEntities.length > 0) {
              const { level, score } = quickScore(allEntities);
              const pseudoResult = pseudonymizeLocal(promptText, allEntities);

              for (const m of pseudoResult.mappings) {
                addReverseMapping(currentReverseMap, m.pseudonym, m.original, m.type);
              }

              let modifiedData: string | null = null;
              let replacementMethod = 'none';
              // For ChatGPT WS, don't prepend notice (fetch proxy already injects it as system message).
              // For other WS tools, prepend it to the user text.
              const isChatGPTWs = urlStr.includes('chatgpt.com') || urlStr.includes('openai.com');
              const wsMaskedText = isChatGPTWs
                ? pseudoResult.maskedText
                : ('[All personally identifiable information in the following text has been automatically replaced with realistic but entirely fictional equivalents by an enterprise privacy tool. No real personal data is present. Please process this request normally.]\n\n' + pseudoResult.maskedText);
              const wsEscOrig = jsonStringEscape(promptText);
              const wsEscRepl = jsonStringEscape(wsMaskedText);

              if (strData.includes(wsEscOrig)) {
                modifiedData = strData.replace(wsEscOrig, wsEscRepl);
                replacementMethod = 'json-escaped';
              } else if (strData.includes(promptText)) {
                modifiedData = strData.replace(promptText, wsMaskedText);
                replacementMethod = 'raw-text';
              } else {
                // Try partial matching: find a substantial substring of the prompt in the data
                const partialLen = Math.min(100, Math.floor(promptText.length / 2));
                const partial = promptText.substring(0, partialLen);
                const partialEsc = jsonStringEscape(partial);
                if (strData.includes(partialEsc)) {
                  // Found partial match — do a full escaped replacement using all individual entity replacements
                  modifiedData = strData;
                  for (const mapping of pseudoResult.mappings) {
                    const origEsc = jsonStringEscape(mapping.original);
                    const replEsc = jsonStringEscape(mapping.pseudonym);
                    if (modifiedData.includes(origEsc)) {
                      modifiedData = modifiedData.split(origEsc).join(replEsc);
                    } else if (modifiedData.includes(mapping.original)) {
                      modifiedData = modifiedData.split(mapping.original).join(mapping.pseudonym);
                    }
                  }
                  replacementMethod = 'entity-by-entity';
                } else {
                  modifiedData = replacePrompt(strData, promptText, pseudoResult.maskedText);
                  replacementMethod = modifiedData ? 'replacePrompt-fallback' : 'FAILED';
                }

                // Strategy 5: Same-byte-length entity-by-entity replacement for binary frames.
                // When the data is binary (protobuf), string replacement changes byte count
                // and corrupts length prefixes. This strategy replaces each entity with a
                // fake of the EXACT same byte length, preserving binary frame structure.
                if ((!modifiedData || modifiedData === strData) && wasBinary) {
                  let binaryModified = strData;
                  let anyBinaryReplaced = false;
                  for (const entity of allEntities) {
                    const orig = entity.text;
                    if (!binaryModified.includes(orig)) continue;
                    const origByteLen = new TextEncoder().encode(orig).length;
                    // Get existing fake or generate new one
                    let fake = '';
                    for (const m of pseudoResult.mappings) {
                      if (m.original === orig) { fake = m.pseudonym; break; }
                    }
                    if (!fake) continue;
                    // Pad or truncate fake to exact same byte length
                    let fakeBytes = new TextEncoder().encode(fake);
                    if (fakeBytes.length < origByteLen) {
                      fake = fake + ' '.repeat(origByteLen - fakeBytes.length);
                    } else if (fakeBytes.length > origByteLen) {
                      while (new TextEncoder().encode(fake).length > origByteLen && fake.length > 0) {
                        fake = fake.substring(0, fake.length - 1);
                      }
                      // Pad if we overshot
                      while (new TextEncoder().encode(fake).length < origByteLen) {
                        fake = fake + ' ';
                      }
                    }
                    binaryModified = binaryModified.split(orig).join(fake);
                    addReverseMapping(currentReverseMap, fake.trim(), orig);
                    anyBinaryReplaced = true;
                  }
                  if (anyBinaryReplaced) {
                    modifiedData = binaryModified;
                    replacementMethod = 'same-byte-length';
                  }
                }
              }

              igLog(`WS PROXY: replacement=${replacementMethod}, modified=${!!modifiedData && modifiedData !== strData}, origLen=${strData.length}, newLen=${modifiedData?.length || 0}`);

              if (modifiedData && modifiedData !== strData) {
                igLog(`WS PROXY: Pseudonymized ${allEntities.length} entities (${level}, score=${score}), masked: ${pseudoResult.maskedText.length} chars`);

                Promise.all([igHash(promptText), minimizeEntitiesForTransit(allEntities)])
                  .then(([ph, me]) => {
                    igPostMessage({
                      type: 'IRON_GATE_INTERCEPTED',
                      promptHash: ph,
                      promptLength: promptText.length,
                      maskedPrompt: pseudoResult.maskedText,
                      mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                      entityCount: allEntities.length,
                      level,
                      score,
                      entities: me,
                    });
                  });

                return _sendResult(modifiedData);
              } else {
                console.warn(`[Iron Gate MAIN] WS PROXY: replacement FAILED — blocking to protect sensitive data. method=${replacementMethod}`);
                // Still report the detection even though we're blocking
                Promise.all([igHash(promptText), minimizeEntitiesForTransit(allEntities)])
                  .then(([ph, me]) => {
                    igPostMessage({
                      type: 'IRON_GATE_AUDIT',
                      promptHash: ph,
                      promptLength: promptText.length,
                      maskedPrompt: pseudoResult.maskedText,
                      mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                      entityCount: allEntities.length,
                      level,
                      score,
                      entities: me,
                    });
                  });
                // Fail CLOSED: do not send original frame with PII
                return;
              }
            }
          } else if (strData.length >= 100) {
            igLog(`WS PROXY: no prompt extracted from ${strData.length}-char frame`);
          }
        } catch (err) {
          console.warn('[Iron Gate MAIN] WS proxy error:', err);
        }
      }

      // ── Audit mode: detect and report WITHOUT modifying ──────────────────
      // Copilot/Bing WS connections are skipped (returned early above).
      if (mode === 'audit') {
        try {
          // Skip very short frames — Socket.IO heartbeats/acks
          if (strData.length < 20 && /^\d{1,3}$/.test(strData.trim())) {
            return _sendResult(strData);
          }
          // Adapter-first WS extraction, then generic + offset fallbacks
          let promptText = activeAdapter?.extractFromWsFrame?.(strData) ?? activeAdapter?.extractPrompt(strData) ?? extractPrompt(strData);
          // Try JSON-offset extraction for binary-framed WebSocket data
          if (!promptText && strData.length >= 50) {
            const jsonStart = strData.indexOf('{');
            const jsonArrayStart = strData.indexOf('[');
            const start = jsonStart >= 0 && jsonArrayStart >= 0
              ? Math.min(jsonStart, jsonArrayStart)
              : jsonStart >= 0 ? jsonStart : jsonArrayStart;
            if (start > 0 && start < 100) {
              promptText = extractPrompt(strData.substring(start));
            }
          }
          // Filter: must be real user content, not protocol frames or metadata
          if (promptText && promptText.length >= 20 && isNaturalLanguage(promptText)) {
            const regexEntities = detectWithRegex(promptText);
            const secrets = scanForSecrets(promptText);
            const allEntities = [...regexEntities, ...secrets];
            if (allEntities.length > 0) {
              const { level, score } = quickScore(allEntities);
              const pseudoResult = pseudonymizeLocal(promptText, allEntities);
              igLog(`WS AUDIT: ${allEntities.length} entities (${level}, score=${score})`);
              Promise.all([igHash(promptText), minimizeEntitiesForTransit(allEntities)])
                .then(([ph, me]) => {
                  igPostMessage({
                    type: 'IRON_GATE_AUDIT',
                    promptHash: ph,
                    promptLength: promptText.length,
                    // SECURITY: raw prompt removed from postMessage — any page script can listen.
                    maskedPrompt: pseudoResult.maskedText,
                    mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                    entityCount: allEntities.length,
                    level,
                    score,
                    entities: me,
                  });
                });
            }
          }
        } catch { /* don't break */ }
      }

      return _sendResult(strData);
    };
    } // end if (!isCopilotWS) — skip instance send patch for Copilot

    // Response de-pseudonymization via addEventListener
    // Copilot WS connections now fall through here for response de-pseudo
    let _wsRcvCount = 0;
    let _wsRcvReplaced = 0;
    const originalAddEventListener = ws.addEventListener.bind(ws);
    ws.addEventListener = function(type: string, listener: any, options?: any) {
      if (type === 'message') {
        const wrappedListener = function(event: MessageEvent) {
          if (Object.keys(currentReverseMap).length === 0) {
            listener.call(ws, event);
            return;
          }

          _wsRcvCount++;
          if (_wsRcvCount <= 5 || _wsRcvCount % 100 === 0) {
            igLog(`WS recv #${_wsRcvCount}: type=${typeof event.data}, size=${typeof event.data === 'string' ? event.data.length : (event.data?.byteLength ?? '?')}, reverseMapSize=${Object.keys(currentReverseMap).length}`);
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
            // IMPORTANT: Skip de-pseudonymization for BINARY WS frames.
            // Binary frames (protobuf) have length-prefixed fields — changing string
            // lengths corrupts the frame and causes garbled rendering (e.g., "m")").
            // The DOM observer handles de-pseudonymization for binary protocols.
            if (responseBinary) {
              _wsRcvCount % 200 === 1 && igLog(`WS recv: skipping binary de-pseudo (${textData.length} chars) — DOM observer will handle`);
              listener.call(ws, event);
              return;
            }

            // For SignalR (Copilot), process each frame separately to ensure
            // JSON-escaped pseudonyms within individual frames are properly handled.
            // SignalR frames are separated by \x1e (record separator).
            let resultData: string;
            if (textData.includes('\x1e')) {
              const frames = textData.split('\x1e');
              const processedFrames = frames.map(f =>
                f.length > 5 ? replacePseudonyms(f, currentReverseMap) : f
              );
              resultData = processedFrames.join('\x1e');
            } else {
              resultData = replacePseudonyms(textData, currentReverseMap);
            }

            if (resultData !== textData) {
              _wsRcvReplaced++;
              if (_wsRcvReplaced <= 10) {
                igLog(`WS recv de-pseudo: REPLACED in msg #${_wsRcvCount} (${_wsRcvReplaced} total replacements)`);
              }
              const newEvent = new MessageEvent('message', {
                data: resultData,
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
    // Always patch — the handler checks currentReverseMap at message-receive time.
    {
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
              // Skip binary frame de-pseudo — protobuf length corruption causes garbled text
              if (respBinary) {
                handler.call(ws, event);
                return;
              }

              // SignalR frame-by-frame de-pseudo (same logic as addEventListener handler)
              let resultData: string;
              if (textData.includes('\x1e')) {
                const frames = textData.split('\x1e');
                const processedFrames = frames.map(f =>
                  f.length > 5 ? replacePseudonyms(f, currentReverseMap) : f
                );
                resultData = processedFrames.join('\x1e');
              } else {
                resultData = replacePseudonyms(textData, currentReverseMap);
              }
              if (resultData !== textData) {
                igLog(`WS onmessage de-pseudo: REPLACED`);
                const newEvent = new MessageEvent('message', {
                  data: resultData,
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

igLog('WebSocket interceptor installed');
(window as any).__IRON_GATE_WS_PATCHED = true;

// ─── Unified DOM Pre-Submit Interceptor ──────────────────────────────────────
// Replaces the per-platform (ChatGPT, Copilot, Gemini) DOM interceptors with
// a single adapter-dispatched system. The adapter provides:
//   findInput(), readInput(), writeInput(), findSubmitButton()
// The interception strategy determines behavior:
//   'dom-presubmit'    → preventDefault, write pseudo text, re-submit
//   'dom-capture-wire' → queue pseudo for WS.prototype.send, let submit propagate

if (activeAdapter && (activeAdapter.interception === 'dom-presubmit' || activeAdapter.interception === 'dom-capture-wire')) {
  const adapterName = activeAdapter.name;
  const isDomPresubmit = activeAdapter.interception === 'dom-presubmit';
  const isDomCaptureWire = activeAdapter.interception === 'dom-capture-wire';

  igLog(`${adapterName} DOM ${isDomPresubmit ? 'pre-submit' : 'capture-wire'} interceptor initializing`);

  let domInterceptBusy = false;

  // Track the last pseudonymized output to prevent double-pseudonymization.
  // When we write pseudo text to the input, the platform or a re-submit may
  // re-read it — without this guard, percentages like "22%" get double-shifted
  // (22%→18%→15%), causing visible flickering.
  let _lastPseudoOutput: string | null = null;

  /**
   * Detect entities, pseudonymize, and report to content script.
   * Returns the pseudonymization result, or null if no entities / not in proxy mode.
   */
  function adapterDomPseudonymize(text: string, source: string) {
    if (mode !== 'proxy') return null;
    if (!text || text.length < 10) return null;

    // Guard against double-pseudonymization: if the text we're about to
    // pseudonymize is the same text we previously wrote to the input,
    // it's already been pseudonymized — skip.
    if (_lastPseudoOutput && text === _lastPseudoOutput) {
      igLog(`${adapterName} DOM: skipping double-pseudo — input matches last pseudonymized output`);
      return null;
    }

    const regexEntities = detectWithRegex(text);
    const secrets = scanForSecrets(text);
    const allEntities = [...regexEntities, ...secrets];
    if (allEntities.length === 0) return null;

    const { level, score } = quickScore(allEntities);
    const pseudoResult = pseudonymizeLocal(text, allEntities);

    for (const m of pseudoResult.mappings) {
      addReverseMapping(currentReverseMap, m.pseudonym, m.original, m.type);
    }

    // ════════════════════════════════════════════════════════════
    // DIAGNOSTIC: DOM PRE-SUBMIT — what gets written to the input
    // ════════════════════════════════════════════════════════════
    console.log(
      `%c[Iron Gate WIRE] DOM PRE-SUBMIT PROXY (${adapterName})`,
      'color: #00cc00; font-weight: bold; font-size: 13px',
      `\n  Trigger: ${source}`,
      `\n  📤 Original: ${text.length} chars`,
      `\n  🔒 Pseudonymized: ${pseudoResult.maskedText.length} chars`,
      `\n  📊 ${allEntities.length} entities, score=${score}, level=${level}`,
    );
    // Debug: show what was actually sent and the entity mapping table
    console.log(
      `%c[Iron Gate DEBUG] Entity Mappings:`,
      'color: #ff9900; font-weight: bold',
    );
    for (const m of pseudoResult.mappings) {
      console.log(`  ${m.type}: "${m.original}" → "${m.pseudonym}"`);
    }
    console.log(
      `%c[Iron Gate DEBUG] Pseudonymized text sent to ${adapterName}:`,
      'color: #ff9900; font-weight: bold',
      `\n${pseudoResult.maskedText}`,
    );
    // ════════════════════════════════════════════════════════════

    igLog(`${adapterName} DOM PROXY (${source}): Pseudonymized ${allEntities.length} entities (${level}, score=${score})`);

    // SECURITY: hash before postMessage — fire-and-forget async
    Promise.all([igHash(text), minimizeEntitiesForTransit(allEntities)])
      .then(([ph, me]) => {
        igPostMessage({
          type: 'IRON_GATE_INTERCEPTED',
          promptHash: ph,
          promptLength: text.length,
          maskedPrompt: pseudoResult.maskedText,
          mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
          entityCount: allEntities.length,
          level,
          score,
          entities: me,
        });
      });

    return pseudoResult;
  }

  // ── Enter key interception (capture phase — runs before platform handlers) ──
  document.addEventListener('keydown', function (e: KeyboardEvent) {
    if (domInterceptBusy) return;
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    const inputEl = activeAdapter!.findInput();
    if (!inputEl) return;
    if (!inputEl.contains(e.target as Node) && e.target !== inputEl) return;

    const text = activeAdapter!.readInput(inputEl);
    if (!text || text.length < 10) return;

    // Always gate on file uploads (regardless of proxy/audit mode)
    if (pendingFileScans.size > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      igLog(`${adapterName} DOM: Enter blocked — checking file upload gate`);
      checkFileUploadGate().then((decision) => {
        if (decision === 'block') {
          igLog(`${adapterName} DOM: File gate BLOCKED send`);
          return;
        }
        // Gate passed — proceed with pseudonymization and submit
        _domEnterSubmit(inputEl as HTMLElement, text);
      });
      return;
    }

    if (mode !== 'proxy') return;

    igLog(`${adapterName} DOM: Enter pressed, text=${text.length} chars`);

    const result = adapterDomPseudonymize(text, 'Enter');
    if (!result) return;

    if (isDomCaptureWire) {
      setPendingCopilotPseudo({ original: text, maskedText: result.maskedText });
      igLog(`${adapterName}: Queued pseudo for WS interception`);
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    _lastPseudoOutput = result.maskedText;
    const writeOk = activeAdapter!.writeInput(inputEl, result.maskedText);
    igLog(`${adapterName} DOM: writeInput result=${writeOk}`);

    // SECURITY: If writeInput failed, DO NOT submit — PII would go through unprotected.
    // Block the submit entirely and warn the user.
    if (!writeOk) {
      console.error(
        `%c[Iron Gate] ❌ BLOCKED: Could not replace sensitive data in ${adapterName} input. Submit prevented to protect your data.`,
        'color: #ef4444; font-weight: bold; font-size: 14px',
      );
      _lastPseudoOutput = null;
      // Notify content script / sidepanel about the blocked submit
      igPostMessage({
        type: 'IRON_GATE_SUBMIT_BLOCKED',
        reason: `DOM replacement failed on ${adapterName} — submit blocked to protect sensitive data`,
        adapter: adapterName,
      });
      return;
    }

    setTimeout(() => {
      domInterceptBusy = true;
      const sendBtn = activeAdapter!.findSubmitButton();
      if (sendBtn) {
        sendBtn.click();
        igLog(`${adapterName} DOM: submitted via button click`);
      } else {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        }));
        igLog(`${adapterName} DOM: submitted via Enter re-dispatch`);
      }
      setTimeout(() => { domInterceptBusy = false; _lastPseudoOutput = null; }, 300);
    }, 100);
  }, true);

  // Helper: re-run pseudonymization and submit after file gate passes
  function _domEnterSubmit(inputEl: HTMLElement, text: string) {
    if (mode === 'proxy') {
      const result = adapterDomPseudonymize(text, 'Enter');
      if (result) {
        if (isDomCaptureWire) {
          setPendingCopilotPseudo({ original: text, maskedText: result.maskedText });
          // Simulate Enter to let the platform submit
          inputEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
          }));
          return;
        }
        _lastPseudoOutput = result.maskedText;
        const writeOk = activeAdapter!.writeInput(inputEl, result.maskedText);
        if (!writeOk) {
          igLog('_domEnterSubmit: writeInput failed — blocking submit to protect PII');
          return;
        }
      }
    }
    setTimeout(() => {
      domInterceptBusy = true;
      const sendBtn = activeAdapter!.findSubmitButton();
      if (sendBtn) {
        sendBtn.click();
      } else {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        }));
      }
      setTimeout(() => { domInterceptBusy = false; }, 300);
    }, 100);
  }

  // ── Send button click interception (capture phase) ──
  document.addEventListener('click', function (e: MouseEvent) {
    if (domInterceptBusy) return;

    const target = e.target as HTMLElement;
    const btn = target.closest('button');
    if (!btn) return;

    // Check if this looks like a send/submit button
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
    const textContent = (btn.textContent || '').toLowerCase();
    const isSendButton = label.includes('send') || label.includes('submit') ||
      testId.includes('send') || testId.includes('submit') ||
      textContent.includes('send') || textContent.includes('submit') ||
      btn.type === 'submit';

    if (!isSendButton) {
      const inputEl = activeAdapter!.findInput();
      if (!inputEl) return;
      const parent = inputEl.closest('form') || inputEl.parentElement?.parentElement?.parentElement;
      if (!parent || !parent.contains(btn)) return;
      if (!btn.querySelector('svg')) return;
    }

    const inputEl = activeAdapter!.findInput();
    if (!inputEl) return;

    const text = activeAdapter!.readInput(inputEl);
    if (!text || text.length < 10) return;

    // Check file upload gate (regardless of proxy/audit mode)
    if (pendingFileScans.size > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      igLog(`${adapterName} DOM: Click blocked — checking file upload gate`);
      checkFileUploadGate().then((decision) => {
        if (decision === 'block') {
          igLog(`${adapterName} DOM: File gate BLOCKED send`);
          return;
        }
        // Gate passed — proceed with pseudonymization and re-click
        if (mode === 'proxy') {
          const result = adapterDomPseudonymize(text, 'SendBtn');
          if (result) {
            if (isDomCaptureWire) {
              setPendingCopilotPseudo({ original: text, maskedText: result.maskedText });
              setTimeout(() => { domInterceptBusy = true; btn.click(); setTimeout(() => { domInterceptBusy = false; }, 300); }, 100);
              return;
            }
            _lastPseudoOutput = result.maskedText;
            activeAdapter!.writeInput(inputEl, result.maskedText);
          }
        }
        setTimeout(() => { domInterceptBusy = true; btn.click(); setTimeout(() => { domInterceptBusy = false; }, 300); }, 100);
      });
      return;
    }

    if (mode !== 'proxy') return;

    igLog(`${adapterName} DOM: Send button clicked, text=${text.length} chars`);

    const result = adapterDomPseudonymize(text, 'SendBtn');
    if (!result) return;

    if (isDomCaptureWire) {
      setPendingCopilotPseudo({ original: text, maskedText: result.maskedText });
      igLog(`${adapterName}: Queued pseudo for WS interception`);
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    _lastPseudoOutput = result.maskedText;
    const writeOk = activeAdapter!.writeInput(inputEl, result.maskedText);

    // SECURITY: If writeInput failed, DO NOT submit — PII would go through unprotected.
    if (!writeOk) {
      console.error(
        `%c[Iron Gate] ❌ BLOCKED: Could not replace sensitive data in ${adapterName} input. Submit prevented to protect your data.`,
        'color: #ef4444; font-weight: bold; font-size: 14px',
      );
      _lastPseudoOutput = null;
      igPostMessage({
        type: 'IRON_GATE_SUBMIT_BLOCKED',
        reason: `DOM replacement failed on ${adapterName} — submit blocked to protect sensitive data`,
        adapter: adapterName,
      });
      return;
    }

    setTimeout(() => {
      domInterceptBusy = true;
      btn.click();
      setTimeout(() => { domInterceptBusy = false; }, 300);
    }, 100);
  }, true);

  // ── Diagnostic: log the elements found after page load ──
  setTimeout(() => {
    const ta = activeAdapter!.findInput();
    const sb = activeAdapter!.findSubmitButton();
    igLog(`${adapterName} DOM: input=${ta?.id || ta?.tagName || 'NOT FOUND'}, submitBtn=${sb?.getAttribute('aria-label') || sb?.getAttribute('data-testid') || sb?.tagName || 'NOT FOUND'}`);
  }, 3000);

  igLog(`${adapterName} DOM ${isDomPresubmit ? 'pre-submit' : 'capture-wire'} interceptor installed`);
}

// ─── Heartbeat & Health Status ───────────────────────────────────────────────
// Notify content script that MAIN world interceptor is active.
// Content script uses this to confirm the script is executing properly.
const _patchStatus = {
  fetch: !!(window as any).__IRON_GATE_FETCH_PATCHED,
  xhr: true, // XHR patch is synchronous and always succeeds
  ws: !!(window as any).__IRON_GATE_WS_PATCHED,
};
const _healthy = _patchStatus.fetch; // fetch is the critical interception path

igPostMessage({
  type: 'IRON_GATE_HEARTBEAT',
  version: '0.2.7',
  timestamp: Date.now(),
  mode,
});

// Health status message — content script relays this to service worker / sidepanel
igPostMessage({
  type: 'IRON_GATE_HEALTH',
  healthy: _healthy,
  patchStatus: _patchStatus,
  adapter: activeAdapter?.name || null,
});

// Mark as active using Symbol-keyed guard
(window as any)[_IG_GUARD_SYM] = { status: 'active', since: Date.now(), token: _igGuardToken };
(window as any).__IRON_GATE_MAIN_WORLD = 'active';
(window as any).__IRON_GATE_MODE = mode;

// Always-visible success log
console.log(
  '%c[Iron Gate MAIN] ✅ Fully initialized',
  'color: #22c55e; font-weight: bold',
  `adapter=${activeAdapter?.name || 'none'}`,
  `mode=${mode}`,
  `fetchPatched=${!!(window as any).__IRON_GATE_FETCH_PATCHED}`
);

} catch (initError) {
  // ─── CRITICAL ERROR RECOVERY ─────────────────────────────────────────────
  // If initialization crashes, reset the flag so a subsequent injection
  // (or page reload) can retry. Without this, the extension is permanently dead.
  console.error(
    '%c[Iron Gate MAIN] ❌ INITIALIZATION CRASHED — fetch interception NOT active',
    'color: #ef4444; font-weight: bold; font-size: 14px',
    '\n\nError:', initError,
    '\n\nResetting guard to allow retry on next injection.'
  );
  delete (window as any)[_IG_GUARD_SYM];
}

} // End of duplicate execution guard
