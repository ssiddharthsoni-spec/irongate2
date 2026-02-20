// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const PoeDetector: AIToolDetector = {
  id: 'poe',
  name: 'Poe',
  urlPatterns: [/poe\.com/],

  getPromptInput() {
    return (
      document.querySelector('textarea.GrowingTextArea_textArea__ZWQbP') as HTMLElement | null ??
      document.querySelector('textarea[class*="TextArea"]') as HTMLElement | null ??
      document.querySelector('textarea') as HTMLElement | null
    );
  },

  getSubmitTrigger() {
    return (
      document.querySelector('button[class*="sendButton"]') as HTMLElement | null ??
      document.querySelector('button[aria-label="Send message"]') as HTMLElement | null
    );
  },

  extractPromptText(input: HTMLElement): string {
    if (input instanceof HTMLTextAreaElement) {
      return input.value.trim();
    }
    return input.innerText?.trim() || input.textContent?.trim() || '';
  },

  getResponseContainer() {
    const responses = document.querySelectorAll('[class*="Message_botMessageBubble"]');
    return (responses[responses.length - 1] as HTMLElement) ?? null;
  },

  isGenerating() {
    return !!(
      document.querySelector('[class*="StopButton"]') ??
      document.querySelector('button[aria-label="Stop message"]')
    );
  },
};
