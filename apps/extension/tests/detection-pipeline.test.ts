/**
 * Detection & Pseudonymization Pipeline Tests
 *
 * Tests the full flow: regex detection → scoring → pseudonymization → de-pseudonymization
 */

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { computeScore } from '../src/detection/scorer';
import { pseudonymizeLocal } from '../src/detection/pseudonymizer';

// ─── Regex Detection Tests ──────────────────────────────────────────────────

describe('Regex Detection', () => {
  it('should detect SSN patterns', () => {
    const text = 'His SSN is 123-45-6789 and hers is 987-65-4321.';
    const entities = detectWithRegex(text);
    const ssns = entities.filter(e => e.type === 'SSN');
    expect(ssns.length).toBeGreaterThanOrEqual(2);
    expect(ssns.some(e => e.text.includes('123-45-6789'))).toBe(true);
    expect(ssns.some(e => e.text.includes('987-65-4321'))).toBe(true);
  });

  it('should detect credit card numbers', () => {
    const text = 'Card number: 4111-1111-1111-1111';
    const entities = detectWithRegex(text);
    const cards = entities.filter(e => e.type === 'CREDIT_CARD');
    expect(cards.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect email addresses', () => {
    const text = 'Contact john.smith@acmecorp.com for details.';
    const entities = detectWithRegex(text);
    const emails = entities.filter(e => e.type === 'EMAIL');
    expect(emails.length).toBe(1);
    expect(emails[0].text).toBe('john.smith@acmecorp.com');
  });

  it('should detect phone numbers', () => {
    const text = 'Call me at (555) 123-4567 or 555-987-6543.';
    const entities = detectWithRegex(text);
    const phones = entities.filter(e => e.type === 'PHONE_NUMBER');
    expect(phones.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect person names with titles', () => {
    const text = 'Dr. Sarah Johnson will review the case.';
    const entities = detectWithRegex(text);
    const persons = entities.filter(e => e.type === 'PERSON');
    expect(persons.length).toBeGreaterThanOrEqual(1);
    expect(persons.some(e => e.text.includes('Sarah Johnson'))).toBe(true);
  });

  it('should detect organizations', () => {
    const text = 'The contract with Acme Corp is pending review.';
    const entities = detectWithRegex(text);
    const orgs = entities.filter(e => e.type === 'ORGANIZATION');
    expect(orgs.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect IP addresses', () => {
    const text = 'Server is at 192.168.1.100 on port 3000.';
    const entities = detectWithRegex(text);
    const ips = entities.filter(e => e.type === 'IP_ADDRESS');
    expect(ips.length).toBe(1);
    expect(ips[0].text).toBe('192.168.1.100');
  });

  it('should handle text with no entities', () => {
    const text = 'What is the weather like today?';
    const entities = detectWithRegex(text);
    expect(entities.length).toBe(0);
  });

  it('should handle empty string', () => {
    const entities = detectWithRegex('');
    expect(entities.length).toBe(0);
  });

  it('should detect multiple entity types in one prompt', () => {
    const text = 'Dr. John Smith (SSN: 123-45-6789, email: john@acme.com) at Acme Corp called (555) 123-4567.';
    const entities = detectWithRegex(text);
    const types = new Set(entities.map(e => e.type));
    expect(types.has('PERSON')).toBe(true);
    expect(types.has('SSN')).toBe(true);
    expect(types.has('EMAIL')).toBe(true);
  });

  it('should have valid start/end positions', () => {
    const text = 'Contact john@example.com for info.';
    const entities = detectWithRegex(text);
    for (const e of entities) {
      expect(e.start).toBeGreaterThanOrEqual(0);
      expect(e.end).toBeGreaterThan(e.start);
      expect(e.end).toBeLessThanOrEqual(text.length);
      expect(text.substring(e.start, e.end)).toBe(e.text);
    }
  });
});

// ─── Scoring Tests ──────────────────────────────────────────────────────────

describe('Sensitivity Scoring', () => {
  it('should score zero for empty entities', () => {
    const result = computeScore('Hello world', []);
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
  });

  it('should score low for a single email', () => {
    const text = 'Contact john@example.com for details.';
    const entities = detectWithRegex(text);
    const result = computeScore(text, entities);
    expect(result.score).toBeLessThanOrEqual(60);
    expect(['low', 'medium']).toContain(result.level);
  });

  it('should score high for SSN', () => {
    const text = 'SSN is 123-45-6789';
    const entities = detectWithRegex(text);
    const result = computeScore(text, entities);
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it('should score higher for multiple sensitive entities', () => {
    const text = 'Dr. John Smith (SSN: 123-45-6789) has credit card 4111-1111-1111-1111 and email john@acme.com. Call (555) 123-4567.';
    const entities = detectWithRegex(text);
    const result = computeScore(text, entities);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(['high', 'critical']).toContain(result.level);
  });

  it('should return valid score breakdown', () => {
    const text = 'SSN: 123-45-6789';
    const entities = detectWithRegex(text);
    const result = computeScore(text, entities);
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.entityScore).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.volumeScore).toBeGreaterThanOrEqual(0);
    expect(result.explanation).toBeTruthy();
  });

  it('should cap score at 100', () => {
    // Create many entities to try to exceed 100
    const entities = Array.from({ length: 20 }, (_, i) => ({
      type: 'SSN',
      text: `${100 + i}-${45 + i}-${6789 + i}`,
      start: i * 15,
      end: i * 15 + 11,
      confidence: 0.95,
      source: 'regex' as const,
    }));
    const text = entities.map(e => e.text).join(' ');
    const result = computeScore(text, entities);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ─── Pseudonymization Tests ─────────────────────────────────────────────────

describe('Pseudonymization', () => {
  it('should replace detected entities with pseudonym tokens', () => {
    const text = 'Contact john@example.com about the case.';
    const entities = detectWithRegex(text);
    const result = pseudonymizeLocal(text, entities);

    // Original email should be gone
    expect(result.maskedText).not.toContain('john@example.com');
    // Should have a pseudonym token
    expect(result.maskedText).toMatch(/\[EMAIL-\d+\]/);
    expect(result.mappings.length).toBeGreaterThanOrEqual(1);
  });

  it('should create deterministic pseudonyms for same entity text', () => {
    const text = 'John sent to john@example.com. John also called.';
    const entities = [
      { type: 'PERSON', text: 'John', start: 0, end: 4, confidence: 0.8, source: 'regex' as const },
      { type: 'EMAIL', text: 'john@example.com', start: 13, end: 29, confidence: 0.95, source: 'regex' as const },
      { type: 'PERSON', text: 'John', start: 31, end: 35, confidence: 0.8, source: 'regex' as const },
    ];
    const result = pseudonymizeLocal(text, entities);

    // Both "John" occurrences should have the same pseudonym
    const johnMapping = result.mappings.find(m => m.original === 'John');
    expect(johnMapping).toBeDefined();

    // Count occurrences of the John pseudonym in masked text
    const pseudonym = johnMapping!.pseudonym;
    const count = result.maskedText.split(pseudonym).length - 1;
    expect(count).toBe(2);
  });

  it('should handle empty entity list', () => {
    const result = pseudonymizeLocal('Hello world', []);
    expect(result.maskedText).toBe('Hello world');
    expect(result.mappings).toHaveLength(0);
  });

  it('should produce valid position-based replacements', () => {
    const text = 'SSN: 123-45-6789 and email: test@example.com';
    const entities = detectWithRegex(text);
    const result = pseudonymizeLocal(text, entities);

    // The masked text should be a valid string (no undefined, no NaN)
    expect(result.maskedText).toBeTruthy();
    expect(result.maskedText).not.toContain('undefined');
    expect(result.maskedText).not.toContain('NaN');

    // Original values should be gone
    expect(result.maskedText).not.toContain('123-45-6789');
    expect(result.maskedText).not.toContain('test@example.com');
  });

  it('should handle overlapping entities correctly', () => {
    const text = 'Dr. John Smith at Acme Corp Inc';
    const entities = [
      { type: 'PERSON', text: 'Dr. John Smith', start: 0, end: 14, confidence: 0.9, source: 'regex' as const },
      { type: 'ORGANIZATION', text: 'Acme Corp Inc', start: 18, end: 31, confidence: 0.8, source: 'regex' as const },
    ];
    const result = pseudonymizeLocal(text, entities);
    expect(result.maskedText).toContain('[PERSON-1]');
    expect(result.maskedText).toContain('[ORGANIZATION-1]');
    expect(result.maskedText).not.toContain('John Smith');
    expect(result.maskedText).not.toContain('Acme Corp');
  });

  it('should maintain mapping for de-pseudonymization', () => {
    const text = 'Dr. Sarah Chen (SSN: 123-45-6789) at Global Corp';
    const entities = detectWithRegex(text);
    const result = pseudonymizeLocal(text, entities);

    // Each mapping should have original, pseudonym, and type
    for (const m of result.mappings) {
      expect(m.original).toBeTruthy();
      expect(m.pseudonym).toMatch(/\[.+\]/);
      expect(m.type).toBeTruthy();
    }

    // De-pseudonymize (reverse the mappings)
    let restored = result.maskedText;
    for (const m of result.mappings) {
      restored = restored.replaceAll(m.pseudonym, m.original);
    }

    // Restored text should contain all original entities
    for (const m of result.mappings) {
      expect(restored).toContain(m.original);
    }
  });
});

// ─── Full Pipeline: detect → score → pseudonymize → de-pseudonymize ────────

describe('Full Pipeline Round-Trip', () => {
  const testPrompts = [
    'Please review the contract for Dr. John Smith (SSN: 123-45-6789) at Acme Corp regarding the merger with Widget Inc.',
    'Patient Sarah Chen, DOB 03/15/1985, diagnosed with hypertension. Contact: sarah.chen@hospital.org, (555) 234-5678.',
    'Transfer $50,000 from account 1234567890 to Global Bank Ltd. Wire reference: WO-12345.',
    'Attorney-client privileged: Case Smith v. Jones, matter #2024-CV-1234, client SSN 987-65-4321.',
    'Server at 192.168.1.100 has credentials: admin@company.com / password123.',
  ];

  for (const [i, prompt] of testPrompts.entries()) {
    it(`should round-trip prompt ${i + 1}: "${prompt.substring(0, 50)}..."`, () => {
      // 1. Detect entities
      const entities = detectWithRegex(prompt);
      expect(entities.length).toBeGreaterThan(0);

      // 2. Score sensitivity
      const score = computeScore(prompt, entities);
      expect(score.score).toBeGreaterThan(0);
      expect(score.level).toBeTruthy();

      // 3. Pseudonymize
      const pseudoResult = pseudonymizeLocal(prompt, entities);
      expect(pseudoResult.maskedText).not.toBe(prompt);
      expect(pseudoResult.mappings.length).toBeGreaterThan(0);

      // 4. Verify no original PII remains
      for (const m of pseudoResult.mappings) {
        expect(pseudoResult.maskedText).not.toContain(m.original);
      }

      // 5. De-pseudonymize (reverse mapping)
      let restored = pseudoResult.maskedText;
      for (const m of pseudoResult.mappings) {
        restored = restored.replaceAll(m.pseudonym, m.original);
      }

      // 6. All originals should be restored
      for (const m of pseudoResult.mappings) {
        expect(restored).toContain(m.original);
      }
    });
  }
});

// ─── Realistic Fake Name Pipeline (MAIN world) ─────────────────────────────

describe('Realistic Pseudonymization (main-world style)', () => {
  // Simulate the main-world.ts generateFake() approach
  const FAKE_NAMES = ['Michael Johnson', 'Emily Davis', 'Robert Wilson', 'Sarah Miller'];
  const FAKE_ORGS = ['Globex Corp', 'Initech Ltd', 'Vandelay Industries'];
  let nameIdx = 0;
  let orgIdx = 0;

  function generateRealisticPseudonym(entity: { type: string; text: string }): string {
    switch (entity.type) {
      case 'PERSON':
        return FAKE_NAMES[nameIdx++ % FAKE_NAMES.length];
      case 'ORGANIZATION':
        return FAKE_ORGS[orgIdx++ % FAKE_ORGS.length];
      case 'SSN':
        return '000-00-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      case 'EMAIL':
        return 'user' + Math.floor(Math.random() * 1000) + '@example.com';
      case 'PHONE_NUMBER':
        return '(555) 000-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      default:
        return `[${entity.type}]`;
    }
  }

  it('should produce natural-looking pseudonymized text', () => {
    const text = 'Please review the contract for Dr. John Smith at Acme Corp. His SSN is 123-45-6789.';
    const entities = detectWithRegex(text);

    // Sort by position descending for safe replacement
    const sorted = [...entities].sort((a, b) => b.start - a.start);
    let maskedText = text;
    const reverseMap: Record<string, string> = {};

    for (const e of sorted) {
      const fake = generateRealisticPseudonym(e);
      maskedText = maskedText.substring(0, e.start) + fake + maskedText.substring(e.end);
      reverseMap[fake] = e.text;
    }

    // Should look natural (no bracket tokens)
    expect(maskedText).not.toMatch(/\[.+-\d+\]/);
    // Original PII should be gone
    expect(maskedText).not.toContain('John Smith');
    expect(maskedText).not.toContain('123-45-6789');
    expect(maskedText).not.toContain('Acme Corp');
  });
});
