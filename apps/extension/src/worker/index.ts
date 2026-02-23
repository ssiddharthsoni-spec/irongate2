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
        console.log(`[Iron Gate] MAIN world event — ${aiToolId}, score: ${score}, level: ${level}, entities: ${entities?.length || 0}, mappings: ${pseudonymMappings?.length || 0}`);

        // Queue event for API
        const promptHash = await hashText(originalPrompt);
        const action = firmMode === 'proxy'
          ? (pseudonymMappings?.length > 0 ? 'proxy' : 'pass')
          : 'pass';

        // Use real entity data from MAIN world if available, otherwise reconstruct from mappings
        let entityList: any[];
        if (entities && entities.length > 0) {
          entityList = entities.map((e: any) => ({
            type: e.type || 'UNKNOWN',
            text: e.text || '',
            start: e.start || 0,
            end: e.end || 0,
            confidence: e.confidence || 0.85,
            source: e.source || 'regex',
          }));
        } else {
          // Fallback: reconstruct from pseudonym mappings
          entityList = (pseudonymMappings || []).map((m: any) => ({
            type: m.type || 'UNKNOWN',
            text: m.original || '',
            start: 0,
            end: (m.original || '').length,
            confidence: 0.85,
            source: 'regex',
          }));
        }

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

      // Re-broadcast to sidepanel (sidepanel only receives messages from the worker,
      // NOT from content scripts — chrome.runtime.sendMessage is directional)
      chrome.runtime.sendMessage({
        type: 'SENSITIVITY_SCORE',
        payload,
      }).catch(() => {});

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

/**
 * Self-contained inline fetch interceptor — injected via chrome.scripting.executeScript({ func })
 * when the full main-world.ts file fails to load. This is the LAST RESORT fallback.
 * Must be 100% self-contained with no external references.
 */
function inlineFetchInterceptor() {
  // Skip if full main-world.ts already loaded
  if ((window as any).__IRON_GATE_MAIN_WORLD === 'active') {
    console.log('[Iron Gate INLINE] Full main-world.ts already active — skipping inline fallback');
    return;
  }

  console.log('[Iron Gate INLINE] 🔧 Installing inline fetch interceptor (fallback)...');

  let mode: 'audit' | 'proxy' = 'audit';

  // Listen for mode changes
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    if (e.data?.type === 'IRON_GATE_SET_MODE') {
      mode = e.data.mode;
      console.log('[Iron Gate INLINE] Mode set to:', mode);
    }
  });
  window.postMessage({ type: 'IRON_GATE_REQUEST_MODE' }, '*');

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
    console.log('[Iron Gate INLINE] Intercepted fetch to', url.substring(0, 60), '— mode:', mode, ', entities:', entities.length);

    if (mode === 'proxy' && entities.length > 0) {
      const level = quickScore(entities);
      const { maskedText, mappings } = pseudonymize(promptText, entities);
      const modifiedBody = replacePrompt(bodyString, promptText, maskedText);

      if (modifiedBody) {
        console.log('[Iron Gate INLINE] ✅ PROXY: Pseudonymized', entities.length, 'entities (', level, ')');
        console.log('[Iron Gate INLINE] Original:', promptText.substring(0, 80), '...');
        console.log('[Iron Gate INLINE] Masked:', maskedText.substring(0, 80), '...');

        window.postMessage({
          type: 'IRON_GATE_INTERCEPTED',
          originalPrompt: promptText,
          maskedPrompt: maskedText,
          mappings,
          entityCount: entities.length,
          level,
        }, '*');

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
      window.postMessage({
        type: 'IRON_GATE_AUDIT',
        originalPrompt: promptText,
        maskedPrompt: maskedText,
        mappings,
        entityCount: entities.length,
        level,
      }, '*');
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
  console.log('[Iron Gate INLINE]', ok ? '✅ Inline fetch interceptor ACTIVE' : '❌ Fetch patch FAILED');
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
      console.log(`[Iron Gate] Programmatic MAIN world injection → tab ${details.tabId} (${details.url?.substring(0, 60)})`);
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

      if (checkResult?.result === 'active') {
        console.log(`[Iron Gate] MAIN world confirmed active on tab ${details.tabId}`);
        return;
      }

      console.warn(`[Iron Gate] MAIN world NOT active (state: ${checkResult?.result}) — injecting inline fallback`);
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        world: 'MAIN' as any,
        func: inlineFetchInterceptor,
      });
      console.log(`[Iron Gate] Inline fallback injected → tab ${details.tabId}`);
    } catch (err) {
      console.warn(`[Iron Gate] Fallback check/injection failed:`, err);
    }
  }, 1500);
}, { url: AI_TOOL_URL_FILTERS });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hash of prompt text — we never store or transmit plaintext prompts */
async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
