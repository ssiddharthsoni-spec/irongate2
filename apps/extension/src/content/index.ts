import { detectAITool } from './detectors';
import { createCaptureEngine } from './capture';
import { createSensitivityBadge } from './ui/sensitivity-badge';
import { createCoachingToasts, getNextCoachingTip, type CoachingToastHandle } from './ui/coaching-toast';
import { resolveMode, resolveConfig } from '../managed-config';

// ── Injection Guard ──────────────────────────────────────────────────────────
// When the extension reloads and re-injects, the OLD content script may still
// be partially alive. We use a window marker to detect and clean up old instances.
// After cleanup, the NEW script MUST initialize (even though the old one ran).
const CS_MARKER = '__IRON_GATE_CS_ACTIVE';
let _isReplacement = false;
if ((window as any)[CS_MARKER]) {
  // Tell the old instance to shut down — we're taking over
  window.dispatchEvent(new CustomEvent('iron-gate-cs-replaced'));
  _isReplacement = true;
  console.log('[Iron Gate] Replacing old content script instance');
}
(window as any)[CS_MARKER] = true;

// Debug logging — silent in production, enable via: chrome.storage.local.set({ironGateDebug: true})
let _IG_DEBUG = false;
try { chrome.storage.local.get('ironGateDebug', (r) => { _IG_DEBUG = !!r.ironGateDebug; }); } catch {}
function igLog(...args: any[]) { if (_IG_DEBUG) console.log('[Iron Gate]', ...args); }

/**
 * Iron Gate Content Script
 * Runs on all supported AI tool pages.
 * Detects the active AI tool and starts capturing prompts.
 */

// ── Encrypted Map Persistence Helpers ────────────────────────────────────────
// Uses a session-scoped AES-GCM key (generated once per browser session) to
// encrypt the reverse pseudonym map before storing in chrome.storage.session.
// This ensures PII in the map is encrypted at rest.

const SESSION_KEY_NAME = '__ig_session_key';
let _sessionKey: CryptoKey | null = null;

async function getSessionKey(): Promise<CryptoKey> {
  if (_sessionKey) return _sessionKey;
  // Try to import a previously exported key from session storage
  try {
    const result = await chrome.storage.session.get(SESSION_KEY_NAME);
    if (result[SESSION_KEY_NAME] && typeof result[SESSION_KEY_NAME] === 'string') {
      const raw = Uint8Array.from(atob(result[SESSION_KEY_NAME]), c => c.charCodeAt(0));
      if (raw.length === 0) throw new Error('Empty session key');
      _sessionKey = await crypto.subtle.importKey(
        'raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
      );
      return _sessionKey;
    }
  } catch {}
  // Generate a new key for this browser session
  _sessionKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
  // Export and store so other tabs in this session can use the same key
  try {
    const exported = await crypto.subtle.exportKey('raw', _sessionKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
    await chrome.storage.session.set({ [SESSION_KEY_NAME]: b64 });
  } catch {}
  return _sessionKey;
}

async function encryptAndStore(key: string, map: Record<string, string> | null | undefined): Promise<number> {
  if (!map) return 0;
  const entries = Object.keys(map).length;
  if (entries === 0) {
    await chrome.storage.session.set({ [key]: null });
    return 0;
  }
  const aesKey = await getSessionKey();
  const plaintext = JSON.stringify(map);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 }, aesKey,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(12 + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), 12);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < combined.length; i += chunkSize) {
    binary += String.fromCharCode(...combined.subarray(i, i + chunkSize));
  }
  const b64 = btoa(binary);
  await chrome.storage.session.set({ [key]: b64 });
  return entries;
}

async function loadAndDecrypt(key: string): Promise<Record<string, string> | null> {
  try {
    const result = await chrome.storage.session.get(key);
    const stored = result[key];
    if (!stored || typeof stored !== 'string') return null;
    const aesKey = await getSessionKey();
    const combined = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    if (combined.length < 13) return null;
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 }, aesKey, ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    return null;
  }
}

let detector: ReturnType<typeof detectAITool> = null;
let engine: ReturnType<typeof createCaptureEngine> | null = null;
let badge: ReturnType<typeof createSensitivityBadge> | null = null;
let toasts: CoachingToastHandle | null = null;

// ── Per-Tab Reverse Map Keying ──────────────────────────────────────────────
// Use tab-specific keys for reverse map storage to prevent cross-tab
// contamination when the same hostname is open in multiple tabs.
let _tabMapKey: string | null = null;

async function getTabMapKey(): Promise<string> {
  if (_tabMapKey) return _tabMapKey;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'IRON_GATE_GET_TAB_ID' });
    if (response?.tabId) {
      _tabMapKey = `reverse_map_tab_${response.tabId}`;
      return _tabMapKey;
    }
  } catch { /* context invalidated */ }
  // Fallback: use hostname + random session ID to prevent cross-tab contamination.
  // Each content script instance gets its own unique key even on the same hostname.
  const sessionId = Math.random().toString(36).substring(2, 10);
  _tabMapKey = `reverse_map_${window.location.hostname}_${sessionId}`;
  return _tabMapKey;
}
let contextAlive = true;

// Coaching state — throttle toasts to avoid spam
let lastToastTime = 0;
let sessionInterceptCount = 0;
const TOAST_COOLDOWN = 8000; // Min 8s between toasts

// ── Content-script → MAIN world nonce (reverse direction) ───────────────────
// Prevents malicious page scripts from sending fake IRON_GATE_SET_MODE or
// other control messages to the MAIN world script.
const _IG_CS_NONCE = crypto.randomUUID();

/**
 * Secure postMessage wrapper for content script → MAIN world messages.
 * Auto-includes the content-script nonce so MAIN world can validate the sender.
 */
function csPostMessage(data: Record<string, unknown>): void {
  window.postMessage({ ...data, _csNonce: _IG_CS_NONCE }, window.location.origin);
}

// ── Sync mode with MAIN world script ────────────────────────────────────────
// The MAIN world script patches window.fetch in the page's JS context.
// We tell it the current mode so it knows whether to pseudonymize.

function syncModeToMainWorld(newMode: 'audit' | 'proxy') {
  csPostMessage({ type: 'IRON_GATE_SET_MODE', mode: newMode });
}

function syncProcessingModeToMainWorld(processingMode: 'local' | 'server' | 'shadow') {
  csPostMessage({ type: 'IRON_GATE_SET_PROCESSING_MODE', processingMode });
}

/**
 * Push the Sovereign Mode enterprise policy to the MAIN world fetch proxy.
 * Triggered at startup and whenever chrome.storage.managed changes.
 *
 * The policy includes:
 *   - deploymentMode (local-only / hybrid / server-only)
 *   - killSwitch (org-wide AI tool block)
 *   - allowedAITools (firm's approved tool allowlist, null = all allowed)
 *   - supportContact (shown in block messages)
 *   - firmId (audit correlation)
 *
 * The MAIN world validates the message via the content-script nonce. Page
 * scripts cannot forge this message — they don't know the nonce.
 */
function syncEnterprisePolicyToMainWorld(policy: {
  deploymentMode?: string;
  killSwitch?: boolean;
  allowedAITools?: string[] | null;
  supportContact?: string;
  firmId?: string;
}) {
  csPostMessage({ type: 'IRON_GATE_SET_ENTERPRISE_POLICY', policy });
}

/** Read the full managed policy from chrome.storage.managed and push to main-world */
async function pushManagedPolicyToMainWorld(): Promise<void> {
  try {
    const managed = await chrome.storage.managed.get(null);
    syncEnterprisePolicyToMainWorld({
      deploymentMode: typeof managed.deploymentMode === 'string' ? managed.deploymentMode : undefined,
      killSwitch: typeof managed.killSwitch === 'boolean' ? managed.killSwitch : false,
      allowedAITools: Array.isArray(managed.allowedAITools) ? managed.allowedAITools : null,
      supportContact: typeof managed.supportContact === 'string' ? managed.supportContact : undefined,
      firmId: typeof managed.firmId === 'string' ? managed.firmId : undefined,
    });
  } catch {
    // chrome.storage.managed is unavailable in unmanaged installs (dev mode) —
    // fall back to a permissive default so dev-mode users are not blocked.
    syncEnterprisePolicyToMainWorld({
      deploymentMode: 'server-only',
      killSwitch: false,
      allowedAITools: null,
    });
  }
}

// Send private LLM config to MAIN world for Executive Lens routing
function syncPrivateLlmToMainWorld() {
  try {
    chrome.storage.local.get(['localLLMEndpoint', 'localLLMModel'], (result) => {
      if (!chrome.runtime?.id) return;
      if (result.localLLMEndpoint) {
        csPostMessage({
          type: 'IRON_GATE_SET_PRIVATE_LLM',
          endpoint: result.localLLMEndpoint,
          model: result.localLLMModel || 'llama3.2:3b',
        });
      }
    });
    // Also check managed storage (enterprise policy)
    chrome.storage.managed?.get(['localLLMEndpoint', 'localLLMModel'], (result) => {
      if (!chrome.runtime?.id) return;
      if (chrome.runtime.lastError) return; // managed storage may not exist
      if (result?.localLLMEndpoint) {
        csPostMessage({
          type: 'IRON_GATE_SET_PRIVATE_LLM',
          endpoint: result.localLLMEndpoint,
          model: result.localLLMModel || 'llama3.2:3b',
        });
      }
    });
  } catch {
    // Non-fatal — private LLM routing just won't be available
  }
}

// ── Suppress "Extension context invalidated" noise ──────────────────────────
// Chrome fires this as an uncaught error when callbacks run after a reload.
// Nothing we can do to prevent it — just silence the console spam.
self.addEventListener('error', (event) => {
  if (event.message?.includes('Extension context invalidated')) {
    event.preventDefault();
    contextAlive = false;
  }
});
self.addEventListener('unhandledrejection', (event) => {
  if (String(event.reason).includes('Extension context invalidated')) {
    event.preventDefault();
    contextAlive = false;
  }
});

// Load saved mode on startup (managed storage takes priority over local)
resolveMode().then((savedMode) => {
  if (!contextAlive) return;
  syncModeToMainWorld(savedMode);
  syncPrivateLlmToMainWorld();
  igLog('Initial mode from storage:', savedMode);
}).catch((err) => {
  igLog('Failed to resolve initial mode:', err);
});

// Sync processing mode (local vs server) to MAIN world
resolveConfig().then((config) => {
  if (!contextAlive) return;
  syncProcessingModeToMainWorld(config.processingMode);
  igLog('Initial processing mode:', config.processingMode);
}).catch(() => {});

// Push the enterprise managed policy (killSwitch, allowedAITools, supportContact)
// to MAIN world immediately, and re-push whenever managed storage changes.
// This is the bridge that lets IT's Intune/Jamf/Workspace policy reach the
// fetch proxy that enforces it.
pushManagedPolicyToMainWorld();
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'managed') {
    igLog('Managed storage changed — re-pushing enterprise policy to MAIN world');
    pushManagedPolicyToMainWorld();
  }
});

// Watch for storage changes in both local AND managed areas
chrome.storage.onChanged.addListener((changes, area) => {
  if (!contextAlive) return;
  if (changes.processingMode) {
    resolveConfig().then((config) => {
      syncProcessingModeToMainWorld(config.processingMode);
      igLog('Processing mode changed:', config.processingMode);
    }).catch(() => {});
  }
  if ((area === 'local' && changes.firmMode) || (area === 'managed' && changes.firmMode)) {
    resolveMode().then((newMode) => {
      syncModeToMainWorld(newMode);
      engine?.updateConfig({ mode: newMode });
      igLog('Mode changed via storage:', newMode, '(area:', area, ')');
    }).catch(() => {});
  }
  // Sync private LLM config changes to MAIN world
  if (changes.localLLMEndpoint || changes.localLLMModel) {
    syncPrivateLlmToMainWorld();
  }
});

// ── MAIN world heartbeat monitor + nonce challenge-response ──────────────
// The MAIN world script generates a cryptographic nonce and includes it in
// every postMessage. The content script captures the nonce from the first
// heartbeat and rejects all subsequent IRON_GATE_* messages without it.
// This prevents other page scripts from injecting fake messages.
let mainWorldAlive = false;
let _igMainWorldNonce: string | null = null;

// ── Per-message replay prevention ───────────────────────────────────────────
// Each message from MAIN world carries a unique _mid (crypto.randomUUID()).
// We track seen IDs and reject duplicates to prevent replay attacks.
const _seenMessageIds = new Set<string>();
const _messageIdTimestamps = new Map<string, number>();
const MESSAGE_ID_TTL_MS = 60_000; // Expire after 1 minute

// Purge expired message IDs every 30 seconds
const _messageIdCleanupTimer = setInterval(() => {
  if (!contextAlive) { clearInterval(_messageIdCleanupTimer); return; }
  const now = Date.now();
  for (const [mid, ts] of _messageIdTimestamps) {
    if (now - ts > MESSAGE_ID_TTL_MS) {
      _seenMessageIds.delete(mid);
      _messageIdTimestamps.delete(mid);
    }
  }
}, 30_000);

function isValidMainWorldMessage(data: any): boolean {
  // Heartbeat establishes the nonce — always accept the first one
  if (data?.type === 'IRON_GATE_HEARTBEAT' && !_igMainWorldNonce && data._nonce) {
    _igMainWorldNonce = data._nonce;
    return true;
  }
  // Fail-closed: reject all messages until nonce is established
  if (!_igMainWorldNonce) return false;
  // All IRON_GATE_* messages must include the valid session nonce
  if (data?._nonce !== _igMainWorldNonce) return false;
  // Per-message ID replay prevention
  const mid = data?._mid;
  if (mid) {
    if (_seenMessageIds.has(mid)) {
      igLog('REJECTED replayed message:', data?.type, 'mid:', mid);
      return false;
    }
    _seenMessageIds.add(mid);
    _messageIdTimestamps.set(mid, Date.now());
  }
  return true;
}

function handleHeartbeatMessages(event: MessageEvent) {
  if (event.source !== window) return;
  if (event.data?.type === 'IRON_GATE_HEARTBEAT') {
    if (!isValidMainWorldMessage(event.data)) return;
    mainWorldAlive = true;
    igLog('MAIN world heartbeat received', `v${event.data.version}, mode: ${event.data.mode}`);
  }
  // Health status from MAIN world — relay to service worker for sidepanel
  if (event.data?.type === 'IRON_GATE_HEALTH') {
    if (!isValidMainWorldMessage(event.data)) return;
    try {
      chrome.runtime.sendMessage({
        type: 'PROTECTION_STATUS',
        payload: {
          healthy: event.data.healthy,
          patchStatus: event.data.patchStatus,
          adapter: event.data.adapter,
        },
      }).catch(() => {});
    } catch {
      // Extension context may be invalidated
    }
  }
}
window.addEventListener('message', handleHeartbeatMessages);

// ── MAIN world injection fallback ────────────────────────────────────────────
// The manifest's content_scripts with world:"MAIN" is the primary injection method
// and bypasses CSP. The <script> tag fallback only runs if the manifest injection
// fails (no heartbeat after 500ms). It will fail on sites with strict CSP (ChatGPT,
// Gemini) but that's OK — the manifest injection handles those.

function tryScriptTagInjection(): void {
  try {
    const manifest = chrome.runtime.getManifest();
    const mainWorldCS = (manifest.content_scripts as any[])?.find(
      (cs: any) => cs.world === 'MAIN'
    );
    const scriptFile = mainWorldCS?.js?.[0];
    if (scriptFile) {
      const scriptUrl = chrome.runtime.getURL(scriptFile);
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.onload = () => {
        igLog('Fallback <script> tag injection succeeded');
        script.remove();
        chrome.storage.local.get('firmMode', (result) => {
          const savedMode = result.firmMode === 'audit' ? 'audit' : 'proxy';
          syncModeToMainWorld(savedMode);
        });
      };
      script.onerror = () => {
        // Silent — CSP blocks this on most AI tool sites, which is expected.
        // The manifest injection (which bypasses CSP) should have already worked.
        console.debug('[Iron Gate] <script> tag blocked by CSP (expected on most AI sites)');
        script.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    }
  } catch {
    // Silent failure
  }
}

// Wait 500ms for the manifest's MAIN world injection to send a heartbeat.
// Only try the <script> tag fallback if no heartbeat was received.
setTimeout(() => {
  if (!mainWorldAlive) {
    igLog('No heartbeat after 500ms — trying <script> tag fallback...');
    tryScriptTagInjection();
  } else {
    igLog('MAIN world alive via manifest injection — no fallback needed');
  }
}, 500);

// ── Input validation for MAIN world relay ─────────────────────────────────
// Validates data from postMessage before relaying to the trusted service worker.
const MAX_FILE_BASE64_LEN = 10_000_000; // ~7.5MB decoded
const MAX_STRING_LEN = 200_000;
const VALID_LEVELS = new Set(['critical', 'high', 'medium', 'low']);

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}
function sanitizeString(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.substring(0, maxLen);
}

// Listen for messages from MAIN world (fetch interception results)
function handleMainWorldMessages(event: MessageEvent) {
  if (event.source !== window) return;
  // Validate origin matches current page
  if (event.origin !== window.location.origin) return;
  // Validate cryptographic nonce from MAIN world script
  if (event.data?.type?.startsWith('IRON_GATE_') && !isValidMainWorldMessage(event.data)) {
    igLog('REJECTED message with invalid nonce:', event.data?.type);
    return;
  }

  // ── File Upload Detection from MAIN world ────────────────────────────
  // The main world fetch interceptor detects File objects in FormData bodies
  // and sends them via postMessage. We relay to the service worker for scanning.
  if (event.data?.type === 'IRON_GATE_FILE_UPLOAD') {
    // Reject oversized payloads BEFORE allocating memory for sanitization
    if (event.data.fileBase64 && typeof event.data.fileBase64 === 'string' && event.data.fileBase64.length > MAX_FILE_BASE64_LEN) {
      igLog('File upload rejected — exceeds size limit');
      return;
    }
    const fileName = sanitizeString(event.data.fileName, 500);
    const fileSize = clampNumber(event.data.fileSize, 0, 100_000_000, 0);
    const fileType = sanitizeString(event.data.fileType, 100);
    const fileBase64 = sanitizeString(event.data.fileBase64, MAX_FILE_BASE64_LEN);
    const url = sanitizeString(event.data.url, 500);
    igLog(`File upload from MAIN world: ${fileName} (${fileSize} bytes) → ${url?.substring(0, 80)}`);
    try {
      chrome.runtime.sendMessage(
        {
          type: 'FILE_UPLOAD_DETECTED',
          payload: {
            fileName,
            fileSize,
            fileType,
            fileBase64,
            aiToolId: detector?.id || 'unknown',
            timestamp: Date.now(),
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[Iron Gate] File scan relay error:', chrome.runtime.lastError.message);
            return;
          }
          if (response?.error) {
            console.warn(`[Iron Gate] File scan failed for "${fileName}":`, response.error);
          } else if (response?.score !== undefined) {
            igLog(`File scan complete: "${fileName}" → score=${response.score}, level=${response.level}, entities=${response.entitiesFound}`);
          } else if (response?.metadataOnly) {
            igLog(`File metadata noted (awaiting full content): ${fileName}`);
          } else {
            igLog('File scan response:', response);
          }
        }
      );
    } catch {
      // Extension context may be invalidated
    }
    return;
  }

  // ── File Metadata Detection from MAIN world ──────────────────────────
  // Detects file upload requests with metadata (e.g., ChatGPT's /backend-api/files)
  if (event.data?.type === 'IRON_GATE_FILE_METADATA') {
    const fileName = sanitizeString(event.data.fileName, 500);
    const fileSize = clampNumber(event.data.fileSize, 0, 100_000_000, 0);
    const fileType = sanitizeString(event.data.fileType, 100);
    const url = sanitizeString(event.data.url, 500);
    igLog(`File metadata from MAIN world: ${fileName} (${fileSize} bytes) → ${url?.substring(0, 80)}`);
    // Notify sidepanel via service worker (lightweight — no file content to scan)
    try {
      chrome.runtime.sendMessage({
        type: 'FILE_UPLOAD_DETECTED',
        payload: {
          fileName,
          fileSize,
          fileType,
          fileBase64: '', // No content — metadata only
          aiToolId: detector?.id || 'unknown',
          timestamp: Date.now(),
          metadataOnly: true,
        },
      }).catch(() => {});
    } catch {
      // Extension context may be invalidated
    }
    return;
  }

  // MAIN world is requesting the current mode (it loaded before us)
  if (event.data?.type === 'IRON_GATE_REQUEST_MODE') {
    resolveMode().then((savedMode) => {
      syncModeToMainWorld(savedMode);
      igLog('Responded to MAIN world mode request:', savedMode);
    }).catch(() => {});
    return;
  }

  // ── Server-mode processing relay ──────────────────────────────────────────
  // MAIN world requests server-side detection/pseudonymization via the worker.
  if (event.data?.type === 'IRON_GATE_SERVER_PROCESS_REQUEST') {
    const { requestId, text, aiToolId } = event.data;
    if (!requestId || !text) return;
    try {
      chrome.runtime.sendMessage({
        type: 'SERVER_PROCESS',
        payload: { text, aiToolId, requestId },
      }, (response) => {
        if (!chrome.runtime?.id) return;
        csPostMessage({
          type: 'IRON_GATE_SERVER_PROCESS_RESPONSE',
          requestId,
          result: response?.result || null,
          error: response?.error || (chrome.runtime.lastError?.message) || null,
        });
      });
    } catch {
      csPostMessage({
        type: 'IRON_GATE_SERVER_PROCESS_RESPONSE',
        requestId,
        error: 'Extension context invalidated',
      });
    }
    return;
  }

  // ── Reverse Pseudonym Map Persistence (Encrypted) ────────────────────────
  // MAIN world sends updated reverse map for persistence in chrome.storage.session.
  // Map is encrypted at rest using a session-scoped AES-GCM key to protect PII
  // even if chrome.storage.session is somehow compromised.
  if (event.data?.type === 'IRON_GATE_PERSIST_REVERSE_MAP') {
    const map = event.data.map;
    const seq = typeof event.data._seq === 'number' ? event.data._seq : 0;
    if (map && typeof map === 'object') {
      getTabMapKey().then((tabKey) => {
        // Store _seq alongside the map so we can send it back on restore
        return encryptAndStore(tabKey, map).then((entryCount) => {
          // Persist _seq in a separate unencrypted key (it's just a counter, not PII)
          chrome.storage.session.set({ [`${tabKey}_seq`]: seq }).catch(() => {});
          igLog(`Persisted reverse map (${entryCount} entries, seq=${seq}) to key ${tabKey}`);
        });
      }).catch(() => {});
    }
    return;
  }

  // MAIN world requests persisted reverse map (after page refresh)
  if (event.data?.type === 'IRON_GATE_REQUEST_REVERSE_MAP') {
    getTabMapKey().then(async (tabKey) => {
      const map = await loadAndDecrypt(tabKey);
      if (map && Object.keys(map).length > 0) {
        // Retrieve the stored _seq so main world can validate staleness
        let seq = -1;
        try {
          const seqResult = await chrome.storage.session.get(`${tabKey}_seq`);
          const stored = seqResult[`${tabKey}_seq`];
          if (typeof stored === 'number') seq = stored;
        } catch { /* ignore */ }
        csPostMessage({
          type: 'IRON_GATE_RESTORE_REVERSE_MAP',
          map,
          _seq: seq,
        });
        igLog(`Restored reverse map (${Object.keys(map).length} entries, seq=${seq}) from key ${tabKey}`);
      }
    }).catch(() => {});
    return;
  }

  // Private LLM routing fallback — notify user their content was pseudonymized instead
  if (event.data?.type === 'IRON_GATE_PRIVATE_LLM_FALLBACK') {
    if (toasts) {
      toasts.show({
        title: 'Private LLM Not Configured',
        message: 'This content was flagged for private LLM routing but no endpoint is configured. Data was pseudonymized before sending to the cloud AI.',
        type: 'warning',
      });
    }
    return;
  }

  // Clean submit — 0 entities detected, clear stale sidepanel results
  if (event.data?.type === 'IRON_GATE_CLEAN_SUBMIT') {
    chrome.runtime.sendMessage({
      type: 'PROMPT_CLEAN_SUBMIT',
      payload: {
        score: event.data.score || 0,
        level: event.data.level || 'low',
        promptLength: event.data.promptLength || 0,
      },
    }).catch(() => {});
    return;
  }

  // Low-risk passthrough — entities detected but context deemed benign
  if (event.data?.type === 'IRON_GATE_LOW_RISK_PASSTHROUGH') {
    const count = event.data.entityCount || 0;
    const types = (event.data.entityTypes || []).join(', ');
    if (toasts && count > 0) {
      toasts.show({
        title: 'Low Risk — Sent Unmodified',
        message: `${count} data point${count > 1 ? 's' : ''} detected (${types}) but context appears benign. Review if this message contains sensitive data.`,
        type: 'tip',
      });
    }
    return;
  }

  // De-pseudonymization failure — show warning toast
  if (event.data?.type === 'IRON_GATE_DEPSEUDO_FAILURE') {
    if (toasts) {
      toasts.show({
        title: 'De-pseudonymization Warning',
        message: event.data.detail || 'Some pseudonymized names may appear in the AI response.',
        type: 'warning',
      });
    }
    return;
  }

  // B1: Audit log relay — MAIN world → worker audit buffer
  // Main-world posts IRON_GATE_RECORD_AUDIT with classification metadata
  // (counts and types only, NO raw PII). Content script relays to the worker
  // which batches via the configured audit sink.
  if (event.data?.type === 'IRON_GATE_RECORD_AUDIT' && event.data?.payload) {
    try {
      // Defense-in-depth: reject any field that smells like raw prompt text.
      // The audit buffer also runs its own PII check, but catching it here
      // prevents the message from ever reaching chrome.runtime.
      const p = event.data.payload;
      const forbiddenFields = ['promptText', 'originalText', 'maskedText', 'entityText', 'rawPrompt'];
      for (const field of forbiddenFields) {
        if (field in p) {
          console.warn(`[Iron Gate] REJECTED audit entry with forbidden field "${field}"`);
          return;
        }
      }
      chrome.runtime.sendMessage({ type: 'IRON_GATE_RECORD_AUDIT', payload: p }).catch(() => {});
    } catch { /* worker may be asleep */ }
    return;
  }

  // Shared validation for INTERCEPTED/AUDIT
  if (event.data?.type === 'IRON_GATE_INTERCEPTED' || event.data?.type === 'IRON_GATE_AUDIT') {
    const isProxy = event.data.type === 'IRON_GATE_INTERCEPTED';
    const promptHash = sanitizeString(event.data.promptHash, 128);
    const promptLength = clampNumber(event.data.promptLength, 0, 10_000_000, 0);
    // originalPrompt is no longer sent via postMessage (security: prevents page-script
    // interception). The sidepanel uses maskedPrompt for display instead.
    const originalPrompt = '';
    const maskedPrompt = sanitizeString(event.data.maskedPrompt, MAX_STRING_LEN);
    const entityCount = clampNumber(event.data.entityCount, 0, 10000, 0);
    const rawLevel = sanitizeString(event.data.level, 20);
    const level = VALID_LEVELS.has(rawLevel) ? rawLevel : 'low';
    const score = clampNumber(event.data.score, 0, 100, 15);
    const entities = Array.isArray(event.data.entities) ? event.data.entities.slice(0, 1000) : [];
    const mappings = Array.isArray(event.data.mappings) ? event.data.mappings.slice(0, 1000) : [];

    igLog(`CS MAIN world ${isProxy ? 'INTERCEPTED' : 'AUDIT'} — ${entityCount} entities (${level}, score=${score}), entities array length: ${entities.length}, mappings: ${mappings.length}`);

    const relayPayload = {
      score: score ?? (level === 'critical' ? 95 : level === 'high' ? 75 : level === 'medium' ? 45 : 15),
      level,
      explanation: isProxy
        ? `Pseudonymized ${entityCount} entities before sending to AI tool.`
        : entityCount === 0
          ? 'No sensitive data detected in your prompt.'
          : `Detected ${entityCount} sensitive data points in your prompt.`,
      entities,
      aiToolId: detector?.id || 'unknown',
      promptHash,
      promptLength,
      originalPrompt,
      maskedPrompt,
      pseudonymMappings: mappings,
      isProxy, // true = pseudonymized (INTERCEPTED), false = audit only
      wireIntercept: event.data.wireIntercept === true, // authoritative wire-level result — sidepanel must not suppress
    };

    // M-9 fix: Atomic check-and-relay — capture runtime ref and send in the same
    // synchronous block to eliminate TOCTOU race where context invalidates between
    // the liveness check and the sendMessage call.
    try {
      const rt = chrome.runtime;
      if (!rt?.id) throw new Error('Extension context invalidated');
      // Send IMMEDIATELY in the same synchronous tick as the liveness check
      rt.sendMessage({
        type: 'SENSITIVITY_SCORE',
        payload: relayPayload,
      }).then(() => {
        igLog('SENSITIVITY_SCORE relayed successfully');
      }).catch((err: unknown) => {
        console.warn('[Iron Gate] runtime.sendMessage failed — using storage backup:', err);
        // BACKUP: Write to chrome.storage.local so sidepanel can pick it up.
        // BUT: 0-entity non-authoritative results must NEVER be persisted to storage.
        // Storage is a bypass channel — the sidepanel's storage poll and onChanged
        // listener would deliver stale 0-entity results that overwrite real detections.
        // Only authoritative results (proxy, wireIntercept, or has entities) are worth persisting.
        if (relayPayload.isProxy || relayPayload.wireIntercept || (relayPayload.entities && relayPayload.entities.length > 0)) {
          try {
            chrome.storage.local.set({
              lastDetectionResult: { ...relayPayload, _storageTimestamp: Date.now() },
            }).catch(() => {});
          } catch { /* storage failed too */ }
        }
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Extension context invalidated') || errMsg.includes('invalidated')) {
        console.error(
          '%c[Iron Gate] Extension was updated — please refresh this page to restore protection.',
          'color: #ef4444; font-weight: bold; font-size: 14px',
        );
        contextAlive = false;
        try {
          const existing = document.getElementById('iron-gate-refresh-banner');
          if (!existing) {
            const banner = document.createElement('div');
            banner.id = 'iron-gate-refresh-banner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#ef4444;color:white;padding:10px 20px;font-family:system-ui;font-size:14px;text-align:center;cursor:pointer;';
            banner.textContent = '\u26a0\ufe0f Iron Gate was updated. Click here or refresh this page to restore protection.';
            banner.onclick = () => window.location.reload();
            document.body.appendChild(banner);
          }
        } catch { /* DOM manipulation may fail */ }
        return;
      }
      console.warn('[Iron Gate] runtime.sendMessage threw:', err);
    }

    // ALWAYS write storage backup for authoritative results — belt and suspenders.
    // The sidepanel has a storage.onChanged listener that processes this.
    // Wire intercept AUDITs (clean prompts in proxy mode) also need storage backup
    // because chrome.runtime.sendMessage is unreliable in MV3 — without this,
    // "All Clear" results have ZERO storage backup and get silently lost.
    if (isProxy || relayPayload.wireIntercept) {
      try {
        const _ts = Date.now();
        chrome.storage.local.set({
          lastDetectionResult: { ...relayPayload, _storageTimestamp: _ts },
        }).then(() => {
          igLog('CS Storage backup written successfully, ts:', _ts, 'isProxy:', relayPayload.isProxy, 'entities:', relayPayload.entities?.length);
        }).catch((err: unknown) => {
          console.warn('[Iron Gate CS] Storage backup FAILED:', err);
        });
      } catch {
        igLog('Storage backup write failed');
      }
    }

    showCoachingFeedback(isProxy ? 'proxy' : 'audit', entityCount, level, score);
  }
}
window.addEventListener('message', handleMainWorldMessages);

// Register message listener IMMEDIATELY so sidepanel can always reach us
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!contextAlive) return;
  try {
    switch (message.type) {
      case 'GET_STATUS':
        sendResponse({
          active: !!detector,
          aiTool: detector?.id || null,
          aiToolName: detector?.name || null,
        });
        break;
      case 'CONFIG_UPDATE':
        engine?.updateConfig(message.payload);
        sendResponse({ ok: true });
        break;
      case 'SENSITIVITY_SCORE':
        // Badge disabled — score updates are no-ops
        sendResponse({ ok: true });
        break;
      case 'MODE_CHANGED':
        engine?.updateConfig({ mode: message.payload.mode });
        syncModeToMainWorld(message.payload.mode);
        igLog('Mode switched to:', message.payload.mode);
        sendResponse({ ok: true });
        break;
      case 'IRON_GATE_APPLY_POLICY_BUNDLE':
        // B3: Forward signed bundle rules from worker to main-world.
        // The worker has already verified the Ed25519 signature — we can trust
        // the payload. Main-world applies the rules to its detection pipeline.
        csPostMessage({
          type: 'IRON_GATE_APPLY_POLICY_BUNDLE',
          payload: message.payload,
        });
        igLog('Policy bundle rules forwarded to main-world');
        sendResponse({ ok: true });
        break;
      case 'PROCESSING_MODE_CHANGED':
        if (message.payload?.processingMode) {
          syncProcessingModeToMainWorld(message.payload.processingMode);
          igLog('Processing mode changed to:', message.payload.processingMode);
        }
        sendResponse({ ok: true });
        break;
      case 'FILE_SCAN_RESULT': {
        const p = message.payload;
        if (p && toasts) {
          const lvl = p.level;
          if (lvl === 'critical' || lvl === 'high') {
            toasts.show({
              type: 'warning',
              title: `${lvl === 'critical' ? 'Critical' : 'High'} Risk Document`,
              message: `"${p.fileName}" contains ${p.entitiesFound} sensitive ${p.entitiesFound === 1 ? 'entity' : 'entities'} (score: ${p.score}). This file may expose confidential data to the AI.`,
              duration: 8000,
            });
          } else if (lvl === 'medium') {
            toasts.show({
              type: 'warning',
              title: 'Sensitive Document Detected',
              message: `"${p.fileName}" contains ${p.entitiesFound} sensitive ${p.entitiesFound === 1 ? 'entity' : 'entities'}. Review the Document Inspector in the side panel.`,
              duration: 5000,
            });
          } else if (lvl === 'error') {
            toasts.show({
              type: 'warning',
              title: 'Document Scan Failed',
              message: p.explanation || `Could not scan "${p.fileName}".`,
              duration: 5000,
            });
          } else if (lvl === 'low' && p.entitiesFound > 0) {
            toasts.show({
              type: 'shield',
              title: 'Document Scanned',
              message: `"${p.fileName}" — ${p.entitiesFound} ${p.entitiesFound === 1 ? 'entity' : 'entities'} found, low risk.`,
              duration: 3500,
            });
          }
        }
        // Relay scan result to MAIN world so fetch/DOM interceptors can gate on it
        if (p) {
          csPostMessage({
            type: 'IRON_GATE_FILE_SCAN_RESULT',
            payload: p,
          });
        }
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  } catch (err) {
    console.warn('[Iron Gate] Message handler error:', err);
    try { sendResponse({ ok: false, error: String(err) }); } catch {}
  }
  return true;
});

// ── Coaching feedback logic ──────────────────────────────────────────────────

function showCoachingFeedback(mode: 'proxy' | 'audit', entityCount: number, level: string, score: number) {
  if (!toasts) return;
  const now = Date.now();
  if (now - lastToastTime < TOAST_COOLDOWN) return;
  lastToastTime = now;
  sessionInterceptCount++;

  if (mode === 'proxy') {
    // Positive feedback: entities were protected
    toasts.show({
      type: 'shield',
      title: 'Protected',
      message: `${entityCount} sensitive ${entityCount === 1 ? 'entity' : 'entities'} pseudonymized before reaching the AI.`,
      duration: 3500,
    });

    // Every 5th interception, show a coaching tip
    if (sessionInterceptCount % 5 === 0) {
      setTimeout(() => {
        toasts?.show({
          type: 'tip',
          title: 'Security Tip',
          message: getNextCoachingTip(),
          duration: 6000,
        });
      }, 4000);
    }
  } else {
    // Audit mode: severity-based feedback
    if (level === 'critical' || level === 'high') {
      toasts.show({
        type: 'warning',
        title: level === 'critical' ? 'Critical Risk Detected' : 'High Risk Detected',
        message: `${entityCount} sensitive ${entityCount === 1 ? 'entity' : 'entities'} found (score: ${score}). Consider enabling proxy mode for automatic protection.`,
        duration: 5000,
      });
    } else if (sessionInterceptCount <= 2) {
      // Only show for first couple of interactions to avoid noise
      toasts.show({
        type: 'shield',
        title: 'Monitoring Active',
        message: `${entityCount} ${entityCount === 1 ? 'entity' : 'entities'} detected. Iron Gate is watching for sensitive data.`,
        duration: 3000,
      });
    }
  }
}

// Initialize detection (may run before DOM is ready, that's OK)
function initialize() {
  try {
    const currentUrl = window.location.href;
    detector = detectAITool(currentUrl);

    if (detector) {
      igLog('Detected AI tool:', detector.name, 'on', currentUrl);

      engine = createCaptureEngine(detector);
      engine.start();

      // ── Fallback real-time polling ──────────────────────────────────────
      // Direct text polling that bypasses the capture engine's DOM observer.
      // Ensures real-time detection works even if MutationObserver has issues.
      let _fbLastText = '';
      const _fbDetector = detector; // capture reference
      const _fbPollTimer = setInterval(() => {
        if (!contextAlive || !_fbDetector) { clearInterval(_fbPollTimer); return; }
        try {
          const input = _fbDetector.getPromptInput();
          if (!input) return;
          const text = _fbDetector.extractPromptText(input);
          if (text && text.length > 5 && text !== _fbLastText) {
            _fbLastText = text;
            igLog(`RT Captured ${text.length} chars from ${_fbDetector.id} — sending PROMPT_DETECTED`);
            try {
              chrome.runtime.sendMessage({
                type: 'PROMPT_DETECTED',
                payload: {
                  text,
                  aiToolId: _fbDetector.id,
                  captureMethod: 'dom-fallback',
                },
              }).catch(() => {});
            } catch {
              // Extension context invalidated
            }
          } else if (!text || text.length === 0) {
            if (_fbLastText.length > 0) {
              _fbLastText = '';
              chrome.runtime.sendMessage({
                type: 'PROMPT_CLEARED',
                payload: { aiToolId: _fbDetector.id },
              }).catch(() => {});
            }
          }
        } catch (err) {
          console.warn('[Iron Gate RT] poll error:', err);
        }
      }, 1500);

      // Badge disabled — the floating "Protected" chip is distracting on AI tool pages
      // badge = createSensitivityBadge();
      // badge.showStandby();
      toasts = createCoachingToasts();

      // Welcome toast on first load (only once per session)
      try {
        chrome.storage.session.get('welcomeShown', (result) => {
          if (!chrome.runtime?.id) return;
          if (chrome.runtime.lastError) return; // Storage not accessible
          if (!result?.welcomeShown && toasts) {
            toasts.show({
              type: 'shield',
              title: `Iron Gate Active`,
              message: `Monitoring ${detector?.name ?? 'unknown'} for sensitive data. Your prompts are being scanned in real time.`,
              duration: 4000,
            });
            chrome.storage.session.set({ welcomeShown: true }).catch(() => {});
          }
        });
      } catch {
        // chrome.storage.session may not be available in all contexts
      }
      // ── Voice mode detection ──────────────────────────────────────────
      // Watch for voice input activation on supported platforms.
      // Voice transcription happens in-app — Iron Gate cannot intercept it.
      let voiceWarningShown = false;
      const voiceSelectors = [
        'button[aria-label*="voice" i]',
        'button[aria-label*="microphone" i]',
        'button[aria-label*="dictate" i]',
        'button[data-testid*="voice" i]',
        '[class*="voice-input" i]',
        '[class*="microphone" i]',
      ].join(',');

      const voiceObserver = new MutationObserver(() => {
        if (voiceWarningShown || !toasts) return;
        const voiceActive = document.querySelector(
          '[aria-label*="stop" i][aria-label*="voice" i], ' +
          '[aria-label*="stop" i][aria-label*="listen" i], ' +
          '[class*="voice-active" i], [class*="recording" i]'
        );
        if (voiceActive) {
          voiceWarningShown = true;
          toasts.show({
            type: 'warning',
            title: 'Voice Input Detected',
            message: 'Voice transcription bypasses Iron Gate protection. Avoid dictating sensitive data.',
            duration: 8000,
          });
          // Reset after 60s so it can warn again in a new voice session
          setTimeout(() => { voiceWarningShown = false; }, 60_000);
        }
      });
      voiceObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-label'] });

    } else {
      igLog('No AI tool detected on:', currentUrl);
    }
  } catch (err) {
    console.error('[Iron Gate] Initialization error:', err);
  }
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// ── Extension Context Liveness Check ─────────────────────────────────────────
// Detect when the extension has been reloaded and our chrome.runtime is dead.
// The service worker's reinjectAllTabs() will replace us with a fresh instance.

function checkExtensionContext(): void {
  if (!contextAlive) return;
  try {
    if (!chrome.runtime?.id) {
      contextAlive = false;
      igLog('Extension context invalidated — orphaned content script');
      engine?.stop();
      csPostMessage({ type: 'IRON_GATE_CONTEXT_INVALIDATED' });
      if (toasts) {
        toasts.show({
          type: 'warning',
          title: 'Iron Gate Reloaded',
          message: 'Extension was updated. Protection will resume automatically.',
          duration: 6000,
        });
      }
      clearInterval(contextCheckInterval);
    }
  } catch {
    contextAlive = false;
    clearInterval(contextCheckInterval);
  }
}

const contextCheckInterval = setInterval(checkExtensionContext, 5000);

// ── Cleanup on Replacement ──────────────────────────────────────────────────
// When a new content script is injected (e.g., after extension reload),
// it dispatches 'iron-gate-cs-replaced' to tell us to shut down.
window.addEventListener('iron-gate-cs-replaced', () => {
  igLog('Content script being replaced by new instance');
  contextAlive = false;
  engine?.stop();
  clearInterval(contextCheckInterval);
  // Clean up all message listeners to prevent orphaned handlers
  window.removeEventListener('message', handleHeartbeatMessages);
  window.removeEventListener('message', handleMainWorldMessages);
}, { once: true });
