// Last verified: 2025-05-01
import { AIToolDetector } from './types';

/** Reject elements inside conversation response containers to avoid reading old messages */
function _isInsideResponse(el: HTMLElement): boolean {
  return !!(
    el.closest('model-response') ||
    el.closest('.response-container') ||
    el.closest('.conversation-container message-content') ||
    el.closest('[data-content-type="response"]')
  );
}

export const GeminiDetector: AIToolDetector = {
  id: 'gemini',
  name: 'Gemini',
  urlPatterns: [/gemini\.google\.com/],

  getPromptInput() {
    // Gemini uses a rich text editor — try specific selectors first,
    // then fall back to generic contenteditable with role="textbox".
    // Must match the selectors in adapters/gemini.ts.
    //
    // CRITICAL: In multi-turn conversations, Gemini may have multiple
    // .ql-editor elements (in response containers, editable code blocks, etc.).
    // We must reject any element inside a conversation response and prefer the
    // LAST match (the input box is always at the bottom of the page).
    const selectors = [
      '.ql-editor[contenteditable="true"]',
      'rich-textarea .ql-editor',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][aria-label]',
      'input-area [contenteditable="true"]',
      '.text-input-field [contenteditable="true"]',
      'p[data-placeholder]',
      'textarea',
    ];
    for (const sel of selectors) {
      // Use querySelectorAll and pick the LAST match that isn't inside a
      // conversation response container. The input box is always at the
      // bottom, so the last match is the safest bet.
      const all = document.querySelectorAll(sel);
      for (let i = all.length - 1; i >= 0; i--) {
        const el = all[i] as HTMLElement;
        if (_isInsideResponse(el)) continue;
        return el;
      }
    }
    // Last resort — generic contenteditable, but only if it looks like an input
    // (has some reasonable size and is visible)
    const allCE = document.querySelectorAll('div[contenteditable="true"]');
    for (let i = allCE.length - 1; i >= 0; i--) {
      const el = allCE[i] as HTMLElement;
      if (_isInsideResponse(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height > 20 && rect.height < 500 && rect.width > 200) {
        return el;
      }
    }
    return null;
  },

  getSubmitTrigger() {
    return (
      document.querySelector('button[aria-label="Send message"]') as HTMLElement | null ??
      document.querySelector('button[aria-label*="send" i]') as HTMLElement | null ??
      document.querySelector('button[aria-label*="submit" i]') as HTMLElement | null ??
      document.querySelector('.send-button') as HTMLElement | null ??
      document.querySelector('button[mattooltip*="Send" i]') as HTMLElement | null
    );
  },

  extractPromptText(input: HTMLElement): string {
    // Gemini uses Quill editor which wraps text in <p> tags
    const paragraphs = input.querySelectorAll('p');
    if (paragraphs.length > 0) {
      return Array.from(paragraphs)
        .map((p) => p.textContent?.trim() || '')
        .filter(Boolean)
        .join('\n');
    }
    return input.innerText?.trim() || input.textContent?.trim() || '';
  },

  getResponseContainer() {
    // Gemini response containers
    const responses = document.querySelectorAll('model-response');
    if (responses.length > 0) {
      return responses[responses.length - 1] as HTMLElement;
    }
    const messageContainers = document.querySelectorAll('.response-container');
    return (messageContainers[messageContainers.length - 1] as HTMLElement) ?? null;
  },

  isGenerating() {
    return !!(
      document.querySelector('.loading-indicator') ??
      document.querySelector('[aria-label="Stop"]') ??
      document.querySelector('.response-streaming')
    );
  },
};
