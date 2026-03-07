/**
 * De-pseudonymization / Pseudonymization Round-Trip Tests
 *
 * The de-pseudonymization functions (replacePseudonyms, addReverseMapping) live
 * inside main-world.ts as part of a self-contained IIFE and are not exported.
 * This file tests the round-trip logic through the exported pseudonymizeLocal()
 * function, verifying that mappings are correct and can reconstruct originals.
 */

import { describe, it, expect } from 'vitest';
import { pseudonymizeLocal } from '../src/detection/pseudonymizer';
import type { DetectedEntity } from '../src/detection/types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function entity(
  type: string,
  text: string,
  confidence: number,
  start: number
): DetectedEntity {
  return {
    type,
    text,
    start,
    end: start + text.length,
    confidence,
    source: 'regex' as const,
  };
}

// ─── Round-Trip Reconstruction ──────────────────────────────────────────────

describe('Pseudonymization round-trip', () => {
  it('should produce mappings that can reconstruct all original entity values', () => {
    const text = 'Dr. Sarah Chen (SSN: 123-45-6789) works at Global Corp. Email: sarah@global.com';
    const entities = [
      entity('PERSON', 'Sarah Chen', 4, 4),
      entity('SSN', '123-45-6789', 1.0, 21),
      entity('ORGANIZATION', 'Global Corp', 0.9, 44),
      entity('EMAIL', 'sarah@global.com', 0.95, 63),
    ];

    const result = pseudonymizeLocal(text, entities);

    // Verify no originals remain in masked text
    expect(result.maskedText).not.toContain('Sarah Chen');
    expect(result.maskedText).not.toContain('123-45-6789');
    expect(result.maskedText).not.toContain('Global Corp');
    expect(result.maskedText).not.toContain('sarah@global.com');

    // Reverse the mappings to reconstruct
    let restored = result.maskedText;
    for (const m of result.mappings) {
      restored = restored.replaceAll(m.pseudonym, m.original);
    }

    // All originals should be present in the restored text
    expect(restored).toContain('Sarah Chen');
    expect(restored).toContain('123-45-6789');
    expect(restored).toContain('Global Corp');
    expect(restored).toContain('sarah@global.com');
  });

  it('should round-trip a complex legal prompt without data loss', () => {
    const text =
      'Attorney-client privileged: Case Smith v. Jones, matter #2024-CV-1234. ' +
      'Client SSN 987-65-4321. Contact: attorney@lawfirm.com, (555) 234-5678.';

    const entities = [
      entity('SSN', '987-65-4321', 1.0, 82),
      entity('EMAIL', 'attorney@lawfirm.com', 0.95, 104),
      entity('PHONE_NUMBER', '(555) 234-5678', 0.9, 126),
    ];

    const result = pseudonymizeLocal(text, entities);

    // None of the originals should be in the masked text
    for (const m of result.mappings) {
      expect(result.maskedText).not.toContain(m.original);
    }

    // Reverse to reconstruct
    let restored = result.maskedText;
    for (const m of result.mappings) {
      restored = restored.replaceAll(m.pseudonym, m.original);
    }

    for (const m of result.mappings) {
      expect(restored).toContain(m.original);
    }
  });
});

// ─── Pseudonymized Org Names ────────────────────────────────────────────────

describe('Pseudonymized organization names', () => {
  it('should not contain original organization text in the pseudonym', () => {
    const text = 'The contract with Acme Corp is under review.';
    const entities = [entity('ORGANIZATION', 'Acme Corp', 0.85, 18)];

    const result = pseudonymizeLocal(text, entities);

    // The pseudonym token itself should NOT contain the original org name
    for (const m of result.mappings) {
      if (m.type === 'ORGANIZATION') {
        expect(m.pseudonym).not.toContain('Acme');
        expect(m.pseudonym).not.toContain('Corp');
      }
    }

    // The masked text should not contain the original either
    expect(result.maskedText).not.toContain('Acme Corp');
    expect(result.maskedText).not.toContain('Acme');
  });

  it('should replace multiple different organizations with distinct pseudonyms', () => {
    const text = 'Acme Corp signed a deal with Widget Inc and Global Bank.';
    const entities = [
      entity('ORGANIZATION', 'Acme Corp', 0.9, 0),
      entity('ORGANIZATION', 'Widget Inc', 0.9, 30),
      entity('ORGANIZATION', 'Global Bank', 0.9, 45),
    ];

    const result = pseudonymizeLocal(text, entities);
    const orgMappings = result.mappings.filter(m => m.type === 'ORGANIZATION');

    // Each org should get a unique pseudonym
    const pseudonyms = orgMappings.map(m => m.pseudonym);
    expect(new Set(pseudonyms).size).toBe(3);

    // None should contain the original text
    for (const m of orgMappings) {
      expect(result.maskedText).not.toContain(m.original);
    }
  });
});

// ─── Deterministic Pseudonym Generation ─────────────────────────────────────

describe('Deterministic pseudonym generation', () => {
  it('should assign the same pseudonym to identical entity text within a single call', () => {
    const text = 'John sent the file. John reviewed it. John approved.';
    const entities = [
      entity('PERSON', 'John', 0.85, 0),
      entity('PERSON', 'John', 0.85, 20),
      entity('PERSON', 'John', 0.85, 38),
    ];

    const result = pseudonymizeLocal(text, entities);

    // There should be only one unique mapping for "John"
    const johnMappings = result.mappings.filter(m => m.original === 'John');
    expect(johnMappings).toHaveLength(1);

    // The pseudonym should appear 3 times in the masked text (once per occurrence)
    const pseudonym = johnMappings[0].pseudonym;
    const occurrences = result.maskedText.split(pseudonym).length - 1;
    expect(occurrences).toBe(3);
  });

  it('should assign different pseudonyms to different entities of the same type', () => {
    const text = 'Alice and Bob attended the meeting.';
    const entities = [
      entity('PERSON', 'Alice', 0.9, 0),
      entity('PERSON', 'Bob', 0.9, 10),
    ];

    const result = pseudonymizeLocal(text, entities);
    const personMappings = result.mappings.filter(m => m.type === 'PERSON');

    expect(personMappings).toHaveLength(2);
    expect(personMappings[0].pseudonym).not.toBe(personMappings[1].pseudonym);
  });

  it('should use the same pseudonym for same text even when entity types differ', () => {
    // This is an edge case: same text detected as two different types.
    // The pseudonymizer deduplicates by text, so the first assigned pseudonym wins.
    const text = 'Contact Global: Global is our partner.';
    const entities = [
      entity('ORGANIZATION', 'Global', 0.7, 8),
      entity('PERSON', 'Global', 0.5, 16), // misdetection, same text
    ];

    const result = pseudonymizeLocal(text, entities);

    // Because entities are sorted by start desc, "Global" at position 16 is processed first.
    // Then "Global" at position 8 reuses the same pseudonym.
    // Both occurrences of "Global" should be replaced with the same token.
    expect(result.maskedText).not.toContain('Global');
  });
});

// ─── Mapping Structure ──────────────────────────────────────────────────────

describe('Mapping structure and integrity', () => {
  it('should include original, pseudonym, and type in every mapping entry', () => {
    const text = 'Name: John Doe, SSN: 123-45-6789, Email: john@test.com';
    const entities = [
      entity('PERSON', 'John Doe', 0.9, 6),
      entity('SSN', '123-45-6789', 1.0, 21),
      entity('EMAIL', 'john@test.com', 0.95, 40),
    ];

    const result = pseudonymizeLocal(text, entities);

    expect(result.mappings.length).toBe(3);
    for (const m of result.mappings) {
      expect(m.original).toBeTruthy();
      expect(m.pseudonym).toBeTruthy();
      expect(m.type).toBeTruthy();
      // Pseudonym should be different from original (realistic fake)
      expect(m.pseudonym).not.toBe(m.original);
    }
  });

  it('should produce mappings in document order (start position ascending)', () => {
    const text = 'Alice at Acme emailed bob@acme.com';
    const entities = [
      entity('PERSON', 'Alice', 0.9, 0),
      entity('ORGANIZATION', 'Acme', 0.85, 9),
      entity('EMAIL', 'bob@acme.com', 0.95, 21),
    ];

    const result = pseudonymizeLocal(text, entities);

    // Mappings should be in document order after the internal reverse
    // Verify by checking originals appear in the order we expect
    const originals = result.mappings.map(m => m.original);
    expect(originals).toEqual(['Alice', 'Acme', 'bob@acme.com']);
  });

  it('should handle empty entity list without error', () => {
    const result = pseudonymizeLocal('No entities here', []);
    expect(result.maskedText).toBe('No entities here');
    expect(result.mappings).toHaveLength(0);
  });

  it('should handle empty text without error', () => {
    const result = pseudonymizeLocal('', []);
    expect(result.maskedText).toBe('');
    expect(result.mappings).toHaveLength(0);
  });
});

// ─── Position Integrity ─────────────────────────────────────────────────────

describe('Position-based replacement integrity', () => {
  it('should not corrupt surrounding text when replacing entities', () => {
    const text = 'Hello Alice, welcome to Acme Corp. Your ID is 123-45-6789. Bye!';
    //            0     6    11             24       33           46         57
    const entities = [
      entity('PERSON', 'Alice', 0.9, 6),
      entity('ORGANIZATION', 'Acme Corp', 0.85, 24),
      entity('SSN', '123-45-6789', 1.0, 46),
    ];

    const result = pseudonymizeLocal(text, entities);

    // Non-entity text should be preserved
    expect(result.maskedText).toContain('Hello ');
    expect(result.maskedText).toContain(', welcome to ');
    expect(result.maskedText).toContain('. Your ID is ');
    expect(result.maskedText).toContain('. Bye!');

    // No undefined or NaN artifacts
    expect(result.maskedText).not.toContain('undefined');
    expect(result.maskedText).not.toContain('NaN');
  });

  it('should handle adjacent entities without losing characters between them', () => {
    // Two entities separated by a single space
    const text = 'Name: Alice Bob';
    const entities = [
      entity('PERSON', 'Alice', 0.9, 6),
      entity('PERSON', 'Bob', 0.9, 12),
    ];

    const result = pseudonymizeLocal(text, entities);

    // "Name: " prefix should be preserved, and the space between should remain
    expect(result.maskedText.startsWith('Name: ')).toBe(true);
    expect(result.maskedText).not.toContain('Alice');
    expect(result.maskedText).not.toContain('Bob');
  });
});
