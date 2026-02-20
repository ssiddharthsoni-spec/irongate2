// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const ChatGPTDetector: AIToolDetector = {
  id: 'chatgpt',
  name: 'ChatGPT',
  urlPatterns: [/chatgpt\.com/, /chat\.openai\.com/],

  getPromptInput() {
    // ChatGPT uses a contenteditable div with id="prompt-textarea"
    return (
      document.querySelector('#prompt-textarea') as HTMLElement | null ??
      document.querySelector('[contenteditable="true"][data-placeholder]') as HTMLElement | null
    );
  },

  getSubmitTrigger() {
    return (
      document.querySelector('button[data-testid="send-button"]') as HTMLElement | null ??
      document.querySelector('button[aria-label="Send prompt"]') as HTMLElement | null
    );
  },

  extractPromptText(input: HTMLElement): string {
    return input.innerText?.trim() || input.textContent?.trim() || '';
  },

  getResponseContainer() {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    return (messages[messages.length - 1] as HTMLElement) ?? null;
  },

  isGenerating() {
    return !!(
      document.querySelector('button[aria-label="Stop generating"]') ??
      document.querySelector('button[data-testid="stop-button"]')
    );
  },
};
