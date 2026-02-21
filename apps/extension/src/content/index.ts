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
