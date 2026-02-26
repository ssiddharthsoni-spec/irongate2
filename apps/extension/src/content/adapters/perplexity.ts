import type { SiteAdapter } from './base';

/**
 * Perplexity Adapter — perplexity.ai, www.perplexity.ai
 *
 * Transport: Socket.IO over WebSocket (42["perplexity_ask","query",{options}])
 *            Also some Fetch POST to /api/query or /api/search
 *            Next.js app
 *
 * Strategy: Wire-level (WebSocket + Fetch dual proxy)
 * - Socket.IO text frames are easily parseable (strip 42 prefix, JSON.parse array)
 * - Fetch fallback catches any REST API calls
 * - No DOM pre-submit needed
 */

function jsonStringEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export const PerplexityAdapter: SiteAdapter = {
  id: 'perplexity',
  name: 'Perplexity',

  hostPatterns: [/perplexity\.ai/],

  transport: 'websocket-socketio',
  interception: 'wire',

  apiPatterns: [
    /perplexity\.ai\/api/,
    /api\.perplexity\.ai/,
  ],

  fileUploadPatterns: [/perplexity\.ai\/api\/upload/],

  skipFetchProxy: false,  // Fetch proxy catches REST API calls
  skipXhrProxy: false,

  inputSelectors: [
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="ask"]',
    'textarea',
  ],

  submitSelectors: [
    'button[aria-label="Submit"]',
    'button[type="submit"]',
  ],

  responseSelectors: [
    '.prose',
  ],

  extractPrompt(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.text === 'string' && parsed.text.length > 5) return parsed.text;
      if (typeof parsed?.query_str === 'string') return parsed.query_str;
      if (typeof parsed?.query === 'string') return parsed.query;
      if (typeof parsed?.params?.query === 'string') return parsed.params.query;
      return null;
    } catch {
      return null;
    }
  },

  replacePrompt(body: string, original: string, replacement: string): string | null {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.text === 'string' && parsed.text.length > 5) {
        parsed.text = replacement; return JSON.stringify(parsed);
      }
      if (typeof parsed?.query_str === 'string') {
        parsed.query_str = replacement; return JSON.stringify(parsed);
      }
      if (typeof parsed?.query === 'string') {
        parsed.query = replacement; return JSON.stringify(parsed);
      }
      if (typeof parsed?.params?.query === 'string') {
        parsed.params.query = replacement; return JSON.stringify(parsed);
      }

      // Generic fallback
      if (original.length >= 20) {
        const escaped = jsonStringEscape(original);
        const escapedRepl = jsonStringEscape(replacement);
        if (body.includes(escaped)) return body.replace(escaped, escapedRepl);
      }
      return null;
    } catch {
      return null;
    }
  },

  readInput(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value.trim();
    return (el.innerText || el.textContent || '').trim();
  },

  writeInput(_el: HTMLElement, _text: string): boolean {
    return false; // Wire-level interception, no DOM write needed
  },

  findInput(): HTMLElement | null {
    for (const sel of this.inputSelectors) {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) return el;
    }
    return null;
  },

  findSubmitButton(): HTMLElement | null {
    for (const sel of this.submitSelectors) {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) return el;
    }
    return null;
  },

  isGenerating(): boolean {
    return !!document.querySelector('.animate-spin');
  },

  isWsEndpoint(url: string): boolean {
    return /perplexity\.ai/.test(url);
  },

  extractFromWsFrame(frame: string): string | null {
    // Socket.IO control frames: just digits like "2" (ping), "3" (pong), "40" (connect), "41" (disconnect)
    if (/^\d{1,3}$/.test(frame.trim())) return null;

    // Socket.IO event frame format: 42["event_name","query_text",{options}]
    // The numeric prefix (42) is the Socket.IO packet type (4=ENGINE.IO MESSAGE, 2=EVENT)
    // Strip the numeric prefix and parse the JSON array
    const jsonStart = frame.indexOf('[');
    if (jsonStart < 0 || jsonStart > 10) return null;

    try {
      const arr = JSON.parse(frame.substring(jsonStart));
      if (!Array.isArray(arr) || arr.length < 2) return null;

      // Only extract from user-initiated query events
      // Skip server-push events, ack frames, and non-query Socket.IO events
      const eventName = typeof arr[0] === 'string' ? arr[0] : '';

      // User query events: perplexity_ask, perplexity_search, etc.
      if (/^perplexity_(?:ask|search|query)/i.test(eventName)) {
        if (typeof arr[1] === 'string' && arr[1].trim().length > 0) {
          return arr[1];
        }
      }

      // Ignore all other Socket.IO events — they are server responses,
      // connection management, or internal protocol frames (not user queries)
      return null;
    } catch {
      return null;
    }
  },

  replaceInWsFrame(frame: string, original: string, replacement: string): string | null {
    // Properly reconstruct the Socket.IO array frame: 42["event","query",{opts}]
    const jsonStart = frame.indexOf('[');
    if (jsonStart < 0 || jsonStart > 10) {
      // Fallback: JSON-escaped string replacement
      const escaped = jsonStringEscape(original);
      if (frame.includes(escaped)) return frame.replace(escaped, jsonStringEscape(replacement));
      return null;
    }

    const prefix = frame.substring(0, jsonStart); // e.g., "42"
    try {
      const arr = JSON.parse(frame.substring(jsonStart));
      if (!Array.isArray(arr) || arr.length < 2) return null;

      // Replace the query text at its correct position in the array
      let replaced = false;
      for (let i = 1; i < arr.length; i++) {
        if (typeof arr[i] === 'string' && arr[i] === original) {
          arr[i] = replacement;
          replaced = true;
          break;
        }
      }

      // Fallback: replace within any matching string element
      if (!replaced) {
        for (let i = 1; i < arr.length; i++) {
          if (typeof arr[i] === 'string' && arr[i].includes(original)) {
            arr[i] = arr[i].replace(original, replacement);
            replaced = true;
            break;
          }
        }
      }

      if (replaced) {
        return prefix + JSON.stringify(arr);
      }

      return null;
    } catch {
      // Parse failed — fall back to string replacement
      const escaped = jsonStringEscape(original);
      if (frame.includes(escaped)) return frame.replace(escaped, jsonStringEscape(replacement));
      return null;
    }
  },
};
