import { AIToolDetector } from './types';
import { ChatGPTDetector } from './chatgpt';
import { ClaudeDetector } from './claude';
import { GeminiDetector } from './gemini';
import { CopilotDetector } from './copilot';
import { DeepSeekDetector } from './deepseek';
import { PerplexityDetector } from './perplexity';
import { PoeDetector } from './poe';
import { GenericDetector } from './generic';

export type { AIToolDetector };

const detectors: AIToolDetector[] = [
  ChatGPTDetector,
  ClaudeDetector,
  GeminiDetector,
  CopilotDetector,
  DeepSeekDetector,
  PerplexityDetector,
  PoeDetector,
];

/**
 * Detects which AI tool is active on the current page.
 * Returns the matching detector or null if no AI tool is detected.
 */
export function detectAITool(url: string): AIToolDetector | null {
  for (const detector of detectors) {
    if (detector.urlPatterns.some((pattern) => pattern.test(url))) {
      return detector;
    }
  }

  // Fallback: try generic detection via DOM heuristics
  if (GenericDetector.detectsChatUI()) {
    return GenericDetector;
  }

  return null;
}

/**
 * Returns all registered detectors (for testing/admin purposes).
 */
export function getAllDetectors(): AIToolDetector[] {
  return [...detectors, GenericDetector];
}
