/**
 * User-bubble restoration safety (June 2026, user-reported).
 *
 * On ChatGPT the user's message bubble renders the WIRE PAYLOAD (pseudonyms),
 * so Iron Gate must restore the original — but with EXACT whole-pseudonym
 * swaps only. Fragment rules (first-name-only) must NEVER apply to the user
 * bubble, because a fake first name can rewrite a real name the user typed
 * ("Lisa Park" → "Maria Park"). This pins the buildRegexCache(expandFragments)
 * contract that the shipped replacePseudonymsFullOnly relies on.
 */
import { describe, it, expect } from 'vitest';
import { buildRegexCache, replacePseudonymsCore } from '../src/content/main-world/depseudo-engine';

describe('user-bubble full-only restoration', () => {
  // reverseMap: fake → original (de-pseudo direction)
  const map = { 'James Mitchell': 'John Smith' };

  it('full-only cache drops first-name fragment entries; full cache keeps them', () => {
    const full = buildRegexCache(map);              // expandFragments default true
    const fullOnly = buildRegexCache(map, false);   // user-bubble mode
    expect(full.some((e) => e.pseudonym === 'James')).toBe(true);
    expect(fullOnly.some((e) => e.pseudonym === 'James')).toBe(false);
    expect(fullOnly.some((e) => e.pseudonym === 'James Mitchell')).toBe(true);
  });

  it('whole-value swap restores the original in both modes', () => {
    const fullOnly = buildRegexCache(map, false);
    expect(replacePseudonymsCore('Hi James Mitchell, welcome', fullOnly))
      .toBe('Hi John Smith, welcome');
  });

  it('SAFETY: full-only does NOT touch a bare first name (user bubble protected)', () => {
    const fullOnly = buildRegexCache(map, false);
    // A bare "James" must pass through untouched — this is what prevents a
    // fragment rule from rewriting a real name the user typed.
    expect(replacePseudonymsCore('Actually call me James', fullOnly))
      .toBe('Actually call me James');
  });

  it('contrast: full mode DOES replace the bare first name (correct for AI response)', () => {
    const full = buildRegexCache(map);
    expect(replacePseudonymsCore('Actually call me James', full))
      .toBe('Actually call me John');
  });

  it('REPRO: the reported wire-fake bubble restores exactly, no collateral edits', () => {
    // What ChatGPT rendered in the user bubble (the fakes) → user's originals.
    const wireMap = {
      'William Taylor LLC': 'Global Trading LLC',
      'JPNorthwind Technologies': 'JPMorgan Chase',
      '391245899': '021000021',
      'INV-9708-0891': 'INV-2024-0891',
    };
    const fullOnly = buildRegexCache(wireMap, false);
    const bubble =
      'Beneficiary: William Taylor LLC Bank: JPNorthwind Technologies Routing: 391245899 Reference: INV-9708-0891';
    expect(replacePseudonymsCore(bubble, fullOnly)).toBe(
      'Beneficiary: Global Trading LLC Bank: JPMorgan Chase Routing: 021000021 Reference: INV-2024-0891',
    );
  });

  it('REPRO: a real name sharing a first name with another fake is NOT corrupted', () => {
    // The "Lisa Park → Maria Park" class: even if a fake shares a first name,
    // full-only mode has no fragment entry to misfire on the user bubble.
    const wireMap = { 'Lisa Brown': 'Maria Mendez' }; // fake → real
    const fullOnly = buildRegexCache(wireMap, false);
    // User also typed a real "Lisa Park" — it must survive untouched.
    expect(replacePseudonymsCore('Member: Lisa Park', fullOnly)).toBe('Member: Lisa Park');
  });
});
