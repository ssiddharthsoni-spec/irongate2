import type { SiteAdapter } from './base';
import { defaultIsValidPromptInput as isValidInput } from './base';

/**
 * Mistral Chat Adapter — chat.mistral.ai
 *
 * Transport: Fetch POST to `/api/v1/chat`. OpenAI-compatible SSE streaming.
 * Strategy: Wire-level (fetch proxy).
 */

function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export const MistralAdapter: SiteAdapter = {
  id: 'mistral',
  name: 'Mistral',

  hostPatterns: [/chat\.mistral\.ai/],
  transport: 'fetch',
  interception: 'wire',
  responseStreamStrategy: 'sse-content',

  apiPatterns: [/chat\.mistral\.ai\/api/],
  fileUploadPatterns: [/chat\.mistral\.ai\/api\/v\d+\/files/],
  skipFetchProxy: false,
  skipXhrProxy: false,

  inputSelectors: [
    'textarea[placeholder*="Ask" i]',
    'textarea[placeholder*="message" i]',
    '[contenteditable="true"][role="textbox"]',
    'textarea',
  ],
  submitSelectors: [
    'button[type="submit"]',
    'button[aria-label="Send" i]',
    'button[aria-label="Submit" i]',
  ],
  responseSelectors: ['[data-message-author-role="assistant"]', '.prose'],

  // OpenAI-compatible delta format
  extractResponseContent(parsed: any) {
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') return { mode: 'delta' as const, content: delta };
    // Mistral sometimes uses `message.content` on a final-event frame
    const msg = parsed?.choices?.[0]?.message?.content;
    if (typeof msg === 'string') return { mode: 'accumulated' as const, content: msg };
    return null;
  },
  injectResponseContent(parsed: any, _mode: 'accumulated' | 'delta', content: string) {
    if (parsed?.choices?.[0]?.delta?.content !== undefined) {
      parsed.choices[0].delta.content = content;
      return;
    }
    if (parsed?.choices?.[0]?.message?.content !== undefined) {
      parsed.choices[0].message.content = content;
    }
  },

  extractPrompt(body: string): string | null {
    try {
      const p = JSON.parse(body);
      if (typeof p?.prompt === 'string') return p.prompt;
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
    for (const sel of this.inputSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el && isValidInput(el)) return el;
    }
    const fallback = Array.from(
      document.querySelectorAll('textarea, [contenteditable="true"]'),
    ).find(isValidInput) as HTMLElement | undefined;
    return fallback ?? null;
  },
  findSubmitButton(): HTMLElement | null {
    for (const sel of this.submitSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) return el;
    }
    return null;
  },
  isGenerating(): boolean {
    return !!(
      document.querySelector('button[aria-label="Stop" i]') ||
      document.querySelector('[data-testid="stop-generating"]')
    );
  },
};
