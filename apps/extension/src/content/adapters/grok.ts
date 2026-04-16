import type { SiteAdapter } from './base';
import { defaultIsValidPromptInput as isValidInput } from './base';

/**
 * xAI Grok Adapter — grok.com / x.com/i/grok
 *
 * Transport: Fetch POST to Grok's conversation endpoints. SSE streaming.
 * Strategy: Wire-level (fetch proxy).
 *
 * Grok exposes chat at two surfaces: the standalone grok.com site and an
 * inline panel inside x.com. Both use the same REST/SSE API under
 * `grok.com/rest/app-chat/conversations`.
 */

function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export const GrokAdapter: SiteAdapter = {
  id: 'grok',
  name: 'Grok',

  hostPatterns: [/^grok\.com$/, /^x\.com$/],
  transport: 'fetch',
  interception: 'wire',
  // OpenAI-compatible delta format
  responseStreamStrategy: 'sse-content',

  apiPatterns: [
    /grok\.com\/rest\/app-chat\/conversations/,
    /x\.com\/i\/api\/grok\//,
  ],
  fileUploadPatterns: [
    /grok\.com\/rest\/app-chat\/.*\/files/,
    /x\.com\/i\/api\/grok\/.*\/upload/,
  ],
  skipFetchProxy: false,
  skipXhrProxy: false,

  inputSelectors: [
    'textarea[placeholder*="Grok" i]',
    'textarea[placeholder*="Ask" i]',
    '[contenteditable="true"][role="textbox"]',
    'textarea',
  ],
  submitSelectors: [
    'button[aria-label="Submit" i]',
    'button[aria-label="Send" i]',
    'button[type="submit"]',
  ],
  responseSelectors: ['.response-content-markdown', '[data-testid="grok-message"]'],

  // Grok speaks OpenAI-compatible SSE deltas:
  //   data: {"result":{"response":"text"}}   (older)
  //   data: {"choices":[{"delta":{"content":"text"}}]} (newer OpenAI-compat)
  extractResponseContent(parsed: any) {
    if (typeof parsed?.result?.response === 'string') {
      return { mode: 'delta' as const, content: parsed.result.response };
    }
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') return { mode: 'delta' as const, content: delta };
    return null;
  },
  injectResponseContent(parsed: any, _mode: 'accumulated' | 'delta', content: string) {
    if (parsed?.result?.response !== undefined) {
      parsed.result.response = content;
      return;
    }
    if (parsed?.choices?.[0]?.delta?.content !== undefined) {
      parsed.choices[0].delta.content = content;
    }
  },

  extractPrompt(body: string): string | null {
    try {
      const p = JSON.parse(body);
      // Grok's conversation payload typically has `message` at the top level
      if (typeof p?.message === 'string') return p.message;
      if (typeof p?.prompt === 'string') return p.prompt;
      // OpenAI-compat messages[] fallback
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
      if (typeof p?.message === 'string') { p.message = replacement; return JSON.stringify(p); }
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
    return (el.innerText || el.textContent || '').trim();
  },
  writeInput(): boolean { return false; },
  findInput(): HTMLElement | null {
    for (const sel of this.inputSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el && isValidInput(el)) return el;
    }
    // Fallback: any visible editor on the page
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
