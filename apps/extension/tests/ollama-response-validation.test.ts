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
  endpoint: 'http://localhost:11434/api/generate',
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

  it('accepts a well-formed Ollama response', async () => {
    mockFetchReturning({
      model: 'gemma4:e2b',
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

  it('REJECTS response missing the "response" field', async () => {
    // A rogue service could return arbitrary JSON. The classifier must not
    // trust it — it should fall back to the conservative amber default.
    mockFetchReturning({ score: 0, message: 'ok' });
    const result = await classifyIntentAndContext('test prompt', CFG);
    expect(result.fellBack).toBe(true);
  });

  it('REJECTS response where "response" field is not a string', async () => {
    mockFetchReturning({ response: { nested: 'object' } });
    const result = await classifyIntentAndContext('test prompt', CFG);
    expect(result.fellBack).toBe(true);
  });

  it('REJECTS response where "model" field has wrong type', async () => {
    mockFetchReturning({
      model: 42, // wrong type
      response: JSON.stringify({
        intent: 'research',
        values_are_real: false,
        sensitivity: 'none',
        reasoning: 'test',
      }),
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
