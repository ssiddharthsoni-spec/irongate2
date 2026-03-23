import type { SiteAdapter } from './base';

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

  fileUploadPatterns: [/content-push\.googleapis\.com\/upload/],

  responseStreamStrategy: 'none',  // DOM pre-submit, no wire response
  skipFetchProxy: true,  // batchexecute body is opaque
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

  // Not used for Gemini (DOM pre-submit only, no wire extraction)
  extractPrompt(_body: string): string | null {
    return null;
  },

  replacePrompt(_body: string, _original: string, _replacement: string): string | null {
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
    // Light DOM first
    for (const sel of this.inputSelectors) {
      try {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) return el;
      } catch { /* invalid selector */ }
    }
    // Shadow DOM
    for (const sel of this.inputSelectors) {
      const el = deepQuery(document, sel);
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
