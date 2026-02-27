/**
 * Shared Pseudonymizer Tests
 *
 * Tests for pseudonymization, de-pseudonymization,
 * same-byte-length mode, overlap handling, and round-trip integrity.
 */

import { describe, it, expect } from 'vitest';
import {
  pseudonymize,
  depseudonymize,
  pseudonymizeSameLength,
} from '../src/shared/pseudonymizer';
import { detectEntities } from '../src/shared/scanner';
import type { DetectedEntity } from '../src/detection/types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function entity(type: string, text: string, start: number): DetectedEntity {
  return { type, text, start, end: start + text.length, confidence: 0.9, source: 'regex' };
}

// ─── Basic Pseudonymization ─────────────────────────────────────────────────

describe('Basic Pseudonymization', () => {
  it('replaces a single email with [EMAIL-1]', () => {
    const text = 'Contact john@example.com for details.';
    const entities = detectEntities(text);
    const result = pseudonymize(text, entities);
    expect(result.maskedText).not.toContain('john@example.com');
    expect(result.maskedText).toMatch(/\[EMAIL-\d+\]/);
  });

  it('replaces SSN with [SSN-1]', () => {
    const entities = [entity('SSN', '123-45-6789', 5)];
    const result = pseudonymize('SSN: 123-45-6789', entities);
    expect(result.maskedText).toContain('[SSN-1]');
    expect(result.maskedText).not.toContain('123-45-6789');
  });

  it('replaces multiple entity types', () => {
    const text = 'Dr. John Smith (SSN: 123-45-6789)';
    const entities = [
      entity('PERSON', 'Dr. John Smith', 0),
      entity('SSN', '123-45-6789', 21),
    ];
    const result = pseudonymize(text, entities);
    expect(result.maskedText).toContain('[PERSON-1]');
    expect(result.maskedText).toContain('[SSN-1]');
    expect(result.maskedText).not.toContain('John Smith');
    expect(result.maskedText).not.toContain('123-45-6789');
  });

  it('returns original text when no entities', () => {
    const result = pseudonymize('Hello world', []);
    expect(result.maskedText).toBe('Hello world');
    expect(result.mappings).toHaveLength(0);
  });

  it('handles empty string input', () => {
    const result = pseudonymize('', []);
    expect(result.maskedText).toBe('');
  });
});

// ─── Deterministic Pseudonyms ───────────────────────────────────────────────

describe('Deterministic Pseudonyms', () => {
  it('same entity text gets same pseudonym', () => {
    const text = 'John sent to John again.';
    const entities = [
      entity('PERSON', 'John', 0),
      entity('PERSON', 'John', 13),
    ];
    const result = pseudonymize(text, entities);
    const johnMapping = result.mappings.find((m) => m.original === 'John');
    expect(johnMapping).toBeDefined();

    // Both "John" should have the same pseudonym
    const count = result.maskedText.split(johnMapping!.pseudonym).length - 1;
    expect(count).toBe(2);
  });

  it('different entity text gets different pseudonyms', () => {
    const entities = [
      entity('PERSON', 'Alice', 0),
      entity('PERSON', 'Bob', 10),
    ];
    const result = pseudonymize('Alice and Bob work together.', entities);
    const aliceMap = result.mappings.find((m) => m.original === 'Alice');
    const bobMap = result.mappings.find((m) => m.original === 'Bob');
    expect(aliceMap!.pseudonym).not.toBe(bobMap!.pseudonym);
  });

  it('uses incrementing counters per type', () => {
    const entities = [
      entity('EMAIL', 'a@b.com', 0),
      entity('EMAIL', 'c@d.com', 15),
    ];
    const result = pseudonymize('a@b.com then c@d.com', entities);
    expect(result.mappings.some((m) => m.pseudonym === '[EMAIL-1]')).toBe(true);
    expect(result.mappings.some((m) => m.pseudonym === '[EMAIL-2]')).toBe(true);
  });
});

// ─── De-pseudonymization ────────────────────────────────────────────────────

describe('De-pseudonymization', () => {
  it('restores original text from mapping array', () => {
    const text = 'Contact john@example.com about case.';
    const entities = detectEntities(text);
    const result = pseudonymize(text, entities);

    const restored = depseudonymize(result.maskedText, result.mappings);
    expect(restored).toContain('john@example.com');
  });

  it('restores original text from plain object map', () => {
    const map = { '[PERSON-1]': 'John Smith', '[EMAIL-1]': 'john@test.com' };
    const masked = '[PERSON-1] can be reached at [EMAIL-1].';
    const restored = depseudonymize(masked, map);
    expect(restored).toBe('John Smith can be reached at john@test.com.');
  });

  it('handles empty mapping gracefully', () => {
    const result = depseudonymize('No changes here.', []);
    expect(result).toBe('No changes here.');
  });

  it('handles empty object map gracefully', () => {
    const result = depseudonymize('No changes here.', {});
    expect(result).toBe('No changes here.');
  });

  it('round-trip preserves all original values', () => {
    const text = 'Dr. Sarah Chen (SSN: 123-45-6789) email: sarah@hospital.org.';
    const entities = detectEntities(text);
    const pseudo = pseudonymize(text, entities);

    // Verify no originals in masked text
    for (const m of pseudo.mappings) {
      expect(pseudo.maskedText).not.toContain(m.original);
    }

    // Restore
    const restored = depseudonymize(pseudo.maskedText, pseudo.mappings);
    for (const m of pseudo.mappings) {
      expect(restored).toContain(m.original);
    }
  });
});

// ─── Same-Byte-Length Pseudonymization ──────────────────────────────────────

describe('Same-Byte-Length Pseudonymization', () => {
  it('produces masked text with same byte length as original', () => {
    const text = 'SSN: 123-45-6789 is private.';
    const entities = [entity('SSN', '123-45-6789', 5)];
    const result = pseudonymizeSameLength(text, entities);
    const originalBytes = new TextEncoder().encode(text).length;
    const maskedBytes = new TextEncoder().encode(result.maskedText).length;
    expect(maskedBytes).toBe(originalBytes);
  });

  it('handles entities shorter than pseudonym tag', () => {
    // Short entity text like "Bob" (3 bytes) vs "[PERSON-1]" (10 bytes)
    const text = 'Hi Bob, how are you?';
    const entities = [entity('PERSON', 'Bob', 3)];
    const result = pseudonymizeSameLength(text, entities);
    const originalBytes = new TextEncoder().encode(text).length;
    const maskedBytes = new TextEncoder().encode(result.maskedText).length;
    expect(maskedBytes).toBe(originalBytes);
  });

  it('returns empty mappings for no entities', () => {
    const result = pseudonymizeSameLength('Hello world', []);
    expect(result.maskedText).toBe('Hello world');
    expect(result.mappings).toHaveLength(0);
  });

  it('preserves mapping for de-pseudonymization', () => {
    const text = 'Email: john@example.com is registered.';
    const entities = [entity('EMAIL', 'john@example.com', 7)];
    const result = pseudonymizeSameLength(text, entities);
    expect(result.mappings.length).toBe(1);
    expect(result.mappings[0].original).toBe('john@example.com');
  });
});

// ─── Overlap Handling ───────────────────────────────────────────────────────

describe('Overlap Handling', () => {
  it('handles adjacent non-overlapping entities', () => {
    const text = 'alice@test.com bob@test.com';
    const entities = [
      entity('EMAIL', 'alice@test.com', 0),
      entity('EMAIL', 'bob@test.com', 15),
    ];
    const result = pseudonymize(text, entities);
    expect(result.maskedText).not.toContain('alice@test.com');
    expect(result.maskedText).not.toContain('bob@test.com');
    expect(result.mappings.length).toBe(2);
  });

  it('preserves surrounding text around entities', () => {
    const text = 'Contact: john@test.com, thank you.';
    const entities = detectEntities(text);
    const result = pseudonymize(text, entities);
    expect(result.maskedText).toContain('Contact: ');
    expect(result.maskedText).toContain(', thank you.');
  });

  it('handles entity at start of string', () => {
    const text = 'john@test.com is the contact.';
    const entities = [entity('EMAIL', 'john@test.com', 0)];
    const result = pseudonymize(text, entities);
    expect(result.maskedText.startsWith('[EMAIL-1]')).toBe(true);
  });

  it('handles entity at end of string', () => {
    const text = 'Contact: john@test.com';
    const entities = [entity('EMAIL', 'john@test.com', 9)];
    const result = pseudonymize(text, entities);
    expect(result.maskedText.endsWith('[EMAIL-1]')).toBe(true);
  });
});

// ─── Mapping Structure ──────────────────────────────────────────────────────

describe('Mapping Structure', () => {
  it('each mapping has original, pseudonym, and type', () => {
    const text = 'Dr. Jane Smith with SSN 123-45-6789';
    const entities = detectEntities(text);
    const result = pseudonymize(text, entities);

    for (const m of result.mappings) {
      expect(m.original).toBeTruthy();
      expect(m.pseudonym).toMatch(/\[.+\]/);
      expect(m.type).toBeTruthy();
    }
  });

  it('mappings are in document order', () => {
    const text = 'Email: a@b.com and SSN: 123-45-6789';
    const entities = detectEntities(text);
    const result = pseudonymize(text, entities);

    // Mappings should be ordered by appearance in document
    if (result.mappings.length >= 2) {
      const firstPos = text.indexOf(result.mappings[0].original);
      const secondPos = text.indexOf(result.mappings[1].original);
      expect(firstPos).toBeLessThan(secondPos);
    }
  });
});
