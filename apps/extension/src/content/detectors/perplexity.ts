// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const PerplexityDetector: AIToolDetector = {
  id: 'perplexity',
  name: 'Perplexity',
  urlPatterns: [/perplexity\.ai/],

  getPromptInput() {
    return (
      document.querySelector('textarea[placeholder*="Ask"]') as HTMLElement | null ??
      document.querySelector('textarea') as HTMLElement | null
    );
  },

  getSubmitTrigger() {
    return (
      document.querySelector('button[aria-label="Submit"]') as HTMLElement | null ??
      document.querySelector('button[type="submit"]') as HTMLElement | null
    );
  },

  extractPromptText(input: HTMLElement): string {
    if (input instanceof HTMLTextAreaElement) {
      return input.value.trim();
    }
    return input.innerText?.trim() || input.textContent?.trim() || '';
  },

  getResponseContainer() {
    const responses = document.querySelectorAll('.prose');
    return (responses[responses.length - 1] as HTMLElement) ?? null;
  },

  isGenerating() {
    return !!document.querySelector('.animate-spin');
  },
};
