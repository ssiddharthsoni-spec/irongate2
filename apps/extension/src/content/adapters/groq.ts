import type { SiteAdapter } from './base';

/**
 * Groq Adapter — groq.com
 *
 * Transport: Fetch POST to API. OpenAI-compatible JSON format.
 * Strategy: Wire-level (fetch proxy)
 */

function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export const GroqAdapter: SiteAdapter = {
  id: 'groq',
  name: 'Groq',

  hostPatterns: [/groq\.com/],
  transport: 'fetch',
  interception: 'wire',

  apiPatterns: [/api\.groq\.com/],
  fileUploadPatterns: [/api\.groq\.com\/.*(?:file|upload)/i],
  skipFetchProxy: false,
  skipXhrProxy: false,

  inputSelectors: ['textarea', 'div[contenteditable="true"]'],
  submitSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="submit" i]', 'button[type="submit"]'],
  responseSelectors: ['.markdown-body', '[class*="assistant"]', '.prose'],

  extractPrompt(body: string): string | null {
    try {
      const p = JSON.parse(body);
      if (p?.messages && Array.isArray(p.messages)) {
        const last = [...p.messages].reverse().find((m: any) => m.role === 'user');
        if (last && typeof last.content === 'string') return last.content;
      }
      if (typeof p?.prompt === 'string') return p.prompt;
      if (typeof p?.query === 'string') return p.query;
      return null;
    } catch { return null; }
  },

  replacePrompt(body: string, original: string, replacement: string): string | null {
    try {
      const p = JSON.parse(body);
      if (p?.messages && Array.isArray(p.messages)) {
        for (let i = p.messages.length - 1; i >= 0; i--) {
          if (p.messages[i].role === 'user' && typeof p.messages[i].content === 'string') {
            p.messages[i].content = replacement; break;
          }
        }
        return JSON.stringify(p);
      }
      if (typeof p?.prompt === 'string') { p.prompt = replacement; return JSON.stringify(p); }
      if (typeof p?.query === 'string') { p.query = replacement; return JSON.stringify(p); }
      if (original.length >= 20) {
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
    return !!(document.querySelector('[class*="loading"]') || document.querySelector('button[aria-label*="stop" i]'));
  },
};
