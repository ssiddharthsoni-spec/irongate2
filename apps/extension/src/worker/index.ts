/**
 * Iron Gate Service Worker
 * Handles background tasks: event queuing, API communication, model management.
 */

import { analyzePrompt, sendProxiedPrompt, handleProxyFlow, analyzeFile } from './proxy-handler';
import { eventQueue } from './queue';
import { apiRequest, configureApiClient, getConfiguredApiKey } from './api-client';
import { initAuth, getFirmId, getUserId, getToken } from './auth';
import { detectWithRegex } from '../detection/fallback-regex';
import { computeScore, scoreToLevel } from '../detection/scorer';
import { pseudonymizeLocal } from '../detection/pseudonymizer';
import { scanForSecrets } from './detectors/secret-scanner';
import { resolveConfig, onManagedConfigChanged } from '../managed-config';
import { saveApiKey, loadApiKey } from '../api-key-store';
import { recordAttestation, getAuditLog, clearAuditLog } from './audit-trail';
import {
  initSessionLock, recordActivity, lockSession, unlockSession,
  isSessionLocked, handleLockAlarm, getLockTimeout, setLockTimeout,
} from './session-lock';
import { initTrialAlarms, handleTrialAlarm } from './trial-notifications';
import { classifyIfPro, classifyForGhost } from '../detection/ml-classifier';
import { isPro } from '../shared/tier-gate';
import { TOTAL_ENTITIES_DETECTED, WEEKLY_SCAN_COUNT } from '../shared/storage-keys';
import { startKillSwitchPoller } from '../security/kill-switch-poller';
import {
  enforceCompliance, setActiveFrameworks, needsProfileRefresh,
  getActiveFrameworks, type ComplianceEnforcementResult,
} from '../shared/compliance-enforcer';
import { trackShadowAI, getShadowAIStats } from './shadow-ai-tracker';
import { detectWithLocalLLM, resetLocalLLMHealth } from './local-llm-detector';
import { createConfidenceRouter, scoreToZone, type RoutingDecision, type TierAdapter } from '../detection/confidence-router';
import { createMetadataClassifierAdapter } from '../detection/metadata-classifier';
import { createTier2Adapter, probeTier2, type Tier2Config } from '../detection/tier2-adapter';
import { getSemanticClassifier } from '../detection/semantic-classifier';
import { sanitizeForClassification } from '../detection/pseudonymizer';
import { getWeightResolver } from '../detection/weight-resolver';
import { createDictionaryMatcher, type DictionaryEntry } from '../detection/entity-dictionary';
import { mergeEntities, dictionaryScoreBoost } from '../detection/entity-merger';
import { createGLiNERAdapter, type GLiNERAdapterConfig } from '../detection/tier2-gliner-adapter';
import { analyzeWithExecutiveLens, resolveRoute, type ExecutiveLensResult } from '../detection/executive-lens';
import { createModelRuntime } from '../agent/model-runtime';
import { createAgentDetector } from '../agent/agent-detector';

// Debug logging — silent in production, enable via: chrome.storage.local.get('ironGateDebug')
let _IG_DEBUG = false;
try { chrome.storage.local.get('ironGateDebug', (r) => { _IG_DEBUG = !!r.ironGateDebug; }); } catch {}
function igLog(...args: any[]) { if (_IG_DEBUG) console.log('[Iron Gate]', ...args); }

// Cache last prompt text per tab for ghost detection (Basic tier only)
const lastPromptTextByTab = new Map<number, string>();

// Debounce real-time broadcasts: at most once per 500ms per tab
const lastBroadcastByTab = new Map<number, number>();
const lastBroadcastScoreByTab = new Map<number, number>();
const BROADCAST_DEBOUNCE_MS = 500;

// Memory-leak guard: cap per-tab Maps so they never grow unbounded.
// If a service worker restarts, tab-close listeners don't fire for
// already-open tabs, so entries would accumulate forever without this.
const MAP_HIGH_WATER = 100;
const MAP_LOW_WATER = 50;

/** Prune a Map to MAP_LOW_WATER entries when it exceeds MAP_HIGH_WATER. */
function pruneMap<V>(map: Map<number, V>): void {
  if (map.size <= MAP_HIGH_WATER) return;
  const keysToDelete = Array.from(map.keys()).slice(0, map.size - MAP_LOW_WATER);
  for (const key of keysToDelete) {
    map.delete(key);
  }
}

// ─── Serialized stats updater ─────────────────────────────────────────────
// Prevents race conditions when concurrent prompts update entity/scan counts.
// Accumulates deltas and flushes them in a single atomic read-then-write.
let _pendingEntityDelta = 0;
let _pendingScanDelta = 0;
let _statsFlushTimer: ReturnType<typeof setTimeout> | null = null;

function incrementStats(entities: number, scans: number): void {
  _pendingEntityDelta += entities;
  _pendingScanDelta += scans;
  // Debounce: flush after 200ms of no new calls (batches concurrent prompts)
  if (_statsFlushTimer) clearTimeout(_statsFlushTimer);
  _statsFlushTimer = setTimeout(flushStats, 200);
}

let _statsIsFlushing = false;
async function flushStats(): Promise<void> {
  if (_statsIsFlushing) return;
  _statsIsFlushing = true;
  const entityDelta = _pendingEntityDelta;
  const scanDelta = _pendingScanDelta;
  _pendingEntityDelta = 0;
  _pendingScanDelta = 0;
  _statsFlushTimer = null;
  if (entityDelta === 0 && scanDelta === 0) { _statsIsFlushing = false; return; }

  try {
    const data = await chrome.storage.local.get([TOTAL_ENTITIES_DETECTED, WEEKLY_SCAN_COUNT]);
    await chrome.storage.local.set({
      [TOTAL_ENTITIES_DETECTED]: (data[TOTAL_ENTITIES_DETECTED] || 0) + entityDelta,
      [WEEKLY_SCAN_COUNT]: (data[WEEKLY_SCAN_COUNT] || 0) + scanDelta,
    });
  } catch {
    // Re-add deltas on failure so they're retried on next flush
    _pendingEntityDelta += entityDelta;
    _pendingScanDelta += scanDelta;
  } finally {
    _statsIsFlushing = false;
  }
}

igLog('Service worker started');

// ─── Uninstall survey ───────────────────────────────────────────────────────
// Open a brief survey when the extension is uninstalled (Priority 6.4)
chrome.runtime.setUninstallURL(
  'https://irongate-dashboard.vercel.app/uninstall-survey'
);

// ─── Auto-update handler ────────────────────────────────────────────────────
// When Chrome downloads a new version, notify the service worker so it can
// apply immediately (for enterprise deployments) or notify the user.
chrome.runtime.onUpdateAvailable.addListener((details) => {
  igLog('Update available:', details.version);
  // Reload immediately to apply the update (no user interaction needed)
  chrome.runtime.reload();
});

// ─── Startup: restore auth & wire API client ────────────────────────────────
initAuth().then(() => {
  configureApiClient({
    firmId: getFirmId() || '',
    getToken,
  });
  igLog('Auth initialized & API client configured');

  // Initialize weight resolver with API fetch function
  const weightResolver = getWeightResolver();
  weightResolver.configure(async (path: string) => {
    return apiRequest({ method: 'GET', path, retries: 1 });
  });
  weightResolver.init().then(() => {
    igLog('Weight resolver initialized');
  }).catch((err) => igLog('Weight resolver init failed (non-fatal):', err));

  // Auto-lock removed — no session lock initialization needed
}).catch((err) => igLog('Startup init failed:', err));

// Open side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Firm mode tracking — defaults to 'proxy' (Protect mode)
let firmMode: 'audit' | 'proxy' = 'proxy';
let isManaged = false;

// ─── Feedback Flywheel: Suppression Rules Cache ──────────────────────────────
// Periodically fetches feedback-based suppression rules from the API.
// Entity types with high false-positive rates get their scoring weights reduced.
let _suppressionWeights: Partial<Record<string, number>> = {};
let _suppressionLastFetch = 0;
const SUPPRESSION_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

// ─── Entity Dictionary (Tier 3) ──────────────────────────────────────────────
const _dictionaryMatcher = createDictionaryMatcher();
let _lastDictHash = '';

async function syncEntityDictionary(): Promise<void> {
  try {
    const versionResp = await apiRequest<{ hash: string; count: number }>({
      method: 'GET', path: '/admin/entity-dictionary/version', retries: 1,
    });
    if (!versionResp?.hash || versionResp.hash === _lastDictHash) return;

    const exportResp = await apiRequest<{ entities: DictionaryEntry[]; count: number }>({
      method: 'GET', path: '/admin/entity-dictionary/export', retries: 1,
    });
    if (!exportResp?.entities) return;

    _dictionaryMatcher.reload(exportResp.entities);
    _lastDictHash = versionResp.hash;

    // Persist to local storage for offline use
    await chrome.storage.local.set({
      iron_gate_entity_dictionary: exportResp.entities,
      iron_gate_dict_hash: versionResp.hash,
    });

    igLog('Entity dictionary synced:', exportResp.count, 'entries');
  } catch (err) {
    igLog('Entity dictionary sync error (non-fatal):', err);
  }
}

// Load cached dictionary on startup
chrome.storage.local.get(['iron_gate_entity_dictionary', 'iron_gate_dict_hash'], (result) => {
  if (result.iron_gate_entity_dictionary?.length) {
    _dictionaryMatcher.reload(result.iron_gate_entity_dictionary);
    _lastDictHash = result.iron_gate_dict_hash || '';
    igLog('Dictionary loaded from cache:', result.iron_gate_entity_dictionary.length, 'entries');
  }
});

async function refreshSuppressionRules(): Promise<void> {
  if (Date.now() - _suppressionLastFetch < SUPPRESSION_REFRESH_MS) return;
  try {
    const result = await apiRequest<{
      rules: Array<{ entityType: string; rule: string; confidence: number }>;
    }>({ method: 'GET', path: '/feedback/rules', retries: 1 });
    if (!result?.rules) return;

    const weights: Partial<Record<string, number>> = {};
    for (const rule of result.rules) {
      if (rule.rule === 'suppress_short') {
        // 80%+ false positive rate — reduce weight to 20% of default
        weights[rule.entityType] = 2;
      } else if (rule.rule === 'reduce_confidence') {
        // 60%+ false positive rate — halve the weight
        const defaultWeight = 10; // fallback default
        weights[rule.entityType] = Math.round(defaultWeight * 0.5);
      }
    }
    _suppressionWeights = weights;
    _suppressionLastFetch = Date.now();
    if (Object.keys(weights).length > 0) {
      igLog('Feedback suppression rules loaded:', Object.keys(weights).length, 'types adjusted');
    }
  } catch {
    // Fail silently — use cached rules or no suppression
  }
}

// ─── Confidence Router ──────────────────────────────────────────────────────
// Lazy-initialized confidence router. Rebuilt when config changes (e.g., Tier 2
// endpoint toggled on/off via managed config).
let _confidenceRouter: ReturnType<typeof createConfidenceRouter> | null = null;
let _routerEntities: import('../detection/types').DetectedEntity[] = [];
let _routerTextLength = 0;

function getConfidenceRouter(config: import('../managed-config').ResolvedConfig): ReturnType<typeof createConfidenceRouter> {
  if (_confidenceRouter) return _confidenceRouter;

  const adapters: TierAdapter[] = [];
  const tierConfig = config.tiers;

  // Tier 2: Client-side LLM (if enabled via tier config or legacy localLLM config)
  const tier2Endpoint = tierConfig.tier2Enabled ? tierConfig.tier2Endpoint
    : config.localLLM?.endpoint && config.localLLM.enableDetection ? config.localLLM.endpoint
    : '';
  if (tier2Endpoint) {
    const tier2Config: Tier2Config = {
      endpoint: tier2Endpoint,
      model: tierConfig.tier2Model || config.localLLM?.model || 'llama3.2:1b',
      format: tierConfig.tier2Protocol || (tier2Endpoint.includes('11434') ? 'ollama' : 'openai'),
      timeoutMs: tierConfig.tier2TimeoutMs || config.localLLM?.timeoutMs || 5000,
      enabled: true,
    };
    adapters.push(createTier2Adapter(tier2Config));
    igLog('Confidence router: Tier 2 enabled —', tier2Config.model, 'at', tier2Config.endpoint);
  }

  // Tier 2 (GLiNER): On-device NER model via offscreen document
  // Gated behind feature flag tier2_ner and managed config localNer.enabled
  if (tierConfig.glinerEnabled || (config as any).localNer?.enabled) {
    const glinerConfig: GLiNERAdapterConfig = {
      enabled: true,
      confidenceThreshold: (config as any).localNer?.confidenceThreshold ?? 0.5,
      timeoutMs: (config as any).localNer?.timeoutMs ?? 10000,
    };
    adapters.push(createGLiNERAdapter(glinerConfig));
    igLog('Confidence router: Tier 2 GLiNER NER enabled');
  }

  // Tier 2.5: Metadata classifier (always available unless explicitly disabled)
  if (tierConfig.tier25Enabled !== false) {
    adapters.push(createMetadataClassifierAdapter(
      () => _routerEntities,
      () => _routerTextLength,
    ));
  }

  // Semantic classifier (runs on all zones, catches casual language)
  let semanticClassify: ((text: string) => Promise<import('../detection/semantic-classifier').SemanticClassification>) | undefined;
  if (tierConfig.semanticEnabled !== false) {
    const semanticClassifier = getSemanticClassifier();
    if (semanticClassifier.isReady()) {
      semanticClassify = (text: string) => semanticClassifier.classify(text);
    }
  }

  _confidenceRouter = createConfidenceRouter({
    adapters,
    escalateAmber: true,
    tierTimeoutMs: tierConfig.tier3TimeoutMs || 3000,
    onTierError: (tier, err) => igLog(`Tier ${tier} error:`, err.message),
    semanticClassify,
  });

  igLog('Confidence router initialized with', adapters.length, 'adapters');
  return _confidenceRouter;
}

// Reset router when config changes so it picks up new tier settings
function resetConfidenceRouter(): void {
  _confidenceRouter = null;
  _agentDetector = null;
}

// ─── Local Agent Detector (context-aware entity detection) ───────────────────
// Uses an LLM to deeply understand text context and identify entities that
// regex and NER models miss. The LLM reads the text and outputs structured
// entity annotations — it never rewrites or modifies the text.
let _agentDetector: ReturnType<typeof createAgentDetector> | null = null;

function getAgentDetector(config: import('../managed-config').ResolvedConfig) {
  if (_agentDetector) return _agentDetector;

  const runtime = createModelRuntime({
    clientLlmEndpoint: config.localLLM?.endpoint,
    clientLlmModel: config.localLLM?.model,
    apiBaseUrl: config.apiUrl || undefined,
    apiKey: config.apiKey || undefined,
  });
  _agentDetector = createAgentDetector(runtime);

  return _agentDetector;
}

// ─── Compliance Profile Cache ─────────────────────────────────────────────────
// Fetches the firm's active compliance frameworks from the API.
// Frameworks like HIPAA, PCI-DSS, SOC 2 define entity types that are BLOCKED
// regardless of sensitivity score.

async function refreshComplianceProfile(): Promise<void> {
  if (!needsProfileRefresh()) return;
  try {
    const result = await apiRequest<{
      frameworks?: Array<{ id: string; enabled: boolean }>;
      activeFrameworks?: string[];
    }>({ method: 'GET', path: '/compliance/active', retries: 1 });
    if (result?.activeFrameworks) {
      setActiveFrameworks(result.activeFrameworks);
      igLog('Compliance profile loaded:', result.activeFrameworks.join(', ') || 'none');
    } else if (result?.frameworks) {
      const active = result.frameworks.filter(f => f.enabled).map(f => f.id);
      setActiveFrameworks(active);
      igLog('Compliance profile loaded:', active.join(', ') || 'none');
    }
  } catch {
    // Fail open on fetch error — keep cached profile
  }
}

// ─── Kill Switch Enforcement ─────────────────────────────────────────────────
// Polls the API every 60 seconds. When active, ALL prompt processing is blocked
// and users see an explanation. Fail-closed: if API is unreachable, kill switch
// activates to prevent unmonitored operation.
let killSwitchActive = false;
let _killSwitchStopFn: (() => void) | null = null;

function startKillSwitchEnforcement(apiBaseUrl: string): void {
  if (_killSwitchStopFn) _killSwitchStopFn(); // Stop any existing poller

  _killSwitchStopFn = startKillSwitchPoller(apiBaseUrl, (shouldDisable) => {
    killSwitchActive = shouldDisable;
    if (shouldDisable) {
      igLog('KILL SWITCH ACTIVE — all AI tool access blocked');
      // Update badge on all tabs
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.action.setBadgeText({ text: 'OFF', tabId: tab.id });
            chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId: tab.id });
          }
        }
      });
      // Notify all content scripts to show block screen
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && tab.url) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'KILL_SWITCH_ACTIVATED',
              payload: { active: true },
            }).catch(() => {});
          }
        }
      });
    } else {
      igLog('Kill switch cleared — normal operation resumed');
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.action.setBadgeText({ text: '', tabId: tab.id });
          }
        }
      });
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && tab.url) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'KILL_SWITCH_ACTIVATED',
              payload: { active: false },
            }).catch(() => {});
          }
        }
      });
    }
  }, getConfiguredApiKey);
}

// Start kill switch poller once config is resolved (needs API URL)
const KILL_SWITCH_API_URL = 'https://irongate-api.onrender.com/v1';

// Load config with managed-first priority
resolveConfig().then((config) => {
  firmMode = config.firmMode;
  isManaged = config.isManaged;
  if (config.isManaged) {
    configureApiClient({ apiKey: config.apiKey, baseUrl: config.apiUrl });
    igLog('Enterprise managed mode active. Mode:', firmMode);
    // Start kill switch enforcement with the configured API URL
    startKillSwitchEnforcement(config.apiUrl || KILL_SWITCH_API_URL);
    // Pre-fetch feedback suppression rules and compliance profile
    refreshSuppressionRules().catch(() => {});
    refreshComplianceProfile().catch(() => {});
  } else {
    igLog('Individual mode. Loaded firm mode:', firmMode);
    // Start kill switch enforcement with default API URL
    startKillSwitchEnforcement(KILL_SWITCH_API_URL);
  }
}).catch((err) => {
  igLog('Failed to resolve managed config:', err);
  chrome.storage.local.get('firmMode', (result) => {
    if (result.firmMode === 'audit' || result.firmMode === 'proxy') {
      firmMode = result.firmMode;
    } else {
      firmMode = 'proxy'; // default to Protect mode
    }
  });
});

// Listen for live managed policy changes (admin pushes new config)
onManagedConfigChanged((config) => {
  igLog('Managed config changed:', config.isManaged, config.firmMode);
  firmMode = config.firmMode;
  isManaged = config.isManaged;
  if (config.isManaged) {
    configureApiClient({ apiKey: config.apiKey, baseUrl: config.apiUrl });
  }
  // Reset local LLM health cache and confidence router when config changes
  resetLocalLLMHealth();
  resetConfidenceRouter();
  // Relay mode change to all content scripts
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'MODE_CHANGED',
          payload: { mode: config.firmMode },
        }).catch(() => {});
      }
    }
  });
});

// ─── Per-Tab State Tracking ──────────────────────────────────────────────────
// Track detection data per tab so the side panel can display tab-specific info.
// Uses chrome.storage.session (survives service worker idle, clears on browser close).

interface TabState {
  tabId: number;
  aiToolId: string;
  aiToolName: string;
  lastScore: number | null;
  lastLevel: string | null;
  lastExplanation: string | null;
  lastEntities: any[];
  lastPromptHash?: string;
  lastOriginalPrompt?: string;
  lastMaskedPrompt?: string;
  lastPseudonymMappings?: any[];
  detectionCount: number;
  lastDetectionTime: number;
}

const TAB_STATE_KEY = 'iron_gate_tab_states';
const MAX_PROMPT_STORAGE = 2000; // Truncate prompts to avoid quota issues

async function loadTabStates(): Promise<Record<number, TabState>> {
  try {
    const result = await chrome.storage.session.get(TAB_STATE_KEY);
    return result[TAB_STATE_KEY] || {};
  } catch {
    return {};
  }
}

async function saveTabStates(states: Record<number, TabState>): Promise<void> {
  try {
    await chrome.storage.session.set({ [TAB_STATE_KEY]: states });
  } catch (err) {
    igLog('Failed to save tab states:', err);
  }
}

async function getTabState(tabId: number): Promise<TabState | null> {
  const states = await loadTabStates();
  return states[tabId] || null;
}

async function updateTabState(tabId: number, update: Partial<TabState>): Promise<TabState> {
  const states = await loadTabStates();
  const existing = states[tabId] || {
    tabId,
    aiToolId: '',
    aiToolName: '',
    lastScore: null,
    lastLevel: null,
    lastExplanation: null,
    lastEntities: [],
    detectionCount: 0,
    lastDetectionTime: 0,
  };
  // Truncate prompts to stay within storage quota (lastPromptHash is always 64 chars, no truncation needed)
  if (update.lastMaskedPrompt && update.lastMaskedPrompt.length > MAX_PROMPT_STORAGE) {
    update.lastMaskedPrompt = update.lastMaskedPrompt.substring(0, MAX_PROMPT_STORAGE);
  }
  states[tabId] = { ...existing, ...update };
  await saveTabStates(states);
  return states[tabId];
}

async function removeTabState(tabId: number): Promise<void> {
  const states = await loadTabStates();
  delete states[tabId];
  await saveTabStates(states);
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let responded = false;
  const safeRespond = (val: any) => { if (!responded) { responded = true; sendResponse(val); } };
  handleMessage(message, sender)
    .then(safeRespond)
    .catch((err) => {
      console.error('[Iron Gate] Message handler error:', err);
      safeRespond({ error: err instanceof Error ? err.message : String(err) });
    });
  return true; // Keep channel open for async
});

// ── Sender validation helpers ──────────────────────────────────────────────
// Sidepanel-only messages must originate from the extension itself (no tab).
// Content-script messages must originate from a tab.
function isSidepanelSender(sender: chrome.runtime.MessageSender): boolean {
  // Sidepanel messages have no tab, and the origin is the extension itself
  return !sender.tab && sender.id === chrome.runtime.id;
}
function isContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
  return !!sender.tab && sender.id === chrome.runtime.id;
}

// Messages that are ONLY allowed from the sidepanel (no tab)
const SIDEPANEL_ONLY: ReadonlySet<string> = new Set([
  'SET_API_KEY', 'MODE_CHANGED', 'BLOCK_OVERRIDE', 'ENTITY_FEEDBACK',
  'CLEAR_AUDIT_LOG', 'GET_AUDIT_LOG', 'GET_MANAGED_STATUS', 'GET_SHADOW_AI_STATS',
]);


async function handleMessage(
  message: { type: string; payload?: any },
  sender: chrome.runtime.MessageSender
): Promise<any> {
  // ── Kill switch: block ALL prompt processing when active ──
  const KILL_SWITCH_BLOCKED_TYPES = new Set([
    'PROMPT_DETECTED', 'PROMPT_SUBMITTED', 'PROXY_ANALYZE', 'PROXY_SEND',
    'FILE_DETECTED', 'CLIPBOARD_DETECTED',
  ]);
  if (killSwitchActive && KILL_SWITCH_BLOCKED_TYPES.has(message.type)) {
    igLog('KILL SWITCH — blocked message:', message.type);
    return {
      ok: false,
      blocked: true,
      reason: 'Iron Gate kill switch is active. All AI tool monitoring is disabled by your administrator.',
    };
  }

  // ── Sender validation: reject spoofed messages ──
  if (SIDEPANEL_ONLY.has(message.type) && !isSidepanelSender(sender)) {
    igLog('BLOCKED — sidepanel-only message from non-sidepanel sender:', message.type);
    return { ok: false, error: 'Unauthorized sender' };
  }

  switch (message.type) {
    case 'PROMPT_DETECTED': {
      const { text, aiToolId, captureMethod } = message.payload;
      igLog('Prompt captured from', aiToolId, 'via', captureMethod, 'length:', text.length);
      const config = await resolveConfig();

      // ────────────────────────────────────────────────────────────────────
      // Detection Pipeline: Agent-First, Regex-Supplement
      //
      // 1. ALWAYS: Regex for structured patterns (SSN, CC, API keys, etc.)
      //    These are format-based — regex is better than any LLM at these.
      //
      // 2. ALWAYS: Secret scanner (API keys, tokens, credentials)
      //
      // 3. ALWAYS: Entity dictionary (admin-configured, Aho-Corasick)
      //
      // 4. PRIMARY: LLM Agent detector — understands context, classifies
      //    entities correctly (Goldman Sachs = ORG not PERSON), catches
      //    codenames, indirect identifiers, implied PII.
      //    If LLM unavailable → regex fills in for name/org/location detection.
      //
      // 5. MERGE: Agent entities + regex structured patterns + dictionary
      //    Agent is authoritative for names/orgs/context.
      //    Regex is authoritative for SSN/CC/API keys/format patterns.
      //    Dictionary overrides both (admin-curated = ground truth).
      // ────────────────────────────────────────────────────────────────────

      // Step 1: Regex for structured patterns (always runs, < 5ms)
      const regexEntities = detectWithRegex(text);
      const secrets = scanForSecrets(text);

      const structuredEntities: import('../detection/types').DetectedEntity[] = [
        ...secrets.map((s) => ({
          type: s.type,
          text: s.text,
          start: s.start,
          end: s.end,
          confidence: s.confidence,
          source: 'regex' as const,
        })),
      ];

      // Separate regex results: structured patterns (regex is better) vs. name/org detection
      const detector = getAgentDetector(config);
      const regexSuperiorTypes = detector.REGEX_SUPERIOR_TYPES;
      for (const e of regexEntities) {
        if (regexSuperiorTypes.has(e.type)) {
          structuredEntities.push(e); // Keep — regex is authoritative for these
        }
      }

      // Step 2: Dictionary matching (always, < 2ms)
      const dictEntities: import('../detection/types').DetectedEntity[] = [];
      if (_dictionaryMatcher.isLoaded()) {
        const dictMatches = _dictionaryMatcher.search(text);
        if (dictMatches.length > 0) {
          dictEntities.push(..._dictionaryMatcher.toDetectedEntities(dictMatches));
          igLog('Dictionary matched', dictMatches.length, 'entities');
        }
      }

      // Step 3: LLM Agent detection — PRIMARY for names, orgs, context
      let agentEntities: import('../detection/types').DetectedEntity[] = [];
      let agentAvailable = false;
      try {
        agentAvailable = await detector.isAvailable();
        if (agentAvailable) {
          agentEntities = await detector.detect(text, structuredEntities, {
            mode: 'primary',
            timeoutMs: 5000,
            minConfidence: 0.5,
          });
          igLog('Agent detected', agentEntities.length, 'entities (primary mode)');
        }
      } catch (err) {
        igLog('Agent detector error (falling back to regex):', err);
      }

      // Step 4: If agent unavailable, use regex for ALL entity types (fallback)
      if (!agentAvailable) {
        for (const e of regexEntities) {
          if (!regexSuperiorTypes.has(e.type)) {
            // These are the name/org/location entities that regex caught
            // Less accurate than agent, but better than nothing
            structuredEntities.push(e);
          }
        }
        igLog('Agent unavailable — using regex fallback for all entity types');
      }

      // Step 5: Legacy local LLM detection (enterprise, if configured separately)
      if (config.localLLM) {
        try {
          const llmResult = await detectWithLocalLLM(text, config.localLLM);
          if (llmResult.available && llmResult.entities.length > 0) {
            for (const llmEntity of llmResult.entities) {
              const overlaps = agentEntities.some(e =>
                e.start < llmEntity.end && e.end > llmEntity.start
              );
              if (!overlaps) {
                agentEntities.push(llmEntity);
              }
            }
            igLog('Local LLM added', llmResult.entities.length, 'entities');
          }
        } catch (err) {
          igLog('Local LLM detection error (non-fatal):', err);
        }
      }

      // Step 6: Merge all sources
      // Priority: dictionary > agent > regex structured
      const mergeSources: import('../detection/types').DetectedEntity[][] = [structuredEntities];
      if (agentEntities.length > 0) mergeSources.push(agentEntities);
      if (dictEntities.length > 0) mergeSources.push(dictEntities);
      const allEntities = mergeEntities(...mergeSources);

      // ── ML classification (Pro+ only) ──
      const mlResult = await classifyIfPro(text);
      if (mlResult && (mlResult.label === 'SENSITIVE' || mlResult.label === 'CRITICAL')) {
        igLog('ML classified as', mlResult.label, 'confidence:', mlResult.confidence);
      }

      // Apply adaptive weights (API-driven) + feedback-based suppression weights
      await refreshSuppressionRules();
      const tier1Start = performance.now();
      const adaptiveWeights = getWeightResolver().getWeights();
      const mergedWeights = { ...adaptiveWeights, ..._suppressionWeights };
      const rawSensitivity = computeScore(text, allEntities,
        Object.keys(mergedWeights).length > 0 ? mergedWeights : undefined);

      // Apply dictionary score boost — known entities from admin dictionary
      // should escalate the sensitivity score even if regex scored low.
      const dictBoost = dictionaryScoreBoost(
        allEntities.filter(e => e.source === 'dictionary')
      );

      // If ML says CRITICAL but regex says low, boost the score.
      // Create a new object instead of mutating — prevents downstream surprises.
      let finalScore = Math.min(100, rawSensitivity.score + dictBoost);
      let finalLevel = scoreToLevel(finalScore);
      if (mlResult && mlResult.label === 'CRITICAL' && finalScore < 60) {
        finalScore = 60;
        finalLevel = scoreToLevel(finalScore);
      }
      const tier1Result = { ...rawSensitivity, score: finalScore, level: finalLevel };

      // ── Confidence-gated routing: escalate amber zone through tiers ──
      // Green (0-25): pass. Amber (26-60): escalate to Tier 2/2.5/3. Red (61+): block.
      // The router also applies semantic classification on ALL zones to catch
      // content that regex/keywords missed (e.g., casual M&A language).
      _routerEntities = allEntities;
      _routerTextLength = text.length;
      const router = getConfidenceRouter(config);
      let routingDecision: RoutingDecision | null = null;
      try {
        routingDecision = await router.route(text, tier1Result, performance.now() - tier1Start);
        igLog('Confidence routing:', routingDecision.finalZone,
          'score:', tier1Result.score, '→', routingDecision.finalScore,
          'tiers:', routingDecision.tiersConsulted.map(t => t.source).join(', '));
      } catch (err) {
        igLog('Confidence routing failed (using Tier 1 result):', err);
      }

      // Use routed score if available, otherwise fall back to Tier 1
      const sensitivityResult = routingDecision
        ? { ...tier1Result, score: routingDecision.finalScore, level: routingDecision.finalLevel }
        : tier1Result;

      // ── Compliance enforcement: framework-specific blocking ──
      // HIPAA + MEDICAL_RECORD = block, regardless of score.
      await refreshComplianceProfile();
      const complianceResult = enforceCompliance(allEntities);
      if (complianceResult?.blocked) {
        igLog('COMPLIANCE BLOCK:', complianceResult.reason);

        // Queue event with complianceOverride flag
        const promptHash = await hashText(text);
        queueEventToApi({
          aiToolId,
          promptHash,
          promptLength: text.length,
          sensitivityScore: 100, // Force critical
          sensitivityLevel: 'critical',
          entities: allEntities.map((e) => ({
            type: e.type, text: e.text, start: e.start, end: e.end,
            confidence: e.confidence, source: e.source,
          })),
          action: 'block',
          captureMethod,
          complianceOverride: true,
          complianceFrameworks: complianceResult.activeFrameworks,
        });

        // Broadcast block to sidepanel
        const blockTabId = sender.tab?.id;
        if (blockTabId) {
          chrome.runtime.sendMessage({
            type: 'COMPLIANCE_BLOCK',
            payload: {
              reason: complianceResult.reason,
              violations: complianceResult.violations,
              frameworks: complianceResult.activeFrameworks,
              score: 100,
              level: 'critical',
              tabId: blockTabId,
              aiToolId,
            },
          }).catch(() => {});
        }

        return {
          received: true,
          blocked: true,
          complianceOverride: true,
          reason: complianceResult.reason,
          violations: complianceResult.violations,
        };
      }

      // Generate pseudonymized version for transparency view
      // Simple find-replace — deterministic, fast (< 1ms)
      // Agent handles DETECTION (above), not rewriting.
      const pseudoResult = pseudonymizeLocal(text, allEntities);

      // ── Executive Lens: industry-aware routing decision ──
      // Determines whether to pseudonymize (cloud), route to private LLM,
      // or passthrough based on industry, entity types, and content signals.
      const lensResult = analyzeWithExecutiveLens(text, allEntities);
      const hasPrivateLlm = !!config.localLLM?.endpoint;
      const executiveRoute = resolveRoute(lensResult, hasPrivateLlm);
      if (lensResult.industry || lensResult.triggeredRules.length > 0) {
        igLog('Executive Lens:', lensResult.industry, '→', executiveRoute,
          lensResult.triggeredRules.length > 0 ? `(rules: ${lensResult.triggeredRules.join(', ')})` : '',
          lensResult.explanation);
      }

      // Track stats for trial banner (serialized to prevent race conditions)
      incrementStats(allEntities.length, 1);

      // Queue event for API with CORRECT schema
      const promptHash = await hashText(text);
      // Use confidence router's action when available; fall back to static thresholds
      const routedAction = routingDecision?.action; // 'pass' | 'warn' | 'block'
      const action = firmMode === 'proxy'
        ? 'proxy'
        : routedAction === 'block' ? 'block'
        : routedAction === 'warn' ? 'warn'
        : sensitivityResult.level === 'critical' ? 'block' : 'pass';
      queueEventToApi({
        aiToolId,
        promptHash,
        promptLength: text.length,
        sensitivityScore: sensitivityResult.score,
        sensitivityLevel: sensitivityResult.level,
        entities: allEntities.map((e) => ({
          type: e.type,
          text: e.text,
          start: e.start,
          end: e.end,
          confidence: e.confidence,
          source: e.source,
        })),
        action,
        captureMethod,
      });

      // ── Positive badge reinforcement ──
      // Show entity count (amber/red) when entities are detected, or a green
      // checkmark when the prompt is clean. This replaces the "silent unless
      // bad" pattern with visible reassurance that protection is active.
      const badgeTabId = sender.tab?.id;
      if (badgeTabId) {
        if (allEntities.length > 0) {
          // Entities detected and protected — show shield count
          const badgeColor = sensitivityResult.level === 'critical' ? '#EF4444'
            : sensitivityResult.level === 'high' ? '#F59E0B'
            : '#6366F1'; // indigo for low/medium — "we see it, you're covered"
          chrome.action.setBadgeText({ text: String(allEntities.length), tabId: badgeTabId });
          chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId: badgeTabId });
        } else {
          // Clean prompt — brief green checkmark (clears after 3s)
          chrome.action.setBadgeText({ text: '\u2713', tabId: badgeTabId });
          chrome.action.setBadgeBackgroundColor({ color: '#22C55E', tabId: badgeTabId });
          setTimeout(() => {
            chrome.action.setBadgeText({ text: '', tabId: badgeTabId }).catch(() => {});
          }, 3000);
        }
      }

      // ── Broadcast real-time detection to side panel (debounced) ──
      // This gives users live feedback as they type. The MAIN world fetch
      // interceptor (SENSITIVITY_SCORE on submit) will overwrite with the
      // final, authoritative result when the prompt is actually sent.
      const pdTabId = sender.tab?.id;
      if (pdTabId) {
        lastPromptTextByTab.set(pdTabId, text);
        pruneMap(lastPromptTextByTab);

        const now = Date.now();
        const lastBroadcast = lastBroadcastByTab.get(pdTabId) || 0;
        const prevScore = lastBroadcastScoreByTab.get(pdTabId) ?? -1;
        // Always broadcast immediately when score DROPS (user removed sensitive data)
        // — stale high scores shouldn't persist. Otherwise debounce normally.
        const scoreDropped = sensitivityResult.score < prevScore;
        if (scoreDropped || now - lastBroadcast >= BROADCAST_DEBOUNCE_MS) {
          lastBroadcastByTab.set(pdTabId, now);
          lastBroadcastScoreByTab.set(pdTabId, sensitivityResult.score);
          pruneMap(lastBroadcastByTab);
          pruneMap(lastBroadcastScoreByTab);
          chrome.runtime.sendMessage({
            type: 'SENSITIVITY_SCORE',
            payload: {
              score: sensitivityResult.score,
              level: sensitivityResult.level,
              entities: allEntities.map((e) => ({
                type: e.type,
                start: e.start,
                end: e.end,
                confidence: e.confidence,
                source: e.source,
              })),
              aiToolId,
              tabId: pdTabId,
              maskedPrompt: pseudoResult.maskedText,
              pseudonymMappings: pseudoResult.mappings.map(m => ({ original: m.original, pseudonym: m.pseudonym, type: m.type, length: m.original.length })),
              promptHash: await hashText(text),
              promptLength: text.length,
              realtime: true, // Flag so UI can differentiate from submit
              zone: routingDecision?.finalZone ?? scoreToZone(sensitivityResult.score),
              action: routedAction ?? (sensitivityResult.level === 'critical' ? 'block' : 'pass'),
              wasEscalated: routingDecision?.wasEscalated ?? false,
              tiersConsulted: routingDecision?.tiersConsulted?.map(t => t.source) ?? ['local-regex-scorer'],
              // Executive Lens routing
              executiveRoute,
              executiveIndustry: lensResult.industry,
              executiveRules: lensResult.triggeredRules,
              executiveExplanation: lensResult.explanation,
              privateLlmEndpoint: executiveRoute === 'private_llm' && config.localLLM ? config.localLLM.endpoint : undefined,
              privateLlmModel: executiveRoute === 'private_llm' && config.localLLM ? config.localLLM.model : undefined,
            },
          }).catch(() => {});
        }
      }

      return { received: true };
    }

    // ── PROMPT_CLEARED — user emptied the input field ──
    // Broadcast to sidepanel so it resets stale detection results.
    case 'PROMPT_CLEARED': {
      const clearTabId = sender.tab?.id;
      if (clearTabId) {
        lastPromptTextByTab.delete(clearTabId);
        lastBroadcastByTab.delete(clearTabId);
        lastBroadcastScoreByTab.delete(clearTabId);
        chrome.runtime.sendMessage({
          type: 'PROMPT_CLEARED',
          payload: { tabId: clearTabId, aiToolId: message.payload?.aiToolId },
        }).catch(() => {});
      }
      return { received: true };
    }

    // ── SENSITIVITY_SCORE from content script (relayed from MAIN world) ──
    // This is the PRIMARY event source — fired when MAIN world intercepts
    // a fetch to an LLM API and detects/pseudonymizes entities.
    case 'SENSITIVITY_SCORE': {
      const payload = message.payload;
      const {
        score, level, explanation, entities = [],
        aiToolId, promptHash, promptLength, maskedPrompt, pseudonymMappings,
      } = payload;

      // Only queue to API if this has prompt data (i.e., from content script, not a re-broadcast)
      if (promptHash) {
        igLog('MAIN world event —', aiToolId, 'score:', score, 'level:', level, 'entities:', entities?.length || 0, 'mappings:', pseudonymMappings?.length || 0);

        const action = firmMode === 'proxy'
          ? (pseudonymMappings?.length > 0 ? 'proxy' : 'pass')
          : 'pass';

        // Entities arrive pre-minimized (textHash + length) from main-world.ts.
        // Pass them directly — queueEventToApi will forward without re-hashing.
        const entityList = (entities && entities.length > 0)
          ? entities.map((e: any) => ({
              type: e.type || 'UNKNOWN',
              text: '', // Placeholder — queueEventToApi will hash (produces empty hash for empty string)
              textHash: e.textHash, // Pre-computed hash from main-world.ts
              length: e.length || 0,
              start: e.start || 0,
              end: e.end || 0,
              confidence: e.confidence || 0.85,
              source: e.source || 'regex',
            }))
          : [];

        // Queue with pre-minimized entities — queueEventToApi detects textHash and skips re-hashing
        await queueEventToApiMinimized({
          aiToolId: aiToolId || 'unknown',
          promptHash,
          promptLength: promptLength || 0,
          sensitivityScore: score,
          sensitivityLevel: level,
          entities: entityList,
          action,
          captureMethod: 'fetch',
        });

        // Cryptographic audit trail — HMAC-signed record for tamper-evidence
        recordAttestation({
          action,
          entityCount: entityList.length,
          promptHash,
          level,
          score,
          aiToolId: aiToolId || 'unknown',
        }).catch(() => {});
      }

      // Store per-tab state for this detection
      const ssTabId = sender.tab?.id || null;
      if (ssTabId && promptHash) {
        updateTabState(ssTabId, {
          aiToolId: aiToolId || 'unknown',
          lastScore: score,
          lastLevel: level,
          lastExplanation: explanation,
          lastEntities: entities || [],
          lastPromptHash: promptHash,
          lastOriginalPrompt: payload.originalPrompt || '',
          lastMaskedPrompt: maskedPrompt,
          lastPseudonymMappings: pseudonymMappings,
          detectionCount: ((await getTabState(ssTabId))?.detectionCount || 0) + 1,
          lastDetectionTime: Date.now(),
        }).catch(() => {});
      }

      // Re-broadcast to sidepanel WITH tab context (sidepanel only receives
      // messages from the worker, NOT from content scripts)
      chrome.runtime.sendMessage({
        type: 'SENSITIVITY_SCORE',
        payload: { ...payload, tabId: ssTabId },
      }).catch(() => {});

      // Ghost detection for Basic tier users (fire-and-forget)
      const ghostTabId = ssTabId ?? sender.tab?.id;
      if (ghostTabId && lastPromptTextByTab.has(ghostTabId)) {
        const cachedText = lastPromptTextByTab.get(ghostTabId)!;
        lastPromptTextByTab.delete(ghostTabId);
        isPro().then(hasPro => {
          if (!hasPro) {
            classifyForGhost(cachedText).then(ghostResult => {
              if (ghostResult && (ghostResult.label === 'SENSITIVE' || ghostResult.label === 'CRITICAL')) {
                chrome.runtime.sendMessage({
                  type: 'GHOST_DETECTION',
                  payload: { label: ghostResult.label, confidence: ghostResult.confidence, tabId: ghostTabId },
                }).catch(() => {});
              }
            }).catch(() => {});
          }
        });
      }

      return { ok: true };
    }

    case 'PROMPT_SUBMITTED': {
      const { text, aiToolId, sensitivityScore } = message.payload;
      igLog('Prompt submitted on', aiToolId, 'score:', sensitivityScore);

      // In proxy mode, run the full proxy flow instead of just passing through
      if (firmMode === 'proxy') {
        try {
          const sessionId = message.payload.sessionId || crypto.randomUUID();
          const result = await handleProxyFlow(text, aiToolId, sessionId);
          return result;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          if (errMsg.includes('No API key') || errMsg.includes('api key')) {
            console.debug('[Iron Gate] Proxy flow skipped — no API key configured.');
          } else {
            console.warn('[Iron Gate] Proxy flow error:', error);
          }
          return { actionRequired: 'pass', error: 'Proxy flow failed, falling back to passthrough' };
        }
      }

      // Audit mode: queue event for backend
      const promptHash = await hashText(text);
      queueEventToApi({
        aiToolId,
        promptHash,
        promptLength: text.length,
        sensitivityScore: sensitivityScore || 0,
        sensitivityLevel: scoreToLevel(sensitivityScore || 0),
        entities: [],
        action: 'pass',
        captureMethod: 'submit',
      });

      return { actionRequired: 'pass' };
    }

    case 'PROXY_ANALYZE': {
      const { text, aiToolId, sessionId } = message.payload;
      igLog('Proxy analyze request for', aiToolId, 'length:', text.length);

      try {
        const result = await analyzePrompt(text, aiToolId, sessionId);

        // Send result back to the content script
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'PROXY_RESULT',
            payload: result,
          });
        }

        return result;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes('No API key') || errMsg.includes('api key')) {
          console.debug('[Iron Gate] Proxy analyze skipped — no API key configured.');
        } else {
          console.warn('[Iron Gate] Proxy analyze error:', error);
        }
        return { error: 'Proxy analysis failed' };
      }
    }

    case 'PROXY_SEND': {
      const { maskedPrompt, route, sessionId, ...options } = message.payload;
      igLog('Proxy send request, route:', route);

      try {
        const result = await sendProxiedPrompt(maskedPrompt, route, sessionId, options);

        // Send response back to the content script
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'PROXY_RESPONSE',
            payload: result,
          });
        }

        return result;
      } catch (error) {
        console.warn('[Iron Gate] Proxy send error:', error);
        return { error: 'Proxy send failed' };
      }
    }

    case 'FILE_UPLOAD_DETECTED': {
      const { fileName, fileBase64, fileType, aiToolId, metadataOnly } = message.payload;
      igLog('File upload detected:', fileName, 'on', aiToolId, metadataOnly ? '(metadata only)' : `(${fileBase64?.length || 0} chars base64)`);

      // Metadata-only events (e.g., ChatGPT /backend-api/files JSON) have no file content to scan.
      // Log them but skip analysis — the actual file bytes will arrive via FileReader/Blob patches.
      if (metadataOnly || !fileBase64) {
        igLog('Skipping analysis — no file content (metadata-only event)');
        return { ok: true, metadataOnly: true };
      }

      try {
        const result = await analyzeFile(fileName, fileBase64, fileType);

        // Broadcast scan result to sidepanel AND content scripts on all tabs
        const scanResult = { type: 'FILE_SCAN_RESULT', payload: { ...result, aiToolId } };
        chrome.runtime.sendMessage(scanResult).catch(() => {});
        // Also send to the tab that uploaded the file
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, scanResult).catch(() => {});
        }

        return result;
      } catch (error) {
        const rawMsg = error instanceof Error ? error.message : String(error);
        // Provide actionable error messages instead of raw HTTP status text
        let errMsg = rawMsg;
        if (rawMsg === 'Not Found' || rawMsg.includes('404')) {
          errMsg = 'API endpoint not found — check your Iron Gate API URL in settings';
        } else if (rawMsg.includes('401') || rawMsg.includes('Unauthorized') || rawMsg.includes('api key')) {
          errMsg = 'Authentication failed — check your API key in Iron Gate settings';
        } else if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError') || rawMsg.includes('ERR_CONNECTION')) {
          errMsg = 'Could not reach Iron Gate API — check your connection and API URL';
        }
        console.warn('[Iron Gate] File analysis error:', errMsg);

        // Notify sidepanel AND content script so both show the error
        const errorResult = {
          type: 'FILE_SCAN_RESULT',
          payload: {
            fileName,
            fileType,
            fileSize: 0,
            textLength: 0,
            score: 0,
            level: 'error',
            entitiesFound: 0,
            explanation: `Scan failed: ${errMsg}`,
            entities: [],
            breakdown: {},
            redactedText: '',
            entitiesRedacted: 0,
            eventId: '',
            aiToolId,
            error: errMsg,
          },
        };
        chrome.runtime.sendMessage(errorResult).catch(() => {});
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, errorResult).catch(() => {});
        }

        return { error: errMsg };
      }
    }

    case 'MODE_CHANGED': {
      if (isManaged) {
        igLog('MODE_CHANGED rejected — enterprise managed mode');
        return { ok: false, error: 'Configuration is managed by your organization' };
      }
      const { mode } = message.payload;
      firmMode = mode;
      chrome.storage.local.set({ firmMode: mode });
      igLog('Firm mode changed to:', mode);

      // Relay MODE_CHANGED to ALL content scripts on AI tool tabs
      // so they can sync the mode to the MAIN world fetch interceptor
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && tab.url) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'MODE_CHANGED',
              payload: { mode },
            }).catch(() => {
              // Tab doesn't have content script — ignore
            });
          }
        }
      });

      return { ok: true, mode };
    }

    case 'SET_API_KEY': {
      if (isManaged) {
        igLog('SET_API_KEY rejected — enterprise managed mode');
        return { ok: false, error: 'Configuration is managed by your organization' };
      }
      const { apiKey } = message.payload;
      igLog('API key updated:', apiKey ? '(set)' : '(cleared)');
      await saveApiKey(apiKey);
      configureApiClient({ apiKey });
      return { ok: true };
    }

    case 'GET_MANAGED_STATUS': {
      return { ok: true, isManaged, firmMode };
    }

    case 'GET_KILL_SWITCH_STATUS': {
      return { ok: true, active: killSwitchActive };
    }

    case 'GET_COMPLIANCE_STATUS': {
      return {
        ok: true,
        activeFrameworks: getActiveFrameworks(),
        frameworkCount: getActiveFrameworks().length,
      };
    }

    case 'BLOCK_OVERRIDE': {
      const { eventId, reason } = message.payload;
      igLog('Block override:', eventId, 'reason:', reason);

      queueEventToApi({
        aiToolId: 'override',
        promptHash: eventId || crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'),
        promptLength: 0,
        sensitivityScore: 0,
        sensitivityLevel: 'low',
        entities: [],
        action: 'override',
        overrideReason: reason,
        captureMethod: 'manual',
      });

      return { ok: true };
    }

    case 'OPEN_SIDE_PANEL': {
      const tabId = sender.tab?.id;
      if (tabId) {
        chrome.sidePanel.open({ tabId }).catch((err) =>
          console.warn('[Iron Gate] Failed to open side panel:', err)
        );
      }
      return { ok: true };
    }

    case 'ENTITY_FEEDBACK': {
      const { entityType, entityText, isCorrect, feedbackType, correctedType } = message.payload;
      igLog('Entity feedback:', entityType, '—', feedbackType);

      // Hash the entity text before sending — raw PII must never leave the browser
      let entityHash = '';
      if (entityText) {
        const data = new TextEncoder().encode(entityText);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        entityHash = Array.from(new Uint8Array(hashBuffer))
          .map((b: number) => b.toString(16).padStart(2, '0'))
          .join('');
      }

      try {
        await apiRequest({
          method: 'POST',
          path: '/feedback',
          body: {
            entityType,
            entityHash,
            isCorrect,
            feedbackType,
            correctedType,
            firmId: getFirmId(),
            userId: getUserId(),
          },
        });
        return { ok: true };
      } catch (err) {
        console.warn('[Iron Gate] Failed to send feedback:', err);
        return { ok: false, error: 'Failed to send feedback' };
      }
    }

    case 'PROTECTION_STATUS': {
      // Relay health status from content script to sidepanel
      chrome.runtime.sendMessage({
        type: 'PROTECTION_STATUS',
        payload: message.payload,
      }).catch(() => {});

      // Update badge to indicate protection failure
      if (message.payload?.healthy === false && sender.tab?.id) {
        chrome.action.setBadgeText({ text: '!', tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId: sender.tab.id });
      }
      return { ok: true };
    }

    case 'GET_TAB_STATE': {
      const requestedTabId = message.payload?.tabId;
      if (requestedTabId) {
        const state = await getTabState(requestedTabId);
        return { ok: true, state };
      }
      return { ok: false, error: 'No tabId provided' };
    }

    case 'GET_AUDIT_LOG': {
      const log = await getAuditLog();
      return { ok: true, log };
    }

    case 'CLEAR_AUDIT_LOG': {
      await clearAuditLog();
      return { ok: true };
    }

    // Session lock removed — no lock/unlock handlers needed

    // ── SSO Detection & Shadow AI ──────────────────────────────────────────
    case 'SSO_DETECTION_RESULT': {
      const { accountType, emailDomain, ssoProvider, confidence, aiToolId } = message.payload;
      igLog('SSO detection result:', accountType, 'domain:', emailDomain, 'provider:', ssoProvider, 'confidence:', confidence);

      // If personal or unknown account, track as shadow AI
      if (accountType === 'personal' || accountType === 'unknown') {
        await trackShadowAI({
          aiToolId,
          accountType,
          emailDomain,
          timestamp: new Date().toISOString(),
          action: 'warning_shown',
        });
        igLog('Shadow AI event tracked for', aiToolId, '(', accountType, ')');
      }

      return { ok: true, accountType, policyTier: accountType === 'corporate' ? 'full' : 'warning' };
    }

    case 'GET_SHADOW_AI_STATS': {
      const stats = await getShadowAIStats();
      return { ok: true, stats };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── Event Queue Helper ─────────────────────────────────────────────────────

/**
 * Queue an event to the API with the CORRECT schema expected by POST /v1/events/batch.
 * This is the single point of event creation — all paths should use this.
 *
 * SECURITY: Entity text is hashed client-side (SHA-256) before leaving the browser.
 * Raw PII never travels to the Iron Gate API — only one-way hashes + metadata.
 */
async function queueEventToApi(event: {
  aiToolId: string;
  promptHash: string;
  promptLength: number;
  sensitivityScore: number;
  sensitivityLevel: string;
  entities: Array<{ type: string; text: string; start: number; end: number; confidence: number; source: string }>;
  action: string;
  overrideReason?: string;
  captureMethod: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  complianceOverride?: boolean;
  complianceFrameworks?: string[];
}): Promise<void> {
  // Client-side data minimization: hash entity text so raw PII never leaves the browser
  const minimizedEntities = await Promise.all(
    event.entities.map(async (e) => ({
      type: e.type,
      textHash: await hashText(e.text),
      length: e.text.length,
      start: e.start,
      end: e.end,
      confidence: e.confidence,
      source: e.source,
    }))
  );

  const meta: Record<string, unknown> = { ...(event.metadata || {}) };
  if (event.complianceOverride) {
    meta.complianceOverride = true;
    meta.complianceFrameworks = event.complianceFrameworks;
  }

  eventQueue.enqueue({
    aiToolId: event.aiToolId,
    aiToolUrl: '',
    promptHash: event.promptHash,
    promptLength: event.promptLength,
    sensitivityScore: event.sensitivityScore,
    sensitivityLevel: event.sensitivityLevel,
    entities: minimizedEntities,
    action: event.action,
    overrideReason: event.overrideReason,
    captureMethod: event.captureMethod,
    sessionId: event.sessionId,
    metadata: meta,
  }).catch((err) => console.warn('[Iron Gate] Failed to queue event:', err));
}

// Periodic alarm for flushing event queue
chrome.alarms.create('flush-events', { periodInMinutes: 1 });

// Periodic alarm for policy sync (every 15 minutes)
chrome.alarms.create('sync-policies', { periodInMinutes: 15 });

// Periodic alarm for heartbeat (every 5 minutes)
chrome.alarms.create('heartbeat', { periodInMinutes: 5 });

// Trial notification alarms
initTrialAlarms();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush-events') {
    igLog('Flushing event queue...');
    eventQueue.flush().catch((err) =>
      console.warn('[Iron Gate] Queue flush failed:', err)
    );
  }
  if (alarm.name === 'sync-policies') {
    igLog('Policy sync triggered');
    syncPolicies().catch((err) =>
      console.warn('[Iron Gate] Policy sync failed:', err)
    );
    // Refresh compliance profile alongside policy sync
    refreshComplianceProfile().catch(() => {});
  }
  if (alarm.name === 'heartbeat') {
    igLog('Sending heartbeat');
    sendHeartbeat().catch((err) =>
      console.warn('[Iron Gate] Heartbeat failed:', err)
    );
  }
  // Trial notification alarms
  handleTrialAlarm(alarm.name).catch((err) =>
    console.warn('[Iron Gate] Trial alarm handler failed:', err)
  );
});

// Run initial policy sync on startup
syncPolicies().catch(() => {});

/**
 * Policy Sync — fetches firm policies from the API every 15 minutes.
 * On change, pushes updated config to all content scripts and the side panel.
 */
let _lastPolicyHash = '';

async function syncPolicies(): Promise<void> {
  const firmId = getFirmId();
  if (!firmId) {
    igLog('No firm ID available, skipping policy sync');
    return;
  }

  try {
    const response = await apiRequest<{
      mode?: string;
      enabledEntityTypes?: string[];
      riskThresholds?: Record<string, number>;
      platformAllowList?: string[];
      platformBlockList?: string[];
      customEntities?: Array<{ name: string; pattern: string; confidence: number; weight: number }>;
      alertConfig?: Record<string, unknown>;
      updatedAt?: string;
    }>({
      method: 'GET',
      path: '/admin/firm',
    });

    // Simple change detection via JSON hash
    const policyStr = JSON.stringify(response);
    if (policyStr === _lastPolicyHash) {
      igLog('Policies unchanged, skipping broadcast');
      return;
    }
    _lastPolicyHash = policyStr;

    // Store in chrome.storage.local
    await chrome.storage.local.set({
      iron_gate_policies: response,
      iron_gate_policies_updated: Date.now(),
    });

    igLog('Policies synced', { updatedAt: response.updatedAt });

    // Sync entity dictionary (Tier 3) alongside policies
    syncEntityDictionary().catch(err => igLog('Dict sync error:', err));

    // Broadcast to all content scripts
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id && tab.url) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'POLICIES_UPDATED',
            payload: { policies: response, updatedAt: Date.now() },
          }).catch(() => {});
        }
      }
    });

    // Also notify side panel
    chrome.runtime.sendMessage({
      type: 'POLICIES_UPDATED',
      payload: { policies: response, updatedAt: Date.now() },
    }).catch(() => {});
  } catch (error) {
    igLog('Policy sync error:', error);
  }
}

/**
 * Heartbeat — sends extension status to the API every 5 minutes.
 * Populates the deployment view in the admin dashboard.
 */
async function sendHeartbeat(): Promise<void> {
  const firmId = getFirmId();
  if (!firmId) return;

  try {
    const manifest = chrome.runtime.getManifest();
    await apiRequest({
      method: 'POST',
      path: '/heartbeat',
      body: {
        extensionVersion: manifest.version,
        mode: firmMode,
        queueDepth: eventQueue.getSize(),
        healthStatus: {
          apiReachable: true,
          errorsLast5Min: 0,
        },
      },
    });
    igLog('Heartbeat sent');
  } catch {
    // Non-critical — don't log errors for missed heartbeats
  }
}

/**
 * Queue a pre-minimized event (entities already hashed by main-world.ts).
 * Used for SENSITIVITY_SCORE events relayed from the MAIN world via content script.
 */
async function queueEventToApiMinimized(event: {
  aiToolId: string;
  promptHash: string;
  promptLength: number;
  sensitivityScore: number;
  sensitivityLevel: string;
  entities: Array<{ type: string; textHash?: string; length?: number; text?: string; start: number; end: number; confidence: number; source: string }>;
  action: string;
  overrideReason?: string;
  captureMethod: string;
}): Promise<void> {
  // Entities already have textHash from main-world.ts — pass through directly
  const minimizedEntities = event.entities.map(e => ({
    type: e.type,
    textHash: e.textHash || '',
    length: e.length || 0,
    start: e.start,
    end: e.end,
    confidence: e.confidence,
    source: e.source,
  }));

  eventQueue.enqueue({
    aiToolId: event.aiToolId,
    aiToolUrl: '',
    promptHash: event.promptHash,
    promptLength: event.promptLength,
    sensitivityScore: event.sensitivityScore,
    sensitivityLevel: event.sensitivityLevel,
    entities: minimizedEntities,
    action: event.action,
    overrideReason: event.overrideReason,
    captureMethod: event.captureMethod,
    metadata: {},
  }).catch((err) => console.warn('[Iron Gate] Failed to queue minimized event:', err));
}

// ─── Programmatic MAIN World Injection ───────────────────────────────────────
// Backup injection method: if manifest content_scripts doesn't load the MAIN
// world interceptor (known CRXJS issue), we inject it programmatically.
// This ensures the fetch/XHR/WebSocket patches are installed on AI tool pages.

const AI_TOOL_URL_FILTERS: chrome.events.UrlFilter[] = [
  { hostContains: 'chatgpt.com' },
  { hostContains: 'chat.openai.com' },
  { hostContains: 'claude.ai' },
  { hostContains: 'gemini.google.com' },
  { hostContains: 'copilot.microsoft.com' },
  { hostContains: 'chat.deepseek.com' },
  { hostContains: 'poe.com' },
  { hostContains: 'perplexity.ai' },
  { hostContains: 'you.com' },
  { hostContains: 'huggingface.co' },
  { hostContains: 'groq.com' },
];

/** Regex matching all supported AI tool hostnames */
const AI_HOST_REGEX = /chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|chat\.deepseek\.com|poe\.com|perplexity\.ai|you\.com|huggingface\.co|groq\.com/;

// ─── Auto Re-inject on Extension Reload / Update ─────────────────────────────
// When the extension is reloaded or updated, existing AI tool tabs keep stale
// content scripts with broken chrome.runtime references. This function
// re-injects fresh content scripts into all matching tabs automatically.

let _reinjectInProgress = false;

async function reinjectAllTabs(): Promise<void> {
  if (_reinjectInProgress) return;
  _reinjectInProgress = true;

  try {
    const tabs = await chrome.tabs.query({});
    const manifest = chrome.runtime.getManifest();
    const mainWorldCS = (manifest.content_scripts as any[])?.find(
      (cs: any) => cs.world === 'MAIN'
    );
    const isolatedCS = (manifest.content_scripts as any[])?.find(
      (cs: any) => !cs.world || cs.world === 'ISOLATED'
    );

    let injectedCount = 0;
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !AI_HOST_REGEX.test(tab.url)) continue;

      const tabId = tab.id;
      try {
        // A: Reset MAIN world flag so duplicate guard allows re-init
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN' as any,
          func: () => {
            (window as any).__IRON_GATE_MAIN_WORLD = undefined;
            (window as any).__IRON_GATE_LOADING_SINCE = undefined;
          },
        });

        // B: Re-inject ISOLATED content script (sets up message bridge)
        if (isolatedCS?.js?.length) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: isolatedCS.js,
          });
        }

        // C: Re-inject MAIN world script (patches fetch)
        if (mainWorldCS?.js?.length) {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN' as any,
            files: mainWorldCS.js,
            injectImmediately: true,
          });
        }

        injectedCount++;
        igLog('Re-injected into tab', tabId, tab.url?.substring(0, 60));
      } catch {
        // Tab may not be accessible (chrome://, about:, restricted) — skip
      }
    }

    if (injectedCount > 0) {
      console.log(`[Iron Gate] Re-injected content scripts into ${injectedCount} AI tool tab(s)`);
    }
  } finally {
    _reinjectInProgress = false;
  }
}

// Re-inject on extension install or Chrome update
chrome.runtime.onInstalled.addListener((details) => {
  igLog('onInstalled:', details.reason);
  if (details.reason === 'install' || details.reason === 'update') {
    // Clear stale API URL on update so new default is used
    chrome.storage.local.remove('apiBaseUrl');
    reinjectAllTabs();
  }
});

// Also re-inject on every service worker startup — covers developer reload
// (which may not always fire onInstalled with reason='update')
reinjectAllTabs();

/**
 * Self-contained inline fetch interceptor — injected via chrome.scripting.executeScript({ func })
 * when the full main-world.ts file fails to load. This is the LAST RESORT fallback.
 * Must be 100% self-contained with no external references.
 */
function inlineFetchInterceptor() {
  const _debug = !!(window as any).__IRON_GATE_DEBUG;

  // Skip if full main-world.ts already loaded or is loading
  const mwState = (window as any).__IRON_GATE_MAIN_WORLD;
  if (mwState === 'active' || mwState === 'loading') {
    if (_debug) console.log('[Iron Gate INLINE] Full main-world.ts already ' + mwState + ' — skipping inline fallback');
    return;
  }

  if (_debug) console.log('[Iron Gate INLINE] Installing inline fetch interceptor (fallback)...');

  // Generate cryptographic nonce for message authentication
  const _nonce = crypto.getRandomValues(new Uint8Array(16))
    .reduce((s: string, b: number) => s + b.toString(16).padStart(2, '0'), '');

  function igPostMessage(data: Record<string, unknown>): void {
    window.postMessage({ ...data, _nonce }, window.location.origin);
  }

  let mode: 'audit' | 'proxy' = 'proxy';

  // Persistent forward/reverse maps for conversation consistency
  const forwardMap: Record<string, string> = {};  // original → pseudonym
  const reverseMap: Record<string, string> = {};  // pseudonym → original

  // Listen for mode changes
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    if (e.data?.type === 'IRON_GATE_SET_MODE') {
      mode = e.data.mode;
      if (_debug) console.log('[Iron Gate INLINE] Mode set to:', mode);
    }
  });
  igPostMessage({ type: 'IRON_GATE_REQUEST_MODE' });

  // ── Entity Detection Patterns ──
  const PATTERNS: Array<{ type: string; re: RegExp }> = [
    { type: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
    { type: 'SSN', re: /\b\d{3}\s\d{2}\s\d{4}\b/g },
    { type: 'SSN', re: /(?<=(?:ssn|social\s*security(?:\s*(?:number|num|no|#))?|ss#)\s*(?:is|:|=|#)?\s*)\d{9}(?!\d)/gi },
    { type: 'EMAIL', re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
    { type: 'PHONE_NUMBER', re: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
    { type: 'CREDIT_CARD', re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
    { type: 'IP_ADDRESS', re: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
    { type: 'DATE_OF_BIRTH', re: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
    { type: 'PERSON', re: /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g },
    { type: 'PERSON', re: /(?<=\b(?:CEO|CFO|CTO|COO|CMO|VP|SVP|EVP|Director|Manager|Attorney|Counsel|Partner|President|Chairman)\s+)[A-Z][a-z]+\s+[A-Z][a-z]+\b/g },
    { type: 'MONETARY_AMOUNT', re: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:million|billion|M|B|k|K)?\b/g },
    { type: 'MONETARY_AMOUNT', re: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:dollars?|USD|EUR|GBP|million|billion)\b/gi },
    { type: 'API_KEY', re: /\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9]{20,}\b/gi },
  ];

  function detectEntities(text: string): Array<{type: string; text: string; start: number; end: number; confidence: number}> {
    const entities: Array<{type: string; text: string; start: number; end: number; confidence: number}> = [];
    for (const p of PATTERNS) {
      const re = new RegExp(p.re.source, p.re.flags);
      let match;
      while ((match = re.exec(text)) !== null) {
        // Skip overlapping matches
        const overlaps = entities.some(e =>
          (match!.index >= e.start && match!.index < e.end) ||
          (match!.index + match![0].length > e.start && match!.index + match![0].length <= e.end)
        );
        if (!overlaps) {
          entities.push({ type: p.type, text: match[0], start: match.index, end: match.index + match[0].length, confidence: 0.9 });
        }
      }
    }
    return entities;
  }

  // ── Realistic Fake Data Pools ──
  const FAKE_NAMES = [
    'James Mitchell', 'Emily Rogers', 'Robert Chen', 'Anna Peterson',
    'David Kumar', 'Lisa Chang', 'William Taylor', 'Maria Santos',
    'Thomas Garcia', 'Rachel Kim', 'Andrew Watson', 'Diana Walsh',
    'Daniel Price', 'Nicole Foster', 'Christopher Lee', 'Amanda Brooks',
  ];
  const FAKE_EMAILS = [
    'j.mitchell@northwind.com', 'e.rogers@contoso.com', 'r.chen@fabrikam.net',
    'a.peterson@adatum.org', 'd.kumar@proseware.io', 'l.chang@northwind.com',
  ];
  const fakeCounters: Record<string, number> = {};
  function pickFake(pool: string[], key: string): string {
    if (!fakeCounters[key]) fakeCounters[key] = 0;
    const idx = fakeCounters[key] % pool.length;
    fakeCounters[key]++;
    return pool[idx];
  }

  function generateRealisticFake(type: string, original: string): string {
    switch (type) {
      case 'PERSON':
        return pickFake(FAKE_NAMES, 'PERSON');
      case 'EMAIL':
        return pickFake(FAKE_EMAILS, 'EMAIL');
      case 'MONETARY_AMOUNT': {
        const cleaned = original.replace(/[,$\s]/g, '');
        const m = cleaned.match(/^(\d+(?:\.\d+)?)\s*(million|billion|M|B|k|K|dollars?|USD|EUR|GBP)?/i);
        if (m && m[1]) {
          const num = parseFloat(m[1]);
          if (isNaN(num)) return original;
          const suffix = m[2] || '';
          const factor = 0.7 + Math.random() * 0.65;
          const shifted = num * factor;
          const hasDec = m[1].includes('.');
          const formatted = hasDec ? shifted.toFixed(m[1].split('.')[1]?.length || 1) : Math.round(shifted).toString();
          const prefix = original.startsWith('$') ? '$' : '';
          return prefix + formatted + suffix;
        }
        return original;
      }
      case 'SSN': {
        const a = Math.floor(100 + Math.random() * 799);
        const b = Math.floor(10 + Math.random() * 89);
        const c = Math.floor(1000 + Math.random() * 8999);
        return original.includes('-') ? a + '-' + b + '-' + c : a + ' ' + b + ' ' + c;
      }
      case 'PHONE_NUMBER': {
        const a = Math.floor(200 + Math.random() * 699);
        const b = Math.floor(200 + Math.random() * 699);
        const c = Math.floor(1000 + Math.random() * 8999);
        return original.includes('(') ? '(' + a + ') ' + b + '-' + c : a + '-' + b + '-' + c;
      }
      case 'CREDIT_CARD':
        return '4' + Array.from({length: 15}, () => Math.floor(Math.random() * 10)).join('');
      case 'IP_ADDRESS':
        return '192.0.2.' + (Math.floor(Math.random() * 254) + 1);
      case 'API_KEY':
        return 'sk-test-' + 'x'.repeat(32);
      default:
        // Randomize digits, preserve structure
        if (/\d/.test(original)) return original.replace(/\d/g, () => String(Math.floor(Math.random() * 10)));
        return original;
    }
  }

  function pseudonymize(text: string, entities: Array<{type: string; text: string; start: number; end: number}>) {
    const sorted = [...entities].sort((a, b) => b.start - a.start);
    const mappings: Array<{original: string; pseudonym: string; type: string}> = [];
    let result = text;
    for (const entity of sorted) {
      // Reuse existing pseudonym for consistency across messages
      let pseudonym = forwardMap[entity.text];
      if (!pseudonym) {
        pseudonym = generateRealisticFake(entity.type, entity.text);
        forwardMap[entity.text] = pseudonym;
        reverseMap[pseudonym] = entity.text;
      }
      result = result.substring(0, entity.start) + pseudonym + result.substring(entity.end);
      if (!mappings.find(m => m.original === entity.text)) {
        mappings.push({ original: entity.text, pseudonym, type: entity.type });
      }
    }
    return { maskedText: result, mappings };
  }

  function extractPrompt(bodyStr: string): string | null {
    try {
      const parsed = JSON.parse(bodyStr);
      // ChatGPT backend: { messages: [{ content: { parts: [...] } }] }
      if (parsed?.messages?.[0]?.content?.parts) {
        const last = parsed.messages[parsed.messages.length - 1];
        if (last?.content?.parts) return last.content.parts.join('\n');
        return parsed.messages[0].content.parts.join('\n');
      }
      // OpenAI / Anthropic: { messages: [{ role, content }] }
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        const msgs = parsed.messages;
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.role === 'user' || m.author === 'user' || m.author?.role === 'user') {
            if (typeof m.content === 'string') return m.content;
            if (typeof m.text === 'string') return m.text;
            if (Array.isArray(m.content)) return m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
          }
        }
      }
      // Other formats
      if (parsed?.message && typeof parsed.message === 'string') return parsed.message;
      if (parsed?.message?.text) return parsed.message.text;
      if (parsed?.message?.content) return parsed.message.content;
      if (typeof parsed?.prompt === 'string') return parsed.prompt;
      if (typeof parsed?.query === 'string') return parsed.query;
      if (typeof parsed?.input === 'string') return parsed.input;
      if (typeof parsed?.content === 'string' && parsed.content.length > 5) return parsed.content;
      if (typeof parsed?.text === 'string' && parsed.text.length > 5) return parsed.text;
      if (typeof parsed?.q === 'string') return parsed.q;
    } catch { /* not JSON */ }
    return null;
  }

  function replacePrompt(bodyStr: string, original: string, replacement: string): string | null {
    try {
      const parsed = JSON.parse(bodyStr);
      // ChatGPT backend
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
      // OpenAI / Anthropic messages
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        for (let i = parsed.messages.length - 1; i >= 0; i--) {
          const m = parsed.messages[i];
          if (m.role === 'user' || m.author === 'user' || m.author?.role === 'user') {
            if (typeof m.content === 'string') { m.content = replacement; return JSON.stringify(parsed); }
            if (typeof m.text === 'string') { m.text = replacement; return JSON.stringify(parsed); }
            if (Array.isArray(m.content)) { const tp = m.content.filter((c: any) => c.type === 'text'); if (tp.length > 0) tp[0].text = replacement; return JSON.stringify(parsed); }
          }
        }
      }
      // Other formats
      if (parsed?.message && typeof parsed.message === 'string') { parsed.message = replacement; return JSON.stringify(parsed); }
      if (parsed?.message?.text) { parsed.message.text = replacement; return JSON.stringify(parsed); }
      if (typeof parsed?.prompt === 'string') { parsed.prompt = replacement; return JSON.stringify(parsed); }
      if (typeof parsed?.query === 'string') { parsed.query = replacement; return JSON.stringify(parsed); }
      if (typeof parsed?.input === 'string') { parsed.input = replacement; return JSON.stringify(parsed); }
      if (typeof parsed?.content === 'string') { parsed.content = replacement; return JSON.stringify(parsed); }
      if (typeof parsed?.text === 'string') { parsed.text = replacement; return JSON.stringify(parsed); }
      // Fallback: raw string replacement
      const escaped = JSON.stringify(original).slice(1, -1);
      const escapedRepl = JSON.stringify(replacement).slice(1, -1);
      if (bodyStr.includes(escaped)) return bodyStr.split(escaped).join(escapedRepl);
    } catch { /* not JSON */ }
    return null;
  }

  function quickScore(entities: Array<{type: string}>): { level: string; score: number } {
    const HIGH = ['SSN', 'CREDIT_CARD', 'API_KEY', 'AWS_CREDENTIAL', 'PRIVATE_KEY'];
    let score = 0;
    for (const e of entities) {
      score += HIGH.includes(e.type) ? 25 : 10;
    }
    const capped = Math.min(score, 100);
    const level = capped >= 86 ? 'critical' : capped >= 61 ? 'high' : capped >= 26 ? 'medium' : 'low';
    return { level, score: capped };
  }

  // ── Patch fetch ──
  const originalFetch = window.fetch;

  const patchedFetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
      return originalFetch.call(window, input, init);
    }

    // Only intercept same-host requests (we only run on AI tool pages)
    try {
      const reqHost = new URL(url, window.location.href).hostname;
      if (reqHost !== window.location.hostname) {
        return originalFetch.call(window, input, init);
      }
    } catch {
      return originalFetch.call(window, input, init);
    }

    // Get body string
    let bodyString: string | null = null;
    if (init?.body && typeof init.body === 'string') {
      bodyString = init.body;
    } else if (input instanceof Request && input.body) {
      try { bodyString = await input.clone().text(); } catch { /* skip */ }
    }

    if (!bodyString) return originalFetch.call(window, input, init);

    const promptText = extractPrompt(bodyString);
    if (!promptText || promptText.length < 10) {
      return originalFetch.call(window, input, init);
    }

    const entities = detectEntities(promptText);
    if (_debug) console.log('[Iron Gate INLINE] Intercepted fetch to', url.substring(0, 60), '— mode:', mode, ', entities:', entities.length);

    if (mode === 'proxy' && entities.length > 0) {
      const { level, score } = quickScore(entities);
      const { maskedText, mappings } = pseudonymize(promptText, entities);
      const modifiedBody = replacePrompt(bodyString, promptText, maskedText);

      if (modifiedBody) {
        if (_debug) console.log('[Iron Gate INLINE] PROXY: Pseudonymized', entities.length, 'entities (', level, ')');

        // SECURITY: hash prompt before postMessage — no raw PII over postMessage
        (async () => {
          const _d = new TextEncoder().encode(promptText);
          const _b = await crypto.subtle.digest('SHA-256', _d);
          const _ph = Array.from(new Uint8Array(_b)).map(b => b.toString(16).padStart(2, '0')).join('');
          igPostMessage({
            type: 'IRON_GATE_INTERCEPTED',
            promptHash: _ph,
            promptLength: promptText.length,
            maskedPrompt: maskedText,
            mappings: mappings.map(m => ({ original: m.original, pseudonym: m.pseudonym, type: m.type, length: m.original.length })),
            entityCount: entities.length,
            level,
            score,
          });
        })();

        const modifiedInit: RequestInit = {
          method: init?.method || (input instanceof Request ? input.method : 'POST'),
          headers: init?.headers || (input instanceof Request ? Object.fromEntries(input.headers.entries()) : {}),
          body: modifiedBody,
          credentials: init?.credentials || (input instanceof Request ? input.credentials : 'same-origin'),
          mode: init?.mode || (input instanceof Request ? input.mode : undefined),
          signal: init?.signal || (input instanceof Request ? input.signal : undefined),
        };

        return originalFetch.call(window, url, modifiedInit);
      }
    }

    if (mode === 'audit' && entities.length > 0) {
      const { level, score } = quickScore(entities);
      const { maskedText, mappings } = pseudonymize(promptText, entities);
      (async () => {
        const _d = new TextEncoder().encode(promptText);
        const _b = await crypto.subtle.digest('SHA-256', _d);
        const _ph = Array.from(new Uint8Array(_b)).map(b => b.toString(16).padStart(2, '0')).join('');
        igPostMessage({
          type: 'IRON_GATE_AUDIT',
          promptHash: _ph,
          promptLength: promptText.length,
          maskedPrompt: maskedText,
          mappings: mappings.map(m => ({ original: m.original, pseudonym: m.pseudonym, type: m.type, length: m.original.length })),
          entityCount: entities.length,
          level,
          score,
        });
      })();
    }

    return originalFetch.call(window, input, init);
  };

  // Install via Object.defineProperty
  try {
    Object.defineProperty(window, 'fetch', {
      value: patchedFetch,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    (window as any).fetch = patchedFetch;
  }

  const ok = window.fetch === patchedFetch;
  (window as any).__IRON_GATE_MAIN_WORLD = ok ? 'active-inline' : 'failed';
  (window as any).__IRON_GATE_FETCH_PATCHED = ok;
  igPostMessage({ type: 'IRON_GATE_HEARTBEAT', version: 'inline-0.1', timestamp: Date.now(), mode });
  if (_debug) console.log('[Iron Gate INLINE]', ok ? 'Inline fetch interceptor ACTIVE' : 'Fetch patch FAILED');
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Only inject into main frame (not iframes)
  if (details.frameId !== 0) return;

  // Method 1: Inject the full main-world.ts via files
  try {
    const manifest = chrome.runtime.getManifest();
    const mainWorldCS = (manifest.content_scripts as any[])?.find(
      (cs: any) => cs.world === 'MAIN'
    );
    const files = mainWorldCS?.js as string[] | undefined;

    if (files && files.length > 0) {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        world: 'MAIN' as any,
        files,
        injectImmediately: true,
      });
      igLog('Programmatic MAIN world injection → tab', details.tabId, `(${details.url?.substring(0, 60)})`);
    }

  } catch (err) {
    console.warn(`[Iron Gate] Programmatic file injection failed:`, err);
  }

  // Method 2: After 1.5s, check if main-world loaded; if not, inject inline fallback
  setTimeout(async () => {
    try {
      const [checkResult] = await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        world: 'MAIN' as any,
        func: () => (window as any).__IRON_GATE_MAIN_WORLD,
      });

      if (checkResult?.result === 'active' || checkResult?.result === 'loading') {
        igLog('MAIN world', checkResult?.result, 'on tab', details.tabId);
        return;
      }

      console.warn(`[Iron Gate] MAIN world NOT active (state: ${checkResult?.result}) — injecting inline fallback`);
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        world: 'MAIN' as any,
        func: inlineFetchInterceptor,
      });
      igLog('Inline fallback injected → tab', details.tabId);
    } catch (err) {
      console.warn(`[Iron Gate] Fallback check/injection failed:`, err);
    }
  }, 1500);
}, { url: AI_TOOL_URL_FILTERS });

// Fallback: tabs.onUpdated catches pages that webNavigation.onCommitted misses
// (e.g., SPA navigations, tabs opened before extension was reloaded).

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !AI_HOST_REGEX.test(tab.url)) return;

  try {
    const [checkResult] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN' as any,
      func: () => (window as any).__IRON_GATE_MAIN_WORLD,
    });

    if (checkResult?.result === 'active') return; // Already injected
    if (checkResult?.result === 'active-inline') return; // Inline fallback active — don't double-inject
    if (checkResult?.result === 'loading') return; // Init in progress — don't double-inject

    igLog('tabs.onUpdated fallback: injecting into tab', tabId, `(state: ${checkResult?.result})`, `(${tab.url?.substring(0, 60)})`);

    const manifest = chrome.runtime.getManifest();
    const mainWorldCS = (manifest.content_scripts as any[])?.find(
      (cs: any) => cs.world === 'MAIN'
    );
    const files = mainWorldCS?.js as string[] | undefined;

    if (files && files.length > 0) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN' as any,
        files,
        injectImmediately: true,
      });
      igLog('tabs.onUpdated: MAIN world injected → tab', tabId);
    }
  } catch (err) {
    // Expected for non-matching tabs or tabs without permission
  }
});

// ─── Tab Lifecycle: clean up per-tab state on close ──────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  igLog('Tab closed:', tabId);
  lastPromptTextByTab.delete(tabId);
  lastBroadcastByTab.delete(tabId);
  lastBroadcastScoreByTab.delete(tabId);
  removeTabState(tabId);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hash of prompt text — we never store or transmit plaintext prompts */
async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
