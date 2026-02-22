import { detectAITool } from './detectors';
import { createCaptureEngine } from './capture';
import { createSensitivityBadge } from './ui/sensitivity-badge';

/**
 * Iron Gate Content Script
 * Runs on all supported AI tool pages.
 * Detects the active AI tool and starts capturing prompts.
 */

let detector: ReturnType<typeof detectAITool> = null;
let engine: ReturnType<typeof createCaptureEngine> | null = null;
let badge: ReturnType<typeof createSensitivityBadge> | null = null;

// ── Sync mode with MAIN world script ────────────────────────────────────────
// The MAIN world script patches window.fetch in the page's JS context.
// We tell it the current mode so it knows whether to pseudonymize.

function syncModeToMainWorld(newMode: 'audit' | 'proxy') {
  window.postMessage({ type: 'IRON_GATE_SET_MODE', mode: newMode }, '*');
}

// Load saved mode and sync on startup
chrome.storage.local.get('firmMode', (result) => {
  const savedMode = result.firmMode === 'proxy' ? 'proxy' : 'audit';
  syncModeToMainWorld(savedMode);
  console.log(`[Iron Gate] Initial mode from storage: ${savedMode}`);
});

// Also watch for storage changes (backup in case MODE_CHANGED message is missed)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.firmMode) {
    const newMode = changes.firmMode.newValue === 'proxy' ? 'proxy' : 'audit';
    syncModeToMainWorld(newMode);
    engine?.updateConfig({ mode: newMode });
    console.log(`[Iron Gate] Mode changed via storage: ${newMode}`);
  }
});

// Listen for messages from MAIN world (fetch interception results)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  // MAIN world is requesting the current mode (it loaded before us)
  if (event.data?.type === 'IRON_GATE_REQUEST_MODE') {
    chrome.storage.local.get('firmMode', (result) => {
      const savedMode = result.firmMode === 'proxy' ? 'proxy' : 'audit';
      syncModeToMainWorld(savedMode);
      console.log(`[Iron Gate] Responded to MAIN world mode request: ${savedMode}`);
    });
    return;
  }

  // PROXY mode: fetch was pseudonymized before sending to LLM
  if (event.data?.type === 'IRON_GATE_INTERCEPTED') {
    const { originalPrompt, maskedPrompt, mappings, entityCount, level } = event.data;
    console.log(`[Iron Gate] MAIN world intercepted fetch — ${entityCount} entities pseudonymized (${level})`);

    try {
      chrome.runtime.sendMessage({
        type: 'SENSITIVITY_SCORE',
        payload: {
          score: level === 'critical' ? 95 : level === 'high' ? 75 : level === 'medium' ? 45 : 15,
          level,
          explanation: `Pseudonymized ${entityCount} entities before sending to AI tool.`,
          entities: [],
          aiToolId: detector?.id || 'unknown',
          originalPrompt,
          maskedPrompt,
          pseudonymMappings: mappings,
        },
      }).catch(() => {});
    } catch {
      // Extension context may be invalidated
    }
  }

  // AUDIT mode: entities detected but NOT pseudonymized (just scored)
  if (event.data?.type === 'IRON_GATE_AUDIT') {
    const { originalPrompt, maskedPrompt, mappings, entityCount, level } = event.data;
    console.log(`[Iron Gate] MAIN world audit — ${entityCount} entities detected (${level})`);

    try {
      chrome.runtime.sendMessage({
        type: 'SENSITIVITY_SCORE',
        payload: {
          score: level === 'critical' ? 95 : level === 'high' ? 75 : level === 'medium' ? 45 : 15,
          level,
          explanation: `Detected ${entityCount} sensitive entities in prompt (audit mode — not pseudonymized).`,
          entities: [],
          aiToolId: detector?.id || 'unknown',
          originalPrompt,
          maskedPrompt,
          pseudonymMappings: mappings,
        },
      }).catch(() => {});
    } catch {
      // Extension context may be invalidated
    }
  }
});

// Register message listener IMMEDIATELY so sidepanel can always reach us
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
        console.log(`[Iron Gate] Mode switched to: ${message.payload.mode}`);
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  } catch (err) {
    console.warn('[Iron Gate] Message handler error:', err);
    sendResponse({ ok: false, error: String(err) });
  }
  return true;
});

// Initialize detection (may run before DOM is ready, that's OK)
function initialize() {
  try {
    const currentUrl = window.location.href;
    detector = detectAITool(currentUrl);

    if (detector) {
      console.log(`[Iron Gate] Detected AI tool: ${detector.name} on ${currentUrl}`);

      engine = createCaptureEngine(detector);
      engine.start();

      badge = createSensitivityBadge();
    } else {
      console.log(`[Iron Gate] No AI tool detected on: ${currentUrl}`);
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
