import type { SiteAdapter } from './base';

/**
 * DeepSeek Adapter — chat.deepseek.com
 *
 * Transport: Fetch POST to /api/*. Standard JSON body. SSE streaming.
 * Strategy: Wire-level (fetch proxy) — simplest platform to support
 */

function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export const DeepSeekAdapter: SiteAdapter = {
  id: 'deepseek',
  name: 'DeepSeek',

  hostPatterns: [/chat\.deepseek\.com/],
  transport: 'fetch',
  interception: 'wire',

  apiPatterns: [/chat\.deepseek\.com\/api/],
  fileUploadPatterns: [/chat\.deepseek\.com\/api\/v0\/chat\/upload/],
  skipFetchProxy: false,
  skipXhrProxy: false,

  inputSelectors: ['#chat-input', 'textarea'],
  submitSelectors: ['#chat-input-send-btn', 'button[aria-label="Send"]'],
  responseSelectors: ['.markdown-body'],

  extractPrompt(body: string): string | null {
    try {
      const p = JSON.parse(body);
      if (typeof p?.prompt === 'string') return p.prompt;
      if (typeof p?.query === 'string') return p.query;
      if (typeof p?.input === 'string') return p.input;
      if (p?.messages && Array.isArray(p.messages)) {
        const last = [...p.messages].reverse().find((m: any) => m.role === 'user');
        if (last && typeof last.content === 'string') return last.content;
      }
      return null;
    } catch { return null; }
  },

  replacePrompt(body: string, original: string, replacement: string): string | null {
    try {
      const p = JSON.parse(body);
      if (typeof p?.prompt === 'string') { p.prompt = replacement; return JSON.stringify(p); }
      if (typeof p?.query === 'string') { p.query = replacement; return JSON.stringify(p); }
      if (typeof p?.input === 'string') { p.input = replacement; return JSON.stringify(p); }
      if (p?.messages && Array.isArray(p.messages)) {
        for (let i = p.messages.length - 1; i >= 0; i--) {
          if (p.messages[i].role === 'user' && typeof p.messages[i].content === 'string') {
            p.messages[i].content = replacement; break;
          }
        }
        return JSON.stringify(p);
      }
      if (original.length >= 10) {
        const esc = jsonStringEscape(original);
        if (body.includes(esc)) return body.replace(esc, jsonStringEscape(replacement));
      }
      return null;
    } catch { return null; }
  },

  readInput(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement) return el.value.trim();
    return (el.innerText || el.textContent || '').trim();
  },
  writeInput(): boolean { return false; },
  findInput(): HTMLElement | null {
    for (const s of this.inputSelectors) { const el = document.querySelector(s) as HTMLElement; if (el) return el; }
    return null;
  },
  findSubmitButton(): HTMLElement | null {
    for (const s of this.submitSelectors) { const el = document.querySelector(s) as HTMLElement; if (el) return el; }
    return null;
  },
  isGenerating(): boolean {
    return !!(document.querySelector('.stop-generating') || document.querySelector('button[aria-label="Stop generating"]'));
  },
};
