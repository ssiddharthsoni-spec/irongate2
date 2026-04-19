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
import { generateFake } from './main-world/fake-data';
import { detectWithRegex } from '../detection/fallback-regex';
import { scanForSecrets, isNaturalLanguage } from './main-world/entity-patterns';
import {
  jsonStringEscape,
  looksLikePersonName,
  buildRegexCache,
  replacePseudonymsCore,
  type CachedPseudoEntry,
} from './main-world/depseudo-engine';
import { createSessionEntityTracker } from './main-world/session-entities';

// ─── Full Scoring Pipeline ──────────────────────────────────────────────────
// Import the REAL scoring pipeline — intent suppression, context analysis,
// document classification — so the proxy decision uses the same intelligence
// as the worker. These are pure functions with no chrome.* dependencies.
import { computeScore, scoreToLevel } from '../detection/scorer';
import type { DetectedEntity } from '../detection/types';
import { HIGH_PII_TYPES, ALWAYS_CRITICAL_TYPES } from '../detection/types';
import { classifyEntityOwnership, type OwnershipType } from '../detection/entity-ownership';
// NLI removed (3.5) — server-side classification replaces in-browser ML

// ─── Duplicate Execution Guard ───────────────────────────────────────────
// Multiple injection methods (manifest, programmatic, <script> tag) may all
// try to run this script. Only the first execution should proceed.
// Uses a crypto-random token stored on a non-enumerable Symbol property
// so page scripts cannot easily detect or spoof the guard.
// Use a non-discoverable property name for the guard. Symbol.for() is globally
// accessible and would let page scripts read guard state (including session nonces).
// A random property key on a non-enumerable property prevents this.
const _IG_GUARD_KEY = '__ig_mw_' + Array.from(crypto.getRandomValues(new Uint8Array(8)),
  b => b.toString(16).padStart(2, '0')).join('');
// Check for any existing guard from a prior injection (uses data-attribute on <html>
// since the prior injection's random key is unknown to us)
const _IG_GUARD_ATTR = document.documentElement.getAttribute('data-ig-guard');
const _IG_GUARD_STATE = _IG_GUARD_ATTR
  ? ((): { status: string; since: number; token: string } | undefined => {
      try { return JSON.parse(_IG_GUARD_ATTR); } catch { return undefined; }
    })()
  : undefined;

if (_IG_GUARD_STATE?.status === 'active') {
  console.log('[Iron Gate MAIN] Already active — re-sending heartbeat for late content script');
  // The nonce is NO LONGER stored on the guard (security fix: prevents page scripts
  // from reading it via the guard). The first injection's nonce is already known to
  // the content script, so a duplicate heartbeat without nonce is harmless — the
  // content script will ignore it if it already has a valid session.
  window.postMessage({
    type: 'IRON_GATE_HEARTBEAT',
    version: '0.2.7',
    timestamp: Date.now(),
    mode: (window as any).__IRON_GATE_MODE || 'proxy',
    _duplicate: true,
    _mid: crypto.randomUUID(),
  }, window.location.origin);
} else if (_IG_GUARD_STATE?.status === 'loading') {
  const elapsed = Date.now() - (_IG_GUARD_STATE.since || 0);
  if (elapsed < 5000) {
    console.log(`[Iron Gate MAIN] Init in progress (${elapsed}ms ago) — skipping`);
  } else {
    // Previous injection crashed — reset and allow retry
    console.warn(`[Iron Gate MAIN] ⚠️ Previous init stuck at 'loading' for ${elapsed}ms — RESETTING for retry`);
    document.documentElement.removeAttribute('data-ig-guard');
  }
}

// Use a flag to wrap all initialization — prevents duplicate setup
if (!_IG_GUARD_STATE) {

// ─── Production Console Gate ─────────────────────────────────────────────────
// Gate ALL console output behind localStorage debug flag. In production,
// console.log statements leak internal state (adapter strategies, pseudonym
// maps, pipeline details) to DevTools. This replaces console methods with
// no-ops unless 'ironGateDebug' is set in localStorage.
let _IG_DEBUG = false;
try { _IG_DEBUG = localStorage.getItem('ironGateDebug') === 'true'; } catch {}
const _origConsole = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
if (!_IG_DEBUG) {
  // In production: suppress all console.log, keep warn/error only for critical issues
  console.log = (..._args: any[]) => {}; // suppressed
  // Wrap warn/error to only output Iron Gate messages when debug is off
  const _origWarn = console.warn;
  const _origError = console.error;
  console.warn = (...args: any[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('[Iron Gate')) return; // suppress internal warnings
    _origWarn.apply(console, args);
  };
  console.error = (...args: any[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('[Iron Gate')) return; // suppress internal errors
    _origError.apply(console, args);
  };
}

// ─── Hashing ─────────────────────────────────────────────────────────────────
// SHA-256 hash — raw PII is hashed before leaving via postMessage so that
// no other page script can intercept the original sensitive text.

async function igHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Send INTERCEPTED/AUDIT notification to content script RELIABLY.
 * Previously used fire-and-forget Promise.all().then().catch() which silently
 * dropped messages if hashing failed. Now awaits hashing with fallback —
 * the message is ALWAYS sent, ensuring the sidepanel always updates.
 */
/**
 * Send detection notification to content script.
 * NON-BLOCKING: sends the message immediately with minimal entity info,
 * then computes hashes in background. This prevents blocking the fetch
 * request to the AI tool — hashing is for reporting only.
 */
function notifyContentScript(
  type: 'IRON_GATE_INTERCEPTED' | 'IRON_GATE_AUDIT',
  promptText: string,
  allEntities: Array<{ type: string; text: string; start: number; end: number; confidence: number; source: string }>,
  maskedText: string,
  mappings: Array<{ pseudonym: string; type: string; length: number }>,
  level: string,
  score: number,
  extra?: Record<string, unknown>,
): void {
  // Send IMMEDIATELY with lightweight entity info — no async hashing
  const entities = allEntities.map(e => ({
    type: e.type, start: e.start, end: e.end,
    confidence: e.confidence, source: e.source, length: e.text.length,
  }));
  igPostMessage({
    type,
    promptHash: '',  // hash not needed for sidepanel delivery
    promptLength: promptText.length,
    // Do NOT send originalPrompt via postMessage — any page script can
    // listen for these messages and extract the raw prompt text.
    // The content script can reconstruct from DOM if needed.
    maskedPrompt: maskedText,
    mappings,
    entityCount: allEntities.length,
    level,
    score,
    entities,
    // Wire intercept flag: tells sidepanel this is an authoritative result from
    // the actual fetch/XHR/DOM interceptor, NOT DOM noise. Sidepanel should
    // always accept these without suppression.
    // ONLY set true for INTERCEPTED or AUDIT-with-entities. 0-entity AUDITs
    // (preflights, metadata fetches) must NOT bypass sidepanel suppression rules
    // — otherwise they overwrite real detections via RULE 2/3 bypass.
    wireIntercept: type === 'IRON_GATE_INTERCEPTED' || allEntities.length > 0,
    ...extra,
  });

  // Compute hash in background for API reporting (non-blocking)
  // Only send the hash update — NOT a full duplicate message (avoids double notification)
  igHash(promptText).then(promptHash => {
    igPostMessage({
      type: 'IRON_GATE_HASH_UPDATE' as any,
      promptHash,
      promptLength: promptText.length,
      entityCount: allEntities.length,
      level,
      score,
    });
  }).catch(() => {});
}


// ─── Challenge-Response Nonce for postMessage Validation ─────────────────────
// Generates a one-time nonce that the content script must echo back.
// Prevents other page scripts from injecting fake IRON_GATE_* messages.
const _IG_MSG_NONCE = crypto.getRandomValues(new Uint8Array(16))
  .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');

// ─── Secure BroadcastChannel for sensitive data ──────────────────────────────
// Uses the nonce as channel name — only the content script (which captures the
// nonce from postMessage handshake) can listen. Page scripts cannot guess the
// channel name. Used for: reverse map, file uploads, server process requests.
const _igSecureChannel = new BroadcastChannel(`ig_${_IG_MSG_NONCE}`);

/**
 * Secure postMessage wrapper that auto-includes the session nonce AND a
 * unique per-message ID. The content script validates the session nonce
 * for authentication, and rejects duplicate message IDs (replay prevention).
 */
function igPostMessage(data: Record<string, unknown>): void {
  window.postMessage({
    ...data,
    _nonce: _IG_MSG_NONCE,
    _mid: crypto.randomUUID(),
  }, window.location.origin);
}

// ─── State ──────────────────────────────────────────────────────────────────

let mode: 'audit' | 'proxy' = 'proxy';
// Always local. Regex + Local LLM. Cloud API never fires.
let processingMode = 'local' as 'local' | 'server';
let currentReverseMap: Record<string, string> = {};
let _reverseMapRestored = false;

// ─── Sovereign Mode Enterprise Policy (received from worker via bridge) ───
// These come from chrome.storage.managed via the worker → content-script →
// main-world postMessage chain. They're set at extension startup and can
// only be changed by IT pushing a new managed policy — never by the user,
// a page script, or the extension UI.
type EnterprisePolicyState = {
  deploymentMode: 'local-only' | 'hybrid' | 'server-only';
  killSwitch: boolean;
  allowedAITools: string[] | null; // null = all tools allowed; [] = no tools
  supportContact: string;
  firmId: string;
};
let _enterprisePolicy: EnterprisePolicyState = {
  deploymentMode: 'server-only',
  killSwitch: false,
  allowedAITools: null,
  supportContact: 'your IT administrator',
  firmId: '',
};

// Per-firm pseudonym key (raw bytes) — set via enterprise policy message.
// When present, all pseudonymization is deterministic per firm.
let _firmKeyBytes: Uint8Array | null = null;
const _firmFakeCache = new Map<string, string>();
const MAX_FIRM_FAKE_CACHE = 2000;

// B3: Signed policy bundle state — applied by the worker's bundle poller.
// These override/augment the built-in detection rules. Mutations only happen
// through IRON_GATE_APPLY_POLICY_BUNDLE which is nonce-validated.
let _bundleCustomEntityRegexes: Array<{ type: string; regex: RegExp; confidence: number }> = [];
let _bundleContextualKeywords: Array<{ keyword: string; weight: number; category: string }> = [];
let _bundleScoringWeights: Record<string, number> = {};
let _bundleCustomBlockMessage: string | null = null;

function _isKillSwitchActive(): boolean {
  return _enterprisePolicy.killSwitch === true;
}

// B2: _prefetchFirmPseudonyms is defined AFTER currentForwardMap is declared
// (TypeScript ordering constraint). See the function body below.
// Forward declaration via function expression so the fetch proxy can call it:
let _prefetchFirmPseudonyms: (entities: Array<{ type: string; text: string }>) => Promise<void> =
  async () => { /* replaced below after currentForwardMap is declared */ };

/** Small pool selector for deterministic firm pseudonyms */
function _firmFakeFromBytes(entityType: string, bytes: Uint8Array): string | null {
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const FIRST = ['Alex','Amara','Ava','Bao','Bianca','Carlos','Chen','Diana','Elena','Fatima','Gabriel','Hana','Iris','James','Julia','Kai','Lily','Mei','Nora','Omar','Paul','Qiana','Raj','Sara','Tara','Uma','Victor','Wendy','Xander','Yuki','Zara'];
  const LAST = ['Adams','Barros','Carter','Davis','Edwards','Fernandez','Garcia','Huang','Ito','Joshi','Kim','Liu','Martinez','Nguyen','Okafor','Park','Quinn','Reed','Smith','Tanaka','Underwood','Vasquez','Wang','Xu','Yates','Zhang'];
  const ORGS = ['Adatum Corp','Contoso Holdings','Northwind Group','Tailspin Industries','Wingtip Partners','Lucerne Capital','Fabrikam Solutions','Litware Systems'];
  const DOMAINS = ['example.com','example.org','example.net','sample.io','test.co','demo.dev'];
  switch (entityType) {
    case 'PERSON':
    case 'NAME': {
      const f = FIRST[n % FIRST.length];
      const l = LAST[(n >> 8) % LAST.length];
      return `${f} ${l}`;
    }
    case 'ORGANIZATION':
    case 'ORG':
    case 'COMPANY':
      return ORGS[n % ORGS.length];
    case 'EMAIL': {
      const f = FIRST[n % FIRST.length].toLowerCase();
      const l = LAST[(n >> 8) % LAST.length].toLowerCase();
      const d = DOMAINS[(n >> 16) % DOMAINS.length];
      return `${f}.${l}@${d}`;
    }
    case 'PHONE':
    case 'PHONE_NUMBER': {
      const area = (n % 800) + 200;
      const prefix = ((n >> 10) % 800) + 200;
      const line = (n >> 20) % 10000;
      return `(${area}) ${prefix}-${String(line).padStart(4, '0')}`;
    }
    case 'SSN': {
      // 900-999 area avoids real-SSN range (Tier 1 regex won't match these as real)
      const area = 900 + (n % 100);
      const group = ((n >> 10) % 99) + 1;
      const serial = ((n >> 20) % 9999) + 1;
      return `${area}-${String(group).padStart(2, '0')}-${String(serial).padStart(4, '0')}`;
    }
    default:
      return null; // let the random generator handle it
  }
}

function _isAiToolAllowed(adapterId: string | undefined): boolean {
  if (!adapterId) return true;
  const list = _enterprisePolicy.allowedAITools;
  if (!list || list.length === 0) return true; // null or empty = all allowed
  return list.includes(adapterId);
}

function _buildKillSwitchResponse(reason: string): Response {
  const body = {
    error: 'blocked_by_policy',
    reason,
    contact: _enterprisePolicy.supportContact,
    firmId: _enterprisePolicy.firmId || undefined,
  };
  return new Response(JSON.stringify(body), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

function _buildFailClosedResponse(url: string, reason: string): Response {
  return new Response(JSON.stringify({
    error: 'iron_gate_blocked',
    reason,
    message: 'Iron Gate blocked this request because pseudonymization failed. Your original data was NOT sent to the AI.',
  }), { status: 502, headers: { 'Content-Type': 'application/json' } });
}

// registerPseudonymization() and wrapResponse() are defined after all their
// dependencies (addReverseMapping, startPersistentDomDepseudo, scanTextNodes,
// depseudonymizeResponse, activeAdapter) to satisfy TypeScript lexical ordering.
// See section before patchedFetch (~line 3350).

// ─── Session Entity Registry ──────────────────────────────────────────────
// Tracks original entity text from prior turns. When a follow-up message
// references these entities (even without re-detecting them as PII), the
// score is boosted to prevent GREEN passthrough of PII that was previously
// flagged. This fixes DEF-016: "follow-up with prior PII scores too low".
// Session entity tracking — extracted to ./main-world/session-entities.ts
const _sessionTracker = createSessionEntityTracker(500);
// Backward-compatible aliases used throughout main-world.ts
const _sessionEntities = { add: (v: string) => _sessionTracker.add(v), clear: () => _sessionTracker.clear(), get size() { return _sessionTracker.size; } };
function _countSessionEntityReferences(text: string): number { return _sessionTracker.countReferences(text); }
let _activeStreamCount = 0;
let _pendingClear = false;
let _lastConversationPath: string = window.location.pathname;

// ─── Private LLM config (set via IRON_GATE_SET_PRIVATE_LLM from content script)
let _privateLlmEndpoint: string | null = null;
let _privateLlmModel: string | null = null;

function _isAllowedLlmEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || host === '[::1]' || host.endsWith('.local');
  } catch {
    return false;
  }
}

// ─── Server-mode processing: request/response relay via content script ────────
// MAIN world can't access chrome APIs, so we relay through the content script
// which forwards to the service worker → API → back.
const _serverProcessPending = new Map<string, {
  resolve: (result: ServerProcessResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

interface ServerProcessResult {
  action: string;
  pseudonymizedText?: string;
  reverseMap?: Record<string, string>;
  sensitivityScore: number;
  sensitivityLevel: string;
  entityCount: number;
  entities?: Array<{ type: string; start: number; end: number }>;
  // Detection API fields
  contextCategory?: string;
  policyExplanation?: string;
  sessionId?: string;
  // Kill switch
  killSwitch?: boolean;
  killSwitchMessage?: string;
}

// ─── Gemma Verdict Cache ────────────────────────────────────────────────────
// Worker pre-computes Gemma's verdict while the user types (PROMPT_DETECTED).
// The verdict is pushed: worker → content script → main-world via postMessage.
// At submit time, the fetch interceptor checks this cache to decide whether
// to pseudonymize. If Gemma says "research/fiction" → skip pseudonymization.
// If Gemma says "work_sharing/high" → pseudonymize.
// If no cached verdict (Gemma not ready) → fall back to regex-only scoring.
let _gemmaVerdict: { intent: string; sensitivity: string; score: number; verdict: string; source: string; promptHash: string; timestamp: number } | null = null;
const GEMMA_VERDICT_TTL = 30_000; // 30s — covers typing → submit window

function getCachedGemmaVerdict(): typeof _gemmaVerdict {
  if (!_gemmaVerdict) return null;
  if (Date.now() - _gemmaVerdict.timestamp > GEMMA_VERDICT_TTL) {
    _gemmaVerdict = null;
    return null;
  }
  return _gemmaVerdict;
}
// Returns the classifier result or null on timeout/error.
// The nonce is handled by igPostMessage (adds _nonce) and the content
// script's isValidMainWorldMessage (captures nonce from any message).

// Gemma classification moved to worker (SENSITIVITY_SCORE handler).
// No cross-context message relay needed — worker calls Ollama directly.

// Server process timeout — 5s default for Detection API (spaCy NER + policy eval).
// Cold starts may take longer; subsequent calls are fast (~200ms).
// Falls back to local detection if timeout expires.
// Configurable via IRON_GATE_SERVER_TIMEOUT_MS in managed storage.
let _serverProcessTimeoutMs = 5000;

// Allow timeout to be updated from config sync
function _updateServerTimeout(ms: number) {
  if (ms >= 2000 && ms <= 30000) _serverProcessTimeoutMs = ms;
}

// IRON_GATE_SET_SERVER_TIMEOUT listener is registered in the main message handler
// below (after isValidContentScriptMessage is defined) to satisfy TypeScript ordering.

function requestServerProcess(text: string, aiToolId: string): Promise<ServerProcessResult> {
  const requestId = crypto.randomUUID();
  return new Promise<ServerProcessResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      _serverProcessPending.delete(requestId);
      reject(new Error('Server process timeout'));
    }, _serverProcessTimeoutMs);

    _serverProcessPending.set(requestId, { resolve, reject, timer });

    // Send via BroadcastChannel (private) — raw prompt text must not be
    // broadcast via window.postMessage where page scripts can read it.
    _igSecureChannel.postMessage({
      type: 'IRON_GATE_SERVER_PROCESS_REQUEST',
      requestId,
      text,
      aiToolId,
    });
  });
}

// ─── Reverse Map: Encrypted Session Persistence ──────────────────────────────
// The reverse map (pseudonym → original PII) lives in `currentReverseMap`.
// On each update, map entries are sent to the content script (extension context)
// via postMessage, which stores them encrypted in chrome.storage.session.
// On page refresh, the content script sends persisted mappings back.
// chrome.storage.session is NOT accessible to page scripts (unlike sessionStorage)
// and is cleared when the browser closes.

// Execution flag — stored as data-attribute on <html> (findable by future injections)
// Guard token stays in a closure-scoped variable, NOT on a global property.
const _igGuardToken = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
document.documentElement.setAttribute('data-ig-guard', JSON.stringify({
  status: 'loading', since: Date.now(), token: _igGuardToken,
}));
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

// Debug logging — ON so you can see the pipeline in the console
const _IG_DEBUG = true;
function igLog(...args: any[]) { if (_IG_DEBUG) console.log('[Iron Gate MAIN]', ...args); }

// Reverse map starts empty each page load (in-memory only, see security note above)

// ─── Adapter Selection ───────────────────────────────────────────────────────
const activeAdapter: SiteAdapter | null = getAdapter();
igLog(`🚀 Script loaded at ${new Date().toISOString()} — adapter: ${activeAdapter?.name || 'none'} — patching fetch/XHR/WebSocket...`);


// NLI verdict cache removed (3.5) — in-browser ML eliminated

// ─── Communication with content script ──────────────────────────────────────

// ── Reverse nonce: validate messages FROM content script ────────────────────
// The content script includes a _csNonce in every postMessage. We capture it
// from the first control message and reject all subsequent messages without it.
// This prevents malicious page scripts from injecting fake mode changes.
let _igContentScriptNonce: string | null = null;
// Grace window: during startup the content script and MAIN world race to
// establish the nonce handshake. Messages that arrive before the first
// successful nonce capture were previously silently rejected — which meant
// IRON_GATE_SET_MODE / SET_ENTERPRISE_POLICY / SET_PROCESSING_MODE never
// reached the MAIN world if the content script was fractionally faster.
// The grace window accepts the first N messages unconditionally (each one
// tries to capture the nonce) so the handshake converges even under timing
// variance. After GRACE_MAX messages we lock to the captured nonce.
let _csNonceGraceCount = 0;
const CS_NONCE_GRACE_MAX = 2;
const _csNonceGraceDeadline = Date.now() + 1000; // 1s window from script load

function isValidContentScriptMessage(data: any): boolean {
  if (!data?._csNonce || typeof data._csNonce !== 'string') return false;
  // Capture nonce from first message that carries one
  if (!_igContentScriptNonce) {
    _igContentScriptNonce = data._csNonce;
    _csNonceGraceCount++;
    return true;
  }
  // Exact match — normal path after handshake
  if (data._csNonce === _igContentScriptNonce) return true;
  // Grace window: if the previously captured nonce came from a stale
  // content script instance (extension reload, navigation), allow the
  // new nonce to replace it during the grace period.
  if (_csNonceGraceCount < CS_NONCE_GRACE_MAX && Date.now() < _csNonceGraceDeadline) {
    _igContentScriptNonce = data._csNonce;
    _csNonceGraceCount++;
    return true;
  }
  return false;
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  // All IRON_GATE_* control messages from content script must carry a valid nonce
  const type = event.data?.type;
  if (type && typeof type === 'string' && type.startsWith('IRON_GATE_') && !type.startsWith('IRON_GATE_HEARTBEAT')) {
    // Skip nonce check for messages we (MAIN world) sent to ourselves
    if (event.data?._nonce === _IG_MSG_NONCE) {
      // This is our own message echoed back — ignore
      return;
    }
    if (!isValidContentScriptMessage(event.data)) {
      igLog('REJECTED control message without valid content-script nonce:', type);
      return;
    }
  }
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
  // Processing mode is locked to 'local'. Everything processed on-device.
  // Ignore any attempt to set it to 'server' — cloud API is disabled.
  if (event.data?.type === 'IRON_GATE_SET_PROCESSING_MODE') {
    // No-op. processingMode stays 'local'.
  }
  // Enterprise managed policy state (killSwitch, allowedAITools, firm info).
  // Validated by the content-script nonce check above.
  if (event.data?.type === 'IRON_GATE_SET_ENTERPRISE_POLICY') {
    const p = event.data.policy;
    if (p && typeof p === 'object') {
      if (p.deploymentMode === 'local-only' || p.deploymentMode === 'hybrid' || p.deploymentMode === 'server-only') {
        _enterprisePolicy.deploymentMode = p.deploymentMode;
      }
      if (typeof p.killSwitch === 'boolean') {
        _enterprisePolicy.killSwitch = p.killSwitch;
      }
      if (Array.isArray(p.allowedAITools)) {
        _enterprisePolicy.allowedAITools = p.allowedAITools.filter((x: unknown) => typeof x === 'string');
      } else if (p.allowedAITools === null) {
        _enterprisePolicy.allowedAITools = null;
      }
      if (typeof p.supportContact === 'string' && p.supportContact.length > 0) {
        _enterprisePolicy.supportContact = p.supportContact;
      }
      if (typeof p.firmId === 'string') {
        _enterprisePolicy.firmId = p.firmId;
      }
      // B2: Per-firm pseudonymization key. 32 bytes expressed as 64 hex chars.
      // When set, pseudonymization becomes deterministic per firm via HKDF.
      if (typeof p.pseudonymKey === 'string' && /^[0-9a-fA-F]{64}$/.test(p.pseudonymKey)) {
        const hex = p.pseudonymKey;
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        _firmKeyBytes = bytes;
        _firmFakeCache.clear(); // Reset cache when key changes
        igLog('Firm pseudonym key installed — pseudonyms are now deterministic per firm');
      } else if (p.pseudonymKey === null || p.pseudonymKey === '') {
        _firmKeyBytes = null;
        _firmFakeCache.clear();
      }
      igLog(`Enterprise policy updated: mode=${_enterprisePolicy.deploymentMode} killSwitch=${_enterprisePolicy.killSwitch} allowed=${_enterprisePolicy.allowedAITools?.join(',') || 'all'} firmKey=${_firmKeyBytes ? 'set' : 'none'}`);
    }
  }
  // B3: Signed policy bundle rules from the customer's policy server.
  // The worker has already verified the Ed25519 signature and schema.
  // Main-world applies the rules to its live detection state.
  if (event.data?.type === 'IRON_GATE_APPLY_POLICY_BUNDLE' && event.data?.payload) {
    const rules = event.data.payload;
    try {
      // Custom entity regexes — compiled once, added to the detection pool
      if (Array.isArray(rules.customEntities)) {
        _bundleCustomEntityRegexes = [];
        for (const ce of rules.customEntities) {
          if (typeof ce?.pattern !== 'string' || typeof ce?.type !== 'string') continue;
          try {
            const regex = new RegExp(ce.pattern, 'gi');
            _bundleCustomEntityRegexes.push({
              type: ce.type,
              regex,
              confidence: typeof ce.confidence === 'number' ? ce.confidence : 0.9,
            });
          } catch { /* bad regex — skip */ }
        }
      }
      // Contextual keyword additions — merged into the scorer's keyword pool
      if (Array.isArray(rules.contextualKeywords)) {
        _bundleContextualKeywords = rules.contextualKeywords
          .filter((k: any) => typeof k?.keyword === 'string' && typeof k?.weight === 'number')
          .map((k: any) => ({ keyword: k.keyword, weight: k.weight, category: k.category || 'firm-custom' }));
      }
      // Scoring weight overrides — applied by the scorer when computing entity contributions
      if (rules.scoringWeights && typeof rules.scoringWeights === 'object') {
        _bundleScoringWeights = { ...rules.scoringWeights };
      }
      // Allowed AI tools — firm policy override
      if (Array.isArray(rules.allowedAITools)) {
        _enterprisePolicy.allowedAITools = rules.allowedAITools;
      }
      if (typeof rules.customBlockMessage === 'string') {
        _bundleCustomBlockMessage = rules.customBlockMessage;
      }
      igLog(`Policy bundle applied: +${_bundleCustomEntityRegexes.length} entities, +${_bundleContextualKeywords.length} keywords, ${Object.keys(_bundleScoringWeights).length} weight overrides`);
    } catch (err) {
      igLog('Bundle rule application failed:', err);
    }
  }
  // Server timeout config from content script (H-14: validated by nonce check above)
  if (event.data?.type === 'IRON_GATE_SET_SERVER_TIMEOUT' && typeof event.data.timeoutMs === 'number') {
    _updateServerTimeout(event.data.timeoutMs);
  }
  // Server-mode processing response from content script
  if (event.data?.type === 'IRON_GATE_SERVER_PROCESS_RESPONSE') {
    const { requestId, result, error } = event.data;
    const pending = _serverProcessPending.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      _serverProcessPending.delete(requestId);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }
  }
  // Receive private LLM config from content script
  // Receive Gemma 4 classification response from content script
  // Receive Gemma verdict from worker (via content script relay).
  // Caches the LLM's context judgment for use at submit time.
  // CRITICAL: only use this verdict if it matches the CURRENT prompt.
  // A stale "allow" from a previous clean prompt must NOT suppress
  // detection on a new sensitive prompt.
  if (event.data?.type === 'IRON_GATE_GEMMA_VERDICT') {
    _gemmaVerdict = {
      intent: event.data.intent || 'ambiguous',
      sensitivity: event.data.sensitivity || 'medium',
      score: event.data.score || 50,
      verdict: event.data.verdict || 'mask',
      source: event.data.source || 'gemma',
      promptHash: event.data.promptHash || '',
      timestamp: Date.now(),
    };
    console.log(
      `%c[Iron Gate] Gemma verdict cached: ${_gemmaVerdict.verdict} (${_gemmaVerdict.intent}/${_gemmaVerdict.sensitivity})`,
      'color: #a855f7; font-weight: bold',
    );
  }
  if (event.data?.type === 'IRON_GATE_SET_PRIVATE_LLM') {
    const candidate = event.data.endpoint || null;
    if (candidate && !_isAllowedLlmEndpoint(candidate)) {
      igLog('REJECTED private LLM endpoint — not localhost:', candidate);
      _privateLlmEndpoint = null;
    } else {
      _privateLlmEndpoint = candidate;
    }
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
        // BUG-21: Use session sequence number instead of time-based window.
        // The old 5s window caused a race: a second prompt within 5s had its
        // restore silently dropped. The restore message includes the sequence
        // at the time it was persisted — if it's stale (from before a clear),
        // we reject it. If no sequence is present (legacy), fall back to time check.
        const restoreSeq = typeof event.data._seq === 'number' ? event.data._seq : -1;
        if (restoreSeq >= 0 && restoreSeq < _clearSequence) {
          igLog(`RESTORE_REVERSE_MAP ignored — stale sequence ${restoreSeq} < current ${_clearSequence}`);
        } else if (restoreSeq < 0 && _lastClearTime > 0 && Date.now() - _lastClearTime < 5000) {
          igLog(`RESTORE_REVERSE_MAP ignored (legacy) — clearReverseMapFully() ran ${Date.now() - _lastClearTime}ms ago`);
        } else {
          // M-1 FIX: MERGE restored entries, but only add keys that don't
          // already exist in the current map. This prevents the restore from
          // overwriting entries added by a pseudonymization that raced ahead
          // of the restore completing.
          for (const [k, v] of entries) {
            if (!(k in currentReverseMap)) {
              currentReverseMap[k] = v as string;
            }
          }
          _reverseMapRestored = true;
          _regexCacheVersion++;
          console.log(
            `%c[Iron Gate MAIN] Restored ${count} reverse pseudonym mappings from session`,
            'color: #22c55e; font-weight: bold',
          );
          // Start de-pseudo observer immediately so previous session's user bubbles
          // get their original text restored (don't wait for a new pseudonymization event)
          startPersistentDomDepseudo();
          // Delay initial scan to let Claude finish rendering conversation history
          setTimeout(() => scanTextNodes(document.body), 1500);
          setTimeout(() => scanTextNodes(document.body), 3000);
        }
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

// ─── Entity Detection (extracted to ./main-world/entity-patterns.ts) ────────

// ─── Fake Data Generation (extracted to ./main-world/fake-data.ts) ──────────

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
 * Strips raw PII (.original) before postMessage — page scripts can read window messages.
 * Only pseudonym, type, and length are safe to transit.
 */
function sanitizeMappingsForTransit(mappings: PseudonymMapping[]): Array<{ pseudonym: string; type: string; length: number }> {
  return mappings.map(m => ({ pseudonym: m.pseudonym, type: m.type, length: m.original.length }));
}

// Global forward map: original → fake (persists across messages in a conversation)
let currentForwardMap: Record<string, string> = {};

// B2: Install the real firm pseudonym prefetch function now that currentForwardMap exists.
// HKDF-SHA256: derive deterministic fakes per firm via the managed policy pseudonymKey.
// Salt binds to entity type; info binds to firmId + original text.
_prefetchFirmPseudonyms = async function firmPseudonymPrefetch(entities) {
  if (!_firmKeyBytes || _firmKeyBytes.length !== 32) return;
  let baseKey: CryptoKey;
  try {
    baseKey = await crypto.subtle.importKey(
      'raw',
      _firmKeyBytes.buffer.slice(
        _firmKeyBytes.byteOffset,
        _firmKeyBytes.byteOffset + _firmKeyBytes.byteLength,
      ) as ArrayBuffer,
      'HKDF',
      false,
      ['deriveBits'],
    );
  } catch { return; }
  for (const e of entities) {
    const normalized = e.text.trim();
    if (normalized.length === 0) continue;
    if (currentForwardMap[normalized]) continue;
    const cacheKey = `${e.type}|${normalized.toLowerCase()}`;
    const cached = _firmFakeCache.get(cacheKey);
    if (cached) {
      currentForwardMap[normalized] = cached;
      continue;
    }
    try {
      const salt = new TextEncoder().encode(`irongate/pseudonym/v1/${e.type}`);
      const info = new TextEncoder().encode(`${_enterprisePolicy.firmId}:${normalized.toLowerCase()}`);
      const derived = await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
          info: info.buffer.slice(info.byteOffset, info.byteOffset + info.byteLength) as ArrayBuffer,
        },
        baseKey,
        256,
      );
      const bytes = new Uint8Array(derived);
      const fake = _firmFakeFromBytes(e.type, bytes);
      if (fake) {
        _firmFakeCache.set(cacheKey, fake);
        if (_firmFakeCache.size > MAX_FIRM_FAKE_CACHE) {
          const iter = _firmFakeCache.keys();
          _firmFakeCache.delete(iter.next().value!);
        }
        currentForwardMap[normalized] = fake;
      }
    } catch { /* HKDF failed — leave empty, random fallback handles it */ }
  }
};

// Per-session cryptographic proxy nonce — prevents prompt injection bypass (C-2).
// Old approach used a guessable string 'enterprise privacy tool' that attackers could
// include in their prompt to skip pseudonymization entirely.
const _proxyNonce = '__IG_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
  .map(b => b.toString(16).padStart(2, '0')).join('') + '__';

// Entity types that are ANALYTICAL VALUES — detected and scored for sensitivity,
// but NOT pseudonymized. Replacing these with fakes corrupts the AI's analysis
// (e.g., fake salaries produce wrong gap calculations). They're only sensitive
// in combination with identifiers — once names are pseudonymized, the values are safe.
const VALUE_TYPES: ReadonlySet<string> = new Set([
  'MONETARY_AMOUNT',
  'DATE',
  'PERCENTAGE',
  'ACCOUNT_NUMBER',
  'EMPLOYEE_ID',
]);

function pseudonymizeLocal(text: string, entities: DetectedEntity[]): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [] };
  }

  // BUG-14: Evict to half capacity using Map insertion order (true LRU).
  // Previously only evicted 100 entries, allowing map to grow to 600 before stabilizing.
  const fwdKeys = Object.keys(currentForwardMap);
  if (fwdKeys.length > MAX_MAP_SIZE) {
    const evictCount = Math.floor(MAX_MAP_SIZE / 2);
    igLog(`Forward map LRU eviction: removing ${evictCount} oldest of ${fwdKeys.length} entries`);
    for (let i = 0; i < evictCount && i < fwdKeys.length; i++) {
      delete currentForwardMap[fwdKeys[i]];
    }
  }

  const mappings: PseudonymMapping[] = [];
  const seen = new Map<string, string>();

  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let maskedText = text;

  for (const entity of sorted) {
    const normalizedText = entity.text.trim();

    // Skip pseudonymization for analytical values — they're still detected
    // and contribute to the sensitivity score, but keeping them real ensures
    // the AI's computations (gaps, percentages, comparisons) are correct.
    if (VALUE_TYPES.has(entity.type)) {
      continue;
    }
    // Check local seen map first (within this call)
    let pseudonym = seen.get(normalizedText);
    if (!pseudonym) {
      // Check global forward map (from previous messages in conversation)
      pseudonym = currentForwardMap[normalizedText];
    }
    // DEF-014: Fuzzy forward map lookup — detection may extract slightly different
    // text across turns (extra whitespace, trailing punctuation, case differences).
    // Without this, the same real entity gets different pseudonyms across turns,
    // leaking the real name when the LLM quotes Turn 1's pseudonym in Turn 2.
    if (!pseudonym) {
      const normLower = normalizedText.toLowerCase().replace(/\s+/g, ' ');
      for (const [orig, fake] of Object.entries(currentForwardMap)) {
        if (orig.toLowerCase().replace(/\s+/g, ' ') === normLower) {
          pseudonym = fake;
          // Also register the exact text variant so future lookups are instant
          currentForwardMap[normalizedText] = fake;
          break;
        }
      }
    }
    if (!pseudonym) {
      // Generate a new realistic fake — ensure uniqueness:
      // 1. Must not collide with another pseudonym (would make reverse map ambiguous)
      // 2. Must not collide with another ORIGINAL (would cause cascading replacement
      //    during de-pseudo: e.g., fake "14.2%" colliding with original "14.2%" churn)
      // 3. Must not be a substring of another pseudonym or vice versa (short fakes
      //    like "$4M" matching inside "$4.2B")
      const usedFakes = new Set(Object.values(currentForwardMap));
      const usedOriginals = new Set(Object.keys(currentForwardMap));
      // Also include originals from this call's seen map (not yet in currentForwardMap)
      for (const [orig] of seen) usedOriginals.add(orig);
      // Check if candidate collides with any existing mapping (exact or substring)
      function hasCollision(c: string): boolean {
        if (usedFakes.has(c) || usedOriginals.has(c) || c === normalizedText) return true;
        // For short tokens (< 8 chars), check substring collisions:
        // a fake "$4M" would match inside another fake "$4.2B" during de-pseudo
        if (c.length < 8) {
          for (const f of usedFakes) {
            if (f.includes(c) || c.includes(f)) return true;
          }
          for (const o of usedOriginals) {
            if (o.includes(c) || c.includes(o)) return true;
          }
        }
        return false;
      }
      let candidate = generateFake(entity.type, normalizedText);
      let attempts = 0;
      while (attempts < 10 && hasCollision(candidate)) {
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

// ─── Selective Entity Filtering (Context-Aware Pseudonymization) ────────────
// Instead of pseudonymizing ALL entities when score > 25, filter based on
// entity ownership. Self-owned entities in benign context and public entities
// are allowed through; credentials are always pseudonymized regardless.

function filterEntitiesForPseudonymization(
  text: string,
  allEntities: DetectedEntity[],
  fullScore: { isSelfReferential?: boolean; contextCategory?: string; score: number },
): DetectedEntity[] {
  if (allEntities.length === 0) return allEntities;

  const contextCategory = fullScore.contextCategory || 'general';
  const isBenignContext = fullScore.isSelfReferential === true ||
    ['personal_task', 'resume_review', 'personal_bio', 'code_review', 'creative_writing'].includes(contextCategory);

  const ownerships = classifyEntityOwnership(text, allEntities, contextCategory);

  return allEntities.filter((entity, i) => {
    const ownership = ownerships[i];
    if (!ownership) return true; // Safety: if ownership missing, pseudonymize

    // Always pseudonymize credentials regardless of ownership
    if (ALWAYS_CRITICAL_TYPES.has(entity.type)) return true;

    // Always pseudonymize HIGH_PII_TYPES (SSN, credit card, medical record, etc.)
    if (HIGH_PII_TYPES.has(entity.type)) return true;

    // Self-owned entities in benign context → allow through
    if (ownership.ownership === 'self' && isBenignContext && ownership.confidence >= 0.7) return false;

    // Public entities with sufficient confidence → allow through
    if (ownership.ownership === 'public' && ownership.confidence >= 0.7) return false;

    // Everything else (third_party, internal, unknown, low-confidence) → pseudonymize
    return true;
  });
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
    // CRITICAL: Find the LAST USER message, not the last message overall.
    // If the last message doesn't have content.parts, DON'T fall back to
    // messages[0] (system message) — search backwards for the last user message.
    if (parsed?.messages?.[0]?.content?.parts) {
      for (let i = parsed.messages.length - 1; i >= 0; i--) {
        const m = parsed.messages[i];
        const isUser = m.role === 'user' || m.author === 'user' || m.author?.role === 'user';
        if (m.content?.parts && Array.isArray(m.content.parts)) {
          const text = m.content.parts.filter((p: any) => typeof p === 'string').join('\n');
          if (text.length > 0 && (isUser || i === parsed.messages.length - 1)) return text;
        }
      }
      // Final fallback: first message with parts (should rarely reach here)
      return parsed.messages[0].content.parts.join('\n');
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

    // Generic fallback: find the longest string value in the JSON.
    // Cap at 5000 chars — if a string is longer, it's likely conversation
    // history or assistant response, not a single user prompt.
    const longest = findLongestStringValue(parsed);
    if (longest && longest.length >= 20) {
      if (longest.length > 5000) {
        igLog(`Generic extraction rejected — string too long (${longest.length} chars, likely conversation history)`);
        return null;
      }
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
      const lastMsg = parsed.messages[lastIdx];
      if (lastMsg?.content?.parts) {
        lastMsg.content.parts = [replacement];
      } else if (lastMsg) {
        lastMsg.content = { content_type: 'text', parts: [replacement] };
      }
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
// jsonStringEscape() — imported from ./main-world/depseudo-engine

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

// quickScore is kept only for audit-mode paths (reporting only, no proxy decisions).
// All proxy decisions now use the full computeScore pipeline (imported above).
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
const MAX_MAP_SIZE = 2000; // Raised from 500 — variant generation creates 10-20 entries per entity

// Debounced persistence: batch map updates to content script
let _mapPersistTimer: ReturnType<typeof setTimeout> | null = null;
let _mapPersistPending = false;

function _scheduleMapPersist(): void {
  if (_mapPersistPending) return;
  _mapPersistPending = true;
  if (_mapPersistTimer) clearTimeout(_mapPersistTimer);
  _mapPersistTimer = setTimeout(() => {
    _mapPersistPending = false;
    // Send reverse map via BroadcastChannel (private, not readable by page scripts).
    // The channel name includes the nonce — only the content script can listen.
    _igSecureChannel.postMessage({
      type: 'IRON_GATE_PERSIST_REVERSE_MAP',
      map: { ...currentReverseMap },
      _seq: _clearSequence,
    });
  }, 500);
}

function addReverseMapping(map: Record<string, string>, pseudonym: string, original: string, entityType?: string): void {
  // BUG-14: Evict to half capacity using insertion order (true LRU).
  const keys = Object.keys(map);
  if (keys.length > MAX_MAP_SIZE) {
    const evictCount = Math.floor(MAX_MAP_SIZE / 2);
    igLog(`Reverse map LRU eviction: removing ${evictCount} oldest of ${keys.length} entries`);
    for (let i = 0; i < evictCount && i < keys.length; i++) {
      delete map[keys[i]];
    }
  }

  map[pseudonym] = original;

  // Invalidate regex cache so replacePseudonyms() rebuilds with new entries
  _regexCacheVersion++;

  // Schedule persistence to chrome.storage.session via content script
  if (map === currentReverseMap) {
    _scheduleMapPersist();
  }

  // ── Generate all name/org fragment variants ──────────────────────────────
  //
  // DESIGN: LLMs abbreviate pseudonyms unpredictably. Instead of trying to
  // catch every reformulation at replacement time (Strategy 4/5 etc.), we
  // pre-register ALL likely variants as first-class map entries here.
  // replacePseudonyms then just does simple boundary-aware matching.
  //
  // Two rules govern what gets a fragment key:
  //   1. ORG_SUFFIXES are never fragment keys (Corp, Holdings, etc. are generic)
  //   2. Everything else is allowed — if we generated the pseudonym, we must
  //      be able to de-pseudo every abbreviation of it
  //
  // The old COMMON_WORD_BLOCKLIST is removed. It was the root cause of
  // de-pseudo leaks: it blocked our own pseudonym words (Contoso, Northwind)
  // from fragment mapping. The only guard needed is: don't create a fragment
  // where the fragment text appears inside the original (prevents recursive
  // expansion on DOM observer re-scan).

  const ORG_SUFFIX_SET = new Set([
    'corporation', 'corp', 'corp.', 'inc', 'inc.', 'llc', 'ltd', 'ltd.',
    'partners', 'group', 'holdings', 'capital', 'enterprises', 'associates',
    'international', 'technologies', 'solutions', 'services', 'consulting',
    'management', 'investments', 'advisors', 'advisory', 'fund', 'trust',
    'bank', 'labs', 'co', 'co.', 'company', 'industries', 'foundation',
  ]);

  const isPerson = entityType === 'PERSON';
  const words = pseudonym.split(/\s+/);
  const origWords = original.split(/\s+/);
  const origLower = original.toLowerCase();

  // Helper: safe to add a fragment key?
  const canAddFragment = (key: string): boolean => {
    if (!key || key.length < 3) return false;
    if (map[key]) return false;  // don't overwrite existing entry
    if (ORG_SUFFIX_SET.has(key.toLowerCase())) return false;  // generic suffix
    if (origLower.includes(key.toLowerCase())) return false;  // prevents recursive expansion
    // DEF-012: Don't add fragment if it's a substring of an existing pseudonym key
    // (e.g., fragment "Angela" would corrupt email pseudonym "angela.kumar@example.com"
    // during replacement — the fragment match fires first and garbles the email)
    const keyLower = key.toLowerCase();
    for (const existingKey of Object.keys(map)) {
      if (existingKey.length > key.length && existingKey.toLowerCase().includes(keyLower)) {
        return false;
      }
    }
    return true;
  };

  // ── PERSON fragments: "James Mitchell" → also map "James" → "David", "Mitchell" → "Park"
  const looksLikePerson = isPerson || (looksLikePersonName(pseudonym) && looksLikePersonName(original));
  if (words.length >= 2 && looksLikePerson && origWords.length >= 2 && words.length === origWords.length) {
    for (let i = 0; i < words.length; i++) {
      const pWord = words[i];
      const oWord = origWords[i];
      if (pWord.length < 3 || oWord.length < 2) continue;
      if (pWord.toLowerCase() === oWord.toLowerCase()) continue;
      if (canAddFragment(pWord)) {
        map[pWord] = oWord;
      }
    }
  }

  // ── ORG/PROJECT/OTHER fragments: "Contoso Holdings" → also map "Contoso" → full original
  if (words.length >= 2 && !looksLikePerson) {
    // First word → full original  (AI writes "Contoso's" instead of "Contoso Holdings")
    if (words[0].length >= 4 && canAddFragment(words[0])) {
      map[words[0]] = original;
    }
    // First two words for 3+ word names → full original
    if (words.length >= 3) {
      const firstTwo = words.slice(0, 2).join(' ');
      if (canAddFragment(firstTwo)) {
        map[firstTwo] = original;
      }
    }
    // Last word → full original (only if distinctive, not a suffix)
    if (words.length >= 2) {
      const lastWord = words[words.length - 1];
      if (lastWord.length >= 4 && canAddFragment(lastWord)) {
        map[lastWord] = original;
      }
    }
    // Suffix-stripped: "Adatum Corporation" → "Adatum" → full original
    const ORG_SUFFIX_RE = /\s+(Corporation|Corp\.?|Inc\.?|LLC|Ltd\.?|Partners|Group|Holdings|Capital|Enterprises|Associates|International|Technologies|Solutions|Services|Consulting|Management|Investments|Advisors|Advisory|Fund|Trust|Bank|Labs|Co\.?)$/i;
    const withoutSuffix = pseudonym.replace(ORG_SUFFIX_RE, '');
    if (withoutSuffix !== pseudonym && canAddFragment(withoutSuffix)) {
      map[withoutSuffix] = original;
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
      // Only create integer variant if the key doesn't already exist — prevents
      // overwriting a DIFFERENT percentage entity's mapping. E.g., if both "22%"
      // and "22.1%" are pseudonyms, "22.1%" should NOT overwrite the "22%" entry.
      if (!map[intPart + '%']) map[intPart + '%'] = original;
      if (!map[intPart + ' percent']) map[intPart + ' percent'] = original;
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

  // Numeric date format variants: covers both US (M/D/YYYY) and ISO (YYYY-MM-DD) formats.
  // LLMs freely reformat dates — "2020-07-21" → "7/21/2020", "July 21, 2020", etc.
  // We generate all cross-format variants so de-pseudo catches every reformatting.

  // US format: "4/15/2026" ↔ "04/15/2026"
  const numDateMatch = pseudonym.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{2,4})$/);
  if (numDateMatch) {
    const m = numDateMatch[1], sep = numDateMatch[2], d = numDateMatch[3], y = numDateMatch[4];
    const withZeros = m.padStart(2, '0') + sep + d.padStart(2, '0') + sep + y;
    const withoutZeros = parseInt(m) + sep + parseInt(d) + sep + y;
    if (withZeros !== pseudonym) map[withZeros] = original;
    if (withoutZeros !== pseudonym) map[withoutZeros] = original;
    // Cross-format: US → ISO (YYYY-MM-DD)
    const fullYear = y.length === 2 ? (parseInt(y) > 50 ? '19' + y : '20' + y) : y;
    const isoKey = fullYear + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
    if (!map[isoKey]) map[isoKey] = original;
    // US with slashes: 4/15/2026
    const slashKey = parseInt(m) + '/' + parseInt(d) + '/' + fullYear;
    if (!map[slashKey]) map[slashKey] = original;
    const slashPadded = m.padStart(2, '0') + '/' + d.padStart(2, '0') + '/' + fullYear;
    if (!map[slashPadded]) map[slashPadded] = original;
    // DEF-013: Written-out date variants for numeric pseudonyms
    // LLMs reformat "07/18/1981" → "July 18, 1981" — must catch these.
    // CRITICAL: The original side must ALSO be in spelled-out form so the user
    // sees "November 22, 1978" (not raw "11/22/1978") when the LLM writes dates.
    const MONTH_FULL_NUM = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const MONTH_SHORT_NUM = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mi = parseInt(m), di = parseInt(d);
    // Parse the ORIGINAL date to generate matching spelled-out original
    const origDateMatch = original.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    const origIsoMatch = original.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let origSpelled = original; // fallback to raw original
    if (origDateMatch) {
      const om = parseInt(origDateMatch[1]), od = parseInt(origDateMatch[3] || origDateMatch[2]);
      const oy = origDateMatch[3] || origDateMatch[2];
      const origFullYear = oy.length === 2 ? (parseInt(oy) > 50 ? '19' + oy : '20' + oy) : oy;
      if (om >= 1 && om <= 12) origSpelled = MONTH_FULL_NUM[om] + ' ' + od + ', ' + origFullYear;
    } else if (origIsoMatch) {
      const om = parseInt(origIsoMatch[2]), od = parseInt(origIsoMatch[3]);
      if (om >= 1 && om <= 12) origSpelled = MONTH_FULL_NUM[om] + ' ' + od + ', ' + origIsoMatch[1];
    }
    // Also parse original as written date
    const origWrittenMatch = original.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/i);
    if (origWrittenMatch) origSpelled = original; // already spelled out
    if (mi >= 1 && mi <= 12) {
      const dayStr = String(di);
      if (!map[MONTH_FULL_NUM[mi] + ' ' + dayStr + ', ' + fullYear]) map[MONTH_FULL_NUM[mi] + ' ' + dayStr + ', ' + fullYear] = origSpelled;
      if (!map[MONTH_SHORT_NUM[mi] + ' ' + dayStr + ', ' + fullYear]) map[MONTH_SHORT_NUM[mi] + ' ' + dayStr + ', ' + fullYear] = origSpelled;
      const ord = (di === 1 || di === 21 || di === 31) ? 'st' : (di === 2 || di === 22) ? 'nd' : (di === 3 || di === 23) ? 'rd' : 'th';
      if (!map[MONTH_FULL_NUM[mi] + ' ' + dayStr + ord + ', ' + fullYear]) map[MONTH_FULL_NUM[mi] + ' ' + dayStr + ord + ', ' + fullYear] = origSpelled;
      if (!map[MONTH_FULL_NUM[mi] + ' ' + dayStr + ' ' + fullYear]) map[MONTH_FULL_NUM[mi] + ' ' + dayStr + ' ' + fullYear] = origSpelled;
      if (!map[dayStr + ' ' + MONTH_FULL_NUM[mi] + ' ' + fullYear]) map[dayStr + ' ' + MONTH_FULL_NUM[mi] + ' ' + fullYear] = origSpelled;
    }
  }

  // ISO format: "2020-07-21" → also generate US variants and written-out formats
  const isoDateMatch = pseudonym.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const y = isoDateMatch[1], m = isoDateMatch[2], d = isoDateMatch[3];
    // US formats: M/D/YYYY, MM/DD/YYYY, M-D-YYYY
    const mi = parseInt(m), di = parseInt(d);
    if (!map[mi + '/' + di + '/' + y]) map[mi + '/' + di + '/' + y] = original;
    if (!map[m + '/' + d + '/' + y]) map[m + '/' + d + '/' + y] = original;
    if (!map[mi + '-' + di + '-' + y]) map[mi + '-' + di + '-' + y] = original;
    if (!map[m + '-' + d + '-' + y]) map[m + '-' + d + '-' + y] = original;
    // Written-out: "July 21, 2020", "Jul 21, 2020"
    // DEF-013: Map spelled-out pseudonym → spelled-out original (not numeric original)
    const MONTH_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Parse original date to generate matching spelled-out original
    const origDateMatchISO = original.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    const origIsoMatchISO = original.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let isoOrigSpelled = original;
    if (origDateMatchISO) {
      const om = parseInt(origDateMatchISO[1]), od = parseInt(origDateMatchISO[2]);
      const oy = origDateMatchISO[3];
      const origFY = oy.length === 2 ? (parseInt(oy) > 50 ? '19' + oy : '20' + oy) : oy;
      if (om >= 1 && om <= 12) isoOrigSpelled = MONTH_FULL[om] + ' ' + od + ', ' + origFY;
    } else if (origIsoMatchISO) {
      const om = parseInt(origIsoMatchISO[2]), od = parseInt(origIsoMatchISO[3]);
      if (om >= 1 && om <= 12) isoOrigSpelled = MONTH_FULL[om] + ' ' + od + ', ' + origIsoMatchISO[1];
    }
    if (mi >= 1 && mi <= 12) {
      const dayStr = String(di);
      // "July 21, 2020" and "Jul 21, 2020"
      if (!map[MONTH_FULL[mi] + ' ' + dayStr + ', ' + y]) map[MONTH_FULL[mi] + ' ' + dayStr + ', ' + y] = isoOrigSpelled;
      if (!map[MONTH_SHORT[mi] + ' ' + dayStr + ', ' + y]) map[MONTH_SHORT[mi] + ' ' + dayStr + ', ' + y] = isoOrigSpelled;
      // With ordinal: "July 21st, 2020"
      const ord = (di === 1 || di === 21 || di === 31) ? 'st' : (di === 2 || di === 22) ? 'nd' : (di === 3 || di === 23) ? 'rd' : 'th';
      if (!map[MONTH_FULL[mi] + ' ' + dayStr + ord + ', ' + y]) map[MONTH_FULL[mi] + ' ' + dayStr + ord + ', ' + y] = isoOrigSpelled;
      // Without comma: "July 21 2020"
      if (!map[MONTH_FULL[mi] + ' ' + dayStr + ' ' + y]) map[MONTH_FULL[mi] + ' ' + dayStr + ' ' + y] = isoOrigSpelled;
      // "21 July 2020" (international format)
      if (!map[dayStr + ' ' + MONTH_FULL[mi] + ' ' + y]) map[dayStr + ' ' + MONTH_FULL[mi] + ' ' + y] = isoOrigSpelled;
    }
    // Without leading zeros: 2020-7-21
    const noZeroKey = y + '-' + mi + '-' + di;
    if (noZeroKey !== pseudonym && !map[noZeroKey]) map[noZeroKey] = original;
  }

  // Written-out date → also generate numeric variants
  // "March 15, 2021" ↔ "2021-03-15" ↔ "3/15/2021"
  const writtenDateMatch = pseudonym.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/i);
  if (writtenDateMatch) {
    const MONTH_MAP: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    };
    const mNum = MONTH_MAP[writtenDateMatch[1].toLowerCase()];
    const dNum = writtenDateMatch[2].padStart(2, '0');
    const yStr = writtenDateMatch[3];
    if (mNum) {
      // ISO
      if (!map[yStr + '-' + mNum + '-' + dNum]) map[yStr + '-' + mNum + '-' + dNum] = original;
      // US numeric
      if (!map[parseInt(mNum) + '/' + parseInt(dNum) + '/' + yStr]) map[parseInt(mNum) + '/' + parseInt(dNum) + '/' + yStr] = original;
      if (!map[mNum + '/' + dNum + '/' + yStr]) map[mNum + '/' + dNum + '/' + yStr] = original;
    }
  }

  // ── EMAIL variants: handle case changes and display formatting ──────────
  // LLMs may output pseudonym emails in different case: "Anna.Peterson@RedwoodCorp.io"
  // when the pseudonym was "anna.peterson@redwoodcorp.io". The boundary-aware regex
  // handles case-insensitive matching (Strategy 3), but emails also need:
  //   1. Lowercase variant (most common LLM output)
  //   2. Title-case local part variant (some LLMs capitalize names in emails)
  //   3. JSON-encoded variant (for SSE streams)
  if (entityType === 'EMAIL' && pseudonym.includes('@')) {
    const lower = pseudonym.toLowerCase();
    if (lower !== pseudonym && !map[lower]) map[lower] = original;
    const upper = pseudonym.toUpperCase();
    if (upper !== pseudonym && !map[upper]) map[upper] = original;
    // Local part variants: anna.peterson → Anna.Peterson
    const [localPart, domain] = pseudonym.split('@');
    if (localPart && domain) {
      const titleLocal = localPart.replace(/\b\w/g, c => c.toUpperCase());
      const titleVariant = titleLocal + '@' + domain;
      if (titleVariant !== pseudonym && !map[titleVariant]) map[titleVariant] = original;
    }
  }

  // Persist to sessionStorage when modifying the global map (not snapshots)
  // Reverse map is in-memory only — no persistence to sessionStorage (security)
}

// ── Regex cache for replacePseudonyms (avoids recompiling per chunk) ──
// Uses a version counter instead of object identity because reverseMap is mutated in-place.
let _regexCacheVersion = 0;  // Bumped by addReverseMapping()
let _regexCacheBuiltVersion = -1;  // Version when cache was last built
let _regexCacheMap: Record<string, string> | null = null;  // Map identity when cache was last built
// CachedPseudoEntry, looksLikePersonName, _ORG_SUFFIXES — imported from ./main-world/depseudo-engine
let _regexCache: CachedPseudoEntry[] = [];

// buildRegexCache() — imported from ./main-world/depseudo-engine

function replacePseudonyms(text: string, reverseMap: Record<string, string>): string {
  // Build/rebuild regex cache when reverseMap changes.
  // Track both version counter (for mutable currentReverseMap) AND the map identity
  // (for snapshot maps passed by depseudonymizeResponse). Without identity check,
  // a snapshot from request A would incorrectly reuse request B's cache.
  if (_regexCacheBuiltVersion !== _regexCacheVersion || _regexCacheMap !== reverseMap) {
    _regexCacheBuiltVersion = _regexCacheVersion;
    _regexCacheMap = reverseMap;
    _regexCache = buildRegexCache(reverseMap);
  }

  // Delegate to the stateless core engine (extracted to depseudo-engine.ts)
  return replacePseudonymsCore(text, _regexCache);
}

/**
 * Persistent DOM de-pseudonymization observer.
 *
 * Claude (and similar platforms) re-render conversation from server state
 * (via WebSocket binary frames → React state), overwriting stream-level de-pseudo.
 * We need a persistent observer that wins the race against React re-renders.
 *
 * Key design decisions:
 * - Uses `currentReverseMap` (global, always has latest mappings)
 * - Runs indefinitely (no timeout) — lives for the page lifetime
 * - NO blanket `_isScanning` guard (that drops mutations = race condition)
 * - Uses per-node `_igSkip` WeakSet to skip only our own mutations
 * - 500ms poll as fallback for React batch re-renders
 * - After any replacement, schedules rapid follow-up scans (100ms, 300ms)
 *   to beat React's next render cycle
 * - Only modifies text nodes (safe — React doesn't track text node content)
 */
let _persistentObserver: MutationObserver | null = null;
let _persistentPollTimer: ReturnType<typeof setInterval> | null = null;
let _persistentReplacementCount = 0;
// WeakSet of text nodes we just modified — observer skips these once then forgets
const _igOurMutations = new WeakSet<Node>();
// M-3 FIX: WeakSet to prevent concurrent depseudonymizeUserBubble calls from
// double-processing the same node. Check+add BEFORE mutation, not after.
const _igBubbleProcessed = new WeakSet<Node>();
// Pending rapid follow-up scan
let _rapidScanPending = false;
// BUG-21: Session sequence number for clearReverseMapFully() — used to reject stale
// RESTORE_REVERSE_MAP messages. Incremented on every clear, checked on every restore.
// The old time-based 5s window caused a race: a second prompt within 5s had its
// restore silently dropped. Sequence numbers are immune to timing.
let _clearSequence = 0;
let _lastClearTime = 0;

// ── Conversation boundary timeout ──────────────────────────────────────────
// Fallback: if URL-based conversation detection fails (platform changed their
// URL structure), clear the map after 30 minutes of no pseudonymization activity.
// This prevents stale pseudonyms from leaking across conversations indefinitely.
const MAP_INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let _mapActivityTimer: ReturnType<typeof setTimeout> | null = null;

function _resetMapActivityTimer(): void {
  if (_mapActivityTimer) clearTimeout(_mapActivityTimer);
  _mapActivityTimer = setTimeout(() => {
    if (Object.keys(currentReverseMap).length > 0) {
      igLog('Map inactivity timeout (30 min) — clearing stale pseudonyms');
      clearReverseMapFully();
    }
  }, MAP_INACTIVITY_TIMEOUT);
}

// ─── Turn Coordinator ─────────────────────────────────────────────────────────
// LLM platforms fire 2-5 fetch/XHR requests per user turn (preflight, metadata,
// conversation history, actual prompt). Each produces its own detection result.
// Without coordination, results race — a 0-entity preflight can overwrite a real
// detection that arrived milliseconds earlier.
//
// The Turn Coordinator replaces the old cancelPendingAudit/markSignificantNotify
// timer approach with a single collect-then-emit pattern:
//
//   INTERCEPTED or AUDIT-with-entities → emit immediately, cancel any pending window
//   0-entity AUDIT → buffer for 800ms, emit only if nothing better arrives
//
// This eliminates the entire class of race-condition bugs.
/**
 * Turn Coordinator — Gate that controls what reaches the sidepanel.
 *
 * ARCHITECTURE (production-grade, replaces buffer/window/sequence approach):
 *
 *   The sidepanel shows the LAST SIGNIFICANT SCAN result. Non-significant
 *   results (0-entity, low-score AUDITs from metadata/preflight/polling
 *   fetches) are DROPPED HERE and never reach the sidepanel at all.
 *
 *   "All Clear" is handled by PROMPT_CLEARED (fires when user's input field
 *   is cleared after submission, already debounced) and tab navigation.
 *
 *   This eliminates the entire class of "0-entity overwrites real detection"
 *   bugs because the noise never enters the pipeline. No buffer windows,
 *   no sequence numbers, no suppression rules in the sidepanel.
 *
 * What passes through:
 *   - INTERCEPTED (any score) — pseudonymized prompt, always significant
 *   - AUDIT with entities > 0 — found something, always significant
 *   - AUDIT with score > 25 — contextual/semantic detection, no entities but meaningful
 *
 * What gets dropped:
 *   - 0-entity AUDIT with score ≤ 25 — metadata fetch, preflight, polling noise
 */
const turnCoordinator = (() => {
  type QueuedResult = {
    type: 'IRON_GATE_INTERCEPTED' | 'IRON_GATE_AUDIT';
    promptText: string;
    allEntities: Array<{ type: string; text: string; start: number; end: number; confidence: number; source: string }>;
    maskedText: string;
    mappings: Array<{ pseudonym: string; type: string; length: number }>;
    level: string;
    score: number;
    extra?: Record<string, unknown>;
  };

  function _emit(r: QueuedResult): void {
    igLog(`Turn coordinator: EMIT ${r.type} score=${r.score} entities=${r.allEntities.length}`);
    notifyContentScript(r.type, r.promptText, r.allEntities, r.maskedText, r.mappings, r.level, r.score, r.extra);

    // B1: Record an audit entry for the configured sink. The audit entry
    // contains ONLY counts and types — never the original prompt text or
    // entity values. The audit buffer in the worker batches and delivers.
    //
    // The shape is enforced by the AuditEntry interface on the worker side;
    // any field added here that could contain raw PII text would fail the
    // architecture invariant test for PII-in-audit.
    const entityTypes = Array.from(new Set(r.allEntities.map(e => e.type)));
    const action: 'allowed' | 'pseudonymized' | 'blocked' | 'low-risk-passthrough' =
      r.type === 'IRON_GATE_INTERCEPTED'
        ? 'pseudonymized'
        : r.score > 25
          ? 'allowed'
          : 'low-risk-passthrough';
    const zone: 'green' | 'amber' | 'red' =
      r.score > 60 ? 'red' : r.score > 25 ? 'amber' : 'green';

    igPostMessage({
      type: 'IRON_GATE_RECORD_AUDIT',
      payload: {
        aiTool: activeAdapter?.id || 'unknown',
        zone,
        score: r.score,
        entityCount: r.allEntities.length,
        entityTypes, // type strings only, NO values
        action,
        tier: 1, // updated to 2 in pipeline if Tier 2 was consulted
        pseudonymsApplied: r.mappings?.length ?? 0,
        modelUsed: (r.extra?.modelUsed as string) || undefined,
        latencyMs: (r.extra?.latencyMs as number) || undefined,
      },
    });
  }

  // Dedup: prevent the same prompt from emitting twice within a short window.
  // ChatGPT (and some adapters) can trigger two fetch interceptions for one
  // user submit, producing near-identical results (e.g., 373ch vs 372ch).
  // Without dedup, the sidepanel receives 2× events × 5 delivery channels
  // = 10+ processDetection calls, causing visible flickering and CPU churn.
  let _lastEmitHash = '';
  let _lastEmitAt = 0;
  const DEDUP_WINDOW_MS = 3000;

  function _promptHash(text: string): string {
    // Fast 53-bit hash of the first 300 chars — enough to identify the same prompt
    let h = 0;
    const s = text.substring(0, 300);
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  return {
    submit(r: QueuedResult): void {
      // INTERCEPTED: always significant — pseudonymization occurred
      if (r.type === 'IRON_GATE_INTERCEPTED') {
        const hash = _promptHash(r.promptText);
        const now = Date.now();
        if (hash === _lastEmitHash && now - _lastEmitAt < DEDUP_WINDOW_MS) {
          igLog(`Turn coordinator: DEDUP skip (same prompt within ${DEDUP_WINDOW_MS}ms)`);
          return;
        }
        _lastEmitHash = hash;
        _lastEmitAt = now;
        _emit(r);
        return;
      }

      // AUDIT with entities: found something — always significant
      if (r.allEntities.length > 0) {
        _emit(r);
        return;
      }

      // AUDIT with meaningful score (contextual/semantic detection): significant
      if (r.score > 25) {
        _emit(r);
        return;
      }

      // ── 0-entity, low-score AUDIT: DROP ──
      // These come from metadata fetches, title generation, conversation
      // updates, and other platform traffic that matches LLM endpoint patterns.
      // They are indistinguishable from genuinely clean user prompts at this
      // layer. Sending CLEAN_SUBMIT here caused real detections to be wiped
      // when a secondary platform fetch arrived seconds later with 0 entities.
      //
      // The sidepanel clears via tab navigation and PROMPT_CLEARED (from DOM
      // observer detecting empty input field). That's the correct signal.
      igLog(`Turn coordinator: DROP 0-entity AUDIT (score=${r.score}) — not forwarded`);
    },
  };
})();

/**
 * Clears the reverse pseudonym map completely — map, regex cache, DOM observer,
 * AND persisted encrypted storage. Use this whenever a new prompt goes through
 * passthrough (no pseudonymization needed) to prevent stale pseudonyms from:
 *   1. Wrapping clean responses with old mappings
 *   2. Showing up in DOM de-pseudo polls
 *   3. Being restored from storage on page refresh
 *   4. Leaking into sidepanel as stale swap data
 */
function clearReverseMapFully(): void {
  // M-4 FIX: If there are active SSE streams being de-pseudonymized,
  // defer the clear until all streams complete. This prevents wiping
  // the map mid-stream when the user navigates to a new conversation.
  if (_activeStreamCount > 0) {
    _pendingClear = true;
    igLog(`clearReverseMapFully: deferred — ${_activeStreamCount} active stream(s)`);
    return;
  }

  const hadEntries = Object.keys(currentReverseMap).length > 0;
  currentReverseMap = {};
  _pendingClear = false;
  _clearSequence++;
  _lastClearTime = Date.now();
  _regexCacheVersion++;

  // Stop the DOM observer — no pseudonyms to replace
  if (_persistentObserver) {
    _persistentObserver.disconnect();
    _persistentObserver = null;
  }
  if (_persistentPollTimer) {
    clearTimeout(_persistentPollTimer);
    _persistentPollTimer = null;
  }
  _persistentReplacementCount = 0;

  // Persist the EMPTY map to encrypted storage so stale keys
  // don't resurrect on page refresh
  if (hadEntries) {
    igPostMessage({
      type: 'IRON_GATE_PERSIST_REVERSE_MAP',
      map: {},
      _seq: _clearSequence,
    });
    igLog('Cleared reverse map fully (map + observer + persisted storage)');
  }
}

/**
 * M-4: Called when a de-pseudo stream ends. Decrements active stream count
 * and executes any deferred clearReverseMapFully() if all streams are done.
 */
function _onStreamEnd(): void {
  _activeStreamCount = Math.max(0, _activeStreamCount - 1);
  if (_activeStreamCount === 0 && _pendingClear) {
    igLog('All active streams ended — executing deferred clearReverseMapFully()');
    clearReverseMapFully();
  }
}

function scanTextNodes(root: Node): number {
  if (Object.keys(currentReverseMap).length === 0) return 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let replacements = 0;
  let textNode: Node | null = walker.nextNode();
  while (textNode) {
    const text = textNode.textContent || '';
    if (text.length > 2) {
      // Use the SAME replacePseudonyms engine as stream de-pseudo.
      // This ensures name fragments, case-insensitive matching, and all
      // 5 strategies work identically in both the stream and DOM paths.
      const replaced = replacePseudonyms(text, currentReverseMap);
      if (replaced !== text) {
        _igOurMutations.add(textNode);
        textNode.textContent = replaced;
        replacements++;
      }
    }
    textNode = walker.nextNode();
  }
  return replacements;
}

/** Schedule rapid follow-up scans after a replacement to beat React re-renders */
function scheduleRapidFollowUp(): void {
  if (_rapidScanPending) return;
  _rapidScanPending = true;
  // Scan again at 100ms and 300ms to catch React's next render cycle
  setTimeout(() => {
    scanTextNodes(document.body);
    setTimeout(() => {
      scanTextNodes(document.body);
      _rapidScanPending = false;
    }, 200);
  }, 100);
}

function startPersistentDomDepseudo(): void {
  if (_persistentObserver) return;

  igLog(`Starting persistent DOM de-pseudo observer (reverseMap: ${Object.keys(currentReverseMap).length} keys)`);

  _persistentObserver = new MutationObserver((mutations) => {
    if (Object.keys(currentReverseMap).length === 0) return;

    let didReplace = false;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        // Skip mutations WE caused (one-shot: skip once then forget).
        // BUT: if the new text contains a pseudonym, React reverted our replacement
        // (e.g., a subsequent WS heartbeat/save triggered a re-render). In that case
        // do NOT skip — fall through and replace again.
        if (_igOurMutations.has(mutation.target)) {
          _igOurMutations.delete(mutation.target);
          const revertedText = mutation.target.textContent || '';
          // Check if React reverted our replacement by running the full engine.
          // If replacePseudonyms would change the text, React overwrote us — re-fix it.
          const wouldReplace = revertedText.length > 2 && replacePseudonyms(revertedText, currentReverseMap) !== revertedText;
          if (!wouldReplace) continue; // Truly our mutation — safe to skip
          // Fall through: React reverted our replacement with a pseudonym — fix it
        }
        // Framework changed this text node — run full replacement engine
        const text = mutation.target.textContent || '';
        if (text.length > 2) {
          const replaced = replacePseudonyms(text, currentReverseMap);
          if (replaced !== text) {
            _igOurMutations.add(mutation.target);
            mutation.target.textContent = replaced;
            _persistentReplacementCount++;
            didReplace = true;
          }
        }
        continue;
      }

      // childList: React replaced entire subtrees — scan new nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
          const count = scanTextNodes(node);
          if (count > 0) {
            _persistentReplacementCount += count;
            didReplace = true;
          }
        }
      }
    }

    // If we replaced anything, React may re-render again soon — schedule follow-up
    if (didReplace) {
      scheduleRapidFollowUp();
    }
  });

  _persistentObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Fallback polling with exponential backoff — starts at 500ms, backs off
  // to 10s when no replacements are found. Resets to 500ms on any replacement.
  // This saves CPU on long idle conversations while staying responsive during
  // active streaming.
  let _pollCount = 0;
  let _pollInterval = 500;
  let _consecutiveEmptyPolls = 0;
  const POLL_MIN = 500;
  const POLL_MAX = 10_000;

  function schedulePoll(): void {
    _persistentPollTimer = setTimeout(() => {
      if (Object.keys(currentReverseMap).length === 0) {
        schedulePoll();
        return;
      }
      _pollCount++;
      const count = scanTextNodes(document.body);
      if (count > 0) {
        _persistentReplacementCount += count;
        _consecutiveEmptyPolls = 0;
        _pollInterval = POLL_MIN; // Reset to fast polling on replacement
        igLog(`DOM POLL: ${count} replacements in poll #${_pollCount} (total: ${_persistentReplacementCount})`);
        scheduleRapidFollowUp();
      } else {
        _consecutiveEmptyPolls++;
        // Exponential backoff: 500 → 1000 → 2000 → 4000 → 8000 → 10000
        if (_consecutiveEmptyPolls > 3) {
          _pollInterval = Math.min(_pollInterval * 2, POLL_MAX);
        }
      }
      schedulePoll();
    }, _pollInterval) as any;
  }
  schedulePoll();

  // BUG-01: Clean up observer + poll timer on navigation to prevent memory leak.
  // Each navigation was adding another observer + timer layer without cleanup.
  window.addEventListener('beforeunload', () => {
    if (_persistentObserver) {
      _persistentObserver.disconnect();
      _persistentObserver = null;
    }
    if (_persistentPollTimer) {
      clearTimeout(_persistentPollTimer);
      _persistentPollTimer = null;
    }
  });
}

/**
 * Entry point — ensures the persistent observer is running and does an immediate scan.
 * Merges the request's reverse map into the global map.
 */
function depseudonymizeUserBubble(reverseMap: Record<string, string>): void {
  if (Object.keys(reverseMap).length === 0) return;

  // Use the SNAPSHOT for scanning — do NOT merge into currentReverseMap.
  // Previously, merging the snapshot back into the global map caused stale
  // entries to persist after clearReverseMapFully() — the merge re-populated
  // the map, causing DOM polls and response wrapping with stale entries.
  // Instead, scan directly with the snapshot's entries.
  function scanWithSnapshot(root: Node): number {
    let count = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (!node.textContent || node.textContent.length <= 2) continue;
      // M-3 FIX: Check and add to WeakSet BEFORE replacement to prevent
      // concurrent calls from double-processing the same node.
      if (_igBubbleProcessed.has(node)) continue;
      _igBubbleProcessed.add(node);
      // Use the SAME replacePseudonyms engine as stream de-pseudo.
      const replaced = replacePseudonyms(node.textContent, reverseMap);
      if (replaced !== node.textContent) {
        _igOurMutations.add(node);
        node.textContent = replaced;
        count++;
      }
    }
    return count;
  }

  console.log(`[Iron Gate DOM] depseudonymizeUserBubble called: ${Object.keys(reverseMap).length} mappings, keys: ${Object.keys(reverseMap).join(', ')}`);
  const count = scanWithSnapshot(document.body);
  if (count > 0) {
    console.log(`[Iron Gate DOM] User bubble immediate scan: ${count} replacements`);
  }

  // Delayed scans to catch the user bubble after the platform renders it.
  // Claude/Gemini render the user bubble ~200-500ms after the fetch completes.
  setTimeout(() => scanWithSnapshot(document.body), 300);
  setTimeout(() => scanWithSnapshot(document.body), 800);
  setTimeout(() => scanWithSnapshot(document.body), 1500);
}

/**
 * Strip position-offset annotations from SSE JSON data lines.
 * ChatGPT's SSE includes `displayedContentReferences` and similar fields with
 * character-offset annotations. When we replace pseudonyms (changing text length),
 * these offsets become invalid and corrupt ChatGPT's rendering. Stripping them
 * is safe — they're cosmetic (citation hover) and the response still renders correctly.
 */
function stripOffsetAnnotations(text: string): string {
  // Only process SSE data lines that look like JSON.
  // IMPORTANT: Use [^\n]+ (not [\s\S]+) to avoid spanning multiple lines.
  return text.replace(/^(data: )(\{[^\n]+\})$/gm, (_match, prefix, json) => {
    try {
      const parsed = JSON.parse(json);
      let changed = false;

      // ChatGPT SSE: message.metadata.displayedContentReferences (citation offsets)
      if (parsed?.message?.metadata?.displayedContentReferences) {
        delete parsed.message.metadata.displayedContentReferences;
        changed = true;
      }
      // Also strip cite_metadata and content_references (variant field names)
      if (parsed?.message?.metadata?.cite_metadata) {
        delete parsed.message.metadata.cite_metadata;
        changed = true;
      }
      if (parsed?.message?.metadata?.content_references) {
        delete parsed.message.metadata.content_references;
        changed = true;
      }

      return changed ? prefix + JSON.stringify(parsed) : _match;
    } catch {
      return _match; // Not valid JSON — leave as-is
    }
  });
}

/**
 * Content-level SSE de-pseudonymization.
 *
 * Architecture: instead of replacing pseudonyms in raw SSE transport text
 * (where "James Park" is split across two JSON objects and never contiguous),
 * we operate at the CONTENT level:
 *
 *   SSE bytes → line splitter → JSON parser → content extractor
 *     → content accumulator → pseudonym replacer → SSE rebuilder → output
 *
 * Two SSE content formats are supported:
 *   1. Accumulated (ChatGPT): each event has full text so far in parts[0]
 *   2. Delta (OpenAI API / Claude): each event has only the new token
 *
 * For accumulated format: replace in the full content; the frontend naturally
 * shows the latest version (corrections appear seamlessly).
 *
 * For delta format: accumulate deltas into a running buffer, replace in the
 * full buffer, diff against previously emitted content to compute the
 * corrected delta.
 *
 * Fallback: non-JSON or unrecognized SSE lines get raw text replacement.
 */
/**
 * Raw-chunk response de-pseudonymization.
 * Decodes each chunk, runs replacePseudonyms on the full decoded text,
 * re-encodes and passes through. No SSE parsing — works with any format.
 * Best for platforms with non-standard SSE (Claude.ai).
 */
function depseudonymizeResponseRaw(response: Response, reverseMap: Record<string, string>): Response {
  if (!response.body || response.bodyUsed) return response;

  // M-6 fix: Snapshot the reverse map at stream-creation time so that
  // concurrent pseudonymization from another prompt cannot pollute this stream.
  const snapshotMap = { ...reverseMap };
  const mapKeys = Object.keys(snapshotMap);
  if (mapKeys.length === 0) return response;

  // BUG-35: Use igLog only (rate-limited) — console.log here caused spam with 100+ entity convos
  igLog(`depseudonymizeResponseRaw: wrapping stream with ${mapKeys.length} mappings (raw-chunk mode)`);

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (readerErr) {
    console.warn('[Iron Gate MAIN] depseudonymizeResponseRaw: getReader() failed —', readerErr instanceof Error ? readerErr.message : String(readerErr));
    return response;
  }

  // M-4: Track active stream for deferred clear
  _activeStreamCount++;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const maxPseudoLen = Math.min(Math.max(...mapKeys.map(k => k.length), 0), 200);
  let chunkCount = 0;
  let totalReplacements = 0;
  let holdback = ''; // Hold back tail of each chunk to handle pseudonyms split across chunks

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          // Flush held-back content
          if (holdback.length > 0) {
            const replaced = replacePseudonyms(holdback, snapshotMap);
            if (replaced !== holdback) totalReplacements++;
            controller.enqueue(encoder.encode(replaced));
          }
          igLog(`depseudonymizeResponseRaw: stream complete — ${chunkCount} chunks, ${totalReplacements} replacements`);
          controller.close();
          _onStreamEnd(); // M-4
          return;
        }

        chunkCount++;
        const decoded = holdback + decoder.decode(value, { stream: true });

        // Hold back the last maxPseudoLen chars to handle pseudonyms split across chunks
        const safeLen = Math.max(0, decoded.length - maxPseudoLen);
        const safeText = decoded.substring(0, safeLen);
        holdback = decoded.substring(safeLen);

        if (safeText.length > 0) {
          const replaced = replacePseudonyms(safeText, snapshotMap);
          if (replaced !== safeText) totalReplacements++;
          controller.enqueue(encoder.encode(replaced));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAbort = msg.includes('aborted') || msg.includes('abort') || msg.includes('cancel');
        if (!isAbort) {
          console.warn('[Iron Gate MAIN] depseudonymizeResponseRaw: stream error', msg);
        }
        try {
          if (holdback.length > 0) {
            controller.enqueue(encoder.encode(holdback));
            holdback = '';
          }
          controller.close();
        } catch {
          try { controller.error(err); } catch { /* already closed */ }
        }
        _onStreamEnd(); // M-4
      }
    },
  });

  const wrappedHeaders = new Headers(response.headers);
  wrappedHeaders.delete('Content-Encoding');
  wrappedHeaders.delete('Content-Length');

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: wrappedHeaders,
  });
}

function depseudonymizeResponse(response: Response, reverseMap: Record<string, string>): Response {
  if (!response.body) {
    igLog('depseudonymizeResponse: no response body — skipping');
    return response;
  }
  // Guard: if body is already locked/consumed, we can't wrap it
  if (response.bodyUsed) {
    igLog('depseudonymizeResponse: body already used — skipping');
    return response;
  }

  // M-6 fix: Snapshot the reverse map at stream-creation time so that
  // concurrent pseudonymization from another prompt cannot pollute this stream.
  const snapshotMap = { ...reverseMap };
  const mapKeys = Object.keys(snapshotMap);
  if (mapKeys.length === 0) {
    igLog('depseudonymizeResponse: no mappings — returning response as-is');
    return response;
  }

  // Check adapter strategy — dispatch to raw-chunk mode for platforms like Claude
  const strategy = activeAdapter?.responseStreamStrategy || 'sse-content';
  console.log(`[Iron Gate DEPSEUDO] Strategy dispatch: adapter=${activeAdapter?.id || 'null'}, strategy=${strategy}, adapterProp=${activeAdapter?.responseStreamStrategy ?? 'MISSING'}`);
  if (strategy === 'raw-chunk') {
    return depseudonymizeResponseRaw(response, snapshotMap);
  }
  if (strategy === 'none') {
    return response;
  }

  igLog(`depseudonymizeResponse: wrapping stream with ${mapKeys.length} mappings (sse-content mode)`);
  console.log(`[Iron Gate DEPSEUDO] Wrapping response stream — ${mapKeys.length} mappings: ${mapKeys.join(', ')}`);

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (readerErr) {
    console.warn('[Iron Gate MAIN] depseudonymizeResponse: getReader() failed —', readerErr instanceof Error ? readerErr.message : String(readerErr));
    return response;
  }

  // M-4: Track active stream for deferred clear
  _activeStreamCount++;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Longest pseudonym — used as holdback margin for partial matches at content tail
  const maxPseudoLen = Math.min(Math.max(...mapKeys.map(k => k.length), 0), 200);

  // ── State ──
  let lineBuffer = '';           // Raw bytes → complete lines
  let deltaAccumulator = '';     // Running content for delta-style SSE
  let emittedDeltaLen = 0;       // How much of replaced delta content we've emitted
  let chunkCount = 0;
  let totalReplacements = 0;

  // ── Content extraction: find the text content in an SSE JSON object ──
  // Returns { mode, content } or null if no content found.
  // Uses adapter-specific extractor when available, falls back to generic patterns.
  function extractContent(parsed: any): { mode: 'accumulated' | 'delta'; content: string } | null {
    // Try adapter-specific extraction first
    if (activeAdapter?.extractResponseContent) {
      const result = activeAdapter.extractResponseContent(parsed);
      if (result) return result;
    }

    // Generic fallbacks — covers ChatGPT, OpenAI API, Anthropic API, Claude.ai
    // ChatGPT accumulated: message.content.parts[0] has full text so far
    const parts = parsed?.message?.content?.parts;
    if (Array.isArray(parts) && typeof parts[0] === 'string') {
      return { mode: 'accumulated', content: parts[0] };
    }
    // OpenAI API delta: choices[0].delta.content
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') {
      return { mode: 'delta', content: delta };
    }
    // Anthropic Messages API stream: delta.text (content_block_delta events)
    const anthropicDelta = parsed?.delta?.text;
    if (typeof anthropicDelta === 'string') {
      return { mode: 'delta', content: anthropicDelta };
    }
    // Claude.ai web: { completion: "accumulated text so far" }
    const completion = parsed?.completion;
    if (typeof completion === 'string') {
      return { mode: 'accumulated', content: completion };
    }
    // ChatGPT 2025+ JSON patch: {"o":"append/add/patch","v":"text or [ops]"}
    // Match on operation type broadly — path format varies across versions
    if (parsed?.o === 'append' && typeof parsed?.v === 'string' && parsed.v.length > 0) {
      return { mode: 'delta', content: parsed.v };
    }
    if (parsed?.o === 'add' && typeof parsed?.v === 'string' && parsed.v.length > 0 && parsed?.p?.includes('content')) {
      return { mode: 'accumulated', content: parsed.v };
    }
    if (parsed?.o === 'patch' && Array.isArray(parsed?.v)) {
      for (const op of parsed.v) {
        if (op?.o === 'append' && typeof op?.v === 'string' && op.v.length > 0) {
          return { mode: 'delta', content: op.v };
        }
      }
    }
    if (parsed?.v?.message?.content?.parts) {
      const vParts = parsed.v.message.content.parts;
      if (Array.isArray(vParts) && typeof vParts[0] === 'string') {
        return { mode: 'accumulated', content: vParts[0] };
      }
    }
    return null;
  }

  // ── Content injection: put modified content back into SSE JSON ──
  // Uses adapter-specific injector when available, falls back to generic patterns.
  function injectContent(parsed: any, mode: 'accumulated' | 'delta', content: string): void {
    // Try adapter-specific injection first
    if (activeAdapter?.injectResponseContent) {
      activeAdapter.injectResponseContent(parsed, mode, content);
      return;
    }

    // Generic fallbacks
    if (mode === 'accumulated') {
      if (parsed?.message?.content?.parts) {
        parsed.message.content.parts[0] = content;
      } else if (parsed?.v?.message?.content?.parts) {
        parsed.v.message.content.parts[0] = content;
      } else if (parsed?.completion !== undefined) {
        parsed.completion = content;
      } else if (parsed?.o === 'add' && typeof parsed?.v === 'string') {
        parsed.v = content;
      }
    } else {
      if (parsed?.choices?.[0]?.delta?.content !== undefined) {
        parsed.choices[0].delta.content = content;
      } else if (parsed?.delta?.text !== undefined) {
        parsed.delta.text = content;
      } else if (parsed?.o === 'append' && typeof parsed?.v === 'string') {
        parsed.v = content;
      } else if (parsed?.o === 'patch' && Array.isArray(parsed?.v)) {
        for (const op of parsed.v) {
          if ((op?.o === 'append' || op?.o === 'add') && typeof op?.v === 'string') {
            op.v = content;
            break;
          }
        }
      }
    }
  }

  // ── Strip offset annotations from parsed ChatGPT SSE ──
  function stripAnnotations(parsed: any): void {
    const meta = parsed?.message?.metadata;
    if (meta) {
      delete meta.displayedContentReferences;
      delete meta.cite_metadata;
      delete meta.content_references;
    }
  }

  // ── Process one complete SSE line ──
  // Returns the modified line string, or null to suppress (holdback for delta mode).
  function processSSELine(line: string): string | null {
    // Pass through empty lines (SSE event separators)
    if (line === '') return '';
    // Non-data lines: could be event types, comments, or raw JSON lines.
    // ChatGPT 2025+ sends raw JSON patch lines without "data: " prefix:
    //   {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"text"}]}
    // These MUST be parsed and content-extracted, not just raw-replaced.
    if (!line.startsWith('data: ')) {
      // Try JSON parsing for raw JSON lines (ChatGPT 2025+ patch format)
      if (line.startsWith('{') && line.length > 10) {
        try {
          const parsed = JSON.parse(line);
          const extracted = extractContent(parsed);
          if (extracted) {
            chunkCount++;
            const { mode, content } = extracted;
            if (mode === 'accumulated') {
              const replaced = replacePseudonyms(content, snapshotMap);
              if (replaced !== content) totalReplacements++;
              stripAnnotations(parsed);
              injectContent(parsed, mode, replaced);
              return JSON.stringify(parsed);
            } else {
              deltaAccumulator += content;
              const replaced = replacePseudonyms(deltaAccumulator, snapshotMap);
              if (replaced !== deltaAccumulator) totalReplacements++;
              const unreplacedSafeLen = deltaAccumulator.length - maxPseudoLen;
              const ratio = deltaAccumulator.length > 0 ? replaced.length / deltaAccumulator.length : 1;
              const safeLen = Math.max(emittedDeltaLen, Math.floor(unreplacedSafeLen * ratio));
              const newDelta = replaced.substring(emittedDeltaLen, safeLen);
              emittedDeltaLen = safeLen;
              injectContent(parsed, mode, newDelta.length > 0 ? newDelta : '');
              return JSON.stringify(parsed);
            }
          }
          // Parsed but no content — raw replacement on serialized JSON
          const reser = JSON.stringify(parsed);
          const replaced = replacePseudonyms(reser, snapshotMap);
          if (replaced !== reser) totalReplacements++;
          return replaced;
        } catch {
          // Not valid JSON — fall through to raw replacement
        }
      }
      if (line.length > 10) {
        const replaced = replacePseudonyms(line, snapshotMap);
        if (replaced !== line) totalReplacements++;
        return replaced;
      }
      return line;
    }
    // Pass through stream terminator
    const payload = line.substring(6);
    if (payload === '[DONE]' || payload.trim() === '[DONE]') return line;
    // Pass through non-JSON payloads
    if (!payload.startsWith('{') && !payload.startsWith('[')) {
      // Raw text replacement fallback
      const replaced = replacePseudonyms(payload, snapshotMap);
      if (replaced !== payload) totalReplacements++;
      return 'data: ' + replaced;
    }

    // ── JSON SSE line: parse, extract content, replace, rebuild ──
    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Invalid JSON — raw text replacement fallback
      const replaced = replacePseudonyms(payload, snapshotMap);
      if (replaced !== payload) totalReplacements++;
      return 'data: ' + replaced;
    }

    const extracted = extractContent(parsed);
    if (!extracted) {
      // Log first few non-content events to understand format
      if (chunkCount <= 3) {
        console.log(`[Iron Gate DEPSEUDO] No content extracted from SSE (chunk ${chunkCount}):`, JSON.stringify(parsed).substring(0, 200));
      }
      // No content field (metadata event, etc.) — pass through with raw replacement
      const reser = JSON.stringify(parsed);
      const replaced = replacePseudonyms(reser, snapshotMap);
      if (replaced !== reser) totalReplacements++;
      return 'data: ' + replaced;
    }

    // Log first content extraction to verify format
    if (chunkCount <= 2 && extracted) {
      console.log(`[Iron Gate DEPSEUDO] Content extracted (${extracted.mode}): "${extracted.content.substring(0, 50)}"`);
    }

    const { mode, content } = extracted;

    if (mode === 'accumulated') {
      // ── Accumulated format (ChatGPT) ──
      // Each event has the FULL text so far. Once both "James" and " Park"
      // are in the accumulated text, "James Park" appears contiguously.
      // Replace in the full content — the frontend always shows the latest
      // version, so corrections appear seamlessly with no flicker.
      const replaced = replacePseudonyms(content, snapshotMap);
      if (replaced !== content) totalReplacements++;
      stripAnnotations(parsed);
      injectContent(parsed, mode, replaced);
      return 'data: ' + JSON.stringify(parsed);
    }

    // ── Delta format (OpenAI API / Claude / others) ──
    // Each event has only the new token. Accumulate into a running buffer,
    // replace in the full buffer, diff to compute the corrected delta.
    deltaAccumulator += content;
    const replaced = replacePseudonyms(deltaAccumulator, snapshotMap);
    if (replaced !== deltaAccumulator) totalReplacements++;

    // Hold back the last maxPseudoLen chars — might be a partial pseudonym.
    // Only emit what's safe (won't change when more content arrives).
    // H-3 FIX: Use deltaAccumulator length (not replaced length) to compute safe boundary.
    // When replacement shortens text ("Jonathan" → "John"), replaced.length < deltaAccumulator.length,
    // and the old formula could advance safeLen beyond the actual safe boundary.
    const unreplacedSafeLen = deltaAccumulator.length - maxPseudoLen;
    // Map the unreplaced safe boundary to the replaced string's coordinate space.
    // The ratio of replaced/unreplaced lengths gives the approximate mapping.
    const ratio = deltaAccumulator.length > 0 ? replaced.length / deltaAccumulator.length : 1;
    const safeLen = Math.max(emittedDeltaLen, Math.floor(unreplacedSafeLen * ratio));
    const newDelta = replaced.substring(emittedDeltaLen, safeLen);
    emittedDeltaLen = safeLen;

    if (newDelta.length === 0) {
      // Held back — but we MUST still emit the event to preserve SSE structure.
      // Claude/Anthropic SSE parsers expect a data line for every event: line.
      // Suppressing the data line breaks their JSON parser.
      // Emit with empty content — the frontend handles empty deltas gracefully.
      injectContent(parsed, mode, '');
      return 'data: ' + JSON.stringify(parsed);
    }

    injectContent(parsed, mode, newDelta);
    return 'data: ' + JSON.stringify(parsed);
  }

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          // ── Flush remaining data ──
          // Process any remaining complete lines in lineBuffer
          if (lineBuffer.length > 0) {
            const remaining = lineBuffer;
            lineBuffer = '';
            const lines = remaining.split('\n');
            for (const line of lines) {
              const result = processSSELine(line);
              if (result !== null) {
                controller.enqueue(encoder.encode(result + '\n'));
              }
            }
          }

          // Flush held-back delta content
          if (emittedDeltaLen < deltaAccumulator.length) {
            const replaced = replacePseudonyms(deltaAccumulator, snapshotMap);
            const finalDelta = replaced.substring(emittedDeltaLen);
            if (finalDelta.length > 0) {
              // Emit as a raw data line (the stream is ending, format doesn't matter)
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":' + JSON.stringify(finalDelta) + '}}]}\n'));
            }
          }

          igLog(`depseudonymizeResponse: stream complete — ${chunkCount} chunks, ${totalReplacements} replacements`);
          console.log(`[Iron Gate DEPSEUDO] Stream complete — ${chunkCount} chunks, ${totalReplacements} replacements, deltaAccum=${deltaAccumulator.length} chars`);
          controller.close();
          _onStreamEnd(); // M-4
          return;
        }

        chunkCount++;
        lineBuffer += decoder.decode(value, { stream: true });

        // Split into complete lines. SSE events are delimited by \n.
        // Keep the last segment (might be incomplete) in lineBuffer.
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const result = processSSELine(line);
          if (result !== null) {
            controller.enqueue(encoder.encode(result + '\n'));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAbort = msg.includes('aborted') || msg.includes('abort') || msg.includes('cancel');
        if (!isAbort) {
          console.warn('[Iron Gate MAIN] depseudonymizeResponse: stream error', msg);
          try {
            window.postMessage({
              type: 'IRON_GATE_DEPSEUDO_FAILURE',
              detail: 'De-pseudonymization stream error — some fake names may appear in the AI response.',
            }, window.location.origin);
          } catch { /* ignore */ }
        }
        // Fail gracefully: flush whatever we have and close.
        try {
          if (lineBuffer.length > 0) {
            controller.enqueue(encoder.encode(lineBuffer));
            lineBuffer = '';
          }
          controller.close();
        } catch {
          try { controller.error(err); } catch { /* already closed */ }
        }
        _onStreamEnd(); // M-4
      }
    },
  });

  // Strip Content-Encoding and Content-Length from the wrapped response.
  // The original response body is already decompressed by the browser;
  // copying these headers to our wrapped Response could cause issues
  // (e.g., frontend expecting compressed data but getting plaintext,
  // or Content-Length mismatch after replacement changes text length).
  const wrappedHeaders = new Headers(response.headers);
  wrappedHeaders.delete('Content-Encoding');
  wrappedHeaders.delete('Content-Length');

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: wrappedHeaders,
  });
}

// ─── DOM De-pseudonymization — REMOVED ──────────────────────────────────────
// All de-pseudonymization now happens at the network layer via depseudonymizeResponse().
// The stream wrapper replaces pseudonyms in fetch Response bodies BEFORE React/framework
// ever sees the text. This eliminates all React removeChild crashes, MutationObserver
// flicker, and DOM manipulation race conditions.
//
// For ChatGPT: displayedContentReferences (offset annotations) are stripped from SSE
// before replacement so length changes don't corrupt rendering.

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
  result?: { score: number; level: string; entities: Array<{ type: string; count: number }>; explanation: string; entitiesFound: number; decision?: string; error?: boolean };
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
  if (pendingFileScans.size >= 50) {
    // Evict oldest entry to prevent unbounded growth
    const oldestKey = pendingFileScans.keys().next().value;
    if (oldestKey) pendingFileScans.delete(oldestKey);
  }
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
      /\/chat\/[^/?#]+\/([^/?#]+)/, // Poe: /chat/{botName}/{chatId} — capture chatId, not botName
      /\/chat\/([^/?#]+)/,          // Claude: /chat/{uuid}
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
      clearReverseMapFully();
      currentForwardMap = {};
      _sessionEntities.clear();
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
const FILE_SCAN_WAIT_TIMEOUT = 3_000; // max wait for pending scan (reduced from 15s to minimize latency)

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
      // Send via BroadcastChannel (private) — not postMessage (broadcast)
      _igSecureChannel.postMessage({
        type: 'IRON_GATE_FILE_UPLOAD',
        fileName: file.name,
        fileSize: file.size,
        fileType: ext,
        fileBase64: base64,
        url: window.location.href,
        timestamp: Date.now(),
      });
    }).catch((err) => {
      // BUG-03: Previously swallowed silently — if file read fails, the pendingFileScans
      // entry stays in 'scanning' forever, permanently blocking the upload gate.
      console.warn('[Iron Gate] File read failed:', file.name, err instanceof Error ? err.message : String(err));
      // Mark scan as complete with 'allow' decision so the gate doesn't hang
      const scanEntry = pendingFileScans.get(fileKey);
      if (scanEntry && scanEntry.status === 'scanning') {
        scanEntry.status = 'complete';
        // H-9 FIX: Fail CLOSED — unreadable files (encrypted, corrupted) should block, not allow.
        scanEntry.result = { score: 100, level: 'critical', entities: [], explanation: 'File read error — blocked (cannot verify safety)', entitiesFound: 0, decision: 'block', error: true };
      }
    });
  } catch (outerErr) {
    console.warn('[Iron Gate] File scan setup failed:', outerErr instanceof Error ? outerErr.message : String(outerErr));
  }
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
        // Use BroadcastChannel (private) — not postMessage (broadcast).
        // Page scripts cannot read BroadcastChannel with nonce-based name.
        _igSecureChannel.postMessage({
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

// ─── Centralized Pseudonymization Hook ───────────────────────────────────
// ARCHITECTURAL FIX: Every code path that pseudonymizes text must call this
// single function. It handles ALL post-pseudonymization actions:
//   1. addReverseMapping (with all variants)
//   2. _sessionEntities registration
//   3. DOM observer kickstart + aggressive rescans
//
// Previously, these actions were scattered across 9+ call sites. Missing any
// one created a bypass gap (DEF-016, DEF-014).

function registerPseudonymization(
  mappings: Array<{ pseudonym: string; original: string; type: string }>,
  options?: { skipDomRescan?: boolean },
): void {
  _resetMapActivityTimer(); // Reset 30-min inactivity timeout on new pseudonymization
  for (const m of mappings) {
    addReverseMapping(currentReverseMap, m.pseudonym, m.original, m.type);
    _sessionEntities.add(m.original); // tracker handles min length + eviction internally
  }
  if (!options?.skipDomRescan && mappings.length > 0) {
    startPersistentDomDepseudo();
    setTimeout(() => scanTextNodes(document.body), 200);
    setTimeout(() => scanTextNodes(document.body), 800);
    setTimeout(() => scanTextNodes(document.body), 2000);
  }
}

// ─── Centralized Response Wrapper ────────────────────────────────────────
// Every code path that returns a fetch Response for an LLM endpoint should
// use this. It wraps with depseudonymizeResponse when the reverse map has entries.

function wrapResponse(response: Response, url: string, snapshotMap?: Record<string, string>): Response {
  const map = snapshotMap || (Object.keys(currentReverseMap).length > 0 ? { ...currentReverseMap } : null);
  if (map && Object.keys(map).length > 0 && adapterIsLLMEndpoint(url, activeAdapter)) {
    return depseudonymizeResponse(response, map);
  }
  return response;
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

  // ─── ENTERPRISE POLICY GATE (A4) ─────────────────────────────────────
  // Before any other logic, check the two managed-config gates:
  //   1. killSwitch — org has disabled ALL AI tools (e.g., incident response)
  //   2. allowedAITools — firm restricts to a subset of tools
  // Both gates ONLY apply to LLM endpoint requests, not generic fetches.
  if (adapterIsLLMEndpoint(url, activeAdapter)) {
    if (_isKillSwitchActive()) {
      igLog('Enterprise kill switch active — blocking LLM request');
      return _buildKillSwitchResponse(
        'AI tools are currently disabled by your organization policy.',
      );
    }
    if (!_isAiToolAllowed(activeAdapter?.id)) {
      igLog(`AI tool "${activeAdapter?.id}" is not in the allowed list — blocking`);
      return _buildKillSwitchResponse(
        `The AI tool "${activeAdapter?.name || activeAdapter?.id}" is not approved by your organization. Contact ${_enterprisePolicy.supportContact}.`,
      );
    }
  }

  // For GET/DELETE/etc: no body to pseudonymize, but response may contain
  // pseudonymized conversation data (e.g., Claude reloads conversation via GET).
  // We MUST de-pseudonymize these responses or React re-renders with fake names.
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    // GET/non-POST: no body to pseudonymize, but wrap response if map has entries
    const response = await originalFetch.call(window, input, init);
    return wrapResponse(response, url);
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
    // Non-LLM endpoint: passthrough (wrapResponse no-ops since adapterIsLLMEndpoint check fails)
    return originalFetch.call(window, input, init);
  }

  // ── Clear stale reverse map — but ONLY for conversation POSTs ──────────────
  // Previous prompt's pseudonyms must be cleared BEFORE any async work (detection,
  // body extraction) so that concurrent GET responses aren't wrapped with stale
  // mappings. If this prompt needs pseudonymization, the map is repopulated below.
  //
  // IMPORTANT: Do NOT clear for non-conversation POSTs (title generation, metadata
  // updates, etc.) — those have short bodies (<50 chars) and their responses need
  // de-pseudonymization using the CURRENT reverse map. Clearing here would wipe
  // the map before the response can be de-pseudonymized.
  // The clear is deferred to AFTER body extraction — only triggered when body >= 50 chars.

  // ── Skip fetch processing EARLY for platforms where DOM/WS handles request ──
  // CRITICAL: Must check BEFORE getBodyString() — reading the body (especially
  // ReadableStream) can consume/mutate the request and cause Copilot to hang.
  // See commits 4116f4a, 4b6bc05 for the original fix.
  //
  // Copilot: dom-capture-wire + WS.prototype.send handles pseudonymization.
  //          Pass fetch through IMMEDIATELY without touching body.
  // Gemini:  dom-presubmit handles pseudonymization; fetch response needs de-pseudo.
  if (shouldSkipFetchProxy(url, activeAdapter)) {
    // For dom-presubmit adapters (Gemini), we still need to:
    //   1. Run file upload gate
    //   2. Wrap response for de-pseudonymization
    if (activeAdapter?.interception === 'dom-presubmit') {
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

      // dom-presubmit (Gemini): adapter handles request pseudonymization, we wrap response
      const skipResponse = await originalFetch.call(window, input, init);
      return wrapResponse(skipResponse, url);
    }

    // dom-capture-wire (Copilot): WS handles request pseudonymization, we wrap response
    const dcwResponse = await originalFetch.call(window, input, init);
    return wrapResponse(dcwResponse, url);
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
    // Small/empty POST bodies (Claude title gen, metadata) — wrap response anyway
    const response = await originalFetch.call(window, input, init);
    return wrapResponse(response, url);
  }

  // ── PRESERVE reverse map across turns (DEF-008 + DEF-009 fix) ──
  // DO NOT clear the map here. Previous turn's pseudonyms must survive so that:
  //   1. The LLM's response to a clean Turn 2 can still be de-pseudonymized
  //      (the response may reference Turn 1's pseudonymized names)
  //   2. The persistent DOM observer stays alive to protect user bubbles
  //      against React re-renders (Claude WebSocket updates)
  // The map has MAX_MAP_SIZE (2000 entries) with LRU eviction, so unbounded
  // growth is already guarded against.
  // Map IS cleared on: page navigation, new conversation URL, explicit clear.

  // ChatGPT-specific diagnostic — ALWAYS log (not limited to first 15 calls)
  if (url.includes('chatgpt.com') || url.includes('chat.openai.com') || url.includes('/backend-api/') || url.includes('/conversation')) {
    igLog(`ChatGPT fetch: ${method} ${url.substring(0, 80)} — body: ${bodyString.length} chars, bodyType: ${init?.body?.constructor?.name || 'unknown'}`);
  }

  igLog(`LLM request intercepted — mode: ${mode}, url: ${url.substring(0, 80)}, body: ${bodyString.length} chars`);

  // Diagnostic: log metadata for debugging (no raw body content)
  if (url.includes('gemini') || url.includes('googleapis')) {
    igLog(`Gemini fetch: body ${bodyString.length} chars`);
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
      // DOM pre-submit handles request pseudonymization; we wrap response.
      const response = await originalFetch.call(window, input, init);
      return wrapResponse(response, url);
    }

    // Prevent double pseudonymization: if this body was already proxied
    // (e.g., ChatGPT sends /prepare then /conversation with same data),
    // skip the second interception. Uses a per-session cryptographic nonce
    // that can't be guessed or injected by user prompts (C-2 fix).
    if (_proxyNonce && bodyString.includes(_proxyNonce)) {
      igLog('Body contains session proxy nonce — skipping double pseudonymization');
      const response = await originalFetch.call(window, input, init);
      return wrapResponse(response, url);
    }

    try {
      // Adapter-first extraction: use the active adapter's platform-specific
      // parser, falling back to the generic multi-format extractor.
      const promptText = activeAdapter?.extractPrompt(bodyString) ?? extractPrompt(bodyString);

      // ── DIAGNOSTIC: Log extraction result for all platforms ──
      console.log(
        '%c[Iron Gate DIAG] extractPrompt result',
        'color: #f59e0b; font-weight: bold',
        {
          adapter: activeAdapter?.id || 'generic',
          bodyLength: bodyString.length,
          promptLength: promptText?.length ?? 0,
          promptPreview: promptText ? promptText.substring(0, 300) : '(null)',
          url: typeof input === 'string' ? input : (input as Request)?.url?.substring(0, 100),
        }
      );

      if (!promptText || promptText.length < 10) {
        igLog(`extractPrompt returned ${promptText === null ? 'null' : `${promptText?.length} chars`} — body: ${bodyString.length} chars`);
      }

      if (promptText && promptText.length >= 10) {

        const _t0 = performance.now();
        // ── SERVER MODE: API-side detection + pseudonymization ──
        if (processingMode === 'server') {
          try {
            const serverResult = await requestServerProcess(promptText, activeAdapter?.id || 'unknown');
            igLog('SERVER MODE: API result —', serverResult.action, 'score:', serverResult.sensitivityScore);

            // Passthrough: no sensitive data detected
            if (serverResult.action === 'passthrough' || !serverResult.pseudonymizedText) {
              igLog('SERVER MODE: passthrough — sending original');
              // Still notify sidepanel about the audit (score=0, no entities)
              turnCoordinator.submit({
                type: 'IRON_GATE_AUDIT', promptText, allEntities: [],
                maskedText: '', mappings: [], level: 'low', score: serverResult.sensitivityScore || 0,
              });
              // Server passthrough: wrap response so prior-turn pseudonyms are restored
              const passthroughResponse = await originalFetch.call(window, input, init);
              return wrapResponse(passthroughResponse, url);
            }

            // Kill switch: org has disabled all AI tools
            if (serverResult.killSwitch) {
              console.log(
                '%c[Iron Gate] KILL SWITCH ACTIVE — all AI tool access blocked by organization policy',
                'color: #ef4444; font-weight: bold; font-size: 14px',
              );
              return new Response(JSON.stringify({
                error: serverResult.killSwitchMessage || 'AI tools restricted by organization policy',
              }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // Blocked: critical sensitivity or policy block
            if (serverResult.action === 'blocked') {
              console.log(
                `%c[Iron Gate] BLOCKED by server — ${serverResult.policyExplanation || 'critical sensitivity detected'}`,
                'color: #ef4444; font-weight: bold; font-size: 14px',
              );
              // Return a synthetic error response instead of sending to AI
              return new Response(JSON.stringify({
                error: serverResult.policyExplanation || 'Request blocked by Iron Gate — sensitive data detected',
              }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
              });
            }

            // Pseudonymized: swap in the pseudonymized text
            if (serverResult.reverseMap) {
              registerPseudonymization(
                Object.entries(serverResult.reverseMap).map(([pseudonym, original]) =>
                  ({ pseudonym, original: original as string, type: 'server' })
                ),
                { skipDomRescan: true }, // server mode handles response via stream
              );
            }
            const requestReverseMap = { ...currentReverseMap };

            const modifiedBody = activeAdapter?.replacePrompt(bodyString, promptText, serverResult.pseudonymizedText)
              ?? replacePrompt(bodyString, promptText, serverResult.pseudonymizedText);

            if (modifiedBody) {
              console.log(
                `%c[Iron Gate WIRE] SERVER PSEUDONYMIZED — ${serverResult.entityCount} entities protected` +
                ` (score: ${serverResult.sensitivityScore}, context: ${serverResult.contextCategory || 'unknown'})`,
                'color: #f97316; font-weight: bold; font-size: 13px',
              );

              // Report to worker for sidepanel — use notifyContentScript for reliable delivery
              // Build entity array from server response (API returns { type, start, end })
              // Fall back to constructing from reverseMap if entities not available
              const serverEntities: Array<{ type: string; text: string; start: number; end: number; confidence: number; source: string }> =
                Array.isArray(serverResult.entities) && serverResult.entities.length > 0
                  ? serverResult.entities.map((e: any) => ({
                      type: e.type || 'UNKNOWN', text: '', start: e.start || 0, end: e.end || 0,
                      confidence: 1, source: 'server',
                    }))
                  : Object.entries(serverResult.reverseMap || {}).map(([pseudonym], i) => ({
                      type: 'ENTITY', text: '', start: i, end: i + 1,
                      confidence: 1, source: 'server',
                    }));

              turnCoordinator.submit({
                type: 'IRON_GATE_INTERCEPTED', promptText, allEntities: serverEntities,
                maskedText: serverResult.pseudonymizedText || '',
                mappings: Object.entries(serverResult.reverseMap || {}).map(([p, o]) => ({ pseudonym: p, original: '', type: 'server', length: p.length })),
                level: serverResult.sensitivityLevel,
                score: serverResult.sensitivityScore,
              });

              // Build modified request with pseudonymized body
              const newInit = { ...init, body: modifiedBody };
              // De-pseudonymize the user's message bubble on every platform.
              // Previously ChatGPT was skipped under the assumption that React
              // state retains the original text — but synthetic input events
              // (and some programmatic paste paths) can cause the pseudonym to
              // end up in the bubble. The call is a safe no-op when the bubble
              // already contains the original because the reverse map won't
              // find anything to replace.
              depseudonymizeUserBubble(requestReverseMap);
              const response = await originalFetch.call(window, input, newInit);
              return depseudonymizeResponse(response, requestReverseMap);
            }
          } catch (err) {
            // Server processing failed — fall through to local pipeline
            igLog('SERVER MODE: failed, falling back to local —', err);
          }
        }

        // Detect entities
        const regexEntities = detectWithRegex(promptText);
        const secrets = scanForSecrets(promptText);
        const allEntities = [...regexEntities, ...secrets];
        const _t1 = performance.now();

        igLog(`Detected ${allEntities.length} entities in prompt (${promptText.length} chars)`);

        // ── DIAGNOSTIC: Log every detected entity for debugging ──
        if (allEntities.length > 0) {
          console.log(
            '%c[Iron Gate DIAG] Detected entities:',
            'color: #f59e0b; font-weight: bold',
            allEntities.map(e => ({ type: e.type, text: (e as any).text?.substring(0, 40) || (e as any).value?.substring(0, 40), confidence: (e as any).confidence }))
          );
        } else {
          console.warn(
            '%c[Iron Gate DIAG] ZERO entities detected from prompt:',
            'color: #ef4444; font-weight: bold',
            { promptLength: promptText.length, promptPreview: promptText.substring(0, 500) }
          );
        }

        // ── Gemma + Regex: use pre-computed verdict if available ────────
        // Gemma ran while the user typed (PROMPT_DETECTED → worker → Ollama).
        // SAFETY RULE: Gemma can only INCREASE protection, never decrease it.
        // If regex found entities, Gemma cannot suppress pseudonymization —
        // it can only confirm or escalate. This prevents stale "allow" verdicts
        // from a previous clean prompt from poisoning sensitive prompt decisions.
        // IntentContextResult shape — typed as any because IIFE can't import from
        // intent-context-classifier.ts. The scorer validates fields at runtime.
        let intentContext: any = null;
        const gemmaVerdict = getCachedGemmaVerdict();
        if (gemmaVerdict) {
          // Only use Gemma to SUPPRESS if regex found ZERO entities.
          // If regex found entities, Gemma can only confirm or escalate.
          const gemmaWantsAllow = gemmaVerdict.verdict === 'allow' || gemmaVerdict.score <= 25;
          const regexFoundEntities = allEntities.length > 0;

          if (gemmaWantsAllow && regexFoundEntities) {
            // Gemma says "allow" but regex found real entities — ignore Gemma.
            // Regex is the safety net. Gemma might be stale or wrong.
            console.log(
              `%c[Iron Gate] Gemma says allow but regex found ${allEntities.length} entities — overriding Gemma, protecting data`,
              'color: #ef4444; font-weight: bold',
            );
          } else {
            intentContext = {
              intent: gemmaVerdict.intent,
              sensitivity: gemmaVerdict.sensitivity,
              valuesAreReal: gemmaVerdict.verdict !== 'allow',
              zone: gemmaVerdict.score > 60 ? 'red' : gemmaVerdict.score > 25 ? 'amber' : 'green',
              action: gemmaVerdict.verdict === 'block' ? 'proxy' : gemmaVerdict.verdict === 'allow' ? 'pass' : 'warn',
              score: gemmaVerdict.score,
              source: gemmaVerdict.source || 'gemma',
              fellBack: false,
            };
            console.log(
              `%c[Iron Gate] Using Gemma verdict: ${gemmaVerdict.verdict}/${gemmaVerdict.sensitivity} (score=${gemmaVerdict.score})`,
              'color: #a855f7; font-weight: bold',
            );
          }
        } else {
          igLog('Gemma: no cached verdict — regex-only scoring');
        }

        const fullScore = computeScore(promptText, allEntities as DetectedEntity[], undefined, intentContext);
        let score = fullScore.score;
        let level = fullScore.level;

        // DEF-016: When follow-up references entities from prior turns, force
        // pseudonymization using the existing forward map. This prevents the
        // #1 defect: names sent in plaintext in follow-up turns.
        //
        // Strategy: if the forward map contains entries that appear in the
        // follow-up text, apply forward-map pseudonymization directly —
        // bypassing the score gate entirely. This is safe because the forward
        // map only contains entities WE previously pseudonymized.
        const sessionRefCount = _countSessionEntityReferences(promptText);
        if (sessionRefCount > 0 && Object.keys(currentForwardMap).length > 0) {
          // Apply forward-map replacement: find any known original entities in
          // the prompt text and replace them with their established pseudonyms.
          let pseudonymizedText = promptText;
          const sessionMappings: PseudonymMapping[] = [];
          // Sort by length descending to prevent substring collisions
          const fwdEntries = Object.entries(currentForwardMap)
            .sort((a, b) => b[0].length - a[0].length);
          for (const [original, pseudonym] of fwdEntries) {
            if (original.length < 3) continue;
            if (!pseudonymizedText.toLowerCase().includes(original.toLowerCase())) continue;
            // Boundary-aware replacement (case-insensitive)
            try {
              const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const prefix = /^[a-zA-Z]/.test(original) ? '(?<![a-zA-Z])' : '';
              const suffix = /[a-zA-Z]$/.test(original) ? '(?![a-zA-Z])' : '';
              const regex = new RegExp(prefix + escaped + suffix, 'gi');
              const before = pseudonymizedText;
              pseudonymizedText = pseudonymizedText.replace(regex, () => pseudonym);
              if (pseudonymizedText !== before) {
                sessionMappings.push({ original, pseudonym, type: 'SESSION_ENTITY' });
              }
            } catch { /* regex failed */ }
          }

          if (sessionMappings.length > 0) {
            console.log(
              `%c[Iron Gate WIRE] DEF-016 FIX: Follow-up references ${sessionRefCount} session entities — force-pseudonymizing ${sessionMappings.length} entities from forward map`,
              'color: #f97316; font-weight: bold; font-size: 13px',
            );

            registerPseudonymization(sessionMappings);
            const requestReverseMap = { ...currentReverseMap };

            // Replace prompt in body
            const modifiedBody = activeAdapter?.replacePrompt(bodyString, promptText, pseudonymizedText)
              ?? replacePrompt(bodyString, promptText, pseudonymizedText);

            if (modifiedBody) {
              // Report to sidepanel
              turnCoordinator.submit({
                type: 'IRON_GATE_INTERCEPTED', promptText, allEntities,
                maskedText: pseudonymizedText,
                mappings: sanitizeMappingsForTransit(sessionMappings),
                level: 'high', score: Math.max(score, 50),
              });

              // Start DOM observer + rescans
              startPersistentDomDepseudo();

              const newInit = { ...init, body: modifiedBody };
              // Always run user-bubble de-pseudo (no ChatGPT skip) — see the
              // comment on the Sovereign-Mode branch above for the rationale.
              depseudonymizeUserBubble(requestReverseMap);
              const response = await originalFetch.call(window, input, newInit);
              return depseudonymizeResponse(response, requestReverseMap);
            }
          }
        }
        // Standard score boost as fallback (for cases where forward map replacement fails)
        if (sessionRefCount > 0 && score < 40) {
          const boost = Math.min(40, sessionRefCount * 15);
          const boostedScore = Math.min(100, score + boost);
          igLog(`DEF-016: Follow-up score boost ${score} → ${boostedScore}`);
          score = boostedScore;
          level = scoreToLevel(score);
        }

        igLog(`Full score: ${score} (${level}) — entities: ${allEntities.length}, breakdown: entity=${fullScore.breakdown.entityScore}, context=${fullScore.breakdown.contextScore}, docType=${fullScore.breakdown.documentTypeMultiplier}`);

        if (allEntities.length > 0) {
          // GREEN ZONE (score ≤ 25): intent suppression + context analysis
          // determined this is benign (horoscope, self-intro, weather, etc.)
          // → pass original text through, don't pseudonymize
          if (score <= 25) {
            console.log(
              `%c[Iron Gate WIRE] ✅ LOW RISK (score=${score}) — ${allEntities.length} entities detected but context is benign, sending original text`,
              'color: #22c55e; font-weight: bold',
            );
            console.log(
              `%c[Iron Gate PERF] Detection: ${(_t1 - _t0).toFixed(0)}ms | Score: ${(performance.now() - _t1).toFixed(0)}ms | Total: ${(performance.now() - _t0).toFixed(0)}ms (GREEN passthrough)`,
              'color: #818cf8; font-weight: bold',
            );
            // Report to worker for audit trail, but don't modify the request
            turnCoordinator.submit({
              type: 'IRON_GATE_AUDIT', promptText, allEntities,
              maskedText: '', mappings: [], level, score,
            });
            // Notify user that entities were detected but context was benign
            if (allEntities.length > 0) {
              igPostMessage({
                type: 'IRON_GATE_LOW_RISK_PASSTHROUGH',
                entityCount: allEntities.length,
                score,
                entityTypes: [...new Set(allEntities.map(e => e.type))],
              });
            }
            // GREEN passthrough: wrap response so prior-turn pseudonyms are restored
            const greenResponse = await originalFetch.call(window, input, init);
            return wrapResponse(greenResponse, url);
          }

          // Selective pseudonymization: filter entities based on ownership context.
          // Self-owned entities in benign context (resume, bio) and public entities
          // are allowed through. Credentials and HIGH_PII always pseudonymized.
          const entitiesToPseudonymize = filterEntitiesForPseudonymization(promptText, allEntities, fullScore);
          igLog(`Ownership filter: ${allEntities.length} entities → ${entitiesToPseudonymize.length} to pseudonymize`);
          // B2: Deterministic per-firm pseudonyms via HKDF (no-op if firmKey not set)
          await _prefetchFirmPseudonyms(entitiesToPseudonymize);
          const pseudoResult = pseudonymizeLocal(promptText, entitiesToPseudonymize);

          // If pseudonymization produced no actual changes (all entities were
          // VALUE_TYPES like MONETARY_AMOUNT/DATE that are intentionally skipped,
          // or all entities were filtered out by ownership), treat as passthrough.
          if (pseudoResult.mappings.length === 0) {
            igLog(`PROXY MODE — ${allEntities.length} entities detected but none require pseudonymization (ownership filter or VALUE_TYPES), score=${score}`);
            console.log(
              `%c[Iron Gate PERF] Detection: ${(_t1 - _t0).toFixed(0)}ms | Total: ${(performance.now() - _t0).toFixed(0)}ms (value-types only, passthrough)`,
              'color: #818cf8; font-weight: bold',
            );

            // Value-types only — report to sidepanel with real score so the
            // user sees the risk level, but don't block text prompts.
            // Block overlay is reserved for document/file uploads only.
            turnCoordinator.submit({
              type: 'IRON_GATE_AUDIT', promptText, allEntities,
              maskedText: '', mappings: [], level, score,
            });
            // Value-types only passthrough: wrap response so prior pseudonyms restored
            const valTypeResponse = await originalFetch.call(window, input, init);
            return wrapResponse(valTypeResponse, url);
          }

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
          // Notify user when private LLM routing was requested but no endpoint is configured
          if (lensRoute.route === 'private_llm' && !_privateLlmEndpoint) {
            igPostMessage({
              type: 'IRON_GATE_PRIVATE_LLM_FALLBACK',
              reason: lensRoute.explanation || 'Sensitive content detected',
              industry: lensRoute.industry || null,
            });
          }

          // Centralized: register all mappings + session entities + DOM observer
          registerPseudonymization(pseudoResult.mappings);
          igLog(`Reverse map: ${Object.keys(currentReverseMap).length} entries`);
          const requestReverseMap = { ...currentReverseMap };

          // ── Private LLM Routing ──
          // When Executive Lens routes to private_llm and an endpoint is configured,
          // send the pseudonymized prompt to the on-premise LLM instead of the AI tool.
          // The response is de-pseudonymized and injected as if the AI tool responded.
          if (effectiveRoute === 'private_llm' && _privateLlmEndpoint) {
            igLog(`PRIVATE LLM: Routing pseudonymized prompt to ${_privateLlmEndpoint}`);

            // Notify content script about the interception (non-blocking)
            turnCoordinator.submit({
              type: 'IRON_GATE_INTERCEPTED', promptText, allEntities,
              maskedText: pseudoResult.maskedText, mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
              level, score,
              extra: { executiveRoute: 'private_llm', executiveIndustry: lensRoute.industry },
            });

            try {
              // Build OpenAI-compatible request for private LLM (Ollama, vLLM, etc.)
              const privateLlmBody = JSON.stringify({
                model: _privateLlmModel || 'gemma3:4b',
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
            // NON-BLOCKING: sends message synchronously, hashes in background.
            // Never blocks the fetch — user sees zero added latency.
            turnCoordinator.submit({
              type: 'IRON_GATE_INTERCEPTED', promptText, allEntities,
              maskedText: pseudoResult.maskedText, mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
              level, score,
            });

            const _t2 = performance.now();
            console.log(
              `%c[Iron Gate PERF] Detection: ${(_t1 - _t0).toFixed(0)}ms | Pseudo+notify: ${(_t2 - _t1).toFixed(0)}ms | Total before fetch: ${(_t2 - _t0).toFixed(0)}ms`,
              'color: #818cf8; font-weight: bold',
            );

            // Send modified request — preserve ALL original fetch arguments.
            // Only override the body to prevent breaking tool-specific properties
            // (CSRF tokens, credentials, referrer policy, etc.).
            // Send modified request — fail-OPEN: if the modified body is rejected,
            // fall through to the original unmodified request so the user isn't blocked.
            let modifiedResponse: Response;
            try {
              if (init) {
                let finalInit: RequestInit = { ...init, body: modifiedBody };
                if (typeof FormData !== 'undefined' && init.body instanceof FormData && typeof modifiedBody === 'string') {
                  const h = new Headers(init.headers);
                  h.set('Content-Type', 'application/x-www-form-urlencoded');
                  finalInit = { ...finalInit, headers: h };
                }
                modifiedResponse = await originalFetch.call(window, input, finalInit);
              } else if (input instanceof Request) {
                modifiedResponse = await originalFetch.call(window, input, { body: modifiedBody });
              } else {
                modifiedResponse = await originalFetch.call(window, input, { method: 'POST', body: modifiedBody });
              }
            } catch (fetchErr) {
              console.error(
                '%c[Iron Gate WIRE] Modified request FAILED — blocking (fail-closed). Original data NOT sent.',
                'color: #ef4444; font-weight: bold; font-size: 13px',
                '\nError:', fetchErr
              );
              igPostMessage({
                type: 'IRON_GATE_DEPSEUDO_FAILURE',
                detail: 'Pseudonymized request failed. Your original data was NOT sent to the AI.',
              });
              return _buildFailClosedResponse(url, 'Pseudonymized fetch failed');
            }

            const _t3 = performance.now();
            console.log(
              `%c[Iron Gate WIRE] Response: ${modifiedResponse.status} ${modifiedResponse.statusText} (fetch took ${(_t3 - _t2).toFixed(0)}ms)`,
              modifiedResponse.ok ? 'color: #22c55e' : 'color: #ef4444; font-weight: bold',
              `(${url.substring(0, 60)})`
            );

            // If the tool rejected our modified body, fall through to original
            // request immediately — NO retry, NO blocking. This matches March 3
            // behavior and prevents doubling latency on body rejection.
            if (!modifiedResponse.ok && modifiedResponse.status >= 400) {
              console.warn(
                `%c[Iron Gate WIRE] Tool rejected modified body (${modifiedResponse.status}) — blocking (fail-closed). Original data NOT sent.`,
                'color: #f59e0b; font-weight: bold',
              );
              igPostMessage({
                type: 'IRON_GATE_DEPSEUDO_FAILURE',
                detail: `AI tool rejected the pseudonymized request (status ${modifiedResponse.status}). Your original data was NOT sent.`,
              });
              return _buildFailClosedResponse(url, `Tool rejected modified body (${modifiedResponse.status})`);
            }

            // De-pseudonymize the user's own message bubble in the DOM.
            // Runs on EVERY platform including ChatGPT. Historically we skipped
            // ChatGPT because React state was assumed to hold the original
            // text, but synthetic-input code paths can land the pseudonym in
            // the rendered bubble. The call is a no-op on platforms where the
            // bubble already shows the original (nothing to replace).
            if (Object.keys(requestReverseMap).length > 0) {
              depseudonymizeUserBubble(requestReverseMap);
            }

            // De-pseudonymize the response stream (use snapshot, not mutable global).
            // All platforms now use stream-level de-pseudo — offset annotations
            // (displayedContentReferences) are stripped by stripOffsetAnnotations()
            // before text replacement, so length changes don't corrupt rendering.
            if (Object.keys(requestReverseMap).length > 0) {
              igLog(`De-pseudonymizing response with ${Object.keys(requestReverseMap).length} mappings`);
              return depseudonymizeResponse(modifiedResponse, requestReverseMap);
            }

            return modifiedResponse;
          } else {
            console.warn('[Iron Gate MAIN] replacePrompt returned null — body format not recognized');
          }
        } else {
          // No entities to pseudonymize, but contextual score may still be high
          // (e.g., "Q3 revenue projections, layoffs, acquisition of BetaWorks").
          igLog(`PROXY MODE — no entities found in prompt (contextual score=${score})`);
          console.log(
            `%c[Iron Gate PERF] Detection: ${(_t1 - _t0).toFixed(0)}ms | Total: ${(performance.now() - _t0).toFixed(0)}ms (no entities, passthrough, contextScore=${score})`,
            'color: #818cf8; font-weight: bold',
          );

          turnCoordinator.submit({
            type: 'IRON_GATE_AUDIT', promptText, allEntities: [],
            maskedText: '', mappings: [], level, score,
          });

          // REMOVED: IRON_GATE_CLEAN_SUBMIT was causing real detections to be
          // wiped by secondary platform fetches. Sidepanel clears via tab
          // navigation and PROMPT_CLEARED (DOM observer) instead.

          // ── DEF-009 FIX: Wrap response with PREVIOUS turn's reverse map ──
          // The LLM has Turn 1's pseudonymized names in context. Even though
          // Turn 2 has no new entities, the response may reference those
          // pseudonyms. De-pseudonymize the response so the user sees real names.
          // No-pseudonymization passthrough: wrap response for multi-turn consistency
          const passthroughResponse = await originalFetch.call(window, input, init);
          return wrapResponse(passthroughResponse, url);
        }
      } else {
        igLog(`PROXY MODE — no prompt extracted from body (${bodyString.length} chars), passing through`);
      }
    } catch (err) {
      console.error(
        '%c[Iron Gate WIRE] ❌ Proxy intercept error — BLOCKING to protect sensitive data',
        'color: #ef4444; font-weight: bold',
        '\nError:', err
      );
      // Fail CLOSED: never send raw PII to the AI tool on proxy failure
      return new Response(JSON.stringify({ error: 'Iron Gate: request blocked due to proxy error. Your sensitive data was NOT sent.' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
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
            // Minimize entities for postMessage — strip raw text, use hash + length only
            const _ame = await Promise.all(allEntities.map(async e => ({
              type: e.type,
              textHash: await igHash(e.text),
              length: e.text.length,
              start: e.start,
              end: e.end,
              confidence: e.confidence,
              source: e.source,
            })));
            igPostMessage({
              type: 'IRON_GATE_AUDIT',
              promptHash: _aph,
              promptLength: promptText.length,
              maskedPrompt: '',
              mappings: [],
              entityCount: allEntities.length,
              level,
              score,
              entities: _ame,
              wireIntercept: true, // authoritative wire-level result — sidepanel must not suppress
            });
          }
        }
      } catch {
        // Don't break anything
      }
    })();
  }

  // Final fallthrough: pass through with response wrapping
  const response = await originalFetch.call(window, input, init);
  return wrapResponse(response, url);
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
// BUG-20: Store handler references for cleanup on navigation
const _docChangeHandler = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (!target || target.type !== 'file' || !target.files || target.files.length === 0) return;
  for (const file of Array.from(target.files)) {
    _readFileToBase64AndPost(file, 'document capture-phase change');
  }
};
const _docPasteHandler = (event: ClipboardEvent) => {
  if (!event.clipboardData?.files?.length) return;
  for (const file of Array.from(event.clipboardData.files)) {
    igLog('Clipboard paste detected:', file.name || 'unnamed', file.type, file.size);
    _readFileToBase64AndPost(file, 'clipboard paste');
  }
};
const _docDropHandler = (event: DragEvent) => {
  if (!event.dataTransfer?.files?.length) return;
  for (const file of Array.from(event.dataTransfer.files)) {
    igLog('Drag-drop file detected:', file.name, file.type, file.size);
    _readFileToBase64AndPost(file, 'drag-drop');
  }
};

try {
  document.addEventListener('change', _docChangeHandler, true);
  igLog('✅ Document capture-phase change listener installed');
} catch {
  igLog('Document capture-phase change listener failed (non-critical)');
}

try {
  document.addEventListener('paste', _docPasteHandler as EventListener, true);
  igLog('Clipboard paste file listener installed');
} catch {
  igLog('Clipboard paste listener failed (non-critical)');
}

try {
  document.addEventListener('drop', _docDropHandler as EventListener, true);
  igLog('Drag-drop file listener installed');
} catch {
  igLog('Drag-drop listener failed (non-critical)');
}

// BUG-20: Clean up all document event listeners on navigation to prevent accumulation
window.addEventListener('beforeunload', () => {
  document.removeEventListener('change', _docChangeHandler, true);
  document.removeEventListener('paste', _docPasteHandler as EventListener, true);
  document.removeEventListener('drop', _docDropHandler as EventListener, true);
});


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
      // SERVER MODE: XHR can't be async easily, so pass through for XHR.
      // Server-mode pseudonymization happens in the fetch interceptor (primary path).
      // XHR is only used by a few platforms (Gemini batchexecute) and those
      // typically use dom-presubmit interception anyway.
      if (processingMode === 'server') {
        igLog('SERVER MODE: XHR pass-through (server handles via fetch path)');
        return originalXHRSend.call(this, body);
      }
      try {
        const promptText = activeAdapter?.extractPrompt(bodyStr) ?? extractPrompt(bodyStr);
        if (promptText && promptText.length >= 10) {
          const regexEntities = detectWithRegex(promptText);
          const secrets = scanForSecrets(promptText);
          const allEntities = [...regexEntities, ...secrets];

          // Always run scoring (contextual keywords matter even with 0 entities)
          const fullScore = computeScore(promptText, allEntities as DetectedEntity[]);
          let score = fullScore.score;
          let level = fullScore.level;

          // DEF-016: Session entity boost for XHR path (same as fetch proxy)
          const xhrSessionRefCount = _countSessionEntityReferences(promptText);
          if (xhrSessionRefCount > 0 && score < 40) {
            const boost = Math.min(40, xhrSessionRefCount * 15);
            score = Math.min(100, score + boost);
            level = scoreToLevel(score);
          }

          if (allEntities.length > 0) {
            // GREEN ZONE: benign context → pass through
            if (score <= 25) {
              igLog(`XHR: Low risk (score=${score}) — sending original`);
              turnCoordinator.submit({
                type: 'IRON_GATE_AUDIT', promptText, allEntities,
                maskedText: '', mappings: [], level, score,
              });
              return originalXHRSend.call(this, body);
            }

            // Selective pseudonymization based on entity ownership
            const xhrEntitiesToPseudo = filterEntitiesForPseudonymization(promptText, allEntities, fullScore);
            // B2: Fire-and-forget firm pseudonym prefetch — warms the cache for
            // subsequent turns. XHR is synchronous so we can't await here;
            // first-turn determinism is handled by the fetch proxy path which IS async.
            void _prefetchFirmPseudonyms(xhrEntitiesToPseudo);
            const pseudoResult = pseudonymizeLocal(promptText, xhrEntitiesToPseudo);

            // No actual pseudonymization (ownership filter or VALUE_TYPES) → passthrough
            if (pseudoResult.mappings.length === 0) {
              igLog(`XHR: ${allEntities.length} entities detected but none require pseudonymization, sending original`);
              turnCoordinator.submit({
                type: 'IRON_GATE_AUDIT', promptText, allEntities,
                maskedText: '', mappings: [], level, score,
              });
              // DEF-014: Do NOT clear reverse map here — previous turns' mappings must persist
              return originalXHRSend.call(this, body);
            }

            // Centralized: register all mappings + session entities + DOM observer
            registerPseudonymization(pseudoResult.mappings, { skipDomRescan: true });
            const xhrReverseMap = { ...currentReverseMap };

            const modifiedBody = activeAdapter?.replacePrompt(bodyStr, promptText, pseudoResult.maskedText) ?? replacePrompt(bodyStr, promptText, pseudoResult.maskedText);
            if (modifiedBody) {
              igLog(`XHR PROXY: Pseudonymized ${allEntities.length} entities (${level}, score=${score}), masked: ${pseudoResult.maskedText.length} chars`);


              // Notify content script (XHR is sync so can't await — but notifyContentScript
              // has internal try/catch so the message is always sent)
              turnCoordinator.submit({
                type: 'IRON_GATE_INTERCEPTED', promptText, allEntities,
                maskedText: pseudoResult.maskedText, mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                level, score,
              });

              // Patch the response to de-pseudonymize
              // SKIP for platforms where DOM observer handles de-pseudo
              const xhrSkipDePseudo = shouldSkipXhrProxy(url, activeAdapter);
              if (Object.keys(xhrReverseMap).length > 0 && !xhrSkipDePseudo) {
                const reverseMap = xhrReverseMap;
                const originalGet = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
                Object.defineProperty(this, 'responseText', {
                  get() {
                    const text = originalGet?.get?.call(this) ?? this.response ?? '';
                    const raw = typeof text === 'string' ? text : '';
                    // Use replacePseudonyms for boundary-aware replacement (not naive split/join)
                    return replacePseudonyms(raw, reverseMap);
                  },
                  configurable: true,
                });
              } else if (xhrSkipDePseudo) {
                igLog('XHR: skipping responseText patch — DOM observer will handle');
              }

              return originalXHRSend.call(this, modifiedBody);
            }
          } else {
            // No entities but contextual score may be high — report real score
            igLog(`XHR: no entities found (contextual score=${score}), sending original`);
            // DEF-014: Do NOT clear reverse map here — previous turns' mappings must persist
            turnCoordinator.submit({
              type: 'IRON_GATE_AUDIT', promptText, allEntities: [],
              maskedText: '', mappings: [], level, score,
            });
          }
        }
      } catch (err) {
        console.error(
          '%c[Iron Gate SECURITY] XHR proxy error — BLOCKED to protect sensitive data',
          'color: #ef4444; font-weight: bold', err,
        );
        // H-1 FIX: Fail CLOSED with user notification (was silently dropping request).
        // Send empty body so XHR completes with an error the platform can handle,
        // rather than leaving the request hanging forever.
        igPostMessage({ type: 'IRON_GATE_XHR_BLOCKED', error: 'Proxy error — request blocked to protect PII' });
        return originalXHRSend.call(this, '');
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
            turnCoordinator.submit({
              type: 'IRON_GATE_AUDIT', promptText, allEntities,
              maskedText: pseudoResult.maskedText, mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
              level, score,
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
// H-14: Track whether a pending pseudo expired — if WS frame arrives after expiry,
// we must block it rather than sending raw PII
let _copilotPseudoExpired = false;

function setPendingCopilotPseudo(pseudo: { original: string; maskedText: string }) {
  pendingCopilotPseudo = pseudo;
  _copilotPseudoExpired = false; // Clear expired flag on new pseudo
  if (pendingCopilotTimer) clearTimeout(pendingCopilotTimer);
  // 30s TTL — Copilot's SignalR can be slow (reconnects, Azure edge latency).
  // 10s was too short and caused pseudonymization to silently fail on slow connections.
  const _pendingSetAt = Date.now();
  pendingCopilotTimer = setTimeout(() => {
    if (pendingCopilotPseudo === pseudo) {
      // BUG-29: Log expiration with details so silent failures are diagnosable
      console.warn(`[Iron Gate] Copilot WS: Pending pseudo EXPIRED after 30s (original=${pseudo.original.length}c, elapsed=${Date.now() - _pendingSetAt}ms). Next WS frame will be BLOCKED.`);
      pendingCopilotPseudo = null;
      _copilotPseudoExpired = true; // H-14: Flag so WS handler blocks the next frame
    }
    pendingCopilotTimer = null;
  }, 30000);
}

function applyCopilotSignalRPseudo(data: string): string {
  // H-14: If a pending pseudo expired, block the frame (don't send raw PII)
  if (!pendingCopilotPseudo && _copilotPseudoExpired) {
    console.warn('%c[Iron Gate SECURITY] Copilot WS: BLOCKED — pending pseudo expired, frame arrived too late', 'color: #ef4444; font-weight: bold');
    _copilotPseudoExpired = false;
    return '';
  }
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
    } catch (parseErr) {
      // BUG-22: Previously silently continued, passing malformed frames unmodified.
      // Log so failures are diagnosable. The frame still passes through (can't
      // pseudonymize what we can't parse), but at least we know it happened.
      igLog(`Copilot WS: Malformed SignalR frame skipped (${frame.length}c):`, parseErr instanceof Error ? parseErr.message : String(parseErr));
      continue;
    }
  }
  if (modified) {
    igLog(`Copilot WS: Pseudonymized SignalR frame (deep walk fallback)`);
    return frames.join(RS);
  }

  // C-4 FIX: Fail CLOSED — if we can't pseudonymize, block the frame.
  // Returning unmodified data would silently leak raw PII to Copilot.
  console.warn(
    '%c[Iron Gate SECURITY] Copilot WS: BLOCKED — could not pseudonymize SignalR frame',
    'color: #ef4444; font-weight: bold',
    `(frame=${data.length}c, orig=${original.length}c)`,
  );
  pendingCopilotPseudo = null; // Clear so user can retry
  return ''; // Empty string blocks the frame — Copilot will show an error or retry
}

function _walkPseudoSignalR(obj: any): { value: any; changed: boolean } {
  if (typeof obj === 'string' && obj.length > 50) {
    const entities = detectWithRegex(obj);
    const secrets = scanForSecrets(obj);
    const all = [...entities, ...secrets];
    if (all.length > 0) {
      const result = pseudonymizeLocal(obj, all);
      if (result.maskedText !== obj) {
        registerPseudonymization(result.mappings, { skipDomRescan: true });
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
  // Copilot: completely bypass WS.prototype.send patch.
  // ANY processing here (even passthrough) can interfere with SignalR's
  // tight send/receive timing and cause Copilot to hang.
  // Detection still works via dom-capture-wire; pseudonymization is deferred.
  if (activeAdapter?.id === 'copilot') {
    return _origWsSend.call(this, data);
  }
  // File upload gate — block WS frames if a high-risk document was detected
  if (hasHighRiskFileScanSync() && activeAdapter?.isWsEndpoint?.(this.url)) {
    igLog('WS.prototype.send BLOCKED — high-risk document detected');
    return;
  }
  if (mode === 'proxy' && pendingCopilotPseudo &&
      activeAdapter?.isWsEndpoint?.(this.url)) {
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
  // Copilot: return the raw WebSocket IMMEDIATELY — do NOT enter the isLLM
  // processing block at all. Any instance property access, logging, or patching
  // on the WS can interfere with SignalR's connection lifecycle.
  const isCopilotWS = activeAdapter?.id === 'copilot' && activeAdapter.isWsEndpoint?.(urlStr);
  if (isCopilotWS) {
    return ws;
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
            // Blob — binary data (e.g., images, audio, protobuf).
            // These are not text prompts and cannot contain user-typed PII.
            // Pass through unchanged in all modes (M-5 fix).
            return originalSend(data);
          }
        } catch (decodeErr) {
          // Binary decode failed. Fail-closed in proxy mode:
          // corrupted or non-UTF8 data could contain PII we can't inspect.
          if (mode === 'proxy') {
            console.warn('[Iron Gate MAIN] WS: Binary decode FAILED — blocking frame to protect PII', decodeErr instanceof Error ? decodeErr.message : '');
            return; // block
          }
          return originalSend(data); // audit mode: passthrough
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
          // Skip Socket.IO control frames: "0" (CONNECT), "1" (DISCONNECT), "2" (PING),
          // "3" (PONG), "40" (CONNECT/ns). Do NOT skip "42" — that's MESSAGE type containing user data.
          // M-20 FIX: Old regex /^\d{1,3}$/ was too broad and skipped actual messages.
          if (strData.length < 10 && /^[0-3](?:0|1)?$/.test(strData.trim())) {
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
              // Full scoring pipeline (sync — WS.send is synchronous)
              const fullScore = computeScore(promptText, allEntities as DetectedEntity[]);
              const score = fullScore.score;
              const level = fullScore.level;

              // GREEN ZONE: benign context → pass through
              if (score <= 25) {
                igLog(`WS: Low risk (score=${score}) — sending original`);
                turnCoordinator.submit({
                  type: 'IRON_GATE_AUDIT', promptText, allEntities,
                  maskedText: '', mappings: [], level, score,
                });
                return originalSend(data);
              }

              // Selective pseudonymization based on entity ownership
              const wsEntitiesToPseudo = filterEntitiesForPseudonymization(promptText, allEntities, fullScore);
              const pseudoResult = pseudonymizeLocal(promptText, wsEntitiesToPseudo);

              // If ownership filter removed all entities, pass through
              if (pseudoResult.mappings.length === 0) {
                igLog(`WS: ${allEntities.length} entities detected but none require pseudonymization, sending original`);
                turnCoordinator.submit({
                  type: 'IRON_GATE_AUDIT', promptText, allEntities,
                  maskedText: '', mappings: [], level, score,
                });
                return originalSend(data);
              }

              registerPseudonymization(pseudoResult.mappings, { skipDomRescan: true });

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
                    registerPseudonymization([{ pseudonym: fake.trim(), original: orig, type: 'WS_BINARY' }], { skipDomRescan: true });
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


                turnCoordinator.submit({
                  type: 'IRON_GATE_INTERCEPTED', promptText, allEntities,
                  maskedText: pseudoResult.maskedText, mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                  level, score,
                });

                return _sendResult(modifiedData);
              } else {
                console.warn(`[Iron Gate MAIN] WS PROXY: replacement FAILED — blocking to protect sensitive data. method=${replacementMethod}`);
                turnCoordinator.submit({
                  type: 'IRON_GATE_AUDIT', promptText, allEntities,
                  maskedText: pseudoResult.maskedText, mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                  level, score,
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
          // Skip Socket.IO control frames only (not "42" MESSAGE type)
          if (strData.length < 10 && /^[0-3](?:0|1)?$/.test(strData.trim())) {
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
              turnCoordinator.submit({
                type: 'IRON_GATE_AUDIT', promptText, allEntities,
                maskedText: pseudoResult.maskedText, mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
                level, score,
              });
            }
          }
        } catch { /* don't break */ }
      }

      return _sendResult(strData);
    };
    } // end if (!isCopilotWS) — skip instance send patch for Copilot

    // Response de-pseudonymization via addEventListener
    // SKIP for Copilot — patching WS instance properties (addEventListener, onmessage)
    // breaks SignalR's internal ping/pong validation, causing "Ping received after close"
    // errors and killing the WebSocket connection. Copilot response de-pseudo is handled
    // by the DOM observer watching `.ac-container` response elements.
    if (isCopilotWS) {
      igLog('Copilot WS: skipping addEventListener/onmessage patching to avoid breaking SignalR');
      return ws;
    }

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
              // Binary frames (protobuf) cannot be safely text-replaced because
              // length-prefixed fields would be corrupted. Pass through unchanged.
              // The DOM observer (startPersistentDomDepseudo) handles cleanup AFTER
              // React renders from the binary frame.
              const pseudoKeys = Object.keys(currentReverseMap);
              const hasPseudo = pseudoKeys.some(p => textData!.includes(p));
              if (hasPseudo) {
                console.log(`%c[Iron Gate WS DIAG] Binary frame #${_wsRcvCount} contains pseudonyms! (${textData!.length} chars) — pseudos found: ${pseudoKeys.filter(p => textData!.includes(p)).join(', ')}`,
                  'color: #ef4444; font-weight: bold; font-size: 13px');
                // Schedule aggressive DOM scans to catch React's re-render from this frame.
                // React will update the DOM with "James Mitchell" after this event is processed,
                // so we schedule scans to run 0ms, 50ms, 150ms, and 400ms later.
                [0, 50, 150, 400].forEach(delay => {
                  setTimeout(() => {
                    if (Object.keys(currentReverseMap).length > 0) {
                      const count = scanTextNodes(document.body);
                      if (count > 0) {
                        _persistentReplacementCount += count;
                        scheduleRapidFollowUp();
                      }
                    }
                  }, delay);
                });
              }
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
              // Binary frames (protobuf) cannot be safely text-replaced — pass through,
              // then schedule DOM scans to catch React's re-render.
              if (respBinary) {
                const pKeys = Object.keys(currentReverseMap);
                const hasP = pKeys.some(p => textData!.includes(p));
                if (hasP) {
                  console.log(`%c[Iron Gate WS DIAG onmsg] Binary frame contains pseudonyms! (${textData!.length} chars) — ${pKeys.filter(p => textData!.includes(p)).join(', ')}`,
                    'color: #ef4444; font-weight: bold; font-size: 13px');
                  // Aggressive DOM scan cascade after React renders from this binary frame
                  [0, 50, 150, 400].forEach(delay => {
                    setTimeout(() => {
                      if (Object.keys(currentReverseMap).length > 0) {
                        const count = scanTextNodes(document.body);
                        if (count > 0) {
                          _persistentReplacementCount += count;
                          scheduleRapidFollowUp();
                        }
                      }
                    }, delay);
                  });
                }
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
  async function adapterDomPseudonymize(text: string, source: string) {
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

    // Always run scoring — contextual keywords matter even with 0 entities
    const fullScore = computeScore(text, allEntities as DetectedEntity[]);
    const score = fullScore.score;
    const level = scoreToLevel(score);

    // DEF-016 ROOT CAUSE FIX (DOM path): Check session entity registry BEFORE
    // the score gate. If the text references entities from prior turns, force-
    // pseudonymize using the forward map — even if the current score is low.
    const domSessionRefCount = _countSessionEntityReferences(text);
    if (domSessionRefCount > 0 && Object.keys(currentForwardMap).length > 0) {
      let pseudonymizedText = text;
      const sessionMappings: PseudonymMapping[] = [];
      const fwdEntries = Object.entries(currentForwardMap)
        .sort((a, b) => b[0].length - a[0].length);
      for (const [original, pseudonym] of fwdEntries) {
        if (original.length < 3) continue;
        if (!pseudonymizedText.toLowerCase().includes(original.toLowerCase())) continue;
        try {
          const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const prefix = /^[a-zA-Z]/.test(original) ? '(?<![a-zA-Z])' : '';
          const suffix = /[a-zA-Z]$/.test(original) ? '(?![a-zA-Z])' : '';
          const regex = new RegExp(prefix + escaped + suffix, 'gi');
          const before = pseudonymizedText;
          pseudonymizedText = pseudonymizedText.replace(regex, () => pseudonym);
          if (pseudonymizedText !== before) {
            sessionMappings.push({ original, pseudonym, type: 'SESSION_ENTITY' });
          }
        } catch { /* regex failed */ }
      }
      if (sessionMappings.length > 0) {
        igLog(`${source} DOM DEF-016: Force-pseudonymizing ${sessionMappings.length} session entities`);
        registerPseudonymization(sessionMappings);
        turnCoordinator.submit({
          type: 'IRON_GATE_INTERCEPTED', promptText: text, allEntities,
          maskedText: pseudonymizedText, mappings: sanitizeMappingsForTransit(sessionMappings),
          level: 'high', score: Math.max(score, 50),
        });
        return { maskedText: pseudonymizedText, mappings: sessionMappings };
      }
    }

    if (allEntities.length === 0) {
      igLog(`${source} DOM: no entities (contextual score=${score}), not pseudonymizing`);
      turnCoordinator.submit({
        type: 'IRON_GATE_AUDIT', promptText: text, allEntities: [],
        maskedText: '', mappings: [], level, score,
      });
      return null;
    }

    // GREEN ZONE: benign context → don't pseudonymize
    if (score <= 25) {
      igLog(`${source} DOM: Low risk (score=${score}) — not pseudonymizing`);
      turnCoordinator.submit({
        type: 'IRON_GATE_AUDIT', promptText: text, allEntities,
        maskedText: '', mappings: [], level, score,
      });
      return null;
    }

    // Selective pseudonymization based on entity ownership
    const domEntitiesToPseudo = filterEntitiesForPseudonymization(text, allEntities, fullScore);
    // B2: Deterministic per-firm pseudonyms (no-op if firmKey not set)
    await _prefetchFirmPseudonyms(domEntitiesToPseudo);
    const pseudoResult = pseudonymizeLocal(text, domEntitiesToPseudo);

    // No actual pseudonymization (ownership filter or VALUE_TYPES) → passthrough
    if (pseudoResult.mappings.length === 0) {
      igLog(`${source} DOM: ${allEntities.length} entities detected but none require pseudonymization`);
      turnCoordinator.submit({
        type: 'IRON_GATE_AUDIT', promptText: text, allEntities,
        maskedText: '', mappings: [], level, score,
      });
      // DEF-014: Do NOT clear reverse map here — previous turns' mappings must persist
      return null;
    }

    // Centralized: register all mappings + session entities + DOM observer
    registerPseudonymization(pseudoResult.mappings);

    // Start persistent DOM observer so the AI response gets de-pseudonymized
    // as it streams in. Critical for DOM-only adapters (Gemini) where there's
    // no fetch/XHR response stream to intercept — the observer watches for
    // new text nodes containing pseudonyms and replaces them in real time.
    startPersistentDomDepseudo();

    // ════════════════════════════════════════════════════════════
    // DIAGNOSTIC: DOM PRE-SUBMIT — what gets written to the input
    // Only log when debug mode is active to prevent PII leak (4.2)
    // ════════════════════════════════════════════════════════════
    if (_IG_DEBUG) {
      console.log(
        `%c[Iron Gate WIRE] DOM PRE-SUBMIT PROXY (${adapterName})`,
        'color: #00cc00; font-weight: bold; font-size: 13px',
        `\n  Trigger: ${source}`,
        `\n  📤 Original: ${text.length} chars`,
        `\n  🔒 Pseudonymized: ${pseudoResult.maskedText.length} chars`,
        `\n  📊 ${allEntities.length} entities, score=${score}, level=${level}`,
      );
      for (const m of pseudoResult.mappings) {
        console.log(`  ${m.type}: [${m.original.length} chars] → "${m.pseudonym}"`);
      }
    }
    // ════════════════════════════════════════════════════════════

    igLog(`${adapterName} DOM PROXY (${source}): Pseudonymized ${allEntities.length} entities (${level}, score=${score})`);

    turnCoordinator.submit({
      type: 'IRON_GATE_INTERCEPTED', promptText: text, allEntities,
      maskedText: pseudoResult.maskedText, mappings: sanitizeMappingsForTransit(pseudoResult.mappings),
      level, score,
    });

    return pseudoResult;
  }

  // ── Enter key interception (capture phase — runs before platform handlers) ──
  document.addEventListener('keydown', async function (e: KeyboardEvent) {
    if (domInterceptBusy) return;
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    const inputEl = activeAdapter?.findInput();
    if (!inputEl) return;
    if (!inputEl.contains(e.target as Node) && e.target !== inputEl) return;

    const text = activeAdapter?.readInput(inputEl);
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
      }).catch(() => {});
      return;
    }

    if (mode !== 'proxy') return;

    igLog(`${adapterName} DOM: Enter pressed, text=${text.length} chars`);

    const result = await adapterDomPseudonymize(text, 'Enter');
    if (!result) return;

    if (isDomCaptureWire) {
      setPendingCopilotPseudo({ original: text, maskedText: result.maskedText });
      igLog(`${adapterName}: Queued pseudo for WS interception`);
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    _lastPseudoOutput = result.maskedText;
    const writeOk = activeAdapter?.writeInput(inputEl, result.maskedText);
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
      const sendBtn = activeAdapter?.findSubmitButton();
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
      // De-pseudonymize user message bubble — dom-presubmit physically changed
      // the textarea, so the submitted text has pseudonyms visible in the UI.
      if (Object.keys(currentReverseMap).length > 0) {
        depseudonymizeUserBubble({ ...currentReverseMap });
      }
      setTimeout(() => { domInterceptBusy = false; _lastPseudoOutput = null; }, 300);
    }, 100);
  }, true);

  // Helper: re-run pseudonymization and submit after file gate passes
  async function _domEnterSubmit(inputEl: HTMLElement, text: string) {
    if (mode === 'proxy') {
      const result = await adapterDomPseudonymize(text, 'Enter');
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
        const writeOk = activeAdapter?.writeInput(inputEl, result.maskedText);
        if (!writeOk) {
          igLog('_domEnterSubmit: writeInput failed — blocking submit to protect PII');
          return;
        }
      }
    }
    setTimeout(() => {
      domInterceptBusy = true;
      const sendBtn = activeAdapter?.findSubmitButton();
      if (sendBtn) {
        sendBtn.click();
      } else {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        }));
      }
      if (Object.keys(currentReverseMap).length > 0) {
        depseudonymizeUserBubble({ ...currentReverseMap });
      }
      setTimeout(() => { domInterceptBusy = false; }, 300);
    }, 100);
  }

  // ── Send button click interception (capture phase) ──
  document.addEventListener('click', async function (e: MouseEvent) {
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
      const inputEl = activeAdapter?.findInput();
      if (!inputEl) return;
      const parent = inputEl.closest('form') || inputEl.parentElement?.parentElement?.parentElement;
      if (!parent || !parent.contains(btn)) return;
      if (!btn.querySelector('svg')) return;
    }

    const inputEl = activeAdapter?.findInput();
    if (!inputEl) return;

    const text = activeAdapter?.readInput(inputEl);
    if (!text || text.length < 10) return;

    // Check file upload gate (regardless of proxy/audit mode)
    if (pendingFileScans.size > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      igLog(`${adapterName} DOM: Click blocked — checking file upload gate`);
      checkFileUploadGate().then(async (decision) => {
        if (decision === 'block') {
          igLog(`${adapterName} DOM: File gate BLOCKED send`);
          return;
        }
        // Gate passed — proceed with pseudonymization and re-click
        if (mode === 'proxy') {
          const result = await adapterDomPseudonymize(text, 'SendBtn');
          if (result) {
            if (isDomCaptureWire) {
              setPendingCopilotPseudo({ original: text, maskedText: result.maskedText });
              setTimeout(() => { domInterceptBusy = true; btn.click(); setTimeout(() => { domInterceptBusy = false; }, 300); }, 100);
              return;
            }
            _lastPseudoOutput = result.maskedText;
            activeAdapter?.writeInput(inputEl, result.maskedText);
          }
        }
        setTimeout(() => {
          domInterceptBusy = true;
          btn.click();
          if (Object.keys(currentReverseMap).length > 0) {
            depseudonymizeUserBubble({ ...currentReverseMap });
          }
          setTimeout(() => { domInterceptBusy = false; }, 300);
        }, 100);
      }).catch(() => {});
      return;
    }

    if (mode !== 'proxy') return;

    igLog(`${adapterName} DOM: Send button clicked, text=${text.length} chars`);

    const result = await adapterDomPseudonymize(text, 'SendBtn');
    if (!result) return;

    if (isDomCaptureWire) {
      setPendingCopilotPseudo({ original: text, maskedText: result.maskedText });
      igLog(`${adapterName}: Queued pseudo for WS interception`);
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    _lastPseudoOutput = result.maskedText;
    const writeOk = activeAdapter?.writeInput(inputEl, result.maskedText);

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
      if (Object.keys(currentReverseMap).length > 0) {
        depseudonymizeUserBubble({ ...currentReverseMap });
      }
      setTimeout(() => { domInterceptBusy = false; }, 300);
    }, 100);
  }, true);

  // ── Diagnostic: log the elements found after page load ──
  setTimeout(() => {
    const ta = activeAdapter?.findInput();
    const sb = activeAdapter?.findSubmitButton();
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

// Mark as active — nonce is NOT stored on the guard (security: prevents page-script extraction)
document.documentElement.setAttribute('data-ig-guard', JSON.stringify({
  status: 'active', since: Date.now(), token: _igGuardToken,
}));
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
  document.documentElement.removeAttribute('data-ig-guard');
}

} // End of duplicate execution guard
