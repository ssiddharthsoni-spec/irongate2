/**
 * WebSocket False Positive Tests
 *
 * Tests that Socket.IO protocol frames, heartbeats, and non-user-content
 * WS messages do NOT trigger entity detection (false positives).
 */

import { describe, it, expect } from 'vitest';
import { PerplexityAdapter } from '../src/content/adapters/perplexity';
import { detectWithRegex } from '../src/detection/fallback-regex';

// ─── Perplexity Adapter: extractFromWsFrame ─────────────────────────────────

describe('Perplexity extractFromWsFrame — false positive prevention', () => {
  const extract = PerplexityAdapter.extractFromWsFrame!.bind(PerplexityAdapter);

  it('should return null for Socket.IO heartbeat "2"', () => {
    expect(extract('2')).toBeNull();
  });

  it('should return null for Socket.IO pong "3"', () => {
    expect(extract('3')).toBeNull();
  });

  it('should return null for Socket.IO connect "40"', () => {
    expect(extract('40')).toBeNull();
  });

  it('should return null for Socket.IO connect with namespace "40/ns"', () => {
    expect(extract('40/ns')).toBeNull();
  });

  it('should return null for Socket.IO disconnect "41"', () => {
    expect(extract('41')).toBeNull();
  });

  it('should return null for server-push events', () => {
    // Server sends query_progress updates — not user queries
    expect(extract('42["query_progress",{"text":"loading...","status":"running"}]')).toBeNull();
  });

  it('should return null for connection ack events', () => {
    expect(extract('42["connect",{"sid":"abc123"}]')).toBeNull();
  });

  it('should return null for non-perplexity events', () => {
    expect(extract('42["some_other_event","data here with enough chars for threshold"]')).toBeNull();
  });

  it('should return null for empty query in perplexity_ask', () => {
    expect(extract('42["perplexity_ask","",{}]')).toBeNull();
  });

  it('should return null for whitespace-only query', () => {
    expect(extract('42["perplexity_ask","   ",{}]')).toBeNull();
  });

  it('should extract user query from perplexity_ask', () => {
    const frame = '42["perplexity_ask","What is the capital of France?",{"version":"2.9"}]';
    expect(extract(frame)).toBe('What is the capital of France?');
  });

  it('should extract user query from perplexity_search', () => {
    const frame = '42["perplexity_search","best restaurants in NYC",{}]';
    expect(extract(frame)).toBe('best restaurants in NYC');
  });

  it('should extract user query from perplexity_query', () => {
    const frame = '42["perplexity_query","explain quantum computing",{}]';
    expect(extract(frame)).toBe('explain quantum computing');
  });

  it('should NOT extract from response/progress events even with long strings', () => {
    const frame = '42["query_result","The capital of France is Paris. Paris is known for the Eiffel Tower and many museums.",{"tokens":42}]';
    expect(extract(frame)).toBeNull();
  });

  it('should NOT extract from internal telemetry events', () => {
    const frame = '42["analytics_event","page_view_search_results_with_some_long_text_here",{"ts":1234567890}]';
    expect(extract(frame)).toBeNull();
  });

  it('should return null for binary/corrupted frames', () => {
    expect(extract('\x00\x01\x02\x03')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extract('')).toBeNull();
  });
});

// ─── isNaturalLanguage (tested via detection pipeline integration) ───────────

describe('Protocol frame detection immunity', () => {
  it('should not detect entities in Socket.IO event names', () => {
    // "PerplexityAsk" matches CamelCase org pattern — but should not be scanned
    // Testing that detectWithRegex itself does not false-positive on these
    const entities = detectWithRegex('perplexity_ask');
    expect(entities.length).toBe(0);
  });

  it('should not detect entities in pure numeric strings', () => {
    const entities = detectWithRegex('42');
    expect(entities.length).toBe(0);
  });

  it('should not detect entities in short protocol data', () => {
    const entities = detectWithRegex('{"sid":"abc123"}');
    expect(entities.length).toBe(0);
  });

  it('should detect entities in real user text', () => {
    const entities = detectWithRegex('Please review Dr. Sarah Johnson at Acme Corp for the merger.');
    expect(entities.length).toBeGreaterThan(0);
  });

  it('should detect SSN in real user content', () => {
    const entities = detectWithRegex('My SSN is 123-45-6789 and I need help filing taxes.');
    const ssns = entities.filter(e => e.type === 'SSN');
    expect(ssns.length).toBe(1);
  });

  it('should not false-positive on JSON metadata', () => {
    const metadata = '{"version":"2.9","source":"default","language":"en","timezone":"America/New_York"}';
    const entities = detectWithRegex(metadata);
    // Should detect zero or very few entities (maybe timezone as location, but not persons/orgs)
    const highConfidence = entities.filter(e => e.confidence >= 0.8 && ['PERSON', 'ORGANIZATION', 'SSN', 'CREDIT_CARD'].includes(e.type));
    expect(highConfidence.length).toBe(0);
  });

  it('should not false-positive on Socket.IO frame with options object', () => {
    const frame = '["perplexity_ask","",{"version":"2.9","source":"default","search_focus":"internet","search_recency_filter":null}]';
    const entities = detectWithRegex(frame);
    const persons = entities.filter(e => e.type === 'PERSON');
    const orgs = entities.filter(e => e.type === 'ORGANIZATION');
    expect(persons.length).toBe(0);
    expect(orgs.length).toBe(0);
  });
});

// ─── replaceInWsFrame integrity ─────────────────────────────────────────────

describe('Perplexity replaceInWsFrame', () => {
  const replace = PerplexityAdapter.replaceInWsFrame!.bind(PerplexityAdapter);

  it('should replace query text in perplexity_ask frame', () => {
    const frame = '42["perplexity_ask","Tell me about Dr. Sarah Johnson",{"version":"2.9"}]';
    const result = replace(frame, 'Tell me about Dr. Sarah Johnson', 'Tell me about Dr. Emily Rogers');
    expect(result).not.toBeNull();
    expect(result).toContain('Emily Rogers');
    expect(result).not.toContain('Sarah Johnson');
    expect(result!.startsWith('42[')).toBe(true);
  });

  it('should preserve Socket.IO prefix and options after replacement', () => {
    const frame = '42["perplexity_ask","Hello world",{"version":"2.9"}]';
    const result = replace(frame, 'Hello world', 'Hi there');
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!.substring(2));
    expect(parsed[0]).toBe('perplexity_ask');
    expect(parsed[1]).toBe('Hi there');
    expect(parsed[2]).toEqual({ version: '2.9' });
  });

  it('should return null for non-matching replacement', () => {
    const frame = '42["perplexity_ask","some text",{}]';
    const result = replace(frame, 'completely different text', 'replacement');
    expect(result).toBeNull();
  });
});
