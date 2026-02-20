// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const CopilotDetector: AIToolDetector = {
  id: 'copilot',
  name: 'Microsoft Copilot',
  urlPatterns: [/copilot\.microsoft\.com/],

  getPromptInput() {
    return (
      document.querySelector('#searchbox') as HTMLElement | null ??
      document.querySelector('textarea[placeholder]') as HTMLElement | null ??
      document.querySelector('[contenteditable="true"]') as HTMLElement | null
    );
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
