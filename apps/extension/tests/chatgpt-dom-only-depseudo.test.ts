import { describe, it, expect } from 'vitest';
import { ChatGPTAdapter } from '../src/content/adapters/chatgpt';

// Regression for the "entity[...]" corruption + byte-offset-shift bug seen
// across multiple ChatGPT sessions (May 2026). Our wire-level
// de-pseudonymization corrupted ChatGPT's inline-marker offsets, producing
// output like `Pancreatitischarge summary` (lost "dis") and
// `entity["people",Dr. Richard Lee` (raw markers leaked).
//
// The architectural fix: skip wire-level de-pseudo for ChatGPT entirely
// (responseStreamStrategy: 'none') and rely on the persistent DOM observer
// to swap pseudonyms in the rendered text. ChatGPT's renderer sees its
// own untouched bytes with intact offsets, so markers clean up correctly.
//
// This test pins the strategy so a future "let's clean up the adapter"
// refactor doesn't silently regress us back to 'sse-content'.

describe('ChatGPT adapter — DOM-only response de-pseudonymization', () => {
  it("responseStreamStrategy is 'none' — wire-level de-pseudo MUST be skipped", () => {
    expect(ChatGPTAdapter.responseStreamStrategy).toBe('none');
  });

  it('keeps outbound pseudonymization unchanged (the security-critical path)', () => {
    // Outbound = request body modification. We do NOT skip that — it's how
    // PII never reaches ChatGPT in the first place. The fetch interceptor
    // and adapter.replacePrompt() still run.
    expect(ChatGPTAdapter.skipFetchProxy).toBeFalsy();
  });

  it('still extracts content from accumulated SSE for detection routing', () => {
    // extractResponseContent is used for response routing decisions even
    // when stream wrap is skipped. It should still recognize ChatGPT's
    // accumulated `message.content.parts[0]` format.
    const result = ChatGPTAdapter.extractResponseContent?.({
      message: { content: { parts: ['Hello world'] } },
    });
    expect(result).toEqual({ mode: 'accumulated', content: 'Hello world' });
  });

  it('still extracts delta from JSON-patch SSE (2025+ format)', () => {
    const result = ChatGPTAdapter.extractResponseContent?.({
      o: 'append',
      v: 'chunk of text',
      p: '/message/content/parts/0',
    });
    expect(result).toEqual({ mode: 'delta', content: 'chunk of text' });
  });
});
