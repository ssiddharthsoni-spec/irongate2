/**
 * WP4: real-import tests for the SHIPPED stream de-pseudo module — the exact
 * code main-world.ts wires into wrapResponse. Exercises full Response /
 * ReadableStream plumbing end to end, including the chunk-boundary cases
 * that previously had zero behavioral coverage at any layer (audit June
 * 2026: "SSE chunk-boundary de-pseudo has zero behavioral tests").
 */
import { describe, it, expect } from 'vitest';
import { createStreamDepseudo } from '../src/content/main-world/stream-depseudo';
import {
  buildRegexCache,
  replacePseudonymsCore,
} from '../src/content/main-world/depseudo-engine';

function makeEngine(reverseMap: Record<string, string>, strategy: 'raw-chunk' | 'sse-content') {
  const cache = buildRegexCache(reverseMap);
  const telemetry: Record<string, number> = {};
  let streamStarts = 0;
  let streamEnds = 0;
  const engine = createStreamDepseudo({
    replacePseudonyms: (text) => replacePseudonymsCore(text, cache),
    log: () => {},
    isDebug: () => true,
    onStreamStart: () => { streamStarts++; },
    onStreamEnd: () => { streamEnds++; },
    recordReplacements: (mech, n) => { telemetry[mech] = (telemetry[mech] || 0) + n; },
    getAdapterId: () => 'test',
    getResponseStreamStrategy: () => strategy,
  });
  return { engine, telemetry, counts: () => ({ streamStarts, streamEnds }) };
}

function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

const MAP = { 'Robert Chen': 'Siddharth Soni' };

describe('stream de-pseudo (shipped module): raw-chunk path', () => {
  it('replaces a pseudonym split across network chunks', async () => {
    const { engine } = makeEngine(MAP, 'raw-chunk');
    const wrapped = engine.depseudonymizeResponseRaw(
      chunkedResponse(['data: {"completion":"ask Robert Ch', 'en about it"}\n\n']),
      MAP,
    );
    const text = await wrapped.text();
    expect(text).toContain('Siddharth Soni');
    expect(text).not.toContain('Robert Chen');
  });

  it('byte-identical to batch replacement across many chunkings (property)', async () => {
    const cache = buildRegexCache(MAP);
    const full = 'data: {"completion":"Robert Chen met Robert Chen; Robert left for Chennai."}\n\n';
    const batch = replacePseudonymsCore(full, cache);
    for (const cut of [1, 7, 13, 26, 41, 60, full.length - 2]) {
      const { engine } = makeEngine(MAP, 'raw-chunk');
      const wrapped = engine.depseudonymizeResponseRaw(
        chunkedResponse([full.slice(0, cut), full.slice(cut)]),
        MAP,
      );
      expect(await wrapped.text(), `cut=${cut}`).toBe(batch);
    }
  });

  it('records wire-raw telemetry and balances stream start/end', async () => {
    const { engine, telemetry, counts } = makeEngine(MAP, 'raw-chunk');
    const wrapped = engine.depseudonymizeResponseRaw(
      chunkedResponse(['hello Robert Chen, goodbye']),
      MAP,
    );
    await wrapped.text();
    expect(telemetry['wire-raw']).toBeGreaterThanOrEqual(1);
    expect(counts().streamEnds).toBe(1);
  });

  it('empty reverse map passes the response through unwrapped', async () => {
    const { engine } = makeEngine({}, 'raw-chunk');
    const original = chunkedResponse(['untouched body']);
    const wrapped = engine.depseudonymizeResponseRaw(original, {});
    expect(wrapped).toBe(original);
  });

  it('strips Content-Encoding/Content-Length headers on the wrapped response', async () => {
    const { engine } = makeEngine(MAP, 'raw-chunk');
    const encoder = new TextEncoder();
    const resp = new Response(
      new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(encoder.encode('Robert Chen')); c.close(); },
      }),
      { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '11' } },
    );
    const wrapped = engine.depseudonymizeResponseRaw(resp, MAP);
    expect(wrapped.headers.get('Content-Encoding')).toBeNull();
    expect(wrapped.headers.get('Content-Length')).toBeNull();
  });
});

describe('stream de-pseudo (shipped module): sse-content path', () => {
  it('replaces inside SSE JSON content via adapter extract/inject hooks', async () => {
    const cache = buildRegexCache(MAP);
    const engine = createStreamDepseudo({
      replacePseudonyms: (text) => replacePseudonymsCore(text, cache),
      log: () => {},
      isDebug: () => true,
      onStreamStart: () => {},
      onStreamEnd: () => {},
      recordReplacements: () => {},
      getAdapterId: () => 'test',
      getResponseStreamStrategy: () => 'sse-content',
      extractResponseContent: (parsed) =>
        typeof parsed?.text === 'string' ? { mode: 'accumulated', content: parsed.text } : null,
      injectResponseContent: (parsed, _mode, content) => { parsed.text = content; },
    });
    const wrapped = engine.depseudonymizeResponse(
      chunkedResponse(['data: {"text":"hello Robert Chen"}\n\n', 'data: [DONE]\n\n']),
      MAP,
    );
    const text = await wrapped.text();
    expect(text).toContain('Siddharth Soni');
    expect(text).not.toContain('Robert Chen');
  });
});
