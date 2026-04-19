/**
 * Sr. Engineer Audit — Week 2 · Item 6
 *
 * Validate that the Ollama-call path rejects malformed responses.
 * A rogue process binding to localhost:11434 before Ollama starts could
 * return `{ score: 0 }` or `{ response: "not-JSON-at-all" }` and our
 * classifier must not trust it.
 *
 * We test this by stubbing globalThis.fetch and asserting the classifier
 * falls back to `fellBack: true` instead of accepting the bogus payload.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyIntentAndContext } from '../src/detection/intent-context-classifier';

const CFG = {
  endpoint: 'http://localhost:11434/api/generate', // Classifier now calls /api/chat but endpoint is rewritten internally
  model: 'gemma4:e2b',
  format: 'ollama' as const,
  timeoutMs: 1000,
};

function mockFetchReturning(body: unknown, ok = true) {
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
}

describe('Ollama response-shape validation (Item 6)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('accepts a well-formed Ollama /api/generate response', async () => {
    // Classifier uses /api/generate with format=json
    mockFetchReturning({
      model: 'gemma3:4b',
      response: JSON.stringify({
        intent: 'research',
        values_are_real: false,
        sensitivity: 'none',
        reasoning: 'test',
      }),
      done: true,
    });
    const result = await classifyIntentAndContext('test prompt', CFG);
    expect(result.fellBack).toBe(false);
    expect(result.intent).toBe('research');
  });

  it('accepts response with named_entities', async () => {
    mockFetchReturning({
      model: 'gemma3:4b',
      response: JSON.stringify({
        intent: 'work_sharing',
        values_are_real: true,
        sensitivity: 'high',
        reasoning: 'Contains confidential data',
        named_entities: [{ type: 'ORGANIZATION', text: 'Acme Corp', is_sensitive: true }],
      }),
      done: true,
    });
    const result = await classifyIntentAndContext('test prompt', CFG);
    expect(result.fellBack).toBe(false);
    expect(result.intent).toBe('work_sharing');
    expect(result.namedEntities.length).toBe(1);
    expect(result.namedEntities[0]!.text).toBe('Acme Corp');
  });

  it('REJECTS response missing content and tool_calls', async () => {
    mockFetchReturning({ model: 'gemma4:e2b', message: { role: 'assistant' } });
    const result = await classifyIntentAndContext('test prompt', CFG);
    expect(result.fellBack).toBe(true);
  });

  it('REJECTS response with no message field at all', async () => {
    mockFetchReturning({ score: 0 });
    const result = await classifyIntentAndContext('test prompt', CFG);
    expect(result.fellBack).toBe(true);
  });

  it('REJECTS response where message content is invalid JSON', async () => {
    mockFetchReturning({
      model: 'gemma4:e2b',
      message: { role: 'assistant', content: 'not-json-at-all' },
    });
    const result = await classifyIntentAndContext('test prompt', CFG);
    expect(result.fellBack).toBe(true);
  });

  it('falls back when HTTP status is not ok (rogue proxy returning 500)', async () => {
    mockFetchReturning({ response: 'whatever' }, false);
    const result = await classifyIntentAndContext('test prompt', CFG);
    expect(result.fellBack).toBe(true);
  });

  it('attaches Authorization header when apiKey is configured', async () => {
    let capturedHeaders: any = null;
    (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers;
      return new Response(
        JSON.stringify({
          model: 'gemma4:e2b',
          response: JSON.stringify({
            intent: 'research',
            values_are_real: false,
            sensitivity: 'none',
            reasoning: 'test',
          }),
        }),
        { status: 200 },
      );
    };

    await classifyIntentAndContext('test prompt', { ...CFG, apiKey: 'shared-secret-abc' });

    expect(capturedHeaders).toBeTruthy();
    expect(capturedHeaders['Authorization']).toBe('Bearer shared-secret-abc');
  });

  it('does NOT attach Authorization header when apiKey is absent', async () => {
    let capturedHeaders: any = null;
    (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers;
      return new Response(
        JSON.stringify({
          model: 'gemma4:e2b',
          response: JSON.stringify({
            intent: 'research',
            values_are_real: false,
            sensitivity: 'none',
            reasoning: 'test',
          }),
        }),
        { status: 200 },
      );
    };

    await classifyIntentAndContext('test prompt', CFG);

    expect(capturedHeaders).toBeTruthy();
    expect(capturedHeaders['Authorization']).toBeUndefined();
  });
});
