import { describe, expect, it } from 'vitest';
import { buildRegexCache, replacePseudonymsCore, stripInlineMarkers } from '../src/content/main-world/depseudo-engine';

// Regression tests for the corrupted ChatGPT response patterns observed:
//   "Patient Jane Millermary"]≡"
//   "cDr. Richard Leehysician"]≡"
//   "Pantoprazoledication"]≡"
//
// All three trace to two bugs in the SSE de-pseudonymization layer:
//   1. ChatGPT inline citation markers (PUA / zero-width chars) embedded in
//      the response content text, leaking through into the rendered UI and
//      sometimes splitting words at unexpected positions.
//   2. The delta-mode safeLen computation used a ratio approximation that
//      let partial pseudonyms emit before they were complete, dropping or
//      doubling characters at chunk boundaries.

describe('stripInlineMarkers — content-level cite-marker strip', () => {
  it('strips Private Use Area characters (the visible "≡" / boxes)', () => {
    // U+E000 is the start of PUA — exactly the kind of character ChatGPT
    // injects as an inline citation marker.
    const input = 'Pantoprazole medication';
    expect(stripInlineMarkers(input)).toBe('Pantoprazole medication');
  });

  it('strips zero-width chars (ZWJ, ZWNJ, BOM, joiner family)', () => {
    const input = 'Patient​ Mary‌﻿';
    expect(stripInlineMarkers(input)).toBe('Patient Mary');
  });

  it('strips the closing-bracket + PUA pair (the "]≡" tail observed in corruption)', () => {
    const input = 'physician Dr. Richard Lee] was attending';
    // The ']' + PUA is the inline-cite-end marker; both should go.
    expect(stripInlineMarkers(input)).toBe('physician Dr. Richard Lee was attending');
  });

  it('leaves regular text completely untouched', () => {
    const t = 'No markers here. Just normal text with [brackets] and (parens).';
    expect(stripInlineMarkers(t)).toBe(t);
  });

  it('handles empty / null safely', () => {
    expect(stripInlineMarkers('')).toBe('');
  });
});

describe('replacePseudonymsCore — bug-list regression', () => {
  it('REGRESSION: PUA marker between pseudonym and rest of word does NOT corrupt the surrounding text', () => {
    // Simulate the "Pantoprazoledication" corruption: a ChatGPT response
    // chunk where a PUA marker was injected mid-word. After the strip step,
    // the word is whole and replacement runs cleanly.
    const reverseMap = { 'Robert Chen': 'Carlos Mendez' };
    const cache = buildRegexCache(reverseMap);

    // Word interrupted by a PUA marker mid-stream.
    const input = 'Pantoprazole medication for Robert Chen';
    const out = replacePseudonymsCore(input, cache);

    // PUA marker is gone, pseudonym replaced, no character drops or splits.
    expect(out).toBe('Pantoprazole medication for Carlos Mendez');
    expect(out).not.toContain('Pantoprazoledication'); // the corruption pattern
    expect(out).not.toContain('');
  });

  it('REGRESSION: pseudonym adjacent to a citation marker is not split', () => {
    // The "cDr. Richard Leehysician" corruption shape: a pseudonym replaced
    // INSIDE a word fragment that was split by a marker.
    const reverseMap = { 'Robert Chen': 'Dr. Richard Lee' };
    const cache = buildRegexCache(reverseMap);

    // Marker is immediately adjacent to the pseudonym.
    const input = 'physician Robert Chen] attended';
    const out = replacePseudonymsCore(input, cache);

    // Cleaned up: marker stripped, pseudonym replaced.
    expect(out).toBe('physician Dr. Richard Lee attended');
    expect(out).not.toMatch(/Leehysician/); // the corruption pattern
  });

  it('fast-reject path returns text unchanged when no pseudonym appears', () => {
    const reverseMap = { 'Robert Chen': 'Carlos Mendez' };
    const cache = buildRegexCache(reverseMap);
    const input = 'This text has no pseudonyms at all, just plain words.';
    expect(replacePseudonymsCore(input, cache)).toBe(input);
  });

  it('empty cache returns text unchanged immediately', () => {
    const cache = buildRegexCache({});
    expect(replacePseudonymsCore('whatever', cache)).toBe('whatever');
  });

  it('replacement still works when text contains both PUA and a legitimate pseudonym', () => {
    const reverseMap = { 'David Kumar': 'Jane Miller' };
    const cache = buildRegexCache(reverseMap);
    const input = 'Patient David Kumar was admitted on 2026-03-01';
    const out = replacePseudonymsCore(input, cache);
    expect(out).toBe('Patient Jane Miller was admitted on 2026-03-01');
  });
});
