import type { SiteAdapter } from './base';

/**
 * You.com Adapter — you.com
 *
 * Transport: Fetch POST to /api/*. Standard JSON.
 * Strategy: Wire-level (fetch proxy)
 */

function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export const YouAdapter: SiteAdapter = {
  id: 'you',
  name: 'You.com',

  hostPatterns: [/you\.com/],
  transport: 'fetch',
  interception: 'wire',

  apiPatterns: [/you\.com\/api/],
  fileUploadPatterns: [/you\.com\/api\/.*upload/, /you\.com\/api\/.*file/, /you\.com\/api\/.*import/],
  skipFetchProxy: false,
  skipXhrProxy: false,

  inputSelectors: ['textarea', 'input[type="text"]', 'div[contenteditable="true"]'],
  submitSelectors: ['button[type="submit"]', 'button[aria-label*="search" i]', 'button[aria-label*="send" i]'],
  responseSelectors: ['.prose', '[class*="answer"]', '[class*="response"]'],

  extractPrompt(body: string): string | null {
    try {
      const p = JSON.parse(body);
      if (typeof p?.query === 'string') return p.query;
      if (typeof p?.q === 'string') return p.q;
      if (typeof p?.input === 'string') return p.input;
      if (typeof p?.prompt === 'string') return p.prompt;
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
      if (typeof p?.query === 'string') { p.query = replacement; return JSON.stringify(p); }
      if (typeof p?.q === 'string') { p.q = replacement; return JSON.stringify(p); }
      if (typeof p?.input === 'string') { p.input = replacement; return JSON.stringify(p); }
      if (typeof p?.prompt === 'string') { p.prompt = replacement; return JSON.stringify(p); }
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
    if (el instanceof HTMLInputElement) return el.value.trim();
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
    return !!(document.querySelector('[class*="loading"]') || document.querySelector('.animate-spin'));
  },
};
