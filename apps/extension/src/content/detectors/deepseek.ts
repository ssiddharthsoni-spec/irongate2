// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const DeepSeekDetector: AIToolDetector = {
  id: 'deepseek',
  name: 'DeepSeek',
  urlPatterns: [/chat\.deepseek\.com/],

  getPromptInput() {
    return (
      document.querySelector('#chat-input') as HTMLElement | null ??
      document.querySelector('textarea') as HTMLElement | null
    );
  },

  getSubmitTrigger() {
    return (
      document.querySelector('#chat-input-send-btn') as HTMLElement | null ??
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
    const responses = document.querySelectorAll('.markdown-body');
    return (responses[responses.length - 1] as HTMLElement) ?? null;
  },

  isGenerating() {
    return !!(
      document.querySelector('.stop-generating') ??
      document.querySelector('[aria-label="Stop generating"]')
    );
  },
};
