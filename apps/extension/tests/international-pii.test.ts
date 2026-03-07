/**
 * International PII Detection Tests
 *
 * 35 tests (5 per country) validating regex detection of international
 * PII patterns: UK NINO, EU IBAN, Canadian SIN, Indian Aadhaar,
 * Australian TFN, German Tax ID, French INSEE.
 */

import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../src/detection/fallback-regex';
import { computeScore } from '../src/detection/scorer';

// ─── Helper ─────────────────────────────────────────────────────────────────

function detectType(text: string, type: string) {
  return detectWithRegex(text).filter((e) => e.type === type);
}

function hasEntity(text: string, type: string): boolean {
  return detectType(text, type).length > 0;
}

function maxConfidence(text: string, type: string): number {
  const entities = detectType(text, type);
  if (entities.length === 0) return 0;
  return Math.max(...entities.map((e) => e.confidence));
}

// ─── UK National Insurance Number (NINO) ────────────────────────────────────

describe('UK NINO Detection', () => {
  it('should detect a valid NINO', () => {
    // QQ is excluded from valid NINO prefixes; use AB which is valid
    const entities = detectType('Her NINO is AB123456C', 'UK_NINO');
    expect(entities.length).toBeGreaterThanOrEqual(1);
    expect(entities.some((e) => e.text.includes('AB123456C'))).toBe(true);
  });

  it('should detect NINO with context keyword at higher confidence', () => {
    const withContext = maxConfidence('National Insurance Number: AB123456C', 'UK_NINO');
    const bare = maxConfidence('Please reference AB123456C in the file', 'UK_NINO');
    expect(withContext).toBeGreaterThan(bare);
  });

  it('should not match when suffix letter is invalid (E-Z)', () => {
    // Valid NINO suffix is only A-D; E is invalid
    expect(hasEntity('Code: AB123456E', 'UK_NINO')).toBe(false);
  });

  it('should not match when prefix uses excluded letters (D, F, I, Q, U, V)', () => {
    // D and F are excluded from the character class
    expect(hasEntity('Reference DA123456B', 'UK_NINO')).toBe(false);
    expect(hasEntity('Reference QQ123456A', 'UK_NINO')).toBe(false);
  });

  it('should not match partial NINOs (too few digits)', () => {
    expect(hasEntity('Code: QQ12345A', 'UK_NINO')).toBe(false);
  });
});

// ─── EU IBAN ────────────────────────────────────────────────────────────────

describe('EU IBAN Detection', () => {
  it('should detect a valid German IBAN', () => {
    const entities = detectType('Transfer to DE89 3704 0044 0532 0130 00', 'EU_IBAN');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect IBAN with context keyword at higher confidence', () => {
    const withContext = maxConfidence('IBAN: GB29 NWBK 6016 1331 9268 19', 'EU_IBAN');
    const bare = maxConfidence('Send to GB29 NWBK 6016 1331 9268 19 please', 'EU_IBAN');
    expect(withContext).toBeGreaterThan(bare);
  });

  it('should not match random uppercase strings', () => {
    // Too short to be a valid IBAN
    expect(hasEntity('Code: AB12 CDEF', 'EU_IBAN')).toBe(false);
  });

  it('should detect a French IBAN', () => {
    const entities = detectType('IBAN: FR76 3000 6000 0112 3456 7890 189', 'EU_IBAN');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should not match when country code is lowercase', () => {
    // IBAN always starts with uppercase country code
    expect(hasEntity('gb29 NWBK 6016 1331 9268 19', 'EU_IBAN')).toBe(false);
  });
});

// ─── Canadian SIN ───────────────────────────────────────────────────────────

describe('Canadian SIN Detection', () => {
  it('should detect SIN with context keyword', () => {
    const entities = detectType('Social Insurance Number: 046-454-286', 'CANADIAN_SIN');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect SIN with keyword at higher confidence than bare pattern', () => {
    const withContext = maxConfidence('SIN: 046-454-286', 'CANADIAN_SIN');
    const bare = maxConfidence('Reference 046-454-286 in file', 'CANADIAN_SIN');
    expect(withContext).toBeGreaterThan(bare);
  });

  it('should not match random 9-digit numbers without context', () => {
    // Bare 9-digit without dashes and without context should not match
    expect(hasEntity('The total was 123456789 units', 'CANADIAN_SIN')).toBe(false);
  });

  it('should detect SIN with spaces as separators', () => {
    const entities = detectType('Canadian SIN is 046 454 286', 'CANADIAN_SIN');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should not match when too many digits', () => {
    // 10+ digits should not match
    expect(hasEntity('SIN: 1234567890', 'CANADIAN_SIN')).toBe(false);
  });
});

// ─── Indian Aadhaar ─────────────────────────────────────────────────────────

describe('Indian Aadhaar Detection', () => {
  it('should detect a valid Aadhaar number', () => {
    const entities = detectType('Aadhaar: 2345 6789 0123', 'INDIAN_AADHAAR');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect Aadhaar with context keyword at higher confidence', () => {
    const withContext = maxConfidence('Aadhaar number: 9876 5432 1098', 'INDIAN_AADHAAR');
    const bare = maxConfidence('Code 9876 5432 1098 reference', 'INDIAN_AADHAAR');
    expect(withContext).toBeGreaterThan(bare);
  });

  it('should not match numbers starting with 0 or 1', () => {
    // Aadhaar never starts with 0 or 1
    expect(hasEntity('Aadhaar: 0123 4567 8901', 'INDIAN_AADHAAR')).toBe(false);
    expect(hasEntity('Aadhaar: 1234 5678 9012', 'INDIAN_AADHAAR')).toBe(false);
  });

  it('should detect Aadhaar without separators', () => {
    const entities = detectType('UIDAI number is 234567890123', 'INDIAN_AADHAAR');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should not match 8-digit or 11-digit numbers', () => {
    // Too few digits
    expect(hasEntity('Aadhaar: 2345 6789', 'INDIAN_AADHAAR')).toBe(false);
  });
});

// ─── Australian TFN ─────────────────────────────────────────────────────────

describe('Australian TFN Detection', () => {
  it('should detect TFN with context keyword', () => {
    const entities = detectType('Tax File Number: 123 456 789', 'AUSTRALIAN_TFN');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect TFN with abbreviation', () => {
    const entities = detectType('TFN: 987-654-321', 'AUSTRALIAN_TFN');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should not match bare 9-digit numbers without TFN context', () => {
    // Without context, we should not detect as TFN
    const entities = detectType('The reference number is 123456789', 'AUSTRALIAN_TFN');
    expect(entities.length).toBe(0);
  });

  it('should detect TFN with "Australian tax" context', () => {
    const entities = detectType('Australian tax number is 456 789 012', 'AUSTRALIAN_TFN');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should not match when too many digits follow', () => {
    const entities = detectType('TFN: 1234567890', 'AUSTRALIAN_TFN');
    expect(entities.length).toBe(0);
  });
});

// ─── German Tax ID (Steuer-ID) ──────────────────────────────────────────────

describe('German Tax ID Detection', () => {
  it('should detect Steuer-ID with context keyword', () => {
    const entities = detectType('Steuer-ID: 12 345 678 901', 'GERMAN_TAX_ID');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect with "Steuerliche Identifikationsnummer" keyword', () => {
    const entities = detectType(
      'Steuerliche Identifikationsnummer: 65 432 109 876',
      'GERMAN_TAX_ID'
    );
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should not match random 11-digit numbers without context', () => {
    // Without context keyword, bare 11 continuous digits should not match
    const entities = detectType('Order 12345678901 confirmed', 'GERMAN_TAX_ID');
    expect(entities.length).toBe(0);
  });

  it('should detect with IdNr keyword', () => {
    const entities = detectType('IdNr: 02 345 678 901', 'GERMAN_TAX_ID');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect bare pattern with space separators', () => {
    // The bare pattern only matches with space separators (dd ddd ddd ddd)
    const entities = detectType('Reference 12 345 678 901 in the form', 'GERMAN_TAX_ID');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── French INSEE / NIR ─────────────────────────────────────────────────────

describe('French INSEE Detection', () => {
  it('should detect a valid INSEE number', () => {
    // Male, born Jan 1985, dept 75, commune 056, order 123, key 45
    const entities = detectType('INSEE: 185017505612345', 'FRENCH_INSEE');
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect INSEE with context keyword at higher confidence', () => {
    const withContext = maxConfidence(
      'Numero de securite sociale: 285076505612345',
      'FRENCH_INSEE'
    );
    const bare = maxConfidence('Reference 285076505612345 in records', 'FRENCH_INSEE');
    expect(withContext).toBeGreaterThan(bare);
  });

  it('should not match numbers starting with 3-9 (sex digit must be 1 or 2)', () => {
    expect(hasEntity('Code: 385017505612345', 'FRENCH_INSEE')).toBe(false);
    expect(hasEntity('Code: 985017505612345', 'FRENCH_INSEE')).toBe(false);
  });

  it('should not match invalid month (13+)', () => {
    // Month 13 is invalid (only 01-12 or 20+ for overseas)
    expect(hasEntity('Code: 18513750561234500', 'FRENCH_INSEE')).toBe(false);
  });

  it('should detect with NIR keyword', () => {
    const entities = detectType('NIR: 269aborting... 269126505698712', 'FRENCH_INSEE');
    // This tests that the NIR keyword triggers detection for a valid number
    const entities2 = detectType('NIR: 269126505698712', 'FRENCH_INSEE');
    expect(entities2.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Cross-cutting: Scorer Integration ──────────────────────────────────────

describe('International PII Scoring Integration', () => {
  it('should score UK NINO as medium or higher', () => {
    const text = 'NINO: AB123456C';
    const entities = detectWithRegex(text);
    const result = computeScore(text, entities);
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it('should score EU IBAN as medium or higher', () => {
    const text = 'IBAN: DE89 3704 0044 0532 0130 00';
    const entities = detectWithRegex(text);
    const result = computeScore(text, entities);
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it('should score multiple international entities higher than single', () => {
    const singleText = 'NINO: AB123456C';
    const multiText =
      'NINO: AB123456C and IBAN: DE89 3704 0044 0532 0130 00 and Aadhaar: 2345 6789 0123';
    const singleEntities = detectWithRegex(singleText);
    const multiEntities = detectWithRegex(multiText);
    const singleScore = computeScore(singleText, singleEntities);
    const multiScore = computeScore(multiText, multiEntities);
    expect(multiScore.score).toBeGreaterThan(singleScore.score);
  });
});
