/**
 * Iron Gate Service Worker
 * Handles background tasks: event queuing, API communication, model management.
 */

import { analyzePrompt, sendProxiedPrompt, handleProxyFlow, analyzeFile } from './proxy-handler';
import { eventQueue } from './queue';
import { apiRequest, configureApiClient } from './api-client';
import { initAuth, getFirmId, getUserId, getToken } from './auth';
import { detectWithRegex } from '../detection/fallback-regex';
import { computeScore } from '../detection/scorer';
import { pseudonymizeLocal } from '../detection/pseudonymizer';
import { scanForSecrets } from './detectors/secret-scanner';
import { resolveConfig, onManagedConfigChanged } from '../managed-config';
import { saveApiKey, loadApiKey } from '../api-key-store';
import { recordAttestation, getAuditLog, clearAuditLog } from './audit-trail';

// Debug logging — silent in production, enable via: chrome.storage.local.get('ironGateDebug')
let _IG_DEBUG = false;
try { chrome.storage.local.get('ironGateDebug', (r) => { _IG_DEBUG = !!r.ironGateDebug; }); } catch {}
function igLog(...args: any[]) { if (_IG_DEBUG) console.log('[Iron Gate]', ...args); }

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
}).catch((err) => console.warn('[Iron Gate] Startup init failed:', err));

// Open side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Firm mode tracking — defaults to 'proxy' (Protect mode)
let firmMode: 'audit' | 'proxy' = 'proxy';
let isManaged = false;

// Load config with managed-first priority
resolveConfig().then((config) => {
  firmMode = config.firmMode;
  isManaged = config.isManaged;
  if (config.isManaged) {
    configureApiClient({ apiKey: config.apiKey, baseUrl: config.apiUrl });
    igLog('Enterprise managed mode active. Mode:', firmMode);
  } else {
    igLog('Individual mode. Loaded firm mode:', firmMode);
  }
}).catch((err) => {
  console.warn('[Iron Gate] Failed to resolve managed config:', err);
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
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async
});

async function handleMessage(
  message: any,
  sender: chrome.runtime.MessageSender
): Promise<any> {
  switch (message.type) {
    case 'PROMPT_DETECTED': {
      const { text, aiToolId, captureMethod } = message.payload;
      igLog('Prompt captured from', aiToolId, 'via', captureMethod, 'length:', text.length);

      // ── Local detection: regex PII + secret scanning ──
      const regexEntities = detectWithRegex(text);
      const secrets = scanForSecrets(text);

      // Merge secret hits into the entity list so the scorer sees them
      const allEntities = [
        ...regexEntities,
        ...secrets.map((s) => ({
          type: s.type,
          text: s.text,
          start: s.start,
          end: s.end,
          confidence: s.confidence,
          source: s.source as 'regex',
        })),
      ];

      const sensitivityResult = computeScore(text, allEntities);

      // Generate pseudonymized version for transparency view
      const pseudoResult = pseudonymizeLocal(text, allEntities);

      // Queue event for API with CORRECT schema
      const promptHash = await hashText(text);
      const action = firmMode === 'proxy' ? 'proxy' : (sensitivityResult.level === 'critical' ? 'block' : 'pass');
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

      // ── DO NOT broadcast to badge or side panel from PROMPT_DETECTED ──
      // The MAIN world fetch interceptor (IRON_GATE_INTERCEPTED / IRON_GATE_AUDIT)
      // is the AUTHORITATIVE source for UI updates. It sees the complete API request
      // body and detects ALL entities accurately.
      //
      // PROMPT_DETECTED comes from the capture engine's DOM observer which fires
      // on every keystroke and may detect only a SUBSET of entities (partial typing),
      // producing a lower score that overwrites the real score on the badge.
      // Example: MAIN world detects 5 entities → score 65, but DOM observer later
      // fires with partial text → 2 entities → score 25, badge drops to 25.
      //
      // PROMPT_DETECTED is still valuable for API analytics (queued above).
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
        sensitivityLevel: sensitivityScore >= 86 ? 'critical' : sensitivityScore >= 61 ? 'high' : sensitivityScore >= 26 ? 'medium' : 'low',
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
      const { fileName, fileBase64, fileType, aiToolId } = message.payload;
      igLog('File upload detected:', fileName, 'on', aiToolId);

      try {
        const result = await analyzeFile(fileName, fileBase64, fileType);

        // Broadcast scan result to sidepanel and all tabs
        chrome.runtime.sendMessage({
          type: 'FILE_SCAN_RESULT',
          payload: { ...result, aiToolId },
        }).catch(() => {});

        return result;
      } catch (error) {
        console.warn('[Iron Gate] File analysis error:', error);
        return { error: 'File analysis failed' };
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

      try {
        await apiRequest({
          method: 'POST',
          path: '/feedback',
          body: {
            entityType,
            entityText,
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
    metadata: event.metadata || {},
  }).catch((err) => console.warn('[Iron Gate] Failed to queue event:', err));
}

// Periodic alarm for flushing event queue
chrome.alarms.create('flush-events', { periodInMinutes: 1 });

// Periodic alarm for policy sync (every 15 minutes)
chrome.alarms.create('sync-policies', { periodInMinutes: 15 });

// Periodic alarm for heartbeat (every 5 minutes)
chrome.alarms.create('heartbeat', { periodInMinutes: 5 });

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
  }
  if (alarm.name === 'heartbeat') {
    igLog('Sending heartbeat');
    sendHeartbeat().catch((err) =>
      console.warn('[Iron Gate] Heartbeat failed:', err)
    );
  }
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

  // Skip if full main-world.ts already loaded
  if ((window as any).__IRON_GATE_MAIN_WORLD === 'active') {
    if (_debug) console.log('[Iron Gate INLINE] Full main-world.ts already active — skipping inline fallback');
    return;
  }

  if (_debug) console.log('[Iron Gate INLINE] 🔧 Installing inline fetch interceptor (fallback)...');

  let mode: 'audit' | 'proxy' = 'proxy';

  // Listen for mode changes
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    if (e.data?.type === 'IRON_GATE_SET_MODE') {
      mode = e.data.mode;
      if (_debug) console.log('[Iron Gate INLINE] Mode set to:', mode);
    }
  });
  window.postMessage({ type: 'IRON_GATE_REQUEST_MODE' }, window.location.origin);

  // ── Entity Detection Patterns ──
  const PATTERNS: Array<{ type: string; re: RegExp }> = [
    { type: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
    { type: 'EMAIL', re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
    { type: 'PHONE_NUMBER', re: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
    { type: 'CREDIT_CARD', re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
    { type: 'IP_ADDRESS', re: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
    { type: 'DATE_OF_BIRTH', re: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
    { type: 'PERSON', re: /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g },
    { type: 'MONETARY_AMOUNT', re: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g },
    { type: 'API_KEY', re: /\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9]{20,}\b/gi },
  ];

  function detectEntities(text: string): Array<{type: string; text: string; start: number; end: number; confidence: number}> {
    const entities: Array<{type: string; text: string; start: number; end: number; confidence: number}> = [];
    for (const p of PATTERNS) {
      const re = new RegExp(p.re.source, p.re.flags);
      let match;
      while ((match = re.exec(text)) !== null) {
        entities.push({ type: p.type, text: match[0], start: match.index, end: match.index + match[0].length, confidence: 0.9 });
      }
    }
    return entities;
  }

  let pseudonymCounter = 1;
  function pseudonymize(text: string, entities: Array<{type: string; text: string; start: number; end: number}>) {
    const sorted = [...entities].sort((a, b) => b.start - a.start);
    const mappings: Array<{original: string; pseudonym: string; type: string}> = [];
    let result = text;
    const seen = new Map<string, string>();
    for (const entity of sorted) {
      let pseudonym = seen.get(entity.text);
      if (!pseudonym) {
        pseudonym = '[' + entity.type + '-' + String(pseudonymCounter++).padStart(4, '0') + ']';
        seen.set(entity.text, pseudonym);
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
        return last.content.parts.join('\n');
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
        parsed.messages[lastIdx].content.parts = [replacement];
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

  function quickScore(entities: Array<{type: string}>): string {
    const HIGH = ['SSN', 'CREDIT_CARD', 'API_KEY', 'AWS_CREDENTIAL', 'PRIVATE_KEY'];
    let score = 0;
    for (const e of entities) {
      score += HIGH.includes(e.type) ? 25 : 10;
    }
    if (score >= 86) return 'critical';
    if (score >= 61) return 'high';
    if (score >= 26) return 'medium';
    return 'low';
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
      const level = quickScore(entities);
      const { maskedText, mappings } = pseudonymize(promptText, entities);
      const modifiedBody = replacePrompt(bodyString, promptText, maskedText);

      if (modifiedBody) {
        if (_debug) console.log('[Iron Gate INLINE] ✅ PROXY: Pseudonymized', entities.length, 'entities (', level, ')');
        if (_debug) console.log('[Iron Gate INLINE] Original:', promptText.length, 'chars');
        if (_debug) console.log('[Iron Gate INLINE] Masked:', maskedText.length, 'chars');

        // SECURITY: hash prompt before postMessage — no raw PII over postMessage
        (async () => {
          const _d = new TextEncoder().encode(promptText);
          const _b = await crypto.subtle.digest('SHA-256', _d);
          const _ph = Array.from(new Uint8Array(_b)).map(b => b.toString(16).padStart(2, '0')).join('');
          window.postMessage({
            type: 'IRON_GATE_INTERCEPTED',
            promptHash: _ph,
            promptLength: promptText.length,
            maskedPrompt: maskedText,
            mappings,
            entityCount: entities.length,
            level,
          }, window.location.origin);
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
      const level = quickScore(entities);
      const { maskedText, mappings } = pseudonymize(promptText, entities);
      (async () => {
        const _d = new TextEncoder().encode(promptText);
        const _b = await crypto.subtle.digest('SHA-256', _d);
        const _ph = Array.from(new Uint8Array(_b)).map(b => b.toString(16).padStart(2, '0')).join('');
        window.postMessage({
          type: 'IRON_GATE_AUDIT',
          promptHash: _ph,
          promptLength: promptText.length,
          maskedPrompt: maskedText,
          mappings,
          entityCount: entities.length,
          level,
        }, window.location.origin);
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
  window.postMessage({ type: 'IRON_GATE_HEARTBEAT', version: 'inline-0.1', timestamp: Date.now(), mode }, '*');
  if (_debug) console.log('[Iron Gate INLINE]', ok ? '✅ Inline fetch interceptor ACTIVE' : '❌ Fetch patch FAILED');
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
