import { detectAITool } from './detectors';
import { createCaptureEngine } from './capture';
import { createSensitivityBadge } from './ui/sensitivity-badge';

/**
 * Iron Gate Content Script
 * Runs on all supported AI tool pages.
 * Detects the active AI tool and starts capturing prompts.
 */

const currentUrl = window.location.href;
const detector = detectAITool(currentUrl);

if (detector) {
  console.log(`[Iron Gate] Detected AI tool: ${detector.name}`);

  // Initialize the capture engine for this AI tool
  const engine = createCaptureEngine(detector);
  engine.start();

  // Initialize the sensitivity badge when an AI tool is detected
  const badge = createSensitivityBadge();

  // Listen for messages from the service worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'GET_STATUS':
        sendResponse({
          active: true,
          aiTool: detector.id,
          aiToolName: detector.name,
        });
        break;
      case 'CONFIG_UPDATE':
        engine.updateConfig(message.payload);
        sendResponse({ ok: true });
        break;
      case 'SENSITIVITY_SCORE':
        // Update the sensitivity badge with the latest score
        badge.update(message.payload.score, message.payload.level);
        sendResponse({ ok: true });
        break;
      case 'MODE_CHANGED':
        // Switch between audit and proxy mode
        engine.updateConfig({ mode: message.payload.mode });
        console.log(`[Iron Gate] Mode switched to: ${message.payload.mode}`);
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
    return true; // Keep message channel open for async response
  });
} else {
  console.log('[Iron Gate] No AI tool detected on this page');
}
