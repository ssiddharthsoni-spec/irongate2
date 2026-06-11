import { describe, it, expect } from 'vitest';
import { stripInlineMarkers } from '../src/content/main-world/depseudo-engine';

// Regression for the May 10 corruption captured in the user's screenshots:
// ChatGPT now embeds inline entity references and citation tokens directly
// in the rendered text. When our pseudonym swap shifts byte offsets, the
// renderer leaves these markers visible. The stripper must remove them
// BEFORE pseudonym replacement so the user sees clean text.

describe('stripInlineMarkers — ChatGPT inline entity/citation markers', () => {
  it('strips entity["company","X"] wrappers', () => {
    const corrupted = '| entity["company","Apple Inc."] | shares';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('entity[');
    expect(cleaned).not.toContain('"company"');
  });

  it('strips entity["person","Y"] wrappers', () => {
    const corrupted = 'probably referring to entity["person","Leopold Aschenbrenner"]edge fund';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('entity[');
    expect(cleaned).not.toContain('"person"');
  });

  it('strips entity wrappers with multiple comma-separated values (NASDAQ refs)', () => {
    const corrupted = 'entity["company","Apple Inc.","NASDAQ:AAPL"] portfolio';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('entity[');
    expect(cleaned).not.toContain('NASDAQ:AAPL"]');
  });

  it('strips bare turn0search0 citation tokens', () => {
    const corrupted = 'AI software names. turn0search0 (latest available)';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('turn0search0');
  });

  it('strips chained turn0search tokens', () => {
    const corrupted = 'Applied Digitalsearch1turn0search0turn0search6 next bullet';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('turn0search');
  });

  it('strips cite_turn0search0 cite_-prefixed tokens', () => {
    const corrupted = 'See cite_turn0search3 for details';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('cite_turn');
  });

  it('strips mainstrecite…turn0search tokens', () => {
    const corrupted = 'mainstreciteturn0search0turn0searc (latest)';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('mainstre');
    expect(cleaned).not.toContain('turn0search');
  });

  it('preserves normal content next to markers', () => {
    const corrupted = 'Apple Inc. is great entity["company","Apple Inc."] truly';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).toContain('Apple Inc.');
    expect(cleaned).toContain('is great');
    expect(cleaned).toContain('truly');
    expect(cleaned).not.toContain('entity[');
  });

  it('handles the full user-reported Leopold Aschenbrenner corruption fragment', () => {
    const corrupted = 'probably referring to entity["person","Leopold Aschenbrenner"]edge fund, Situational Awareness LP.';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('entity[');
    expect(cleaned).toContain('edge fund');
    expect(cleaned).toContain('Situational Awareness LP');
  });

  it('handles the full Apple Inc table-row corruption fragment', () => {
    const corrupted = '|Heentity["company","Apple Inc."],Apple Inc.ity["company","Microsoft Corporation"]Microsoft CorporationPortfolio Value:** $177,210';
    const cleaned = stripInlineMarkers(corrupted);
    expect(cleaned).not.toContain('entity["company"');
    // Leftover open-fragment (`ity["company","`) must also go via the
    // bare-fragment pattern
    expect(cleaned).not.toMatch(/entity\["[a-z_]+","/);
  });
});
