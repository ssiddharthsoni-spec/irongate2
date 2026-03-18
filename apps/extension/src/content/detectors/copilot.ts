// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const CopilotDetector: AIToolDetector = {
  id: 'copilot',
  name: 'Microsoft Copilot',
  urlPatterns: [/copilot\.microsoft\.com/],

  getPromptInput() {
    // Match adapters/copilot.ts selectors — #userInput is the primary ID
    // First try standard DOM selectors
    const standard =
      document.querySelector('#userInput') as HTMLElement | null ??
      document.querySelector('#searchbox') as HTMLElement | null ??
      document.querySelector('textarea[placeholder]') as HTMLElement | null ??
      document.querySelector('[class*="text-input"] textarea') as HTMLElement | null ??
      document.querySelector('[class*="chat-input"] textarea') as HTMLElement | null ??
      document.querySelector('[class*="composer"] textarea') as HTMLElement | null ??
      document.querySelector('[class*="composer"] [contenteditable="true"]') as HTMLElement | null ??
      document.querySelector('div[contenteditable="true"]') as HTMLElement | null ??
      document.querySelector('textarea') as HTMLElement | null;
    if (standard) return standard;

    // Pierce Shadow DOM: Copilot Web Components (cib-*) use shadow roots
    try {
      const serp = document.querySelector('cib-serp');
      if (serp?.shadowRoot) {
        const bar = serp.shadowRoot.querySelector('cib-action-bar');
        if (bar?.shadowRoot) {
          const textarea = bar.shadowRoot.querySelector('textarea') as HTMLElement | null;
          if (textarea) return textarea;
          const ce = bar.shadowRoot.querySelector('[contenteditable="true"]') as HTMLElement | null;
          if (ce) return ce;
        }
      }
    } catch { /* shadow DOM not available */ }

    // Generic shadow DOM walk — find any textarea/contenteditable in open shadow roots
    try {
      const allElements = document.querySelectorAll('*');
      for (let i = 0; i < allElements.length; i++) {
        const sr = (allElements[i] as HTMLElement).shadowRoot;
        if (sr) {
          const textarea = sr.querySelector('textarea') as HTMLElement | null;
          if (textarea) return textarea;
          const ce = sr.querySelector('[contenteditable="true"]') as HTMLElement | null;
          if (ce) return ce;
        }
      }
    } catch { /* shadow DOM walk failed */ }

    return null;
  },

  getSubmitTrigger() {
    return (
      document.querySelector('button[aria-label="Submit"]') as HTMLElement | null ??
      document.querySelector('button[aria-label="Send"]') as HTMLElement | null
    );
  },

  extractPromptText(input: HTMLElement): string {
    if (input instanceof HTMLTextAreaElement) {
      return input.value.trim();
    }
    return input.innerText?.trim() || input.textContent?.trim() || '';
  },

  getResponseContainer() {
    const responses = document.querySelectorAll('.ac-container');
    return (responses[responses.length - 1] as HTMLElement) ?? null;
  },

  isGenerating() {
    return !!(
      document.querySelector('[aria-label="Stop Responding"]') ??
      document.querySelector('.typing-indicator')
    );
  },
};
