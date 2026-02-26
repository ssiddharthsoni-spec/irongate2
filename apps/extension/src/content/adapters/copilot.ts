import type { SiteAdapter } from './base';

/**
 * Copilot Adapter — copilot.microsoft.com
 *
 * Transport: SignalR over WebSocket (frames separated by \x1e record separator)
 *            Message types: 1=Invocation (chat), 3=Completion, 6=Ping, 7=Close
 *
 * Strategy: DOM capture + WebSocket.prototype.send patch
 * - React's internal state overwrites DOM changes — DOM write is useless
 * - Capture text on Enter/click, store pending pseudo
 * - WS.prototype.send patch finds original text in SignalR frame and replaces it
 *
 * Why prototype.send and NOT instance.send:
 * - Modifying WS instance properties breaks SignalR's internal validation
 * - Prototype patch is invisible to SignalR
 */

export const CopilotAdapter: SiteAdapter = {
  id: 'copilot',
  name: 'Microsoft Copilot',

  hostPatterns: [/copilot\.microsoft\.com/],

  transport: 'websocket-signalr',
  interception: 'dom-capture-wire',

  apiPatterns: [
    /copilot\.microsoft\.com\/c\/api\/conversations\b/,
    /copilot\.microsoft\.com\/c\/api\/chat\b/,
    /copilot\.microsoft\.com\/sl\/api\/chat\b/,
    /copilot\.microsoft\.com\/turing\/conversation/,
    /sydney\.bing\.com\/sydney/,
    /bing\.com\/.*\/api\/.*chat/i,
  ],

  fileUploadPatterns: [/edgeservices\.bing\.com\/images\/kblob/],

  skipFetchProxy: true,  // SignalR WS handles everything
  skipXhrProxy: true,

  inputSelectors: [
    '#userInput',
    'textarea[placeholder]',
    'div[contenteditable="true"]',
    '#searchbox',
    '[class*="text-input"] textarea',
    '[class*="chat-input"] textarea',
    '[class*="composer"] textarea',
    '[class*="composer"] [contenteditable="true"]',
    'textarea',
  ],

  submitSelectors: [
    'button[aria-label="Submit"]',
    'button[aria-label="Send"]',
  ],

  responseSelectors: [
    '.ac-container',
  ],

  usesShadowDom: true,

  extractPrompt(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) {
        if (typeof parsed.message === 'string') return parsed.message;
        if (typeof parsed.message?.text === 'string') return parsed.message.text;
        if (typeof parsed.message?.content === 'string') return parsed.message.content;
      }
      if (typeof parsed?.content === 'string' && parsed.content.length > 5) return parsed.content;
      if (typeof parsed?.q === 'string') return parsed.q;
      if (typeof parsed?.question === 'string') return parsed.question;
      return null;
    } catch {
      return null;
    }
  },

  replacePrompt(body: string, original: string, replacement: string): string | null {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) {
        if (typeof parsed.message === 'string') { parsed.message = replacement; return JSON.stringify(parsed); }
        if (typeof parsed.message?.text === 'string') { parsed.message.text = replacement; return JSON.stringify(parsed); }
        if (typeof parsed.message?.content === 'string') { parsed.message.content = replacement; return JSON.stringify(parsed); }
      }
      if (typeof parsed?.content === 'string' && parsed.content.length > 5) {
        parsed.content = replacement; return JSON.stringify(parsed);
      }
      if (typeof parsed?.q === 'string') { parsed.q = replacement; return JSON.stringify(parsed); }
      if (typeof parsed?.question === 'string') { parsed.question = replacement; return JSON.stringify(parsed); }
      return null;
    } catch {
      return null;
    }
  },

  readInput(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value.trim();
    return (el.innerText || el.textContent || '').trim();
  },

  // Copilot uses React — DOM writes are useless. This is a no-op.
  writeInput(_el: HTMLElement, _text: string): boolean {
    return false;
  },

  findInput(): HTMLElement | null {
    // Try light DOM first
    for (const sel of this.inputSelectors) {
      try {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) return el;
      } catch { /* invalid selector */ }
    }
    // Try Shadow DOM: Copilot Web Components (cib-*) use shadow roots
    try {
      const serp = document.querySelector('cib-serp');
      if (serp?.shadowRoot) {
        const bar = serp.shadowRoot.querySelector('cib-action-bar');
        if (bar?.shadowRoot) {
          const textarea = bar.shadowRoot.querySelector('textarea');
          if (textarea) return textarea as HTMLElement;
          const ce = bar.shadowRoot.querySelector('[contenteditable="true"]');
          if (ce) return ce as HTMLElement;
        }
      }
    } catch { /* shadow DOM not available */ }
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
    return !!(
      document.querySelector('[aria-label="Stop Responding"]') ||
      document.querySelector('.typing-indicator')
    );
  },

  isWsEndpoint(url: string): boolean {
    return /copilot\.microsoft\.com|sydney\.bing\.com|bing\.com/.test(url);
  },

  extractFromWsFrame(frame: string): string | null {
    // SignalR frames are separated by \x1e. Each frame is JSON.
    // Type 1 = Invocation (contains chat text in arguments)
    const RS = '\x1e';
    const frames = frame.split(RS);
    for (const f of frames) {
      const trimmed = f.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.type !== 1 || !Array.isArray(parsed?.arguments)) continue;
        // Walk arguments to find the prompt text
        const text = this._walkForText(parsed.arguments);
        if (text && text.length >= 10) return text;
      } catch { continue; }
    }
    return null;
  },

  replaceInWsFrame(frame: string, original: string, replacement: string): string | null {
    // Try JSON-escaped exact match first (fastest)
    const escapedOrig = JSON.stringify(original).slice(1, -1);
    const escapedRepl = JSON.stringify(replacement).slice(1, -1);
    if (frame.includes(escapedOrig)) {
      return frame.replace(escapedOrig, escapedRepl);
    }
    // Normalized line breaks
    const normOrig = original.replace(/\r\n/g, '\n').trim();
    const escapedNorm = JSON.stringify(normOrig).slice(1, -1);
    if (escapedNorm !== escapedOrig && frame.includes(escapedNorm)) {
      const normRepl = replacement.replace(/\r\n/g, '\n').trim();
      return frame.replace(escapedNorm, JSON.stringify(normRepl).slice(1, -1));
    }
    return null;
  },

  // Internal helper: recursively walk an object to find the longest string > 50 chars
  _walkForText(obj: any): string | null {
    if (typeof obj === 'string' && obj.length > 50) return obj;
    if (Array.isArray(obj)) {
      let best: string | null = null;
      for (const item of obj) {
        const found = this._walkForText(item);
        if (found && (!best || found.length > best.length)) best = found;
      }
      return best;
    }
    if (obj && typeof obj === 'object') {
      let best: string | null = null;
      for (const val of Object.values(obj)) {
        const found = this._walkForText(val);
        if (found && (!best || found.length > best.length)) best = found;
      }
      return best;
    }
    return null;
  },
} as SiteAdapter & { _walkForText(obj: any): string | null };
