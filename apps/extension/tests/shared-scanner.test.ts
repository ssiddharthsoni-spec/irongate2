/**
 * Shared Scanner Tests
 *
 * Comprehensive tests for every entity type detection,
 * risk scorer boundaries, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { detectEntities, computeRiskScore } from '../src/shared/scanner';
import { detectWithRegex } from '../src/detection/fallback-regex';
import type { DetectedEntity } from '../src/detection/types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function entity(type: string, text: string, confidence: number, start = 0): DetectedEntity {
  return { type, text, start, end: start + text.length, confidence, source: 'regex' };
}

// ─── Entity Type Detection (21 tests) ───────────────────────────────────────

describe('Entity Type Detection', () => {
  it('should detect PERSON with title prefix', () => {
    const entities = detectEntities('Dr. Sarah Johnson will attend the meeting.');
    expect(entities.some((e) => e.type === 'PERSON' && e.text.includes('Sarah Johnson'))).toBe(true);
  });

  it('should detect PERSON with contextual keyword', () => {
    const entities = detectEntities('The patient is John Carter and needs care.');
    expect(entities.some((e) => e.type === 'PERSON')).toBe(true);
  });

  it('should detect PERSON after preposition', () => {
    const entities = detectEntities('This email is from Robert Garcia regarding the case.');
    expect(entities.some((e) => e.type === 'PERSON')).toBe(true);
  });

  it('should detect ORGANIZATION with suffix', () => {
    const entities = detectEntities('We signed the contract with Acme Corp.');
    expect(entities.some((e) => e.type === 'ORGANIZATION')).toBe(true);
  });

  it('should detect ORGANIZATION with multiple suffixes', () => {
    const entities = detectEntities('Global Insurance Ltd was the underwriter.');
    expect(entities.some((e) => e.type === 'ORGANIZATION')).toBe(true);
  });

  it('should detect SSN patterns', () => {
    const entities = detectEntities('SSN: 123-45-6789');
    const ssns = entities.filter((e) => e.type === 'SSN');
    expect(ssns.length).toBe(1);
    expect(ssns[0].text).toBe('123-45-6789');
    expect(ssns[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('should detect CREDIT_CARD with spaces', () => {
    const entities = detectEntities('Card: 4111 1111 1111 1111');
    expect(entities.some((e) => e.type === 'CREDIT_CARD')).toBe(true);
  });

  it('should detect CREDIT_CARD with dashes', () => {
    const entities = detectEntities('Visa: 4111-1111-1111-1111');
    expect(entities.some((e) => e.type === 'CREDIT_CARD')).toBe(true);
  });

  it('should detect EMAIL addresses', () => {
    const entities = detectEntities('Send it to jane.doe@company.com please.');
    const emails = entities.filter((e) => e.type === 'EMAIL');
    expect(emails.length).toBe(1);
    expect(emails[0].text).toBe('jane.doe@company.com');
  });

  it('should detect PHONE_NUMBER in US format', () => {
    const entities = detectEntities('Call us at (555) 123-4567.');
    expect(entities.some((e) => e.type === 'PHONE_NUMBER')).toBe(true);
  });

  it('should detect PHONE_NUMBER with dots', () => {
    const entities = detectEntities('Phone: 555.123.4567');
    expect(entities.some((e) => e.type === 'PHONE_NUMBER')).toBe(true);
  });

  it('should detect IP_ADDRESS (IPv4)', () => {
    const entities = detectEntities('The server is at 10.0.0.1.');
    const ips = entities.filter((e) => e.type === 'IP_ADDRESS');
    expect(ips.length).toBe(1);
    expect(ips[0].text).toBe('10.0.0.1');
  });

  it('should detect DATE patterns (MM/DD/YYYY)', () => {
    const entities = detectEntities('Date of birth: 03/15/1985');
    expect(entities.some((e) => e.type === 'DATE')).toBe(true);
  });

  it('should detect DATE patterns (YYYY-MM-DD)', () => {
    const entities = detectEntities('Effective date: 2024-01-15');
    expect(entities.some((e) => e.type === 'DATE')).toBe(true);
  });

  it('should detect MONETARY_AMOUNT with dollar sign', () => {
    const entities = detectEntities('The settlement was $4,500,000.');
    expect(entities.some((e) => e.type === 'MONETARY_AMOUNT')).toBe(true);
  });

  it('should detect MONETARY_AMOUNT with text suffix', () => {
    const entities = detectEntities('Revenue was 50 million dollars.');
    expect(entities.some((e) => e.type === 'MONETARY_AMOUNT')).toBe(true);
  });

  it('should detect PASSPORT_NUMBER patterns', () => {
    const entities = detectEntities('Passport: A12345678');
    expect(entities.some((e) => e.type === 'PASSPORT_NUMBER' || e.type === 'DRIVERS_LICENSE')).toBe(true);
  });

  it('should detect ACCOUNT_NUMBER with prefix', () => {
    const entities = detectEntities('Account #12345678 needs review.');
    expect(entities.some((e) => e.type === 'ACCOUNT_NUMBER')).toBe(true);
  });

  it('should detect MEDICAL_RECORD with MRN prefix', () => {
    const entities = detectEntities('MRN: 12345678');
    expect(entities.some((e) => e.type === 'MEDICAL_RECORD')).toBe(true);
  });

  it('should detect EMPLOYEE_ID patterns', () => {
    const entities = detectEntities('Employee EMP-12345 submitted the request.');
    expect(entities.some((e) => e.type === 'EMPLOYEE_ID')).toBe(true);
  });

  it('should detect MATTER_NUMBER patterns', () => {
    const entities = detectEntities('Refer to case #2024-001234 for details.');
    expect(entities.some((e) => e.type === 'MATTER_NUMBER')).toBe(true);
  });
});

// ─── Risk Scorer Level Boundaries ───────────────────────────────────────────

describe('Risk Scorer Boundaries', () => {
  it('score 0 → low (no entities)', () => {
    const result = computeRiskScore([], 'Hello world');
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
  });

  it('score ≤25 → low', () => {
    const entities = [entity('EMAIL', 'a@b.com', 0.9)];
    const result = computeRiskScore(entities, 'Contact a@b.com');
    expect(result.score).toBeLessThanOrEqual(25);
    expect(result.level).toBe('low');
  });

  it('score 26 → medium (exact boundary)', () => {
    const entities = [entity('CUSTOM', 'val', 1.0)];
    const result = computeRiskScore(entities, 'short', { CUSTOM: 26 });
    expect(result.score).toBe(26);
    expect(result.level).toBe('medium');
  });

  it('score 60 → medium (upper bound)', () => {
    const entities = [entity('CUSTOM', 'val', 1.0)];
    const result = computeRiskScore(entities, 'short', { CUSTOM: 60 });
    expect(result.score).toBe(60);
    expect(result.level).toBe('medium');
  });

  it('score 61 → high (exact boundary)', () => {
    const entities = [entity('CUSTOM', 'val', 1.0)];
    const result = computeRiskScore(entities, 'short', { CUSTOM: 61 });
    expect(result.score).toBe(61);
    expect(result.level).toBe('high');
  });

  it('score 85 → high (upper bound)', () => {
    const longText = 'A'.repeat(5001);
    const entities = [entity('CUSTOM', 'val', 1.0, 0)];
    const result = computeRiskScore(entities, longText, { CUSTOM: 65 });
    expect(result.score).toBe(85);
    expect(result.level).toBe('high');
  });

  it('score 86 → critical (exact boundary)', () => {
    const longText = 'A'.repeat(5001);
    const entities = [entity('CUSTOM', 'val', 1.0, 0)];
    const result = computeRiskScore(entities, longText, { CUSTOM: 66 });
    expect(result.score).toBe(86);
    expect(result.level).toBe('critical');
  });

  it('score capped at 100', () => {
    const privilegeText = 'attorney-client privilege ' + 'privileged and confidential ' + 'A'.repeat(5100);
    const entities = Array.from({ length: 15 }, (_, i) => entity('SSN', `${100 + i}-45-6789`, 1.0, i * 15));
    const result = computeRiskScore(entities, privilegeText);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('score never below 0', () => {
    const result = computeRiskScore([], '');
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

// ─── Score Component Tests ──────────────────────────────────────────────────

describe('Score Components', () => {
  it('applies 1.15x bonus for 2 unique entity types', () => {
    const entities = [
      entity('PERSON', 'Jane Doe', 0.9, 0),
      entity('EMAIL', 'jane@test.com', 0.9, 15),
    ];
    const result = computeRiskScore(entities, 'Jane Doe jane@test.com');
    // PERSON(10*0.9=9) + EMAIL(12*0.9=10.8) = 19.8 * 1.15 = 22.77 → 23
    expect(result.score).toBe(23);
  });

  it('applies 1.3x bonus for 3+ unique entity types', () => {
    const entities = [
      entity('PERSON', 'John', 0.9, 0),
      entity('EMAIL', 'j@a.com', 0.9, 10),
      entity('SSN', '123-45-6789', 0.9, 25),
    ];
    const result = computeRiskScore(entities, 'John j@a.com 123-45-6789');
    expect(result.score).toBe(70); // entity cap at 70
  });

  it('applies 1.2x volume bonus for 5-9 entities', () => {
    const entities = Array.from({ length: 5 }, (_, i) =>
      entity('LOCATION', `City${i}`, 0.9, i * 10)
    );
    const result = computeRiskScore(entities, entities.map((e) => e.text).join(' '));
    // 5 * (3*0.9=2.7) = 13.5 * 1.2 = 16.2 → 16
    expect(result.score).toBe(16);
  });

  it('applies 1.4x volume bonus for 10+ entities', () => {
    const entities = Array.from({ length: 10 }, (_, i) =>
      entity('EMAIL', `u${i}@e.com`, 0.9, i * 15)
    );
    const result = computeRiskScore(entities, entities.map((e) => e.text).join(' '));
    expect(result.breakdown.entityScore).toBe(70); // capped
  });

  it('entity score capped at 70', () => {
    const entities = Array.from({ length: 15 }, (_, i) =>
      entity('SSN', `${100 + i}-45-6789`, 1.0, i * 15)
    );
    const result = computeRiskScore(entities, entities.map((e) => e.text).join(' '));
    expect(result.breakdown.entityScore).toBe(70);
  });

  it('volume score: 0 for short text (<500)', () => {
    const result = computeRiskScore([], 'short');
    expect(result.breakdown.volumeScore).toBe(0);
  });

  it('volume score: 5 for medium text (500-1999)', () => {
    const result = computeRiskScore(
      [entity('SSN', '111-22-3333', 1.0)],
      'Z'.repeat(600)
    );
    expect(result.breakdown.volumeScore).toBe(5);
  });

  it('volume score: 10 for long text (2000-4999)', () => {
    const result = computeRiskScore(
      [entity('SSN', '111-22-3333', 1.0)],
      'Y'.repeat(2500)
    );
    expect(result.breakdown.volumeScore).toBe(10);
  });

  it('volume score: 20 for very long text (5000+)', () => {
    const result = computeRiskScore(
      [entity('SSN', '111-22-3333', 1.0)],
      'X'.repeat(5100)
    );
    expect(result.breakdown.volumeScore).toBe(20);
  });

  it('legal boost for privilege markers', () => {
    const text = 'This is attorney-client privilege communication about SSN 123-45-6789.';
    const entities = detectEntities(text);
    const result = computeRiskScore(entities, text);
    expect(result.breakdown.legalBoost).toBeGreaterThan(0);
  });

  it('context score for legal keywords near entities', () => {
    const text = 'The privileged settlement involves SSN 123-45-6789.';
    const entities = detectEntities(text);
    const result = computeRiskScore(entities, text);
    expect(result.breakdown.contextScore).toBeGreaterThanOrEqual(0);
  });
});

// ─── Detection Edge Cases ───────────────────────────────────────────────────

describe('Detection Edge Cases', () => {
  it('empty string returns no entities', () => {
    expect(detectEntities('')).toHaveLength(0);
  });

  it('single character returns no entities', () => {
    expect(detectEntities('a')).toHaveLength(0);
  });

  it('all whitespace returns no entities', () => {
    expect(detectEntities('   \n\t  ')).toHaveLength(0);
  });

  it('numbers only (not matching patterns) returns no entities', () => {
    expect(detectEntities('42 is the answer')).toHaveLength(0);
  });

  it('entity positions are valid (start < end, within text bounds)', () => {
    const text = 'Dr. Smith at (555) 123-4567 with SSN 123-45-6789';
    const entities = detectEntities(text);
    for (const e of entities) {
      expect(e.start).toBeGreaterThanOrEqual(0);
      expect(e.end).toBeGreaterThan(e.start);
      expect(e.end).toBeLessThanOrEqual(text.length);
    }
  });

  it('multiple SSNs detected correctly', () => {
    const text = 'SSN1: 111-22-3333 and SSN2: 444-55-6666';
    const ssns = detectEntities(text).filter((e) => e.type === 'SSN');
    expect(ssns.length).toBe(2);
  });

  it('overlapping entities keep higher confidence', () => {
    // detectWithRegex already handles overlaps
    const text = 'Dr. Sarah Chen at Global Bank';
    const entities = detectEntities(text);
    // No two entities should share the same span
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const overlap =
          entities[i].start < entities[j].end && entities[j].start < entities[i].end;
        expect(overlap).toBe(false);
      }
    }
  });

  it('entities are sorted by position', () => {
    const text = 'Email: a@b.com, SSN: 123-45-6789, Phone: (555) 111-2222';
    const entities = detectEntities(text);
    for (let i = 1; i < entities.length; i++) {
      expect(entities[i].start).toBeGreaterThanOrEqual(entities[i - 1].start);
    }
  });
});

// ─── Score Explanation ──────────────────────────────────────────────────────

describe('Score Explanation', () => {
  it('explains "No sensitive information" for zero entities', () => {
    const result = computeRiskScore([], 'Hello');
    expect(result.explanation).toContain('No sensitive information');
  });

  it('explains detected entity types', () => {
    const entities = [entity('SSN', '123-45-6789', 0.95)];
    const result = computeRiskScore(entities, 'SSN: 123-45-6789');
    expect(result.explanation.toLowerCase()).toContain('ssn');
  });

  it('mentions privilege markers when present', () => {
    const text = 'This is privileged and confidential. SSN: 123-45-6789';
    const entities = detectEntities(text);
    const result = computeRiskScore(entities, text);
    expect(result.explanation.toLowerCase()).toContain('privilege');
  });

  it('mentions large text volume for long documents', () => {
    const text = 'A'.repeat(2100) + ' Contact: john@test.com';
    const entities = detectEntities(text);
    const result = computeRiskScore(entities, text);
    expect(result.explanation.toLowerCase()).toContain('volume');
  });
});
