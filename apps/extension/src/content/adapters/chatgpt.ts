import type { SiteAdapter } from './base';

/**
 * ChatGPT Adapter — chatgpt.com, chat.openai.com
 *
 * Transport: Fetch POST to /backend-api/conversation (auth) or /backend-anon/conversation (anon)
 *            SSE streaming responses
 *
 * Strategy: Wire (fetch body modification)
 * - Modify the fetch request body, NOT the ProseMirror editor
 * - The user's message bubble shows the ORIGINAL text (from React state)
 * - Pseudonymized text is only in the HTTP body sent to OpenAI
 * - Response stream is de-pseudonymized before React renders it
 * - Eliminates flicker caused by DOM de-pseudonymizer fighting React re-renders
 */

function jsonStringEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export const ChatGPTAdapter: SiteAdapter = {
  id: 'chatgpt',
  name: 'ChatGPT',

  hostPatterns: [/chatgpt\.com/, /chat\.openai\.com/],

  transport: 'fetch',
  interception: 'wire',

  apiPatterns: [
    /chatgpt\.com\/backend-api\/conversation/,
    /chat\.openai\.com\/backend-api\/conversation/,
    /\/backend-api\/conversation/,
    /\/backend-anon\/conversation/,
    /api\.openai\.com\/v1\/chat\/completions/,
  ],

  fileUploadPatterns: [/\/backend-api\/files/, /files\.oaiusercontent\.com/],

  skipFetchProxy: false, // Fetch proxy handles request pseudonymization
  skipXhrProxy: false,

  inputSelectors: [
    '#prompt-textarea',
    'div[contenteditable="true"][id*="prompt"]',
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"].ProseMirror',
    'textarea[data-id="root"]',
  ],

  submitSelectors: [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
  ],

  responseSelectors: [
    '[data-message-author-role="assistant"]',
    '[class*="markdown"]',
    '[class*="result-streaming"]',
    '.agent-turn',
    'article',
    '[class*="prose"]',
    'main [class*="text-base"]',
    // User messages (for notice stripping)
    '[data-message-author-role="user"]',
    '.whitespace-pre-wrap',
  ],

  extractPrompt(body: string): string | null {
    try {
      const parsed = JSON.parse(body);

      // ChatGPT backend: { messages: [{ content: { parts: [...] } }] }
      if (parsed?.messages?.[0]?.content?.parts) {
        const last = parsed.messages[parsed.messages.length - 1];
        if (last?.content?.parts) return last.content.parts.join('\n');
        return parsed.messages[0].content.parts.join('\n');
      }

      // OpenAI API: { messages: [{ role, content }] }
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        const lastUser = [...parsed.messages].reverse().find(
          (m: any) => m.role === 'user' || m.author === 'user' || m.author?.role === 'user'
        );
        if (lastUser) {
          if (typeof lastUser.content === 'string') return lastUser.content;
          if (typeof lastUser.text === 'string') return lastUser.text;
          if (Array.isArray(lastUser.content)) {
            return lastUser.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  },

  replacePrompt(body: string, original: string, replacement: string): string | null {
    try {
      const parsed = JSON.parse(body);

      // ChatGPT backend format
      if (parsed?.messages?.[0]?.content?.parts) {
        const lastIdx = parsed.messages.length - 1;
        const lastMsg = parsed.messages[lastIdx];
        if (lastMsg?.content?.parts) {
          lastMsg.content.parts = [replacement];
        } else if (lastMsg) {
          // Last message lacks content.parts — set content directly
          lastMsg.content = { content_type: 'text', parts: [replacement] };
        }
        return JSON.stringify(parsed);
      }

      // OpenAI API format
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        for (let i = parsed.messages.length - 1; i >= 0; i--) {
          const msg = parsed.messages[i];
          if (msg.role === 'user' || msg.author === 'user' || msg.author?.role === 'user') {
            if (typeof msg.content === 'string') {
              msg.content = replacement;
            } else if (typeof msg.text === 'string') {
              msg.text = replacement;
            } else if (Array.isArray(msg.content)) {
              const textParts = msg.content.filter((c: any) => c.type === 'text');
              if (textParts.length > 0) textParts[0].text = replacement;
            }
            break;
          }
        }
        return JSON.stringify(parsed);
      }

      // Generic fallback: string replacement
      if (original.length >= 20) {
        const escaped = jsonStringEscape(original);
        const escapedRepl = jsonStringEscape(replacement);
        if (body.includes(escaped)) {
          return body.replace(escaped, escapedRepl);
        }
      }

      return null;
    } catch {
      return null;
    }
  },

  readInput(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement) return el.value.trim();
    return (el.innerText || el.textContent || '').trim();
  },

  writeInput(el: HTMLElement, text: string): boolean {
    if (el instanceof HTMLTextAreaElement) {
      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (desc?.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    // Strategy 1: execCommand (ProseMirror-compatible)
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('insertText', false, text);
      if (ok) {
        const after = this.readInput(el);
        if (after.includes(text.substring(0, 50))) return true;
      }
    }

    // Strategy 2: DataTransfer paste event
    try {
      el.focus();
      const s = window.getSelection();
      if (s) {
        const r = document.createRange();
        r.selectNodeContents(el);
        s.removeAllRanges();
        s.addRange(r);
      }
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt,
      } as any);
      el.dispatchEvent(pasteEvent);
      const after = this.readInput(el);
      if (after.includes(text.substring(0, 50))) return true;
    } catch { /* paste failed */ }

    // Strategy 3: Direct DOM manipulation
    while (el.firstChild) el.removeChild(el.firstChild);
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: text,
    }));
    return true;
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
    // Fallback: button near the textarea
    const textarea = this.findInput();
    if (textarea) {
      const form = textarea.closest('form');
      if (form) {
        const btn = form.querySelector('button[type="submit"], button:last-of-type') as HTMLElement;
        if (btn) return btn;
      }
    }
    return null;
  },

  isGenerating(): boolean {
    return !!(
      document.querySelector('button[aria-label="Stop generating"]') ||
      document.querySelector('button[data-testid="stop-button"]')
    );
  },

  getConversationId(): string | null {
    // ChatGPT URL format: /c/UUID
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  },

  isWsEndpoint(url: string): boolean {
    return /chatgpt\.com|chat\.openai\.com/.test(url);
  },

  extractFromWsFrame(frame: string): string | null {
    // ChatGPT 5.2+ uses binary WebSocket frames (protobuf-like).
    // Text frames may still occur for some payloads. Try JSON extraction.
    try {
      const parsed = JSON.parse(frame);
      // Check for messages-style payload
      if (parsed?.messages?.[0]?.content?.parts) {
        const last = parsed.messages[parsed.messages.length - 1];
        if (last?.content?.parts) return last.content.parts.join('\n');
        return parsed.messages[0].content.parts.join('\n');
      }
      if (parsed?.message?.content?.parts) {
        return parsed.message.content.parts.join('\n');
      }
      // Simple text fields
      if (typeof parsed?.body === 'string' && parsed.body.length > 10) return parsed.body;
      if (typeof parsed?.text === 'string' && parsed.text.length > 10) return parsed.text;
      return null;
    } catch {
      // Not JSON — may be binary protobuf frame.
      // Try to extract readable UTF-8 text for audit (best-effort).
      const textMatch = frame.match(/[\x20-\x7E]{20,}/g);
      if (textMatch) {
        const longest = textMatch.reduce((a, b) => a.length >= b.length ? a : b);
        if (longest.length >= 20) return longest;
      }
      return null;
    }
  },

  // Binary WS frames cannot be safely modified (byte count changes corrupt protobuf).
  // Replacement is handled via DOM pre-submit: the pseudonymized text is written to the
  // ProseMirror editor BEFORE the framework builds the binary frame.
  replaceInWsFrame(): string | null {
    return null;
  },
};
