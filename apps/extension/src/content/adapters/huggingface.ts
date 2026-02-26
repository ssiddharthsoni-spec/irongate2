import type { SiteAdapter } from './base';

/**
 * HuggingFace Chat Adapter — huggingface.co/chat
 *
 * Transport: Fetch POST to /chat/{id}/message. SSE streaming.
 * Strategy: Wire-level (fetch proxy)
 */

function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export const HuggingFaceAdapter: SiteAdapter = {
  id: 'huggingface',
  name: 'HuggingFace Chat',

  hostPatterns: [/huggingface\.co/],
  transport: 'fetch',
  interception: 'wire',

  apiPatterns: [/huggingface\.co\/chat\/.*\/message/],
  fileUploadPatterns: [/huggingface\.co\/chat\/.*\/upload/, /huggingface\.co\/chat\/.*\/file/],
  skipFetchProxy: false,
  skipXhrProxy: false,

  inputSelectors: ['textarea', 'div[contenteditable="true"]'],
  submitSelectors: ['button[type="submit"]', 'button[aria-label*="send" i]'],
  responseSelectors: ['.prose', '.markdown-body', '[class*="assistant"]'],

  extractPrompt(body: string): string | null {
    try {
      const p = JSON.parse(body);
      if (typeof p?.inputs === 'string') return p.inputs;
      if (typeof p?.text === 'string' && p.text.length > 5) return p.text;
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
      if (typeof p?.inputs === 'string') { p.inputs = replacement; return JSON.stringify(p); }
      if (typeof p?.text === 'string' && p.text.length > 5) { p.text = replacement; return JSON.stringify(p); }
      if (typeof p?.prompt === 'string') { p.prompt = replacement; return JSON.stringify(p); }
      if (p?.messages && Array.isArray(p.messages)) {
        for (let i = p.messages.length - 1; i >= 0; i--) {
          if (p.messages[i].role === 'user' && typeof p.messages[i].content === 'string') {
            p.messages[i].content = replacement; break;
          }
        }
        return JSON.stringify(p);
      }
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
