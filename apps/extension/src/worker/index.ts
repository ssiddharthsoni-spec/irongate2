/**
 * Iron Gate Service Worker
 * Handles background tasks: event queuing, API communication, model management.
 */

import { analyzePrompt, sendProxiedPrompt, handleProxyFlow, analyzeFile } from './proxy-handler';

console.log('[Iron Gate] Service worker started');

// Open side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Firm mode tracking — defaults to 'audit', persisted in chrome.storage.local
let firmMode: 'audit' | 'proxy' = 'audit';

// Load persisted mode on startup
chrome.storage.local.get('firmMode', (result) => {
  if (result.firmMode === 'audit' || result.firmMode === 'proxy') {
    firmMode = result.firmMode;
    console.log(`[Iron Gate] Loaded firm mode: ${firmMode}`);
  }
});

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
      console.log(`[Iron Gate] Prompt captured from ${aiToolId} via ${captureMethod}, length: ${text.length}`);

      // Send to detection pipeline (will be implemented in Task 2.1)
      // For now, just acknowledge
      return { received: true, eventId: crypto.randomUUID() };
    }

    case 'PROMPT_SUBMITTED': {
      const { text, aiToolId, sensitivityScore } = message.payload;
      console.log(`[Iron Gate] Prompt submitted on ${aiToolId}, score: ${sensitivityScore}`);

      // In proxy mode, run the full proxy flow instead of just passing through
      if (firmMode === 'proxy') {
        try {
          const sessionId = message.payload.sessionId || crypto.randomUUID();
          const result = await handleProxyFlow(text, aiToolId, sessionId);
          return result;
        } catch (error) {
          console.error('[Iron Gate] Proxy flow error:', error);
          return { actionRequired: 'pass', error: 'Proxy flow failed, falling back to passthrough' };
        }
      }

      // Queue event for backend submission (Task 3.3)
      return { actionRequired: 'pass' };
    }

    case 'PROXY_ANALYZE': {
      const { text, aiToolId, sessionId } = message.payload;
      console.log(`[Iron Gate] Proxy analyze request for ${aiToolId}, length: ${text.length}`);

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
        console.error('[Iron Gate] Proxy analyze error:', error);
        return { error: 'Proxy analysis failed' };
      }
    }

    case 'PROXY_SEND': {
      const { maskedPrompt, route, sessionId, ...options } = message.payload;
      console.log(`[Iron Gate] Proxy send request, route: ${route}`);

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
        console.error('[Iron Gate] Proxy send error:', error);
        return { error: 'Proxy send failed' };
      }
    }

    case 'FILE_UPLOAD_DETECTED': {
      const { fileName, fileBase64, fileType, aiToolId } = message.payload;
      console.log(`[Iron Gate] File upload detected: ${fileName} on ${aiToolId}`);

      try {
        const result = await analyzeFile(fileName, fileBase64, fileType);
        return result;
      } catch (error) {
        console.error('[Iron Gate] File analysis error:', error);
        return { error: 'File analysis failed' };
      }
    }

    case 'MODE_CHANGED': {
      const { mode } = message.payload;
      firmMode = mode;
      chrome.storage.local.set({ firmMode: mode });
      console.log(`[Iron Gate] Firm mode changed to: ${mode}`);
      return { ok: true, mode };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// Periodic alarm for flushing event queue
chrome.alarms.create('flush-events', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush-events') {
    // Will be implemented in Task 3.3
    console.log('[Iron Gate] Flushing event queue...');
  }
});
