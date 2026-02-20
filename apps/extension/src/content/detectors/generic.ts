// Last verified: 2025-05-01
import { AIToolDetector } from './types';

/**
 * Generic detector that uses DOM heuristics to detect unknown AI chat interfaces.
 * This is the fallback when no specific detector matches.
 */
export const GenericDetector: AIToolDetector & { detectsChatUI(): boolean } = {
  id: 'generic',
  name: 'Unknown AI Tool',
  urlPatterns: [],

  detectsChatUI(): boolean {
    // Heuristic: look for common patterns in AI chat UIs
    const hasContentEditable = !!document.querySelector('[contenteditable="true"]');
    const hasTextarea = !!document.querySelector('textarea');
    const hasSendButton = !!(
      document.querySelector('button[aria-label*="send" i]') ??
      document.querySelector('button[aria-label*="submit" i]') ??
      document.querySelector('button[type="submit"]')
    );
    const hasMessageList = !!(
      document.querySelector('[role="log"]') ??
      document.querySelector('[class*="message" i][class*="list" i]') ??
      document.querySelector('[class*="conversation" i]')
    );

    // Need at least an input method + send mechanism + message area
    return (hasContentEditable || hasTextarea) && hasSendButton && hasMessageList;
  },

  getPromptInput() {
    return (
      document.querySelector('[contenteditable="true"]') as HTMLElement | null ??
      document.querySelector('textarea') as HTMLElement | null
    );
  },

  getSubmitTrigger() {
    return (
      document.querySelector('button[aria-label*="send" i]') as HTMLElement | null ??
      document.querySelector('button[aria-label*="submit" i]') as HTMLElement | null ??
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
    // Try common patterns for AI response containers
    const selectors = [
      '[data-message-author-role="assistant"]',
      '[class*="assistant" i]',
      '[class*="bot" i][class*="message" i]',
      '[class*="response" i]',
      '.prose:last-child',
      '.markdown-body:last-child',
    ];
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        return elements[elements.length - 1] as HTMLElement;
      }
    }
    return null;
  },

  isGenerating() {
    return !!(
      document.querySelector('button[aria-label*="stop" i]') ??
      document.querySelector('[class*="loading" i]') ??
      document.querySelector('[class*="generating" i]')
    );
  },
};
