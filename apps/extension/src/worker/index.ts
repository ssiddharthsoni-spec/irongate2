/**
 * Iron Gate Service Worker
 * Handles background tasks: event queuing, API communication, model management.
 */

import { analyzePrompt, sendProxiedPrompt, handleProxyFlow, analyzeFile } from './proxy-handler';
import { eventQueue } from './queue';
import { apiRequest } from './api-client';
import { getFirmId, getUserId } from './auth';

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

      const eventId = crypto.randomUUID();
      // Queue event for backend — fire-and-forget
      eventQueue.enqueue({
        eventId,
        type: 'prompt_detected',
        aiToolId,
        captureMethod,
        promptLength: text.length,
        promptHash: await hashText(text),
        firmId: getFirmId(),
        userId: getUserId(),
        timestamp: Date.now(),
      }).catch((err) => console.warn('[Iron Gate] Failed to queue event:', err));

      return { received: true, eventId };
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

      // Audit mode: queue event for backend
      eventQueue.enqueue({
        eventId: crypto.randomUUID(),
        type: 'prompt_submitted',
        aiToolId,
        sensitivityScore,
        promptLength: text.length,
        promptHash: await hashText(text),
        action: 'pass',
        firmId: getFirmId(),
        userId: getUserId(),
        timestamp: Date.now(),
      }).catch((err) => console.warn('[Iron Gate] Failed to queue event:', err));

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

    case 'BLOCK_OVERRIDE': {
      const { eventId, reason } = message.payload;
      console.log(`[Iron Gate] Block override: ${eventId}, reason: ${reason}`);

      eventQueue.enqueue({
        eventId: eventId || crypto.randomUUID(),
        type: 'block_override',
        reason,
        firmId: getFirmId(),
        userId: getUserId(),
        timestamp: Date.now(),
      }).catch((err) => console.warn('[Iron Gate] Failed to queue override event:', err));

      return { ok: true };
    }

    case 'ENTITY_FEEDBACK': {
      const { entityType, entityText, isCorrect, feedbackType, correctedType } = message.payload;
      console.log(`[Iron Gate] Entity feedback: ${entityType} — ${feedbackType}`);

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

    default:
      return { error: 'Unknown message type' };
  }
}

// Periodic alarm for flushing event queue
chrome.alarms.create('flush-events', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush-events') {
    console.log('[Iron Gate] Flushing event queue...');
    eventQueue.flush().catch((err) =>
      console.warn('[Iron Gate] Queue flush failed:', err)
    );
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hash of prompt text — we never store or transmit plaintext prompts */
async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
