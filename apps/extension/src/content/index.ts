import { detectAITool } from './detectors';
import { createCaptureEngine } from './capture';
import { createSensitivityBadge } from './ui/sensitivity-badge';
import { createEntityTooltips, type EntityTooltipHandle } from './ui/entity-tooltip';
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
try { chrome.storage.local.get('ironGateDebug', (r) => { _IG_DEBUG = Boolean(r?.ironGateDebug); }); } catch {}
function igLog(...args: any[]) { if (_IG_DEBUG) console.log('[Iron Gate CS]', ...args); }

/**
 * Iron Gate Content Script
 * Runs on all supported AI tool pages.
 * Detects the active AI tool and starts capturing prompts.
 */

// Reverse-map persistence moved to the WORKER (June 2026): content scripts
// cannot access chrome.storage.session (TRUSTED_CONTEXTS only) — the old
// in-place AES helpers here silently failed on every persist and restore.
// See worker/index.ts PERSIST_REVERSE_MAP / REQUEST_REVERSE_MAP.

let detector: ReturnType<typeof detectAITool> = null;
let engine: ReturnType<typeof createCaptureEngine> | null = null;
let badge: ReturnType<typeof createSensitivityBadge> | null = null;
let tooltips: EntityTooltipHandle | null = null;
let toasts: CoachingToastHandle | null = null;

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
          model: result.localLLMModel || 'gemma3:4b',
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
          model: result.localLLMModel || 'gemma3:4b',
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
let _igSecureChannel: BroadcastChannel | null = null;

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
  if (!data?._nonce || typeof data._nonce !== 'string') return false;

  // Capture nonce from the FIRST message that carries one — not just heartbeats.
  // The old code only accepted nonces from IRON_GATE_HEARTBEAT. If the content
  // script loaded after the first heartbeat, the nonce was never captured and
  // ALL subsequent messages (including IRON_GATE_INTERCEPTED with proxy data)
  // were silently rejected. This was the root cause of "maskedPrompt: EMPTY"
  // and "inspector: NULL" in the sidepanel.
  if (!_igMainWorldNonce) {
    _igMainWorldNonce = data._nonce;
    igLog('Nonce established from', data.type);
    // Open BroadcastChannel for secure data from main-world.
    // Channel name includes nonce — page scripts can't guess it.
    if (!_igSecureChannel) {
      _igSecureChannel = new BroadcastChannel(`ig_${data._nonce}`);
      _igSecureChannel.onmessage = (evt) => {
        if (!chrome.runtime?.id) return;
        handleSecureChannelMessage(evt.data);
      };
      igLog('Secure BroadcastChannel established');
    }
  }

  // Validate nonce matches
  if (data._nonce !== _igMainWorldNonce) {
    // Nonce changed — main-world was reloaded (extension update, navigation).
    // Accept the new nonce and update.
    _igMainWorldNonce = data._nonce;
    _seenMessageIds.clear();
    _messageIdTimestamps.clear();
    igLog('Nonce rotated from', data.type);
  }

  // Per-message ID replay prevention
  const mid = data?._mid;
  if (mid) {
    if (_seenMessageIds.has(mid)) {
      return false;
    }
    _seenMessageIds.add(mid);
    _messageIdTimestamps.set(mid, Date.now());
  }
  return true;
}

function handleHeartbeatMessages(event: MessageEvent) {
  if (event.source !== window) return;
  if (event.data?._csNonce) return; // skip our own outbound messages
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

// Wait for the manifest's MAIN world injection to send a heartbeat.
// Only try the <script> tag fallback if no heartbeat was received.
//
// IMPORTANT: check BOTH the heartbeat flag AND the window property that
// main-world.ts sets at load time (line 469: __IRON_GATE_MAIN_WORLD =
// 'active'). The heartbeat message can be delayed by page load, but the
// window property is set synchronously during script execution. If the
// property is set, the script IS running — don't launch a second copy.
//
// Launching two MAIN world instances was the root cause of the nonce
// conflict: each instance has its own _IG_MSG_NONCE and _IG_CS_NONCE
// capture, and they fought over incoming messages. One would capture the
// content script's nonce, the other would reject it.
setTimeout(() => {
  // Check ALL three presence signals before deciding main-world is dead:
  //   1. mainWorldAlive — heartbeat captured (best evidence)
  //   2. window property — synchronous flag set early during main-world init
  //      (value is 'loading' before fetch is patched, 'active' after).
  //      'loading' still means main-world IS running — slow init is not death.
  //   3. data-ig-guard attribute — set on <html> at init start, removed by
  //      main-world's catch handler if init crashes. Survives across the
  //      'loading' → 'active' transition and is the most reliable presence
  //      signal independent of timing.
  // Firing the fallback while instance A is still loading creates two race
  // conditions: (a) instance B sees guard='loading' and skips init, leaving
  // no main-world alive; (b) instance B sees guard='active' and emits a
  // no-nonce duplicate heartbeat that gets rejected as "invalid nonce".
  // Both leak interception. Use guard attribute as the primary signal.
  const mwProp = (window as any).__IRON_GATE_MAIN_WORLD;
  const mainWorldProperty = mwProp === 'active' || mwProp === 'loading';
  const guardAttr = document.documentElement.getAttribute('data-ig-guard');
  const mainWorldPresent = mainWorldAlive || mainWorldProperty || !!guardAttr;
  if (!mainWorldPresent) {
    igLog('No heartbeat, no window property, no guard attribute after 1500ms — trying <script> tag fallback...');
    tryScriptTagInjection();
  } else if (!mainWorldAlive) {
    // Main-world is present but still initializing OR its first heartbeat
    // was missed. Periodic heartbeats (every 1s for 10s, see main-world.ts
    // heartbeat block) will deliver one shortly. No fallback needed.
    igLog(`MAIN world detected via ${mwProp ? 'window property=' + mwProp : 'guard attribute'} (heartbeat pending)`);
  } else {
    igLog('MAIN world alive via manifest injection — no fallback needed');
  }
}, 1500); // Increased from 500ms to give manifest injection more time

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

// ── Secure BroadcastChannel handler ──────────────────────────────────────────
// Receives sensitive data (reverse map, file uploads, server process requests)
// via BroadcastChannel instead of window.postMessage. Page scripts cannot
// listen because the channel name includes the unguessable nonce.
function handleSecureChannelMessage(data: any) {
  if (!data?.type) return;

  if (data.type === 'IRON_GATE_FILE_UPLOAD') {
    if (data.fileBase64 && typeof data.fileBase64 === 'string' && data.fileBase64.length > MAX_FILE_BASE64_LEN) return;
    const fileName = sanitizeString(data.fileName, 500);
    const fileSize = clampNumber(data.fileSize, 0, 100_000_000, 0);
    const fileType = sanitizeString(data.fileType, 100);
    const fileBase64 = sanitizeString(data.fileBase64, MAX_FILE_BASE64_LEN);
    igLog(`File upload via secure channel: ${fileName} (${fileSize} bytes)`);
    chrome.runtime.sendMessage({
      type: 'FILE_UPLOAD_DETECTED',
      nonce: crypto.randomUUID(),
      payload: { fileName, fileSize, fileType, fileBase64, aiToolId: detector?.id || 'unknown', timestamp: Date.now() },
    }).catch(() => {});
    return;
  }

  if (data.type === 'IRON_GATE_SERVER_PROCESS_REQUEST') {
    const { requestId, text, aiToolId } = data;
    if (!requestId || !text) return;
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
    return;
  }

  if (data.type === 'IRON_GATE_PERSIST_REVERSE_MAP') {
    // Relay to the worker — content scripts cannot access
    // chrome.storage.session (TRUSTED_CONTEXTS only); the old in-place
    // implementation silently failed on every persist. The worker keys
    // the map by sender.tab.id and bounds its size.
    const map = data.map;
    const seq = typeof data._seq === 'number' ? data._seq : 0;
    if (map && typeof map === 'object') {
      chrome.runtime.sendMessage({
        type: 'PERSIST_REVERSE_MAP',
        payload: { map, seq },
      }).catch(() => {});
    }
    return;
  }
}

// Listen for messages from MAIN world (fetch interception results)
function handleMainWorldMessages(event: MessageEvent) {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  // window.postMessage dispatches to ALL listeners on `window` — including
  // our own outbound csPostMessage() calls (SET_MODE etc.) and the heartbeats
  // already consumed by handleHeartbeatMessages. Re-validating them here
  // produces noisy "REJECTED message — invalid nonce" warnings (outbound
  // messages have _csNonce not _nonce; heartbeats fail the duplicate _mid
  // replay check because handleHeartbeatMessages consumed the _mid first).
  // Skip both classes early so the inbound validation only runs against
  // genuine main-world → content-script messages.
  if (event.data?._csNonce) return; // our own outbound message
  const inboundType = event.data?.type;
  if (inboundType === 'IRON_GATE_HEARTBEAT' || inboundType === 'IRON_GATE_HEALTH') {
    return; // already handled by handleHeartbeatMessages
  }

  // LOUD logging for INTERCEPTED messages — this is where proxy data gets lost
  if (inboundType === 'IRON_GATE_INTERCEPTED') {
    console.log('%c[Iron Gate CS] RECEIVED IRON_GATE_INTERCEPTED', 'color: #00ff00; font-weight: bold; font-size: 14px',
      'maskedPrompt:', event.data.maskedPrompt ? event.data.maskedPrompt.length + 'ch' : 'EMPTY',
      'mappings:', event.data.mappings?.length || 0,
      'entities:', event.data.entityCount);
  }

  // Validate cryptographic nonce from MAIN world script
  if (inboundType?.startsWith('IRON_GATE_') && !isValidMainWorldMessage(event.data)) {
    console.warn('[Iron Gate CS] REJECTED message — invalid nonce:', inboundType);
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
          nonce: crypto.randomUUID(),
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
  // Gemma classification relay REMOVED — worker handles Gemma directly
  // via the SENSITIVITY_SCORE handler using maskedPrompt. No relay needed.

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

  // ── Reverse Pseudonym Map Persistence ────────────────────────────────────
  // PERSIST arrives ONLY via the secure BroadcastChannel (see
  // handleSecureChannelMessage) — the previous duplicate window-path handler
  // here is removed: one channel, one handler.

  // MAIN world requests persisted reverse map (after page refresh). The
  // request carries nothing sensitive so it may arrive on the window channel,
  // but the RESPONSE is the full fake→real map (raw PII values) and goes
  // back ONLY over the nonce-named secure channel — never window.postMessage,
  // where any page script could observe it.
  if (event.data?.type === 'IRON_GATE_REQUEST_REVERSE_MAP') {
    chrome.runtime.sendMessage({ type: 'REQUEST_REVERSE_MAP' }).then((response) => {
      if (!chrome.runtime?.id) return;
      const map = response?.map;
      if (map && typeof map === 'object' && Object.keys(map).length > 0 && _igSecureChannel) {
        _igSecureChannel.postMessage({
          type: 'IRON_GATE_RESTORE_REVERSE_MAP',
          map,
          _seq: typeof response.seq === 'number' ? response.seq : -1,
        });
        igLog(`Restored reverse map (${Object.keys(map).length} entries, seq=${response.seq}) via secure channel`);
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

  // IRON_GATE_CLEAN_SUBMIT relay REMOVED (WP1): the main-world producer was
  // deleted long ago, so this block was unreachable. Clean user submits now
  // mint a TurnId in the coordinator and arrive as ordinary turn-stamped
  // IRON_GATE_AUDIT results.

  // Low-risk passthrough — entities detected but context deemed benign
  // ── ENFORCEMENT: Block overlay for critical prompts ──────────────────────
  // This is the enforcement layer — when the verdict is "block", the fetch
  // interceptor returns a 502 and posts this message. The content script
  // shows the block overlay in Shadow DOM. The user can cancel or redact.
  if (event.data?.type === 'IRON_GATE_BLOCK_PROMPT') {
    const { score, level, entityCount, entityTypes, explanation } = event.data;
    igLog(`BLOCK PROMPT: score=${score}, entities=${entityCount}, types=${entityTypes?.join(', ')}`);
    import('./ui/block-overlay').then(({ showBlockOverlay }) => {
      showBlockOverlay({
        score: score || 100,
        level: level || 'critical',
        entities: (entityTypes || []).map((t: string) => ({ type: t, count: 1 })),
        explanation: explanation || 'This prompt contains sensitive data that was blocked from being sent.',
      }).then((result) => {
        igLog(`Block overlay result: ${result.action}${result.overrideReason ? ` (reason: ${result.overrideReason})` : ''}`);
        // If user chose to override, record it
        if (result.action === 'allow' && result.overrideReason) {
          try {
            chrome.runtime.sendMessage({
              type: 'BLOCK_OVERRIDE',
              payload: {
                eventId: crypto.randomUUID(),
                reason: result.overrideReason,
                score,
                entityTypes,
              },
            }).catch(() => {});
          } catch { /* context may be gone */ }
        }
      }).catch(() => {});
    }).catch(() => {});
    return;
  }

  if (event.data?.type === 'IRON_GATE_LOW_RISK_PASSTHROUGH') {
    // Toast disabled — was firing on every keystroke and crashing ChatGPT
    return;
  }

  // De-pseudonymization / fail-closed signal from main-world.
  // Two responsibilities:
  //   1. Show a warning toast on the page.
  //   2. RETRACT any IRON_GATE_INTERCEPTED notification that was emitted for
  //      this turn — main-world fires INTERCEPTED before the actual fetch
  //      so the badge updates instantly, but if the fetch then fails or the
  //      LLM rejects the modified body, the request is blocked. Without a
  //      retraction, the sidepanel inspector would claim "N entities sent
  //      to the LLM" when in fact nothing reached the LLM. The retraction
  //      tells the worker → sidepanel to null lastScore (which cascades
  //      through the inspector useEffect to clear the Changes panel).
  if (event.data?.type === 'IRON_GATE_DEPSEUDO_FAILURE') {
    if (toasts) {
      toasts.show({
        title: 'De-pseudonymization Warning',
        message: event.data.detail || 'Some pseudonymized names may appear in the AI response.',
        type: 'warning',
      });
    }
    try {
      const rt = chrome.runtime;
      if (rt?.id) {
        rt.sendMessage({
          type: 'PROMPT_TURN_INVALIDATED',
          payload: { reason: event.data.detail || 'request blocked' },
        }).catch(() => {});
      }
    } catch { /* extension context invalidated — toast still shown */ }
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

    // Lifecycle phase tag — see shared/iron-gate-messages.ts for the
    // authoritative semantics. The wire interceptor's INTERCEPTED message
    // is the definitive result for the turn (`authoritative`); AUDIT is a
    // contextual signal that must never replace an authoritative result
    // downstream (`audit`).
    const phase: 'authoritative' | 'audit' = isProxy ? 'authoritative' : 'audit';

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
      isProxy, // legacy flag — true = pseudonymized (INTERCEPTED), false = audit only
      wireIntercept: event.data.wireIntercept === true, // legacy flag
      phase, // ← canonical lifecycle tag for downstream precedence rule
      // WP1: real turn identity minted by the main-world coordinator —
      // validated shape only; the worker's display gate keys on it.
      turn: (event.data.turn
          && typeof event.data.turn.epoch === 'number'
          && typeof event.data.turn.seq === 'number')
        ? { epoch: event.data.turn.epoch, seq: event.data.turn.seq }
        : null,
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
        // WP1: the worker is the SINGLE writer of display state — no storage
        // bypass channel here anymore (it raced the worker's gated writes).
        // sendMessage wakes a suspended MV3 worker; a failure is transient,
        // so retry once. The turn id makes the retry idempotent downstream.
        console.warn('[Iron Gate] runtime.sendMessage failed — retrying once:', err);
        setTimeout(() => {
          if (!chrome.runtime?.id) return;
          chrome.runtime.sendMessage({
            type: 'SENSITIVITY_SCORE',
            payload: relayPayload,
          }).catch((err2: unknown) => {
            console.warn('[Iron Gate] SENSITIVITY_SCORE retry failed — result lost:', err2);
          });
        }, 250);
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

    // WP1: belt-and-suspenders lastDetectionResult backup REMOVED. Redundant
    // channels were root cause #1 of the stale-panel class: one event became
    // N racing deliveries needing dedup at both ends. The worker's gated
    // per-tab state write (observed by the sidepanel via storage.onChanged)
    // is the one delivery path; the relay above retries once on failure.

    // Update floating sensitivity badge with current score/level
    if (badge) {
      badge.update(score, level);
      badge.show();
    }

    // Apply green shimmer to the user's message bubble after interception
    if (tooltips && isProxy && entityCount > 0 && detector) {
      // Brief delay to let the platform render the user bubble in the DOM
      setTimeout(() => {
        try {
          // Find the most recent user message bubble using common platform selectors
          const bubbleSelectors = [
            '[data-message-author-role="user"]:last-of-type',         // ChatGPT
            '.human-turn:last-of-type .message-text',                 // Claude
            '.query-text:last-of-type',                               // Gemini
            '.user-message:last-of-type',                             // generic
            '[data-testid="user-message"]:last-of-type',              // common pattern
          ];
          for (const sel of bubbleSelectors) {
            const bubble = document.querySelector<HTMLElement>(sel);
            if (bubble) {
              tooltips?.applyShimmer(bubble);
              break;
            }
          }
        } catch {
          // DOM query may fail — non-fatal
        }
      }, 300);
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
        if (badge && message.payload) {
          const s = clampNumber(message.payload.score, 0, 100, 0);
          const l = VALID_LEVELS.has(message.payload.level) ? message.payload.level : 'low';
          badge.update(s, l);
          badge.show();
        }
        sendResponse({ ok: true });
        break;
      case 'MODE_CHANGED':
        engine?.updateConfig({ mode: message.payload.mode });
        syncModeToMainWorld(message.payload.mode);
        igLog('Mode switched to:', message.payload.mode);
        sendResponse({ ok: true });
        break;
      case 'IRON_GATE_GEMMA_VERDICT':
        // Worker → content script → main-world: Gemma's context verdict and
        // any contextually-judged entities. Main-world caches the verdict for
        // intent-context scoring AND merges the entity texts into the
        // submit-time entity set so values regex missed (e.g., credentials
        // whose format the regex doesn't match) still get pseudonymized.
        //
        // SECURITY: entity texts are raw sensitive values. They travel ONLY
        // on the nonce-named BroadcastChannel — window.postMessage is
        // observable by any page script, and a window-path handler would
        // also let page scripts forge "allow" verdicts. No fallback: a
        // verdict always responds to a prompt main-world itself intercepted,
        // so the handshake (and therefore the channel) already exists; if it
        // somehow doesn't, dropping an enrichment verdict is fail-safe
        // (detection stays at the regex score — never weaker).
        if (_igSecureChannel) {
          _igSecureChannel.postMessage({
            type: 'IRON_GATE_GEMMA_VERDICT',
            intent: message.intent,
            sensitivity: message.sensitivity,
            score: message.score,
            verdict: message.verdict,
            source: message.source,
            entities: Array.isArray(message.entities) ? message.entities.slice(0, 50) : [],
          });
          igLog('Gemma verdict forwarded to main-world (secure channel):', message.verdict, message.sensitivity, `entities=${Array.isArray(message.entities) ? message.entities.length : 0}`);
        } else {
          igLog('Gemma verdict DROPPED — secure channel not established (fail-safe: regex score stands)');
        }
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

      // CRITICAL: Read the CURRENT firmMode from storage and apply it to
      // the engine BEFORE any prompts flow. The engine defaults to 'audit'
      // (monitor-only, no pseudonymization). Without this initial read, the
      // mode only updates on future CHANGE events — but if storage already
      // has 'proxy' (set during onboarding), no change event fires and the
      // engine stays in audit. That's the root cause of PII leaking through
      // on all platforms.
      try {
        chrome.storage.local.get('firmMode', (result) => {
          if (!chrome.runtime?.id) return;
          const savedMode = result?.firmMode === 'proxy' ? 'proxy' : 'audit';
          engine?.updateConfig({ mode: savedMode });
          // ALSO sync to MAIN world — the DOM pre-submit interceptor
          // (Gemini, Copilot) reads mode from main-world.ts, not from the
          // capture engine. Without this sync, the MAIN world defaults to
          // proxy (correct) but never receives explicit confirmation —
          // and if a future change flips the default, Gemini breaks.
          syncModeToMainWorld(savedMode);
          igLog('Initial mode loaded from storage:', savedMode);
        });
        // Also check managed storage (enterprise policy overrides local)
        chrome.storage.managed?.get('firmMode', (result) => {
          if (!chrome.runtime?.id) return;
          if (chrome.runtime.lastError) return;
          if (result?.firmMode === 'proxy' || result?.firmMode === 'audit') {
            engine?.updateConfig({ mode: result.firmMode });
            igLog('Managed mode override:', result.firmMode);
          }
        });
      } catch { /* storage API unavailable — stays on default */ }

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
                nonce: crypto.randomUUID(),
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

      badge = createSensitivityBadge();
      badge.showStandby();
      tooltips = createEntityTooltips();
      toasts = createCoachingToasts();

      // Welcome toast on first load (only once per session)
      try {
        // WP1: chrome.storage.LOCAL, not session — content scripts cannot
        // access storage.session (TRUSTED_CONTEXTS only), so the old check
        // silently failed and the toast fired on every page load. Local
        // also gives the better semantic: welcome once ever, not per session.
        chrome.storage.local.get('welcomeShown', (result) => {
          if (!chrome.runtime?.id) return;
          if (chrome.runtime.lastError) return; // Storage not accessible
          if (!result?.welcomeShown && toasts) {
            toasts.show({
              type: 'shield',
              title: `Iron Gate Active`,
              message: `Monitoring ${detector?.name ?? 'unknown'} for sensitive data. Your prompts are being scanned in real time.`,
              duration: 4000,
            });
            chrome.storage.local.set({ welcomeShown: true }).catch(() => {});
          }
        });
      } catch {
        // chrome.storage may not be available in all contexts
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
  badge?.destroy();
  tooltips?.destroy();
  clearInterval(contextCheckInterval);
  // Clean up all message listeners to prevent orphaned handlers
  window.removeEventListener('message', handleHeartbeatMessages);
  window.removeEventListener('message', handleMainWorldMessages);
}, { once: true });
