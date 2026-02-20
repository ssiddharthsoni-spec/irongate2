// Last verified: 2025-05-01
import { AIToolDetector } from './types';

export const GeminiDetector: AIToolDetector = {
  id: 'gemini',
  name: 'Gemini',
  urlPatterns: [/gemini\.google\.com/],

  getPromptInput() {
    // Gemini uses a rich text editor
    return (
      document.querySelector('.ql-editor[contenteditable="true"]') as HTMLElement | null ??
      document.querySelector('rich-textarea .ql-editor') as HTMLElement | null ??
      document.querySelector('[contenteditable="true"]') as HTMLElement | null
    );
  },

  getSubmitTrigger() {
    return (
      document.querySelector('button[aria-label="Send message"]') as HTMLElement | null ??
      document.querySelector('.send-button') as HTMLElement | null
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
