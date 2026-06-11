import type { SiteAdapter } from './base';
import { findDeepestString } from './base';
import { jsonStringEscape } from '../main-world/depseudo-engine';
// Wire parser available but not active — DOM pre-submit is the current strategy.
// import { extractPromptFromBatchexecute, replacePromptInBatchexecute } from '../main-world/gemini-wire';

/**
 * Gemini Adapter — gemini.google.com
 *
 * Transport: Fetch/XHR POST to /_/BardChatUi/data/ or /v1beta/models/
 *            URL-encoded form body with f.req= containing double-escaped nested JSON
 *            Quill rich text editor
 *
 * Strategy: DOM pre-submit ONLY
 * - batchexecute body contains base64/encrypted data that extractPrompt misidentifies
 * - Double-escaped nested JSON is extremely fragile to modify at wire level
 * - Writing to Quill editor via execCommand is reliable
 * - Fetch/XHR proxy is explicitly SKIPPED
 */

/** Reject elements inside conversation response containers to avoid reading old messages */
function isInsideResponse(el: HTMLElement): boolean {
  return !!(
    el.closest('model-response') ||
    el.closest('.response-container') ||
    el.closest('.conversation-container message-content') ||
    el.closest('[data-content-type="response"]')
  );
}

/** Deep querySelector that pierces open Shadow DOMs */
function deepQuery(root: Document | Element | ShadowRoot, selector: string, depth = 0): HTMLElement | null {
  if (depth > 10) return null; // Prevent runaway recursion in deeply nested Shadow DOMs
  try {
    const el = root.querySelector(selector) as HTMLElement;
    if (el) return el;
  } catch { /* invalid selector */ }
  const children = root.querySelectorAll('*');
  for (let i = 0; i < children.length; i++) {
    const sr = (children[i] as any).shadowRoot;
    if (sr) {
      const found = deepQuery(sr, selector, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Deep querySelectorAll — returns LAST match not inside a response container */
function deepQueryLast(root: Document | Element | ShadowRoot, selector: string): HTMLElement | null {
  // Light DOM: get all matches, return last one not in a response
  const all = root.querySelectorAll(selector);
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i] as HTMLElement;
    if (!isInsideResponse(el)) return el;
  }
  // Shadow DOM fallback — collect all and return last safe one
  const results: HTMLElement[] = [];
  function walk(r: Document | Element | ShadowRoot, d: number) {
    if (d > 10) return;
    try {
      const matches = r.querySelectorAll(selector);
      for (const m of matches) {
        if (!isInsideResponse(m as HTMLElement)) results.push(m as HTMLElement);
      }
    } catch { /* invalid selector */ }
    const children = r.querySelectorAll('*');
    for (let i = 0; i < children.length; i++) {
      const sr = (children[i] as any).shadowRoot;
      if (sr) walk(sr, d + 1);
    }
  }
  walk(root, 0);
  return results.length > 0 ? results[results.length - 1] : null;
}

export const GeminiAdapter: SiteAdapter = {
  id: 'gemini',
  name: 'Google Gemini',

  hostPatterns: [/gemini\.google\.com/],

  transport: 'dom-only',
  interception: 'dom-presubmit',

  apiPatterns: [
    /gemini\.google\.com\/app\/_\/api/,
    /gemini\.google\.com.*\/batchexecute/,
    /gemini\.google\.com.*\/StreamGenerate/,
    /generativelanguage\.googleapis\.com/,
  ],

  // StreamGenerate is the chat send; batchexecute is the multiplexed RPC
  // channel (mixed traffic) and must not match.
  primaryEndpointPatterns: [
    /gemini\.google\.com.*\/StreamGenerate/,
  ],

  fileUploadPatterns: [/content-push\.googleapis\.com\/upload/],

  responseStreamStrategy: 'none',
  skipFetchProxy: true,
  // Quill reverts DOM writeInput; the XHR wire proxy sends the real
  // notification after verified replacement — see base.ts.
  wireConfirmsNotification: true,
  skipXhrProxy: true,

  inputSelectors: [
    '.ql-editor[contenteditable="true"]',
    'rich-textarea .ql-editor',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label]',
    'div[contenteditable="true"]',
    'textarea',
    'input-area [contenteditable="true"]',
    '.text-input-field [contenteditable="true"]',
    'p[data-placeholder]',
  ],

  submitSelectors: [
    'button[aria-label="Send message"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="submit" i]',
    'button.send-button',
    'button[data-test-id="send-button"]',
    '.send-button-container button',
    'button[mattooltip*="Send" i]',
  ],

  responseSelectors: [
    'model-response',
    '.response-container',
  ],

  usesShadowDom: true,

  // WP3: Gemini's f.req wire parsing lives HERE now (it used to hide in
  // main-world's "generic" fallbacks while this adapter claimed DOM-only —
  // the architectural lie behind the May revert ping-pong). DOM pre-submit
  // remains the primary path; these handle the XHR/fetch wire echoes.
  extractPrompt(body: string): string | null {
    // URL-encoded form body with f.req= containing nested JSON:
    // f.req=[[["MfsCee","[\"prompt text\",...]",null,"generic"]]]&at=...
    if (typeof body !== 'string' || !(body.includes('f.req=') || body.includes('f.req%3D'))) {
      return null;
    }
    try {
      const params = new URLSearchParams(body);
      const fReq = params.get('f.req');
      if (fReq) {
        const outer = JSON.parse(fReq);
        // Walk the nested arrays to find the deepest string
        const deep = findDeepestString(Array.isArray(outer) ? outer : [outer]);
        if (deep) {
          // Gemini nests JSON-in-JSON: the string might itself be a JSON array
          try {
            const inner = JSON.parse(deep);
            const innerDeep = findDeepestString(Array.isArray(inner) ? inner : [inner]);
            if (innerDeep && innerDeep.length > 10) {
              return innerDeep;
            }
          } catch { /* not JSON-in-JSON, use the string directly */ }
          if (deep.length > 10) {
            return deep;
          }
        }
      }
    } catch { /* parse failed — not extractable */ }
    return null;
  },

  replacePrompt(body: string, originalPrompt: string, replacement: string): string | null {
    // The prompt appears JSON-escaped (possibly double-escaped) inside f.req.
    // Parse, replace with matching escaping, re-encode.
    if (!(body.includes('f.req=') || body.includes('f.req%3D'))) return null;
    try {
      const params = new URLSearchParams(body);
      const fReq = params.get('f.req');
      if (fReq && originalPrompt.length >= 10) {
        // Try single JSON-escaped match (prompt inside a JSON string)
        const escapedOrig = jsonStringEscape(originalPrompt);
        const escapedRepl = jsonStringEscape(replacement);
        if (fReq.includes(escapedOrig)) {
          params.set('f.req', fReq.split(escapedOrig).join(escapedRepl));
          return params.toString();
        }
        // Try double-escaped match (JSON-in-JSON: prompt is escaped twice)
        const doubleEscapedOrig = jsonStringEscape(escapedOrig);
        const doubleEscapedRepl = jsonStringEscape(escapedRepl);
        if (fReq.includes(doubleEscapedOrig)) {
          params.set('f.req', fReq.split(doubleEscapedOrig).join(doubleEscapedRepl));
          return params.toString();
        }
        // Try raw text match (prompt appears unescaped)
        if (fReq.includes(originalPrompt)) {
          params.set('f.req', fReq.split(originalPrompt).join(replacement));
          return params.toString();
        }
      }
    } catch { /* parse failed */ }
    return null;
  },

  readInput(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value.trim();
    // Quill editor wraps text in <p> tags
    const paragraphs = el.querySelectorAll('p');
    if (paragraphs.length > 0) {
      return Array.from(paragraphs).map(p => p.textContent || '').join('\n').trim();
    }
    return (el.innerText || el.textContent || '').trim();
  },

  writeInput(el: HTMLElement, text: string): boolean {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const desc = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      );
      if (desc?.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // Verify the write succeeded
      const verifyText = el.value;
      if (!verifyText.includes(text.substring(0, 50))) {
        console.error('[Iron Gate] Gemini writeInput FAILED verification on textarea/input');
        return false;
      }
      return true;
    }

    // contenteditable — use execCommand for Quill compatibility
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

    // Direct DOM fallback
    while (el.firstChild) el.removeChild(el.firstChild);
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));

    // CRITICAL: Verify the DOM fallback actually wrote the pseudonymized text.
    // If verification fails, return false so the caller blocks the submit
    // instead of sending unprotected PII.
    const finalCheck = this.readInput(el);
    if (!finalCheck.includes(text.substring(0, 50))) {
      console.error('[Iron Gate] Gemini writeInput FAILED verification — DOM fallback did not apply');
      return false;
    }
    return true;
  },

  findInput(): HTMLElement | null {
    // CRITICAL: In multi-turn conversations, Gemini may have multiple
    // contenteditable elements (in response containers, code blocks, etc.).
    // Use deepQueryLast to get the LAST match not inside a response container.
    // The input box is always at the bottom of the page.
    for (const sel of this.inputSelectors) {
      const el = deepQueryLast(document, sel);
      if (el) return el;
    }
    return null;
  },

  findSubmitButton(): HTMLElement | null {
    // Light DOM
    for (const sel of this.submitSelectors) {
      try {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) return el;
      } catch { /* invalid selector */ }
    }
    // Shadow DOM
    for (const sel of this.submitSelectors) {
      const el = deepQuery(document, sel);
      if (el) return el;
    }
    // Fallback: button near the textarea
    const textarea = this.findInput();
    if (textarea) {
      const parent = textarea.closest('form') || textarea.closest('.input-area-container') || textarea.parentElement?.parentElement?.parentElement;
      if (parent) {
        const buttons = parent.querySelectorAll('button');
        for (const btn of buttons) {
          const lbl = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
          if (lbl.includes('send') || lbl.includes('submit')) return btn as HTMLElement;
        }
        if (buttons.length > 0) return buttons[buttons.length - 1] as HTMLElement;
      }
    }
    return null;
  },

  isGenerating(): boolean {
    return !!(
      document.querySelector('.loading-indicator') ||
      document.querySelector('[aria-label="Stop"]') ||
      document.querySelector('.response-streaming')
    );
  },
};
