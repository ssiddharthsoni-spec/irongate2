import type { SiteAdapter } from './base';

/**
 * Poe Adapter — poe.com
 *
 * Transport: Fetch POST to /api/* (GraphQL mutations). SSE streaming.
 * Strategy: Wire-level (fetch proxy)
 * Note: Uses CSS Modules with hash-based class names that change across deployments
 */

function jsonStringEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export const PoeAdapter: SiteAdapter = {
  id: 'poe',
  name: 'Poe',

  hostPatterns: [/poe\.com/],
  transport: 'fetch',
  interception: 'wire',
  responseStreamStrategy: 'sse-content',

  apiPatterns: [/poe\.com\/api/],
  fileUploadPatterns: [/poe\.com\/api\/gql_upload_POST/],
  skipFetchProxy: false,
  skipXhrProxy: false,

  inputSelectors: [
    'textarea[class*="TextArea"]',
    'textarea.GrowingTextArea_textArea__ZWQbP',
    'textarea',
  ],
  submitSelectors: [
    'button[class*="sendButton"]',
    'button[aria-label="Send message"]',
  ],
  responseSelectors: [
    '[class*="Message_botMessageBubble"]',
  ],

  // Poe uses GraphQL subscriptions over fetch — response shape: {"data":{"messageAdded":{"text":"..."}}}
  extractResponseContent(parsed: any) {
    const text = parsed?.data?.messageAdded?.text;
    if (typeof text === 'string') return { mode: 'accumulated' as const, content: text };
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') return { mode: 'delta' as const, content: delta };
    return null;
  },
  injectResponseContent(parsed: any, _mode: 'accumulated' | 'delta', content: string) {
    if (parsed?.data?.messageAdded?.text !== undefined) {
      parsed.data.messageAdded.text = content;
    } else if (parsed?.choices?.[0]?.delta?.content !== undefined) {
      parsed.choices[0].delta.content = content;
    }
  },

  extractPrompt(body: string): string | null {
    try {
      const p = JSON.parse(body);
      // GraphQL: { query, variables: { input: { text } } }
      if (typeof p?.variables?.input?.text === 'string') return p.variables.input.text;
      if (typeof p?.variables?.message === 'string') return p.variables.message;
      if (typeof p?.query === 'string' && p.query.length > 20 && !p.query.includes('mutation')) return p.query;
      if (typeof p?.prompt === 'string') return p.prompt;
      if (typeof p?.input === 'string') return p.input;
      // Generic: find longest string value
      return findLongestString(p, 5);
    } catch { return null; }
  },

  replacePrompt(body: string, original: string, replacement: string): string | null {
    try {
      const p = JSON.parse(body);
      if (typeof p?.variables?.input?.text === 'string') { p.variables.input.text = replacement; return JSON.stringify(p); }
      if (typeof p?.variables?.message === 'string') { p.variables.message = replacement; return JSON.stringify(p); }
      if (typeof p?.prompt === 'string') { p.prompt = replacement; return JSON.stringify(p); }
      if (typeof p?.input === 'string') { p.input = replacement; return JSON.stringify(p); }

      // Align with extractPrompt's findLongestString fallback:
      // If extraction found a value via generic search, replacement must use
      // JSON-escaped string substitution to find and replace it in the body.
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
    return !!(document.querySelector('[class*="StopButton"]') || document.querySelector('button[aria-label="Stop message"]'));
  },
};

function findLongestString(obj: any, maxDepth: number, seen?: Set<any>): string | null {
  if (maxDepth <= 0) return null;
  if (typeof obj === 'string' && obj.length >= 20) return obj;
  if (!obj || typeof obj !== 'object') return null;
  if (!seen) seen = new Set();
  if (seen.has(obj)) return null;
  seen.add(obj);
  const items = Array.isArray(obj) ? obj : Object.values(obj);
  let best: string | null = null;
  for (const item of items) { const f = findLongestString(item, maxDepth - 1, seen); if (f && (!best || f.length > best.length)) best = f; }
  return best;
}
