/**
 * Adapter Pseudonymization End-to-End Tests
 *
 * Tests extractPrompt → replacePrompt → verify round-trip for every adapter.
 * Also tests WS frame extraction/replacement for WS-based adapters.
 */

import { describe, it, expect } from 'vitest';

// Import all adapters
import { ChatGPTAdapter } from '../src/content/adapters/chatgpt';
import { ClaudeAdapter } from '../src/content/adapters/claude';
import { CopilotAdapter } from '../src/content/adapters/copilot';
import { DeepSeekAdapter } from '../src/content/adapters/deepseek';
import { GeminiAdapter } from '../src/content/adapters/gemini';
import { GroqAdapter } from '../src/content/adapters/groq';
import { HuggingFaceAdapter } from '../src/content/adapters/huggingface';
import { PerplexityAdapter } from '../src/content/adapters/perplexity';
import { PoeAdapter } from '../src/content/adapters/poe';
import { YouAdapter } from '../src/content/adapters/you';

const SENSITIVE_PROMPT = 'Please review the contract for John Smith (SSN: 123-45-6789) at Acme Corp regarding the merger with Widget Inc.';
const PSEUDONYMIZED_PROMPT = 'Please review the contract for Michael Johnson (SSN: 987-65-4321) at Globex Corp regarding the merger with Initech Ltd.';

// ─── ChatGPT ────────────────────────────────────────────────────────────────

describe('ChatGPT Adapter', () => {
  const chatgptBackendBody = JSON.stringify({
    action: 'next',
    messages: [{
      id: 'msg-1',
      author: { role: 'user' },
      content: { content_type: 'text', parts: [SENSITIVE_PROMPT] },
    }],
    model: 'gpt-4',
  });

  const openaiApiBody = JSON.stringify({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: SENSITIVE_PROMPT },
    ],
  });

  it('should extract from ChatGPT backend format', () => {
    expect(ChatGPTAdapter.extractPrompt(chatgptBackendBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from OpenAI API format', () => {
    expect(ChatGPTAdapter.extractPrompt(openaiApiBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in ChatGPT backend format', () => {
    const result = ChatGPTAdapter.replacePrompt(chatgptBackendBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.messages[0].content.parts[0]).toBe(PSEUDONYMIZED_PROMPT);
    // Verify original is gone
    expect(result).not.toContain('John Smith');
    expect(result).not.toContain('123-45-6789');
  });

  it('should replace in OpenAI API format', () => {
    const result = ChatGPTAdapter.replacePrompt(openaiApiBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.messages[1].content).toBe(PSEUDONYMIZED_PROMPT);
    // System message should be unchanged
    expect(parsed.messages[0].content).toBe('You are a helpful assistant.');
  });

  it('should round-trip: extract → replace → extract = pseudonymized', () => {
    const extracted = ChatGPTAdapter.extractPrompt(chatgptBackendBody);
    expect(extracted).toBe(SENSITIVE_PROMPT);
    const replaced = ChatGPTAdapter.replacePrompt(chatgptBackendBody, extracted!, PSEUDONYMIZED_PROMPT);
    const reExtracted = ChatGPTAdapter.extractPrompt(replaced!);
    expect(reExtracted).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should identify WS endpoints', () => {
    expect(ChatGPTAdapter.isWsEndpoint!('wss://chatgpt.com/ws')).toBe(true);
    expect(ChatGPTAdapter.isWsEndpoint!('wss://chat.openai.com/ws')).toBe(true);
    expect(ChatGPTAdapter.isWsEndpoint!('wss://claude.ai/ws')).toBe(false);
  });

  it('should extract from WS JSON text frame', () => {
    const frame = JSON.stringify({
      messages: [{ content: { parts: ['Hello from WebSocket'] } }],
    });
    expect(ChatGPTAdapter.extractFromWsFrame!(frame)).toBe('Hello from WebSocket');
  });

  it('should return null for replaceInWsFrame (binary safety)', () => {
    expect(ChatGPTAdapter.replaceInWsFrame!('binary-frame', 'a', 'b')).toBeNull();
  });

  it('should handle malformed JSON gracefully', () => {
    expect(ChatGPTAdapter.extractPrompt('not json')).toBeNull();
    expect(ChatGPTAdapter.replacePrompt('not json', 'a', 'b')).toBeNull();
  });
});

// ─── Claude ─────────────────────────────────────────────────────────────────

describe('Claude Adapter', () => {
  const anthropicBody = JSON.stringify({
    model: 'claude-3-opus',
    messages: [
      { role: 'user', content: SENSITIVE_PROMPT },
    ],
  });

  const anthropicArrayContent = JSON.stringify({
    model: 'claude-3',
    messages: [
      { role: 'user', content: [{ type: 'text', text: SENSITIVE_PROMPT }] },
    ],
  });

  const claudeWebBody = JSON.stringify({ prompt: SENSITIVE_PROMPT });

  it('should extract from Anthropic messages format', () => {
    expect(ClaudeAdapter.extractPrompt(anthropicBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from array content format', () => {
    expect(ClaudeAdapter.extractPrompt(anthropicArrayContent)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from Claude web prompt field', () => {
    expect(ClaudeAdapter.extractPrompt(claudeWebBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in messages format', () => {
    const result = ClaudeAdapter.replacePrompt(anthropicBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).messages[0].content).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should replace in array content format', () => {
    const result = ClaudeAdapter.replacePrompt(anthropicArrayContent, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).messages[0].content[0].text).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should replace in prompt field', () => {
    const result = ClaudeAdapter.replacePrompt(claudeWebBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).prompt).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should round-trip extract → replace → extract', () => {
    const extracted = ClaudeAdapter.extractPrompt(anthropicBody);
    const replaced = ClaudeAdapter.replacePrompt(anthropicBody, extracted!, PSEUDONYMIZED_PROMPT);
    expect(ClaudeAdapter.extractPrompt(replaced!)).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should extract from WS frame (messages format)', () => {
    const frame = JSON.stringify({ messages: [{ role: 'user', content: 'WS test' }] });
    expect(ClaudeAdapter.extractFromWsFrame!(frame)).toBe('WS test');
  });

  it('should replace in WS frame', () => {
    const frame = JSON.stringify({ messages: [{ role: 'user', content: SENSITIVE_PROMPT }] });
    const result = ClaudeAdapter.replaceInWsFrame!(frame, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).messages[0].content).toBe(PSEUDONYMIZED_PROMPT);
  });
});

// ─── Copilot ────────────────────────────────────────────────────────────────

describe('Copilot Adapter', () => {
  const copilotBody = JSON.stringify({ message: SENSITIVE_PROMPT });
  const copilotNestedBody = JSON.stringify({ message: { text: SENSITIVE_PROMPT } });

  it('should extract from message string', () => {
    expect(CopilotAdapter.extractPrompt(copilotBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from nested message.text', () => {
    expect(CopilotAdapter.extractPrompt(copilotNestedBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in message string', () => {
    const result = CopilotAdapter.replacePrompt(copilotBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).message).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should extract from SignalR WS frame', () => {
    // SignalR format: JSON with \x1e separator
    const frame = JSON.stringify({
      type: 1,
      target: 'send',
      arguments: [{ text: 'Short' }, { text: SENSITIVE_PROMPT }],
    }) + '\x1e';
    const result = CopilotAdapter.extractFromWsFrame!(frame);
    expect(result).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in SignalR WS frame', () => {
    const frame = JSON.stringify({
      type: 1,
      target: 'send',
      arguments: [{ text: SENSITIVE_PROMPT }],
    }) + '\x1e';
    const result = CopilotAdapter.replaceInWsFrame!(frame, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(result).toContain('Michael Johnson');
    expect(result).not.toContain('John Smith');
  });

  it('should identify WS endpoints', () => {
    expect(CopilotAdapter.isWsEndpoint!('wss://copilot.microsoft.com/c/api/chat')).toBe(true);
    expect(CopilotAdapter.isWsEndpoint!('wss://sydney.bing.com/sydney')).toBe(true);
  });
});

// ─── DeepSeek ───────────────────────────────────────────────────────────────

describe('DeepSeek Adapter', () => {
  const messagesBody = JSON.stringify({
    messages: [{ role: 'user', content: SENSITIVE_PROMPT }],
  });
  const promptBody = JSON.stringify({ prompt: SENSITIVE_PROMPT });
  const queryBody = JSON.stringify({ query: SENSITIVE_PROMPT });

  it('should extract from messages format', () => {
    expect(DeepSeekAdapter.extractPrompt(messagesBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from prompt field', () => {
    expect(DeepSeekAdapter.extractPrompt(promptBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from query field', () => {
    expect(DeepSeekAdapter.extractPrompt(queryBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in messages format', () => {
    const result = DeepSeekAdapter.replacePrompt(messagesBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).messages[0].content).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should round-trip prompt field', () => {
    const extracted = DeepSeekAdapter.extractPrompt(promptBody);
    const replaced = DeepSeekAdapter.replacePrompt(promptBody, extracted!, PSEUDONYMIZED_PROMPT);
    expect(DeepSeekAdapter.extractPrompt(replaced!)).toBe(PSEUDONYMIZED_PROMPT);
  });
});

// ─── Gemini ─────────────────────────────────────────────────────────────────

describe('Gemini Adapter', () => {
  it('should return null for extractPrompt (by design — DOM only)', () => {
    const body = JSON.stringify({ messages: [{ content: 'test' }] });
    expect(GeminiAdapter.extractPrompt(body)).toBeNull();
  });

  it('should return null for replacePrompt (by design — DOM only)', () => {
    expect(GeminiAdapter.replacePrompt('body', 'a', 'b')).toBeNull();
  });
});

// ─── Groq ───────────────────────────────────────────────────────────────────

describe('Groq Adapter', () => {
  const body = JSON.stringify({
    model: 'llama-3.1-70b',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: SENSITIVE_PROMPT },
    ],
  });

  it('should extract last user message', () => {
    expect(GroqAdapter.extractPrompt(body)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace and preserve system message', () => {
    const result = GroqAdapter.replacePrompt(body, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    const parsed = JSON.parse(result!);
    expect(parsed.messages[0].content).toBe('You are helpful.');
    expect(parsed.messages[1].content).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should round-trip', () => {
    const replaced = GroqAdapter.replacePrompt(body, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(GroqAdapter.extractPrompt(replaced!)).toBe(PSEUDONYMIZED_PROMPT);
  });
});

// ─── HuggingFace ────────────────────────────────────────────────────────────

describe('HuggingFace Adapter', () => {
  const inputsBody = JSON.stringify({ inputs: SENSITIVE_PROMPT });
  const textBody = JSON.stringify({ text: SENSITIVE_PROMPT });

  it('should extract from inputs field', () => {
    expect(HuggingFaceAdapter.extractPrompt(inputsBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from text field', () => {
    expect(HuggingFaceAdapter.extractPrompt(textBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in inputs field', () => {
    const result = HuggingFaceAdapter.replacePrompt(inputsBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(JSON.parse(result!).inputs).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should round-trip', () => {
    const replaced = HuggingFaceAdapter.replacePrompt(inputsBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(HuggingFaceAdapter.extractPrompt(replaced!)).toBe(PSEUDONYMIZED_PROMPT);
  });
});

// ─── Perplexity ─────────────────────────────────────────────────────────────

describe('Perplexity Adapter', () => {
  const fetchBody = JSON.stringify({ text: SENSITIVE_PROMPT });
  const queryStrBody = JSON.stringify({ query_str: SENSITIVE_PROMPT });

  // Socket.IO frame format
  const socketFrame = `42["perplexity_ask","${SENSITIVE_PROMPT.replace(/"/g, '\\"')}",{"source":"default"}]`;

  it('should extract from fetch text field', () => {
    expect(PerplexityAdapter.extractPrompt(fetchBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from query_str field', () => {
    expect(PerplexityAdapter.extractPrompt(queryStrBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in fetch body', () => {
    const result = PerplexityAdapter.replacePrompt(fetchBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(JSON.parse(result!).text).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should extract from Socket.IO WS frame', () => {
    const result = PerplexityAdapter.extractFromWsFrame!(socketFrame);
    expect(result).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in Socket.IO WS frame with proper reconstruction', () => {
    const result = PerplexityAdapter.replaceInWsFrame!(socketFrame, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    // Should start with 42
    expect(result!.startsWith('42')).toBe(true);
    // Should be valid Socket.IO array format
    const arr = JSON.parse(result!.substring(2));
    expect(arr[0]).toBe('perplexity_ask');
    expect(arr[1]).toBe(PSEUDONYMIZED_PROMPT);
    expect(arr[2]).toEqual({ source: 'default' });
  });

  it('should round-trip Socket.IO WS frame', () => {
    const extracted = PerplexityAdapter.extractFromWsFrame!(socketFrame);
    expect(extracted).toBe(SENSITIVE_PROMPT);
    const replaced = PerplexityAdapter.replaceInWsFrame!(socketFrame, extracted!, PSEUDONYMIZED_PROMPT);
    const reExtracted = PerplexityAdapter.extractFromWsFrame!(replaced!);
    expect(reExtracted).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should identify WS endpoints', () => {
    expect(PerplexityAdapter.isWsEndpoint!('wss://www.perplexity.ai/socket.io')).toBe(true);
  });
});

// ─── Poe ────────────────────────────────────────────────────────────────────

describe('Poe Adapter', () => {
  const graphqlBody = JSON.stringify({
    query: 'mutation { sendMessage($input: SendMessageInput!) { ... } }',
    variables: { input: { text: SENSITIVE_PROMPT } },
  });

  const variablesMsgBody = JSON.stringify({
    query: 'mutation { ... }',
    variables: { message: SENSITIVE_PROMPT },
  });

  const promptBody = JSON.stringify({ prompt: SENSITIVE_PROMPT });

  it('should extract from variables.input.text', () => {
    expect(PoeAdapter.extractPrompt(graphqlBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from variables.message', () => {
    expect(PoeAdapter.extractPrompt(variablesMsgBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from prompt field', () => {
    expect(PoeAdapter.extractPrompt(promptBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in variables.input.text', () => {
    const result = PoeAdapter.replacePrompt(graphqlBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).variables.input.text).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should replace in variables.message', () => {
    const result = PoeAdapter.replacePrompt(variablesMsgBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).variables.message).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should replace in prompt field', () => {
    const result = PoeAdapter.replacePrompt(promptBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).prompt).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should handle findLongestString fallback via JSON escape', () => {
    // Body where prompt is in an unusual nested structure
    const nestedBody = JSON.stringify({
      query: 'mutation { ... }',
      variables: { data: { payload: { content: SENSITIVE_PROMPT } } },
    });
    const extracted = PoeAdapter.extractPrompt(nestedBody);
    expect(extracted).toBe(SENSITIVE_PROMPT);
    // Replacement via JSON-escaped string substitution should work
    const replaced = PoeAdapter.replacePrompt(nestedBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(replaced).not.toBeNull();
    expect(replaced).toContain('Michael Johnson');
    expect(replaced).not.toContain('John Smith');
  });

  it('should round-trip', () => {
    const extracted = PoeAdapter.extractPrompt(graphqlBody);
    const replaced = PoeAdapter.replacePrompt(graphqlBody, extracted!, PSEUDONYMIZED_PROMPT);
    expect(PoeAdapter.extractPrompt(replaced!)).toBe(PSEUDONYMIZED_PROMPT);
  });
});

// ─── You.com ────────────────────────────────────────────────────────────────

describe('You.com Adapter', () => {
  const queryBody = JSON.stringify({ query: SENSITIVE_PROMPT });
  const qBody = JSON.stringify({ q: SENSITIVE_PROMPT });

  it('should extract from query field', () => {
    expect(YouAdapter.extractPrompt(queryBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should extract from q field', () => {
    expect(YouAdapter.extractPrompt(qBody)).toBe(SENSITIVE_PROMPT);
  });

  it('should replace in query field', () => {
    const result = YouAdapter.replacePrompt(queryBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(JSON.parse(result!).query).toBe(PSEUDONYMIZED_PROMPT);
  });

  it('should round-trip', () => {
    const replaced = YouAdapter.replacePrompt(queryBody, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    expect(YouAdapter.extractPrompt(replaced!)).toBe(PSEUDONYMIZED_PROMPT);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('all adapters should handle empty string body', () => {
    const adapters = [ChatGPTAdapter, ClaudeAdapter, CopilotAdapter, DeepSeekAdapter,
      GeminiAdapter, GroqAdapter, HuggingFaceAdapter, PerplexityAdapter, PoeAdapter, YouAdapter];
    for (const adapter of adapters) {
      expect(adapter.extractPrompt('')).toBeNull();
    }
  });

  it('all adapters should handle null/undefined gracefully', () => {
    const adapters = [ChatGPTAdapter, ClaudeAdapter, CopilotAdapter, DeepSeekAdapter,
      GeminiAdapter, GroqAdapter, HuggingFaceAdapter, PerplexityAdapter, PoeAdapter, YouAdapter];
    for (const adapter of adapters) {
      expect(adapter.extractPrompt('null')).toBeNull();
      expect(adapter.extractPrompt('undefined')).toBeNull();
      expect(adapter.extractPrompt('{}')).toBeNull();
    }
  });

  it('all adapters should handle extremely long prompts', () => {
    const longPrompt = 'A'.repeat(100_000);
    const body = JSON.stringify({ messages: [{ role: 'user', content: longPrompt }] });
    // Should not throw
    expect(ClaudeAdapter.extractPrompt(body)).toBe(longPrompt);
    expect(GroqAdapter.extractPrompt(body)).toBe(longPrompt);
  });

  it('prompts with special characters should round-trip', () => {
    const specialPrompt = 'Review: "John\'s SSN is 123-45-6789"\nLine2\tTabbed\r\nCRLF\\backslash';
    const body = JSON.stringify({ messages: [{ role: 'user', content: specialPrompt }] });
    const extracted = ClaudeAdapter.extractPrompt(body);
    expect(extracted).toBe(specialPrompt);
    const replaced = ClaudeAdapter.replacePrompt(body, extracted!, 'SAFE TEXT');
    expect(ClaudeAdapter.extractPrompt(replaced!)).toBe('SAFE TEXT');
  });

  it('multi-turn conversation should only replace last user message', () => {
    const body = JSON.stringify({
      messages: [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: SENSITIVE_PROMPT },
      ],
    });
    const result = ClaudeAdapter.replacePrompt(body, SENSITIVE_PROMPT, PSEUDONYMIZED_PROMPT);
    const parsed = JSON.parse(result!);
    expect(parsed.messages[0].content).toBe('First message');
    expect(parsed.messages[1].content).toBe('Response');
    expect(parsed.messages[2].content).toBe(PSEUDONYMIZED_PROMPT);
  });
});

// ─── fileUploadPatterns Coverage ──────────────────────────────────────────────

describe('fileUploadPatterns', () => {
  const adaptersWithPatterns: Array<{
    adapter: { name: string; fileUploadPatterns?: RegExp[] };
    shouldMatch: string[];
    shouldNotMatch: string[];
  }> = [
    {
      adapter: ChatGPTAdapter,
      shouldMatch: [
        'https://chatgpt.com/backend-api/files',
        'https://chatgpt.com/backend-api/files/file-abc123/uploaded',
        'https://files.oaiusercontent.com/some-presigned-url',
      ],
      shouldNotMatch: [
        'https://chatgpt.com/backend-api/conversation',
        'https://chatgpt.com/c/abc123',
      ],
    },
    {
      adapter: ClaudeAdapter,
      shouldMatch: [
        'https://claude.ai/api/convert_document',
      ],
      shouldNotMatch: [
        'https://claude.ai/api/organizations/x/chat_conversations/y/completion',
      ],
    },
    {
      adapter: CopilotAdapter,
      shouldMatch: [
        'https://edgeservices.bing.com/images/kblob',
        'https://edgeservices.bing.com/images/kblob?bcid=abc',
      ],
      shouldNotMatch: [
        'https://copilot.microsoft.com/c/api/conversations',
      ],
    },
    {
      adapter: GeminiAdapter,
      shouldMatch: [
        'https://content-push.googleapis.com/upload/something',
      ],
      shouldNotMatch: [
        'https://gemini.google.com/app/_/api/batchexecute',
      ],
    },
    {
      adapter: PerplexityAdapter,
      shouldMatch: [
        'https://perplexity.ai/api/upload',
        'https://perplexity.ai/api/upload/file-123',
      ],
      shouldNotMatch: [
        'https://perplexity.ai/api/query',
      ],
    },
    {
      adapter: PoeAdapter,
      shouldMatch: [
        'https://poe.com/api/gql_upload_POST',
      ],
      shouldNotMatch: [
        'https://poe.com/api/gql_POST',
      ],
    },
    {
      adapter: DeepSeekAdapter,
      shouldMatch: [
        'https://chat.deepseek.com/api/v0/chat/upload',
        'https://chat.deepseek.com/api/v0/chat/upload/file-123',
      ],
      shouldNotMatch: [
        'https://chat.deepseek.com/api/v0/chat/completions',
      ],
    },
    {
      adapter: GroqAdapter,
      shouldMatch: [
        'https://api.groq.com/v1/files',
        'https://api.groq.com/v1/file/upload',
        'https://api.groq.com/openai/v1/files/upload',
      ],
      shouldNotMatch: [
        'https://api.groq.com/v1/chat/completions',
      ],
    },
    {
      adapter: HuggingFaceAdapter,
      shouldMatch: [
        'https://huggingface.co/chat/conv123/upload',
        'https://huggingface.co/chat/abc-def/file',
      ],
      shouldNotMatch: [
        'https://huggingface.co/chat/conv123/message',
      ],
    },
    {
      adapter: YouAdapter,
      shouldMatch: [
        'https://you.com/api/v2/upload',
        'https://you.com/api/file/scan',
        'https://you.com/api/import/gdrive',
      ],
      shouldNotMatch: [
        'https://you.com/api/search',
        'https://you.com/api/chat',
      ],
    },
  ];

  for (const { adapter, shouldMatch, shouldNotMatch } of adaptersWithPatterns) {
    describe(adapter.name, () => {
      it('should have fileUploadPatterns defined', () => {
        expect(adapter.fileUploadPatterns).toBeDefined();
        expect(adapter.fileUploadPatterns!.length).toBeGreaterThan(0);
      });

      for (const url of shouldMatch) {
        it(`should match: ${url}`, () => {
          const matches = adapter.fileUploadPatterns!.some(p => p.test(url));
          expect(matches).toBe(true);
        });
      }

      for (const url of shouldNotMatch) {
        it(`should NOT match: ${url}`, () => {
          const matches = adapter.fileUploadPatterns!.some(p => p.test(url));
          expect(matches).toBe(false);
        });
      }
    });
  }
});
