import { detectAITool } from './detectors';
import { createCaptureEngine } from './capture';
import { createSensitivityBadge } from './ui/sensitivity-badge';
import { createCoachingToasts, getNextCoachingTip, type CoachingToastHandle } from './ui/coaching-toast';
import { resolveMode } from '../managed-config';

// ── Duplicate Injection Guard ────────────────────────────────────────────────
// When the extension reloads and re-injects, the OLD content script may still
// be partially alive. We use a window marker to detect and clean up old instances.
const CS_MARKER = '__IRON_GATE_CS_ACTIVE';
if ((window as any)[CS_MARKER]) {
  // Tell the old instance to shut down
  window.dispatchEvent(new CustomEvent('iron-gate-cs-replaced'));
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

let detector: ReturnType<typeof detectAITool> = null;
let engine: ReturnType<typeof createCaptureEngine> | null = null;
let badge: ReturnType<typeof createSensitivityBadge> | null = null;
let toasts: CoachingToastHandle | null = null;
let contextAlive = true;

// Coaching state — throttle toasts to avoid spam
let lastToastTime = 0;
let sessionInterceptCount = 0;
const TOAST_COOLDOWN = 8000; // Min 8s between toasts

// ── Sync mode with MAIN world script ────────────────────────────────────────
// The MAIN world script patches window.fetch in the page's JS context.
// We tell it the current mode so it knows whether to pseudonymize.

function syncModeToMainWorld(newMode: 'audit' | 'proxy') {
  window.postMessage({ type: 'IRON_GATE_SET_MODE', mode: newMode }, window.location.origin);
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
  igLog('Initial mode from storage:', savedMode);
}).catch(() => {});

// Watch for storage changes in both local AND managed areas
chrome.storage.onChanged.addListener((changes, area) => {
  if (!contextAlive) return;
  if ((area === 'local' && changes.firmMode) || (area === 'managed' && changes.firmMode)) {
    resolveMode().then((newMode) => {
      syncModeToMainWorld(newMode);
      engine?.updateConfig({ mode: newMode });
      igLog('Mode changed via storage:', newMode, '(area:', area, ')');
    }).catch(() => {});
  }
});

// ── MAIN world heartbeat monitor ─────────────────────────────────────────
let mainWorldAlive = false;

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'IRON_GATE_HEARTBEAT') {
    mainWorldAlive = true;
    igLog('MAIN world heartbeat received', `v${event.data.version}, mode: ${event.data.mode}`);
  }
  // Health status from MAIN world — relay to service worker for sidepanel
  if (event.data?.type === 'IRON_GATE_HEALTH') {
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
});

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

// Listen for messages from MAIN world (fetch interception results)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  // ── File Upload Detection from MAIN world ────────────────────────────
  // The main world fetch interceptor detects File objects in FormData bodies
  // and sends them via postMessage. We relay to the service worker for scanning.
  if (event.data?.type === 'IRON_GATE_FILE_UPLOAD') {
    const { fileName, fileSize, fileType, fileBase64, url } = event.data;
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
            console.log(`[Iron Gate] File scan complete: "${fileName}" → score=${response.score}, level=${response.level}, entities=${response.entitiesFound}`);
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
    const { fileName, fileSize, fileType, url } = event.data;
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

  // PROXY mode: fetch was pseudonymized before sending to LLM
  if (event.data?.type === 'IRON_GATE_INTERCEPTED') {
    const { promptHash, promptLength, maskedPrompt, mappings, entityCount, level, score, entities } = event.data;
    igLog(`MAIN world intercepted fetch — ${entityCount} entities pseudonymized (${level}, score=${score})`);

    try {
      chrome.runtime.sendMessage({
        type: 'SENSITIVITY_SCORE',
        payload: {
          score: score ?? (level === 'critical' ? 95 : level === 'high' ? 75 : level === 'medium' ? 45 : 15),
          level,
          explanation: `Pseudonymized ${entityCount} entities before sending to AI tool.`,
          entities: entities || [],
          aiToolId: detector?.id || 'unknown',
          promptHash,
          promptLength,
          maskedPrompt,
          pseudonymMappings: mappings,
        },
      }).catch((err) => {
        console.warn('[Iron Gate] Failed to relay INTERCEPTED to service worker:', err);
      });
    } catch {
      // Extension context may be invalidated
    }

    // Coaching toast: confirm pseudonymization
    showCoachingFeedback('proxy', entityCount, level, score);
  }

  // AUDIT mode: entities detected but NOT pseudonymized (just scored)
  if (event.data?.type === 'IRON_GATE_AUDIT') {
    const { promptHash, promptLength, maskedPrompt, mappings, entityCount, level, score, entities } = event.data;
    igLog(`MAIN world audit — ${entityCount} entities detected (${level}, score=${score})`);

    try {
      chrome.runtime.sendMessage({
        type: 'SENSITIVITY_SCORE',
        payload: {
          score: score ?? (level === 'critical' ? 95 : level === 'high' ? 75 : level === 'medium' ? 45 : 15),
          level,
          explanation: `Detected ${entityCount} sensitive entities in prompt (audit mode — not pseudonymized).`,
          entities: entities || [],
          aiToolId: detector?.id || 'unknown',
          promptHash,
          promptLength,
          maskedPrompt,
          pseudonymMappings: mappings,
        },
      }).catch((err) => {
        console.warn('[Iron Gate] Failed to relay AUDIT to service worker:', err);
      });
    } catch {
      // Extension context may be invalidated
    }

    // Coaching toast: warn about detected entities in audit mode
    showCoachingFeedback('audit', entityCount, level, score);
  }
});

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
        badge?.update(message.payload.score, message.payload.level);
        sendResponse({ ok: true });
        break;
      case 'MODE_CHANGED':
        engine?.updateConfig({ mode: message.payload.mode });
        syncModeToMainWorld(message.payload.mode);
        igLog('Mode switched to:', message.payload.mode);
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
          window.postMessage({
            type: 'IRON_GATE_FILE_SCAN_RESULT',
            payload: p,
          }, window.location.origin);
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

      badge = createSensitivityBadge();
      toasts = createCoachingToasts();

      // Welcome toast on first load (only once per session)
      try {
        chrome.storage.session.get('welcomeShown', (result) => {
          if (chrome.runtime.lastError) return; // Storage not accessible
          if (!result?.welcomeShown && toasts) {
            toasts.show({
              type: 'shield',
              title: `Iron Gate Active`,
              message: `Monitoring ${detector!.name} for sensitive data. Your prompts are being scanned in real time.`,
              duration: 4000,
            });
            chrome.storage.session.set({ welcomeShown: true }).catch(() => {});
          }
        });
      } catch {
        // chrome.storage.session may not be available in all contexts
      }
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
      window.postMessage({ type: 'IRON_GATE_CONTEXT_INVALIDATED' }, window.location.origin);
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
}, { once: true });
