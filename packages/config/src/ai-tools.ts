import type { AIToolId } from '@iron-gate/types';

export const AI_TOOL_ENDPOINTS: Record<AIToolId, string[]> = {
  chatgpt: ['https://chatgpt.com', 'https://chat.openai.com'],
  claude: ['https://claude.ai'],
  gemini: ['https://gemini.google.com'],
  copilot: ['https://copilot.microsoft.com'],
  deepseek: ['https://chat.deepseek.com'],
  poe: ['https://poe.com'],
  perplexity: ['https://perplexity.ai'],
  you: ['https://you.com'],
  huggingface: ['https://huggingface.co/chat'],
  groq: ['https://groq.com'],
  generic: [],
};

/** API patterns to detect in fetch interception */
export const AI_TOOL_API_PATTERNS: Record<string, RegExp[]> = {
  openai: [
    /api\.openai\.com\/v1\/chat\/completions/,
    /chatgpt\.com\/backend-api\/conversation/,
  ],
  anthropic: [
    /api\.anthropic\.com\/v1\/messages/,
    /claude\.ai\/api/,
  ],
  google: [
    /generativelanguage\.googleapis\.com/,
    /gemini\.google\.com\/app\/_\/api/,
  ],
  microsoft: [
    /copilot\.microsoft\.com\/c\/api/,
    /sydney\.bing\.com\/sydney/,
  ],
  deepseek: [
    /chat\.deepseek\.com\/api/,
  ],
};
