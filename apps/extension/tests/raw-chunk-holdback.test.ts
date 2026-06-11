/**
 * DEF-031 regression: raw-chunk holdback split text BEFORE replacement,
 * so a pseudonym straddling the holdback cut leaked verbatim into the
 * user-visible AI response (Claude path, responseStreamStrategy 'raw-chunk').
 *
 * June 2026 audit repro: chunk 'data: {"text":"please ask Robert Chen ok"}'
 * with the fake name cut at the holdback boundary leaked "Robert Chen"
 * (the pseudonym) unreplaced.
 *
 * These tests exercise the SHIPPED HoldbackReplacer class (imported from
 * depseudo-engine.ts — the same instance main-world.ts wires into the
 * stream), with the real buildRegexCache + replacePseudonymsCore as the
 * replacement function, exactly as production composes them.
 */
import { describe, it, expect } from 'vitest';
import {
  HoldbackReplacer,
  buildRegexCache,
  replacePseudonymsCore,
} from '../src/content/main-world/depseudo-engine';

// reverseMap: fake → real (de-pseudonymization direction).
// Wiring mirrors production exactly (main-world.ts depseudonymizeResponseRaw):
// replace fn = real replacement core, candidate tokens = real cache pseudonyms.
function makeReplacer(reverseMap: Record<string, string>): HoldbackReplacer {
  const cache = buildRegexCache(reverseMap);
  return new HoldbackReplacer(
    (text) => replacePseudonymsCore(text, cache),
    cache.map((e) => e.pseudonym),
  );
}

function runChunks(hb: HoldbackReplacer, chunks: string[]): string {
  let out = '';
  for (const c of chunks) out += hb.push(c);
  out += hb.flush();
  return out;
}

describe('HoldbackReplacer: DEF-031 chunk-boundary straddle', () => {
  const reverseMap = { 'Robert Chen': 'Siddharth Soni' };

  it('replaces a pseudonym split across two chunks at the holdback cut', () => {
    // 'Robert Chen' is 11 chars → holdback = 11. First chunk ends mid-name.
    const out = runChunks(makeReplacer(reverseMap), [
      'data: {"text":"please ask Robert Ch',
      'en ok"}',
    ]);
    expect(out).toContain('Siddharth Soni');
    expect(out).not.toContain('Robert Chen');
  });

  it('audit repro: name positioned so the pre-fix safeLen cut split it', () => {
    // Pre-fix: decoded='data: {"text":"please ask Robert Chen ok"}' (43 chars),
    // safeLen=32 cut inside 'Robert Chen' at [26,37) → head emitted unreplaced.
    const out = runChunks(makeReplacer(reverseMap), [
      'data: {"text":"please ask Robert Chen ok"}',
      ' [DONE]',
    ]);
    expect(out).toContain('Siddharth Soni');
    expect(out).not.toContain('Robert Chen');
  });

  it('replaces a pseudonym split across THREE chunks', () => {
    const out = runChunks(makeReplacer(reverseMap), ['…ask Rob', 'ert C', 'hen now']);
    expect(out).toContain('Siddharth Soni');
    expect(out).not.toContain('Robert Chen');
  });

  it('replaces a pseudonym contained in the final flush remainder', () => {
    const out = runChunks(makeReplacer(reverseMap), ['Robert Chen']);
    expect(out).toBe('Siddharth Soni');
  });

  it('emits nothing held forever: total output preserves all non-pseudonym text', () => {
    const chunks = ['The quick brown ', 'fox jumps over ', 'the lazy dog.'];
    const out = runChunks(makeReplacer(reverseMap), chunks);
    expect(out).toBe('The quick brown fox jumps over the lazy dog.');
  });

  it('does not double-replace or corrupt an already-replaced real name spanning the cut', () => {
    // Real name is LONGER than the fake → after replacement the real value
    // itself can span the holdback boundary; it must pass through intact.
    const out = runChunks(makeReplacer(reverseMap), [
      'Say hi to Robert Chen', // fake completes exactly at chunk end
      ' and Robert Chen again',
    ]);
    expect(out).toBe('Say hi to Siddharth Soni and Siddharth Soni again');
  });

  it('handles multiple distinct pseudonyms straddling different cuts', () => {
    const map = { 'Robert Chen': 'Siddharth Soni', 'Acme Holdings': 'Irongate Labs' };
    const out = runChunks(makeReplacer(map), [
      'Robert C', 'hen works at Acme Hol', 'dings now',
    ]);
    expect(out).toBe('Siddharth Soni works at Irongate Labs now');
  });

  it('counts replacement activity for stream-end logging', () => {
    const hb = makeReplacer(reverseMap);
    runChunks(hb, ['hello Robert Chen']);
    expect(hb.replacedCount).toBeGreaterThanOrEqual(1);
  });

  it('never corrupts via fragment entries: incomplete full name at buffer end must not fragment-replace', () => {
    // The cache contains a first-name fragment (Robert → Siddharth). A naive
    // replace-then-split rewrites "…Robert Ch" into "…Siddharth Ch" before
    // "en" arrives, yielding the corrupted hybrid "Siddharth Chen".
    const out = runChunks(makeReplacer(reverseMap), [
      'data: {"text":"please ask Robert Ch',
      'en ok"}',
    ]);
    expect(out).not.toContain('Siddharth Chen');
    expect(out).toContain('Siddharth Soni');
  });

  it('PROPERTY: streaming output equals batch replacement of the full text, at every chunking', () => {
    // The fundamental invariant: chunk boundaries must be invisible.
    // Whatever the core does on the complete text (including its designed
    // fragment semantics, e.g. "Robert Chennai" → "Siddharth Chennai"),
    // the stream must produce byte-identical output for ANY split.
    const cache = buildRegexCache(reverseMap);
    const texts = [
      'visit Robert Chennai today', // full-name boundary fails, fragment fires
      'data: {"text":"please ask Robert Chen ok"}',
      'Robert Chen met Robert Chen; Robert left.',
      'no pseudonyms anywhere in this sentence',
      'ends with Robert Chen',
    ];
    for (const text of texts) {
      const batch = replacePseudonymsCore(text, cache);
      for (let cut1 = 0; cut1 <= text.length; cut1 += 3) {
        for (let cut2 = cut1; cut2 <= text.length; cut2 += 5) {
          const out = runChunks(makeReplacer(reverseMap), [
            text.slice(0, cut1), text.slice(cut1, cut2), text.slice(cut2),
          ]);
          expect(out, `text="${text}" cuts=${cut1},${cut2}`).toBe(batch);
        }
      }
    }
  });

  it('flush() after error path returns REPLACED text (pre-fix leaked raw holdback)', () => {
    const hb = makeReplacer(reverseMap);
    hb.push('tail is Robert Che'); // partial fake parked in holdback
    const remainder = hb.push('n') + hb.flush(); // complete then simulate stream end
    expect(remainder).toContain('Siddharth Soni');
    expect(remainder).not.toContain('Robert Chen');
  });
});
