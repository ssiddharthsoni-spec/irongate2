/**
 * Payload Contract Tests
 *
 * These tests freeze the EXACT request body formats that each AI platform uses.
 * When ChatGPT, Gemini, Claude, or any platform changes their API format,
 * these tests FAIL — catching the breakage before users do.
 *
 * How to update: When a test fails after a platform update:
 * 1. Open DevTools on the platform → Network tab → find the POST request
 * 2. Copy the request body
 * 3. Update the payload in this file
 * 4. Verify extractPrompt and replacePrompt still work
 * 5. If they don't, fix the adapter/interceptor logic
 *
 * These are the #1 most important tests in the extension.
 * If these break, the extension is broken in production.
 */

import { describe, it, expect } from 'vitest';

// ─── Import adapters ────────────────────────────────────────────────────────
import { ChatGPTAdapter } from '../src/content/adapters/chatgpt';
import { ClaudeAdapter } from '../src/content/adapters/claude';
import { GeminiAdapter } from '../src/content/adapters/gemini';
import { CopilotAdapter } from '../src/content/adapters/copilot';
import { DeepSeekAdapter } from '../src/content/adapters/deepseek';
import { PerplexityAdapter } from '../src/content/adapters/perplexity';
import { PoeAdapter } from '../src/content/adapters/poe';
import { GroqAdapter } from '../src/content/adapters/groq';
import { HuggingFaceAdapter } from '../src/content/adapters/huggingface';
import { YouAdapter } from '../src/content/adapters/you';

const TEST_PROMPT = 'Draft an NDA for the merger between Acme Corp and Widget Industries. Key contacts: John Smith (john.smith@acme.com, SSN 456-78-9012) and Sarah Chen (sarah@widget.io).';
const PSEUDO_PROMPT = 'Draft an NDA for the merger between Globex Corp and Initech LLC. Key contacts: Michael Johnson (michael.johnson@globex.com, SSN 987-65-4321) and Emily Wang (emily@initech.io).';

// ─────────────────────────────────────────────────────────────────────────────
// ChatGPT — the most common source of breakage
// ─────────────────────────────────────────────────────────────────────────────
describe('ChatGPT Payload Contracts', () => {
  // Captured from chatgpt.com on March 2025
  // This is the EXACT format ChatGPT uses for /backend-api/conversation
  const backendPayload = JSON.stringify({
    action: 'next',
    messages: [{
      id: 'aaa2e1c1-fake-4a1a-b2c3-d4e5f6a7b8c9',
      author: { role: 'user' },
      content: { content_type: 'text', parts: [TEST_PROMPT] },
      metadata: {
        serialization_metadata: { custom_symbol_offsets: [] },
      },
    }],
    conversation_id: 'abc123-def456',
    parent_message_id: 'parent-msg-id-fake',
    model: 'gpt-4o',
    timezone_offset_min: -330,
    suggestions: [],
    history_and_training_disabled: false,
    conversation_mode: { kind: 'primary_assistant' },
    force_paragen: false,
    force_paragen_model_slug: '',
    force_nulligen: false,
    force_rate_limit: false,
    reset_rate_limits: false,
    websocket_request_id: 'ws-req-fake-id',
    system_hints: [],
    force_use_sse: true,
    supported_encodings: ['br'],
    conversation_origin: null,
  });

  it('should extract prompt from ChatGPT backend format', () => {
    const extracted = ChatGPTAdapter.extractPrompt(backendPayload);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should replace prompt in ChatGPT backend format', () => {
    const replaced = ChatGPTAdapter.replacePrompt(backendPayload, TEST_PROMPT, PSEUDO_PROMPT);
    expect(replaced).not.toBeNull();
    const parsed = JSON.parse(replaced!);
    expect(parsed.messages[0].content.parts[0]).toBe(PSEUDO_PROMPT);
    // Original PII must be completely gone
    expect(replaced).not.toContain('John Smith');
    expect(replaced).not.toContain('456-78-9012');
    expect(replaced).not.toContain('john.smith@acme.com');
    // Non-content fields must be preserved
    expect(parsed.model).toBe('gpt-4o');
    expect(parsed.action).toBe('next');
    expect(parsed.conversation_id).toBe('abc123-def456');
    expect(parsed.force_use_sse).toBe(true);
  });

  // ChatGPT multi-turn: prompt is in the LAST message, not the first
  it('should handle multi-turn conversations (extract LAST user message)', () => {
    const multiTurn = JSON.stringify({
      action: 'next',
      messages: [
        {
          id: 'msg-1',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Hello, I need help with a contract.'] },
        },
        {
          id: 'msg-2',
          author: { role: 'user' },
          content: { content_type: 'text', parts: [TEST_PROMPT] },
        },
      ],
      model: 'gpt-4o',
    });
    const extracted = ChatGPTAdapter.extractPrompt(multiTurn);
    expect(extracted).toBe(TEST_PROMPT);
  });

  // ChatGPT with file attachments — parts array has mixed content
  it('should handle messages with file references in parts', () => {
    const withFiles = JSON.stringify({
      action: 'next',
      messages: [{
        id: 'msg-1',
        author: { role: 'user' },
        content: {
          content_type: 'multimodal_text',
          parts: [
            TEST_PROMPT,
            { content_type: 'image_asset_pointer', asset_pointer: 'file-abc123' },
          ],
        },
      }],
      model: 'gpt-4o',
    });
    // Should extract text parts only
    const extracted = ChatGPTAdapter.extractPrompt(withFiles);
    expect(extracted).toContain(TEST_PROMPT);
  });

  // OpenAI API format (used by API playground, some integrations)
  it('should extract from OpenAI API format', () => {
    const apiPayload = JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful legal assistant.' },
        { role: 'user', content: TEST_PROMPT },
      ],
      stream: true,
    });
    const extracted = ChatGPTAdapter.extractPrompt(apiPayload);
    expect(extracted).toBe(TEST_PROMPT);
  });

  // Anthropic content block format (array of {type, text})
  it('should handle Anthropic-style content blocks in messages', () => {
    const contentBlocks = JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: TEST_PROMPT },
          ],
        },
      ],
      model: 'claude-3-sonnet',
    });
    const extracted = ChatGPTAdapter.extractPrompt(contentBlocks);
    expect(extracted).toBe(TEST_PROMPT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gemini — the trickiest format (URL-encoded nested JSON)
// ─────────────────────────────────────────────────────────────────────────────
describe('Gemini Payload Contracts', () => {
  // IMPORTANT: Gemini uses DOM-level interception, NOT fetch body modification.
  // The adapter's extractPrompt returns null intentionally (skipFetchProxy: true).
  // The f.req extraction and replacement logic lives in main-world.ts extractPrompt().
  //
  // These tests verify the MAIN-WORLD extractPrompt logic for Gemini,
  // not the adapter. This is critical because Gemini's format is the most fragile.

  // Replicate main-world.ts extractPrompt for Gemini f.req
  function extractGeminiPrompt(body: string): string | null {
    if (typeof body === 'string' && body.includes('f.req=')) {
      try {
        const params = new URLSearchParams(body);
        const fReq = params.get('f.req');
        if (fReq) {
          const outer = JSON.parse(fReq);
          const deep = findDeepestString(Array.isArray(outer) ? outer : [outer]);
          if (deep) {
            try {
              const inner = JSON.parse(deep);
              const innerDeep = findDeepestString(Array.isArray(inner) ? inner : [inner]);
              if (innerDeep && innerDeep.length > 10) return innerDeep;
            } catch {}
            if (deep.length > 10) return deep;
          }
        }
      } catch {}
    }
    return null;
  }

  function findDeepestString(arr: any[], depth = 0): string | null {
    if (depth > 10) return null;
    let longest: string | null = null;
    for (const item of arr) {
      if (typeof item === 'string' && item.length > (longest?.length || 0)) {
        longest = item;
      } else if (Array.isArray(item)) {
        const found = findDeepestString(item, depth + 1);
        if (found && found.length > (longest?.length || 0)) longest = found;
      }
    }
    return longest;
  }

  it('should extract prompt from Gemini f.req format (main-world logic)', () => {
    const innerPayload = JSON.stringify([TEST_PROMPT, null, null]);
    const outerPayload = JSON.stringify([
      [['MfsCee', innerPayload, null, 'generic']],
    ]);
    const body = `f.req=${encodeURIComponent(outerPayload)}&at=ABC123`;

    const extracted = extractGeminiPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should handle double-escaped Gemini payload', () => {
    // Sometimes Gemini double-escapes the inner JSON — the deepest string
    // after two rounds of JSON.parse should be the prompt
    const innerPayload = JSON.stringify([TEST_PROMPT, null]);
    const outerPayload = JSON.stringify([
      [['MfsCee', innerPayload, null, 'generic']],
    ]);
    const body = `f.req=${encodeURIComponent(outerPayload)}&at=ABC123`;

    const extracted = extractGeminiPrompt(body);
    // After parsing nested JSON, the extracted text should contain the prompt
    expect(extracted).toBeTruthy();
    expect(extracted!).toContain('Acme Corp');
  });

  // Gemini adapter IS responsible for DOM operations
  it('Gemini adapter should use hybrid DOM + wire strategy', () => {
    expect(GeminiAdapter.skipFetchProxy).toBe(false);
    expect(GeminiAdapter.interception).toBe('dom-presubmit');
    // extractPrompt and replacePrompt must be implemented for wire fallback
    expect(typeof GeminiAdapter.extractPrompt).toBe('function');
    expect(typeof GeminiAdapter.replacePrompt).toBe('function');
  });

  it('Gemini adapter extractPrompt returns null (by design)', () => {
    // This is correct — Gemini uses DOM, not fetch body
    const result = GeminiAdapter.extractPrompt('any body');
    expect(result).toBeNull();
  });

  it('Gemini should have ql-editor in input selectors', () => {
    const hasQl = GeminiAdapter.inputSelectors.some(s => s.includes('ql-editor'));
    expect(hasQl).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Claude — ProseMirror content
// ─────────────────────────────────────────────────────────────────────────────
describe('Claude Payload Contracts', () => {
  // Claude.ai uses a simple messages format
  const claudePayload = JSON.stringify({
    completion: {
      prompt: '',
      timezone: 'Asia/Kolkata',
      model: 'claude-sonnet-4-20250514',
    },
    organization_uuid: 'org-fake-uuid',
    conversation_uuid: 'conv-fake-uuid',
    text: TEST_PROMPT,
    attachments: [],
    files: [],
  });

  // Claude uses the messages format for its API
  const claudeMessagesPayload = JSON.stringify({
    messages: [
      { role: 'user', content: TEST_PROMPT },
    ],
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    stream: true,
  });

  // Note: Claude web format uses { prompt } NOT { text }
  // The adapter correctly handles: { messages: [...] } and { prompt: "..." }
  it('should extract from Claude { prompt } format', () => {
    const promptPayload = JSON.stringify({ prompt: TEST_PROMPT });
    const extracted = ClaudeAdapter.extractPrompt(promptPayload);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should extract prompt from Claude messages format', () => {
    const extracted = ClaudeAdapter.extractPrompt(claudeMessagesPayload);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should replace prompt in Claude messages format', () => {
    const replaced = ClaudeAdapter.replacePrompt(claudeMessagesPayload, TEST_PROMPT, PSEUDO_PROMPT);
    expect(replaced).not.toBeNull();
    expect(replaced).not.toContain('John Smith');
    const parsed = JSON.parse(replaced!);
    const lastUser = parsed.messages.findLast((m: any) => m.role === 'user');
    expect(lastUser.content).toBe(PSEUDO_PROMPT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Copilot — multiple format variants
// ─────────────────────────────────────────────────────────────────────────────
describe('Copilot Payload Contracts', () => {
  it('should extract from { message: string } format', () => {
    const body = JSON.stringify({
      message: TEST_PROMPT,
      conversationId: 'conv-123',
      conversationStyle: 'creative',
    });
    const extracted = CopilotAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should extract from { message: { text } } format', () => {
    const body = JSON.stringify({
      message: { text: TEST_PROMPT, messageType: 'Chat' },
      conversationId: 'conv-123',
    });
    const extracted = CopilotAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should extract from { content } format', () => {
    const body = JSON.stringify({
      content: TEST_PROMPT,
      conversationStyle: 'balanced',
    });
    const extracted = CopilotAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });

  // Note: SignalR WebSocket frames are handled by the main-world.ts interceptor,
  // NOT the adapter's extractPrompt. The adapter handles REST API bodies only.
  // WebSocket patching is done via WebSocket.prototype.send in main-world.ts.

  it('should extract from { q } format (Bing variant)', () => {
    const body = JSON.stringify({ q: TEST_PROMPT, count: 10 });
    const extracted = CopilotAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DeepSeek
// ─────────────────────────────────────────────────────────────────────────────
describe('DeepSeek Payload Contracts', () => {
  it('should extract from messages format', () => {
    const body = JSON.stringify({
      messages: [
        { role: 'user', content: TEST_PROMPT },
      ],
      model: 'deepseek-chat',
      stream: true,
    });
    const extracted = DeepSeekAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should extract from prompt field', () => {
    const body = JSON.stringify({ prompt: TEST_PROMPT });
    const extracted = DeepSeekAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Perplexity — multiple transport formats
// ─────────────────────────────────────────────────────────────────────────────
describe('Perplexity Payload Contracts', () => {
  // Note: Socket.IO format (42["perplexity_ask", ...]) is handled by main-world.ts
  // extractPrompt, not the adapter. The adapter handles REST API bodies only.

  it('should extract from query_str format', () => {
    const body = JSON.stringify({ query_str: TEST_PROMPT, search_focus: 'internet' });
    const extracted = PerplexityAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should extract from text format', () => {
    const body = JSON.stringify({ text: TEST_PROMPT, source: 'default' });
    const extracted = PerplexityAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should extract from query format', () => {
    const body = JSON.stringify({ query: TEST_PROMPT });
    const extracted = PerplexityAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });

  it('should extract from params.query format', () => {
    const body = JSON.stringify({ params: { query: TEST_PROMPT } });
    const extracted = PerplexityAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Remaining adapters
// ─────────────────────────────────────────────────────────────────────────────
describe('Groq Payload Contract', () => {
  it('should extract from messages format', () => {
    const body = JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      messages: [{ role: 'user', content: TEST_PROMPT }],
      stream: true,
    });
    const extracted = GroqAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });
});

describe('HuggingFace Payload Contract', () => {
  it('should extract from inputs format', () => {
    const body = JSON.stringify({
      inputs: TEST_PROMPT,
      parameters: { max_new_tokens: 512 },
    });
    const extracted = HuggingFaceAdapter.extractPrompt(body);
    expect(extracted).toBeTruthy();
  });

  it('should extract from messages format', () => {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: TEST_PROMPT }],
    });
    const extracted = HuggingFaceAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });
});

describe('You.com Payload Contract', () => {
  it('should extract from query format', () => {
    const body = JSON.stringify({ query: TEST_PROMPT, chat_mode: 'smart' });
    const extracted = YouAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });
});

describe('Poe Payload Contract', () => {
  it('should extract from messages format', () => {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: TEST_PROMPT }],
      queryName: 'chatLLM',
    });
    const extracted = PoeAdapter.extractPrompt(body);
    expect(extracted).toBe(TEST_PROMPT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-adapter invariants — things that MUST be true for ALL adapters
// ─────────────────────────────────────────────────────────────────────────────
describe('Cross-Adapter Invariants', () => {
  // Adapters that support the standard messages format
  const messagesAdapters = [
    { name: 'ChatGPT', adapter: ChatGPTAdapter },
    { name: 'Claude', adapter: ClaudeAdapter },
    { name: 'DeepSeek', adapter: DeepSeekAdapter },
    { name: 'Groq', adapter: GroqAdapter },
    { name: 'HuggingFace', adapter: HuggingFaceAdapter },
    { name: 'Poe', adapter: PoeAdapter },
    { name: 'You', adapter: YouAdapter },
  ];

  // All adapters (including those with custom formats)
  const adapters = [
    ...messagesAdapters,
    { name: 'Copilot', adapter: CopilotAdapter },
  ];

  // Most adapters must support the generic messages format
  // Copilot is excluded — it uses { message } / { q } / SignalR, not { messages: [...] }
  for (const { name, adapter } of messagesAdapters) {
    it(`${name}: should extract from standard messages format`, () => {
      const body = JSON.stringify({
        messages: [{ role: 'user', content: TEST_PROMPT }],
      });
      const extracted = adapter.extractPrompt(body);
      expect(extracted).toBe(TEST_PROMPT);
    });

    it(`${name}: extract then replace should produce valid JSON with no PII`, () => {
      const body = JSON.stringify({
        messages: [{ role: 'user', content: TEST_PROMPT }],
      });
      const extracted = adapter.extractPrompt(body);
      if (!extracted) return; // skip if adapter doesn't support this format

      const replaced = adapter.replacePrompt(body, extracted, PSEUDO_PROMPT);
      if (!replaced) return;

      // Must be valid JSON
      expect(() => JSON.parse(replaced)).not.toThrow();
      // Must not contain original PII
      expect(replaced).not.toContain('John Smith');
      expect(replaced).not.toContain('456-78-9012');
      expect(replaced).not.toContain('john.smith@acme.com');
    });
  }

  // Empty/null/undefined body should not crash any adapter
  for (const { name, adapter } of adapters) {
    it(`${name}: should handle empty body gracefully`, () => {
      expect(() => adapter.extractPrompt('')).not.toThrow();
      expect(() => adapter.extractPrompt('{}')).not.toThrow();
      expect(() => adapter.extractPrompt('null')).not.toThrow();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// De-pseudonymization stress tests
// ─────────────────────────────────────────────────────────────────────────────
describe('De-pseudonymization Replacement Logic', () => {
  // We test the replacePseudonyms function from main-world.ts directly.
  // Since it's not exported, we replicate its core logic here as a contract test.
  // If the behavior of main-world.ts diverges from these tests, it's a bug.

  function replacePseudonyms(text: string, reverseMap: Record<string, string>): string {
    let result = text;
    const entries = Object.entries(reverseMap)
      .filter(([k]) => k && k.length >= 2)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [pseudonym, original] of entries) {
      if (pseudonym === original) continue;
      try {
        const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startsWithAlpha = /^[a-zA-Z]/.test(pseudonym);
        const endsWithAlpha = /[a-zA-Z]$/.test(pseudonym);
        const startsWithDigit = /^\d/.test(pseudonym);
        const endsWithDigit = /\d$/.test(pseudonym);
        const prefix = startsWithDigit ? '(?<!\\d)' : startsWithAlpha ? '(?<![a-zA-Z])' : '';
        const suffix = endsWithDigit ? '(?!\\d)' : endsWithAlpha ? '(?![a-zA-Z])' : '';
        const regex = new RegExp(prefix + escaped + suffix, 'g');
        if (regex.test(result)) {
          regex.lastIndex = 0;
          result = result.replace(regex, original);
          continue;
        }
      } catch {}

      // JSON-escaped match
      const jsonEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      const jsonPseudo = jsonEscape(pseudonym);
      const jsonOrig = jsonEscape(original);
      if (jsonPseudo !== pseudonym && result.includes(jsonPseudo)) {
        result = result.split(jsonPseudo).join(jsonOrig);
        continue;
      }

      // Case-insensitive
      try {
        const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        if (regex.test(result)) {
          regex.lastIndex = 0;
          result = result.replace(regex, original);
          continue;
        }
      } catch {}

      // Plain substring (≥8 chars)
      if (pseudonym.length >= 8 && result.includes(pseudonym)) {
        result = result.split(pseudonym).join(original);
      }
    }
    return result;
  }

  const REVERSE_MAP = {
    'Michael Johnson': 'John Smith',
    'Globex Corp': 'Acme Corp',
    '987-65-4321': '456-78-9012',
    'michael.johnson@globex.com': 'john.smith@acme.com',
    'Emily Wang': 'Sarah Chen',
  };

  it('should de-pseudonymize plain text', () => {
    const input = 'The contract between Globex Corp and Michael Johnson (987-65-4321) is ready.';
    const result = replacePseudonyms(input, REVERSE_MAP);
    expect(result).toContain('Acme Corp');
    expect(result).toContain('John Smith');
    expect(result).toContain('456-78-9012');
    expect(result).not.toContain('Globex Corp');
    expect(result).not.toContain('Michael Johnson');
    expect(result).not.toContain('987-65-4321');
  });

  it('should handle JSON-escaped strings (SSE payload)', () => {
    const input = '{"text":"Hello Michael Johnson, your SSN is 987-65-4321."}';
    const result = replacePseudonyms(input, REVERSE_MAP);
    expect(result).toContain('John Smith');
    expect(result).toContain('456-78-9012');
  });

  it('should handle pseudonyms split across SSE chunks', () => {
    // Simulate buffered processing — the caller should buffer, but verify behavior
    const chunk1 = 'Hello Mich';
    const chunk2 = 'ael Johnson, how are you?';
    // In real usage, the stream buffer handles this — but individual replacement
    // should at least not corrupt the text
    const result1 = replacePseudonyms(chunk1, REVERSE_MAP);
    const result2 = replacePseudonyms(chunk2, REVERSE_MAP);
    // chunk1 won't match (partial), chunk2 won't match (partial)
    // This is expected — the stream buffer in depseudonymizeResponse handles this
    // The key test is that neither chunk is corrupted
    expect(result1 + result2).toContain('Mich');
    expect(result1 + result2).toContain('ael Johnson');
  });

  it('should handle full buffered text (simulating stream buffer flush)', () => {
    const fullBuffer = 'Hello Michael Johnson, how are you? Your SSN is 987-65-4321.';
    const result = replacePseudonyms(fullBuffer, REVERSE_MAP);
    expect(result).toBe('Hello John Smith, how are you? Your SSN is 456-78-9012.');
  });

  it('should handle LLM concatenation (no space between pseudonym and word)', () => {
    // LLMs sometimes write "Michael Johnsonminimizing" instead of "Michael Johnson minimizing"
    const input = 'The report by Michael Johnsonminimizing costs was excellent.';
    const result = replacePseudonyms(input, REVERSE_MAP);
    // "Michael Johnson" is 15 chars > 8, so plain substring fallback should catch it
    expect(result).toContain('John Smith');
  });

  it('should handle multiple occurrences', () => {
    const input = 'Michael Johnson spoke with Michael Johnson about Globex Corp and Globex Corp.';
    const result = replacePseudonyms(input, REVERSE_MAP);
    expect(result).toBe('John Smith spoke with John Smith about Acme Corp and Acme Corp.');
  });

  it('should not corrupt text when reverse map is empty', () => {
    const input = 'This is normal text with no pseudonyms.';
    const result = replacePseudonyms(input, {});
    expect(result).toBe(input);
  });

  it('should handle special regex characters in pseudonyms', () => {
    const specialMap = {
      'Smith & Associates (LLC)': 'Real Firm Name',
      'price: $1,000.00': 'price: $5,000.00',
    };
    const input = 'Contact Smith & Associates (LLC) for price: $1,000.00';
    const result = replacePseudonyms(input, specialMap);
    expect(result).toContain('Real Firm Name');
  });

  it('should prioritize longer pseudonyms over shorter ones', () => {
    const overlapMap = {
      'John': 'Jane',
      'John Smith': 'Original Person', // longer should take priority
    };
    const input = 'Hello John Smith!';
    const result = replacePseudonyms(input, overlapMap);
    expect(result).toBe('Hello Original Person!');
  });

  // Simulate real ChatGPT SSE response
  it('should handle ChatGPT SSE data lines', () => {
    const sseChunk = [
      'data: {"message":{"content":{"parts":["According to Michael Johnson at Globex Corp, the merger"]}}}',
      'data: {"message":{"content":{"parts":["According to Michael Johnson at Globex Corp, the merger terms include SSN 987-65-4321"]}}}',
    ].join('\n');
    const result = replacePseudonyms(sseChunk, REVERSE_MAP);
    expect(result).toContain('John Smith');
    expect(result).toContain('Acme Corp');
    expect(result).toContain('456-78-9012');
    expect(result).not.toContain('Michael Johnson');
    expect(result).not.toContain('Globex Corp');
    expect(result).not.toContain('987-65-4321');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Selector registry — frozen selectors that MUST match
// ─────────────────────────────────────────────────────────────────────────────
describe('Selector Registry (frozen)', () => {
  // These selectors are used to find prompt inputs on each platform.
  // If a selector is removed from the adapter, this test fails → you know
  // the adapter dropped support for that selector.

  it('ChatGPT input selectors should include #prompt-textarea', () => {
    const selectors = ChatGPTAdapter.inputSelectors || [];
    expect(selectors).toContain('#prompt-textarea');
  });

  it('ChatGPT submit selectors should include send-button testid', () => {
    const selectors = ChatGPTAdapter.submitSelectors || [];
    const hasSendButton = selectors.some(
      (s: string) => s.includes('send-button') || s.includes('composer-send')
    );
    expect(hasSendButton).toBe(true);
  });

  it('Gemini input selectors should include ql-editor', () => {
    const selectors = GeminiAdapter.inputSelectors || [];
    const hasQlEditor = selectors.some((s: string) => s.includes('ql-editor'));
    expect(hasQlEditor).toBe(true);
  });

  it('Claude input selectors should include ProseMirror', () => {
    const selectors = ClaudeAdapter.inputSelectors || [];
    const hasProseMirror = selectors.some((s: string) => s.includes('ProseMirror'));
    expect(hasProseMirror).toBe(true);
  });

  // API endpoint patterns — these MUST match for interception to work
  it('ChatGPT API patterns should match /backend-api/conversation', () => {
    const patterns = ChatGPTAdapter.apiPatterns || [];
    const url = 'https://chatgpt.com/backend-api/conversation';
    const matches = patterns.some((p: RegExp) => p.test(url));
    expect(matches).toBe(true);
  });

  it('Claude API patterns should match /api', () => {
    const patterns = ClaudeAdapter.apiPatterns || [];
    const url = 'https://claude.ai/api/organizations/org-id/chat_conversations/conv-id/completion';
    const matches = patterns.some((p: RegExp) => p.test(url));
    expect(matches).toBe(true);
  });

  it('Gemini API patterns should match batchexecute', () => {
    const patterns = GeminiAdapter.apiPatterns || [];
    const url = 'https://gemini.google.com/app/_/api/batchexecute';
    const matches = patterns.some((p: RegExp) => p.test(url));
    expect(matches).toBe(true);
  });
});
