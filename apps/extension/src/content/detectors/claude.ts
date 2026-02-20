// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const ClaudeDetector: AIToolDetector = {
  id: 'claude',
  name: 'Claude',
  urlPatterns: [/claude\.ai/],

  getPromptInput() {
    // Claude uses a contenteditable div inside the prompt editor
    return (
      document.querySelector('[contenteditable="true"].ProseMirror') as HTMLElement | null ??
      document.querySelector('div[contenteditable="true"]') as HTMLElement | null
    );
  },

  getSubmitTrigger() {
    return (
      document.querySelector('button[aria-label="Send Message"]') as HTMLElement | null ??
      document.querySelector('button[aria-label="Send message"]') as HTMLElement | null ??
      // Fallback: look for the send button near the input area
      document.querySelector('fieldset button[type="button"]:last-child') as HTMLElement | null
    );
  },

  extractPromptText(input: HTMLElement): string {
    // Claude uses ProseMirror which may have paragraph elements
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
    // Claude response blocks
    const responses = document.querySelectorAll('[data-is-streaming]');
    if (responses.length > 0) {
      return responses[responses.length - 1] as HTMLElement;
    }
    // Fallback: look for assistant message containers
    const messages = document.querySelectorAll('.font-claude-message');
    return (messages[messages.length - 1] as HTMLElement) ?? null;
  },

  isGenerating() {
    return !!(
      document.querySelector('[data-is-streaming="true"]') ??
      document.querySelector('button[aria-label="Stop Response"]')
    );
  },
};
