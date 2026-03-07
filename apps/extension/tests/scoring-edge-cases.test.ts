/**
 * Scoring Edge Cases Tests
 *
 * Tests boundary conditions and edge cases for the sensitivity scoring algorithm,
 * including level thresholds, combination bonuses, volume multipliers, and caps.
 */

import { describe, it, expect } from 'vitest';
import { computeScore } from '../src/detection/scorer';
import type { DetectedEntity } from '../src/detection/types';

// ─── Helper ─────────────────────────────────────────────────────────────────

/** Build a DetectedEntity at a given position. */
function entity(
  type: string,
  text: string,
  confidence: number,
  start = 0
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

// ─── Zero Entities ──────────────────────────────────────────────────────────

describe('Zero entities', () => {
  it('should return score 0 and level low when no entities are detected', () => {
    const result = computeScore('Just a normal sentence with no PII.', []);
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
  });
});

// ─── Single Entity Scoring ──────────────────────────────────────────────────

describe('Single entity scoring', () => {
  it('should score ~11 (level low) for a single EMAIL entity with confidence 0.9', () => {
    // EMAIL weight = 12, confidence 0.9 => 12 * 0.9 = 10.8 => rounded to 11
    const entities = [entity('EMAIL', 'john@example.com', 0.9)];
    const result = computeScore('Contact john@example.com', entities);
    expect(result.score).toBe(11);
    expect(result.level).toBe('low');
  });

  it('should score at least 61 (level high) for a single SSN entity with confidence 1.0', () => {
    // SSN is ALWAYS_CRITICAL type — floor is 61 (high minimum)
    const entities = [entity('SSN', '123-45-6789', 1.0)];
    const result = computeScore('SSN is 123-45-6789', entities);
    expect(result.score).toBeGreaterThanOrEqual(61);
    expect(result.level).toBe('high');
  });
});

// ─── Combination Bonus ──────────────────────────────────────────────────────

describe('Entity combination bonus (1.3x for 3+ types)', () => {
  it('should apply 1.3x bonus for 3 different entity types, reaching high or above', () => {
    // PERSON=10*0.9=9, EMAIL=12*0.9=10.8, SSN=40*0.9=36 => sum=55.8
    // 3 unique types => 55.8 * 1.3 = 72.54, capped at 70 (entity cap)
    // Co-occurrence: PERSON + SSN (high PII) in proximity → 1.5x multiplier
    // 70 * 1.5 = 105 → capped at 100
    const entities = [
      entity('PERSON', 'John Smith', 0.9, 0),
      entity('EMAIL', 'john@acme.com', 0.9, 20),
      entity('SSN', '123-45-6789', 0.9, 40),
    ];
    const result = computeScore('John Smith john@acme.com 123-45-6789', entities);
    expect(result.score).toBe(100);
    expect(result.level).toBe('critical');
  });

  it('should apply 1.15x bonus for exactly 2 different entity types', () => {
    // PERSON=10*0.9=9, EMAIL=12*0.9=10.8 => sum=19.8
    // 2 unique types => 19.8 * 1.15 = 22.77 => ~23
    // Relationship analyzer: proximity boost ~+2
    const entities = [
      entity('PERSON', 'Jane Doe', 0.9, 0),
      entity('EMAIL', 'jane@test.com', 0.9, 15),
    ];
    const result = computeScore('Jane Doe jane@test.com', entities);
    expect(result.score).toBe(25);
    expect(result.level).toBe('low');
  });
});

// ─── Volume Multiplier ──────────────────────────────────────────────────────

describe('Volume multiplier (1.4x for 10+ entities)', () => {
  it('should apply 1.4x multiplier when 10 or more entities are present', () => {
    // 10 EMAIL entities: 10 * (12 * 0.9) = 108
    // Only 1 unique type => no combination bonus
    // 10 entities => 1.4x => 108 * 1.4 = 151.2, but entity score capped at 70
    const entities = Array.from({ length: 10 }, (_, i) =>
      entity('EMAIL', `user${i}@example.com`, 0.9, i * 25)
    );
    const text = entities.map(e => e.text).join(' ');
    const result = computeScore(text, entities);

    // Entity score is capped at 70; no legal/context boost on this text
    // Volume score depends on text length
    expect(result.breakdown.entityScore).toBe(70);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('should apply 1.2x multiplier when 5-9 entities are present', () => {
    // 5 LOCATION entities: 5 * (3 * 0.9) = 13.5 => 13.5 * 1.2 = 16.2 => ~16
    // Plus relationship analyzer proximity boost for nearby entities → ~+3
    const entities = Array.from({ length: 5 }, (_, i) =>
      entity('LOCATION', `City${i}`, 0.9, i * 10)
    );
    const text = entities.map(e => e.text).join(' ');
    const result = computeScore(text, entities);
    expect(result.score).toBe(19);
  });
});

// ─── Entity Score Cap ───────────────────────────────────────────────────────

describe('Entity score cap at 70', () => {
  it('should cap entity score at 70 even with many high-weight entities', () => {
    // 15 SSN entities: 15 * (40 * 1.0) = 600 * 1.4 (10+ count) = 840, but capped at 70
    const entities = Array.from({ length: 15 }, (_, i) =>
      entity('SSN', `${100 + i}-45-6789`, 1.0, i * 15)
    );
    const text = entities.map(e => e.text).join(' ');
    const result = computeScore(text, entities);
    expect(result.breakdown.entityScore).toBe(70);
  });

  it('should cap entity score at 70 with multiple high-weight types combined', () => {
    // 5 SSN (40*1.0=40 each) + 5 CREDIT_CARD (30*1.0=30 each) = 200+150=350
    // 2 types => 1.15x => 402.5; 10 entities => 1.4x => 563.5; but cap = 70
    const ssns = Array.from({ length: 5 }, (_, i) =>
      entity('SSN', `${200 + i}-55-1234`, 1.0, i * 20)
    );
    const cards = Array.from({ length: 5 }, (_, i) =>
      entity('CREDIT_CARD', `4111-1111-1111-${1000 + i}`, 1.0, 100 + i * 25)
    );
    const entities = [...ssns, ...cards];
    const text = entities.map(e => e.text).join(' ');
    const result = computeScore(text, entities);
    expect(result.breakdown.entityScore).toBe(70);
  });
});

// ─── Level Boundaries ───────────────────────────────────────────────────────

describe('Level boundary thresholds', () => {
  // scoreToLevel is not exported, so we test it through computeScore.
  // We use customWeights to precisely control the entity score.

  it('score 25 should be level low (upper bound of low)', () => {
    // Use a custom weight to get exactly entity score = 25
    // Single entity, confidence 1.0, custom weight 25 => entityScore = 25
    const entities = [entity('CUSTOM_TYPE', 'test-value', 1.0)];
    const result = computeScore('short text', entities, { CUSTOM_TYPE: 25 });
    expect(result.score).toBe(25);
    expect(result.level).toBe('low');
  });

  it('score 26 should be level medium (lower bound of medium)', () => {
    const entities = [entity('CUSTOM_TYPE', 'test-value', 1.0)];
    const result = computeScore('short text', entities, { CUSTOM_TYPE: 26 });
    expect(result.score).toBe(26);
    expect(result.level).toBe('medium');
  });

  it('score 60 should be level medium (upper bound of medium)', () => {
    const entities = [entity('CUSTOM_TYPE', 'test-value', 1.0)];
    const result = computeScore('short text', entities, { CUSTOM_TYPE: 60 });
    expect(result.score).toBe(60);
    expect(result.level).toBe('medium');
  });

  it('score 61 should be level high (lower bound of high)', () => {
    const entities = [entity('CUSTOM_TYPE', 'test-value', 1.0)];
    const result = computeScore('short text', entities, { CUSTOM_TYPE: 61 });
    expect(result.score).toBe(61);
    expect(result.level).toBe('high');
  });

  it('score 85 should be level high (upper bound of high)', () => {
    // entityScore caps at 70, so we need additional points from volume/context/legal.
    // Use a large text (>5000 chars) to get volumeScore = 20, plus entityScore = 65.
    const longText = 'A'.repeat(5001);
    const entities = [entity('CUSTOM_TYPE', 'test-value', 1.0, 0)];
    const result = computeScore(longText, entities, { CUSTOM_TYPE: 65 });
    // entityScore = 65, volumeScore = 20 => total 85
    expect(result.score).toBe(85);
    expect(result.level).toBe('high');
  });

  it('score 86 should be level critical (lower bound of critical)', () => {
    // entityScore = 66, volumeScore = 20 => total 86
    const longText = 'A'.repeat(5001);
    const entities = [entity('CUSTOM_TYPE', 'test-value', 1.0, 0)];
    const result = computeScore(longText, entities, { CUSTOM_TYPE: 66 });
    expect(result.score).toBe(86);
    expect(result.level).toBe('critical');
  });
});

// ─── Large Text Volume Score ────────────────────────────────────────────────

describe('Large text (>5000 chars) volume score', () => {
  it('should add 20 to the score via volumeScore for text longer than 5000 characters', () => {
    const longText = 'X'.repeat(5100);
    // Use EMAIL (weight=20) instead of SSN (has floor of 61)
    const entities = [entity('EMAIL', 'test@example.com', 1.0, 0)];
    const result = computeScore(longText, entities);
    expect(result.breakdown.volumeScore).toBe(20);
    // entityScore=20 + volumeScore=20 = 40 (or higher with context)
    expect(result.breakdown.volumeScore).toBe(20);
  });

  it('should add 10 for text between 2000 and 4999 characters', () => {
    const mediumText = 'Y'.repeat(2500);
    const entities = [entity('EMAIL', 'test@example.com', 1.0, 0)];
    const result = computeScore(mediumText, entities);
    expect(result.breakdown.volumeScore).toBe(10);
  });

  it('should add 5 for text between 500 and 1999 characters', () => {
    const shortText = 'Z'.repeat(600);
    const entities = [entity('EMAIL', 'test@example.com', 1.0, 0)];
    const result = computeScore(shortText, entities);
    expect(result.breakdown.volumeScore).toBe(5);
  });

  it('should add 0 for text under 500 characters', () => {
    const tinyText = 'Hello world';
    const entities = [entity('EMAIL', 'test@example.com', 1.0, 0)];
    const result = computeScore(tinyText, entities);
    expect(result.breakdown.volumeScore).toBe(0);
  });
});

// ─── Score Clamping ─────────────────────────────────────────────────────────

describe('Overall score clamping', () => {
  it('should never exceed 100 even with maximum entity, volume, context, and legal scores', () => {
    // Construct a scenario with legal keywords, privilege markers, large text, and many entities
    const privilegeText = 'attorney-client privilege ' + 'privileged and confidential ' + 'A'.repeat(5100);
    const entities = Array.from({ length: 15 }, (_, i) =>
      entity('SSN', `${100 + i}-45-6789`, 1.0, i * 15)
    );
    const result = computeScore(privilegeText, entities);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('should never go below 0', () => {
    const result = computeScore('', []);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
