// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const GeminiDetector: AIToolDetector = {
  id: 'gemini',
  name: 'Gemini',
  urlPatterns: [/gemini\.google\.com/],

  getPromptInput() {
    // Gemini uses a rich text editor — try specific selectors first,
    // then fall back to generic contenteditable with role="textbox".
    // Must match the selectors in adapters/gemini.ts.
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
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) return el;
    }
    // Last resort — generic contenteditable, but only if it looks like an input
    // (has some reasonable size and is visible)
    const allCE = document.querySelectorAll('div[contenteditable="true"]');
    for (const el of allCE) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.height > 20 && rect.height < 500 && rect.width > 200) {
        return el as HTMLElement;
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
