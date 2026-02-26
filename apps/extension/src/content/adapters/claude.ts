import type { SiteAdapter } from './base';

/**
 * Claude Adapter — claude.ai
 *
 * Transport: Fetch POST to /api/organizations/{id}/chat_conversations/{id}/completion
 *            SSE streaming responses, WebSocket connections
 *
 * Strategy: Wire-level (fetch proxy)
 * - Standard JSON body with messages[] or prompt field
 * - No binary encoding, no double-escaping
 * - ProseMirror editor state is complex — DOM pre-submit not worth the risk
 */

function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export const ClaudeAdapter: SiteAdapter = {
  id: 'claude',
  name: 'Claude',

  hostPatterns: [/claude\.ai/],

  transport: 'fetch',
  interception: 'wire',

  apiPatterns: [
    /claude\.ai\/api/,
    /api\.anthropic\.com\/v1\/messages/,
  ],

  fileUploadPatterns: [/claude\.ai\/api\/convert_document/],

  skipFetchProxy: false,
  skipXhrProxy: false,

  inputSelectors: [
    '[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]',
  ],

  submitSelectors: [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'fieldset button[type="button"]:last-child',
  ],

  responseSelectors: [
    '[data-is-streaming]',
    '.font-claude-message',
  ],

  extractPrompt(body: string): string | null {
    try {
      const parsed = JSON.parse(body);

      // Anthropic API: { messages: [{ role, content }] }
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        const lastUser = [...parsed.messages].reverse().find(
          (m: any) => m.role === 'user'
        );
        if (lastUser) {
          if (typeof lastUser.content === 'string') return lastUser.content;
          if (Array.isArray(lastUser.content)) {
            return lastUser.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
          }
        }
      }

      // Claude web: { prompt }
      if (typeof parsed?.prompt === 'string') return parsed.prompt;

      return null;
    } catch {
      return null;
    }
  },

  replacePrompt(body: string, original: string, replacement: string): string | null {
    try {
      const parsed = JSON.parse(body);

      if (parsed?.messages && Array.isArray(parsed.messages)) {
        for (let i = parsed.messages.length - 1; i >= 0; i--) {
          if (parsed.messages[i].role === 'user') {
            const msg = parsed.messages[i];
            if (typeof msg.content === 'string') { msg.content = replacement; }
            else if (Array.isArray(msg.content)) {
              const textParts = msg.content.filter((c: any) => c.type === 'text');
              if (textParts.length > 0) textParts[0].text = replacement;
            }
            break;
          }
        }
        return JSON.stringify(parsed);
      }

      if (typeof parsed?.prompt === 'string') {
        parsed.prompt = replacement;
        return JSON.stringify(parsed);
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
    // ProseMirror paragraph structure
    const paragraphs = el.querySelectorAll('p');
    if (paragraphs.length > 0) {
      return Array.from(paragraphs).map(p => p.textContent || '').join('\n').trim();
    }
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
    return !!(
      document.querySelector('[data-is-streaming="true"]') ||
      document.querySelector('button[aria-label="Stop Response"]')
    );
  },

  isWsEndpoint(url: string): boolean {
    return /claude\.ai/.test(url);
  },

  extractFromWsFrame(frame: string): string | null {
    // Claude.ai WebSocket messages are JSON text frames
    try {
      const parsed = JSON.parse(frame);

      // Anthropic messages format within WS
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        const lastUser = [...parsed.messages].reverse().find(
          (m: any) => m.role === 'user'
        );
        if (lastUser) {
          if (typeof lastUser.content === 'string') return lastUser.content;
          if (Array.isArray(lastUser.content)) {
            return lastUser.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
          }
        }
      }

      // Direct prompt field
      if (typeof parsed?.prompt === 'string' && parsed.prompt.length > 5) return parsed.prompt;
      if (typeof parsed?.text === 'string' && parsed.text.length > 10) return parsed.text;

      return null;
    } catch {
      return null;
    }
  },

  replaceInWsFrame(frame: string, original: string, replacement: string): string | null {
    // Claude WS frames are JSON — reconstruct properly
    try {
      const parsed = JSON.parse(frame);

      if (parsed?.messages && Array.isArray(parsed.messages)) {
        for (let i = parsed.messages.length - 1; i >= 0; i--) {
          if (parsed.messages[i].role === 'user') {
            const msg = parsed.messages[i];
            if (typeof msg.content === 'string') { msg.content = replacement; }
            else if (Array.isArray(msg.content)) {
              const textParts = msg.content.filter((c: any) => c.type === 'text');
              if (textParts.length > 0) textParts[0].text = replacement;
            }
            break;
          }
        }
        return JSON.stringify(parsed);
      }

      if (typeof parsed?.prompt === 'string') {
        parsed.prompt = replacement;
        return JSON.stringify(parsed);
      }

      // JSON-escaped string replacement fallback
      if (original.length >= 20) {
        const escaped = jsonStringEscape(original);
        const escapedRepl = jsonStringEscape(replacement);
        if (frame.includes(escaped)) return frame.replace(escaped, escapedRepl);
      }
      return null;
    } catch {
      return null;
    }
  },
};
