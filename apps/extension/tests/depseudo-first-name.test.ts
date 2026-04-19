/**
 * De-pseudonymization First-Name Matching Tests
 *
 * Verifies that when the AI response uses only the first name of a
 * pseudonymized person, the de-pseudo engine replaces it correctly.
 * This was a user-visible bug: "James" leaked through when the full
 * pseudonym was "James Mitchell" → "David Park".
 */

import { describe, it, expect } from 'vitest';
import { buildRegexCache, replacePseudonymsCore } from '../src/content/main-world/depseudo-engine';

describe('De-pseudonymization: first-name-only matching', () => {
  const reverseMap: Record<string, string> = {
    'James Mitchell': 'David Park',
    'Project Aurora': 'Project Atlas',
  };

  it('replaces full pseudonym', () => {
    const cache = buildRegexCache(reverseMap);
    const result = replacePseudonymsCore(
      'James Mitchell has been a Senior Engineer.',
      cache,
    );
    expect(result).toContain('David Park');
    expect(result).not.toContain('James Mitchell');
  });

  it('replaces first-name-only usage', () => {
    const cache = buildRegexCache(reverseMap);
    const result = replacePseudonymsCore(
      'Over the past two review cycles, James has received ratings of 2/5.',
      cache,
    );
    expect(result).toContain('David');
    expect(result).not.toContain('James');
  });

  it('does NOT replace first name inside longer words', () => {
    const cache = buildRegexCache(reverseMap);
    const result = replacePseudonymsCore(
      'The Jameson whiskey brand is popular.',
      cache,
    );
    // "Jameson" should NOT be affected — it's a different word
    expect(result).toContain('Jameson');
  });

  it('replaces first name in possessive form', () => {
    const cache = buildRegexCache(reverseMap);
    const result = replacePseudonymsCore(
      "James's performance has been below expectations.",
      cache,
    );
    expect(result).toContain("David's");
    expect(result).not.toContain("James's");
  });

  it('handles multiple person pseudonyms', () => {
    const multiMap: Record<string, string> = {
      'Lisa Chang': 'Sarah Chen',
      'Robert Clare': 'David Park',
      'Anna Peterson': 'Maria Santos',
    };
    const cache = buildRegexCache(multiMap);
    const result = replacePseudonymsCore(
      'Lisa and Robert discussed the project. Anna joined later.',
      cache,
    );
    expect(result).toContain('Sarah');
    expect(result).toContain('David');
    expect(result).toContain('Maria');
    expect(result).not.toContain('Lisa');
    expect(result).not.toContain('Robert');
    expect(result).not.toContain('Anna');
  });

  it('does NOT create first-name mapping for organizations', () => {
    const orgMap: Record<string, string> = {
      'Contoso Holdings': 'Meridian Health',
    };
    const cache = buildRegexCache(orgMap);
    const result = replacePseudonymsCore(
      'Contoso is a leader in the industry.',
      cache,
    );
    // "Contoso" alone should NOT be replaced — it's an org, not a person
    // The full "Contoso Holdings" should be replaced
    expect(result).toContain('Contoso');
  });
});
