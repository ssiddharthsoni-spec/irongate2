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

console.log('[Iron Gate] Service worker started');

// ─── Startup: restore auth & wire API client ────────────────────────────────
initAuth().then(() => {
  configureApiClient({
    firmId: getFirmId() || '',
    getToken,
  });
  console.log('[Iron Gate] Auth initialized & API client configured');
}).catch((err) => console.warn('[Iron Gate] Startup init failed:', err));

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

      const scorePayload = {
        score: sensitivityResult.score,
        level: sensitivityResult.level,
        explanation: sensitivityResult.explanation,
        entities: sensitivityResult.entities,
        aiToolId: aiToolId,
      };

      // Broadcast score to the originating content-script tab (for badge)
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'SENSITIVITY_SCORE',
          payload: scorePayload,
        }).catch(() => {});
      }

      // Broadcast to sidepanel with full prompt inspector data
      chrome.runtime.sendMessage({
        type: 'SENSITIVITY_SCORE',
        payload: {
          ...scorePayload,
          originalPrompt: text,
          maskedPrompt: pseudoResult.maskedText,
          pseudonymMappings: pseudoResult.mappings,
        },
      }).catch(() => {});

      return { received: true };
    }

    // ── SENSITIVITY_SCORE from content script (relayed from MAIN world) ──
    // This is the PRIMARY event source — fired when MAIN world intercepts
    // a fetch to an LLM API and detects/pseudonymizes entities.
    case 'SENSITIVITY_SCORE': {
      const payload = message.payload;
      const {
        score, level, explanation, entities = [],
        aiToolId, originalPrompt, maskedPrompt, pseudonymMappings,
      } = payload;

      // Only queue to API if this has prompt data (i.e., from content script, not a re-broadcast)
      if (originalPrompt) {
        console.log(`[Iron Gate] MAIN world event — ${aiToolId}, score: ${score}, level: ${level}, entities: ${pseudonymMappings?.length || 0}`);

        // Queue event for API
        const promptHash = await hashText(originalPrompt);
        const action = firmMode === 'proxy'
          ? (pseudonymMappings?.length > 0 ? 'proxy' : 'pass')
          : 'pass';

        // Reconstruct entity list from pseudonym mappings (since MAIN world doesn't send full entity data)
        const entityList = (pseudonymMappings || []).map((m: any) => ({
          type: m.type || 'UNKNOWN',
          text: m.original || '',
          start: 0,
          end: (m.original || '').length,
          confidence: 0.85,
          source: 'regex',
        }));

        queueEventToApi({
          aiToolId: aiToolId || 'unknown',
          promptHash,
          promptLength: originalPrompt.length,
          sensitivityScore: score,
          sensitivityLevel: level,
          entities: entityList,
          action,
          captureMethod: 'fetch',
        });
      }

      // Don't re-broadcast — sidepanel already receives chrome.runtime messages directly
      return { ok: true };
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

        // Broadcast scan result to sidepanel and all tabs
        chrome.runtime.sendMessage({
          type: 'FILE_SCAN_RESULT',
          payload: { ...result, aiToolId },
        }).catch(() => {});

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
      const { apiKey } = message.payload;
      console.log(`[Iron Gate] API key updated: ${apiKey ? apiKey.substring(0, 8) + '...' : '(cleared)'}`);
      chrome.storage.local.set({ ironGateApiKey: apiKey });
      configureApiClient({ apiKey });
      return { ok: true };
    }

    case 'BLOCK_OVERRIDE': {
      const { eventId, reason } = message.payload;
      console.log(`[Iron Gate] Block override: ${eventId}, reason: ${reason}`);

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

// ─── Event Queue Helper ─────────────────────────────────────────────────────

/**
 * Queue an event to the API with the CORRECT schema expected by POST /v1/events/batch.
 * This is the single point of event creation — all paths should use this.
 */
function queueEventToApi(event: {
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
}): void {
  eventQueue.enqueue({
    aiToolId: event.aiToolId,
    aiToolUrl: '',
    promptHash: event.promptHash,
    promptLength: event.promptLength,
    sensitivityScore: event.sensitivityScore,
    sensitivityLevel: event.sensitivityLevel,
    entities: event.entities,
    action: event.action,
    overrideReason: event.overrideReason,
    captureMethod: event.captureMethod,
    sessionId: event.sessionId,
    metadata: event.metadata || {},
  }).catch((err) => console.warn('[Iron Gate] Failed to queue event:', err));
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

chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Only inject into main frame (not iframes)
  if (details.frameId !== 0) return;

  try {
    // Find the MAIN world script file from the manifest
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
      console.log(`[Iron Gate] Programmatic MAIN world injection → tab ${details.tabId} (${details.url?.substring(0, 60)})`);
    }
  } catch (err) {
    // Can fail if tab navigated away or extension lacks permission
    console.warn(`[Iron Gate] Programmatic injection failed:`, err);
  }
}, { url: AI_TOOL_URL_FILTERS });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hash of prompt text — we never store or transmit plaintext prompts */
async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
