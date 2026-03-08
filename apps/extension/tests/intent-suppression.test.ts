/**
 * Intent-Aware Suppression Tests
 *
 * Validates that PII used intentionally (horoscopes, research, self-intro)
 * is suppressed, while PII in data records is still protected.
 */

import { describe, it, expect } from 'vitest';
import { applyIntentSuppression } from '../src/detection/intent-suppression';
import { computeScore } from '../src/detection/scorer';
import type { DetectedEntity } from '../src/detection/types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeEntity(type: string, text: string, start: number): DetectedEntity {
  return {
    type,
    text,
    start,
    end: start + text.length,
    confidence: 0.8,
  };
}

// ─── Unit Tests: applyIntentSuppression ─────────────────────────────────────

describe('Intent Suppression: Horoscope / Astrology', () => {
  it('should suppress DATE when user asks for horoscope', () => {
    const text = 'Create a horoscope for March 15, 1990';
    const entities = [makeEntity('DATE', 'March 15, 1990', 24)];
    const result = applyIntentSuppression(text, entities);

    expect(result.suppressions).toHaveLength(1);
    expect(result.suppressions[0].pattern).toBe('horoscope_request');
    expect(result.entities[0].confidence).toBeLessThanOrEqual(0.2);
    expect(result.scoreMultiplier).toBeLessThan(1.0);
  });

  it('should suppress LOCATION for birth chart', () => {
    const text = 'Generate my natal chart. I was born in Chicago on January 5';
    const entities = [
      makeEntity('LOCATION', 'Chicago', 42),
      makeEntity('DATE', 'January 5', 53),
    ];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(2);
  });

  it('should NOT suppress SSN even in horoscope context', () => {
    const text = 'Create a horoscope for 123-45-6789';
    const entities = [makeEntity('SSN', '123-45-6789', 23)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(0);
    expect(result.entities[0].confidence).toBe(0.8); // unchanged
  });
});

describe('Intent Suppression: Competitive Research', () => {
  it('should suppress ORGANIZATION for competitive research', () => {
    const text = 'Do competitive research on Acme Corp and their market position';
    const entities = [makeEntity('ORGANIZATION', 'Acme Corp', 27)];
    const result = applyIntentSuppression(text, entities);

    expect(result.suppressions).toHaveLength(1);
    expect(result.suppressions[0].pattern).toBe('competitive_research');
  });

  it('should suppress ORGANIZATION for market analysis', () => {
    const text = 'I need a competitive analysis of Tesla vs Ford in the EV market';
    const entities = [
      makeEntity('ORGANIZATION', 'Tesla', 35),
      makeEntity('ORGANIZATION', 'Ford', 44),
    ];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(2);
  });

  it('should suppress for plain research query but scorer guards against MNPI', () => {
    // "Do competitive research on Acme Corp" — suppressed at intent level
    const text = 'Do competitive research on Acme Corp';
    const entities = [makeEntity('ORGANIZATION', 'Acme Corp', 27)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(1);

    // But if the SAME org appears in M&A context, the scorer's
    // contextualKeywordScore >= 15 guard prevents score reduction
  });
});

describe('Intent Suppression: Self-Introduction', () => {
  it('should suppress PERSON for self-introduction', () => {
    const text = 'My name is Sarah Johnson and I need help with my resume';
    const entities = [makeEntity('PERSON', 'Sarah Johnson', 11)];
    const result = applyIntentSuppression(text, entities);

    expect(result.suppressions).toHaveLength(1);
    expect(result.entities[0].confidence).toBeLessThanOrEqual(0.2);
  });

  it('should suppress PERSON + EMAIL for self-intro + resume', () => {
    const text = "I'm John Doe. Help me write my resume. My email is john@example.com";
    const entities = [
      makeEntity('PERSON', 'John Doe', 4),
      makeEntity('EMAIL', 'john@example.com', 51),
    ];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(2);
  });
});

describe('Intent Suppression: Location Queries', () => {
  it('should suppress LOCATION for weather query', () => {
    const text = "What's the weather in San Francisco this weekend?";
    const entities = [makeEntity('LOCATION', 'San Francisco', 22)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(1);
  });

  it('should suppress LOCATION for travel planning', () => {
    const text = 'Plan a trip to Tokyo for next month. Best restaurants in Shibuya?';
    const entities = [
      makeEntity('LOCATION', 'Tokyo', 15),
      makeEntity('LOCATION', 'Shibuya', 56),
    ];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(2);
  });
});

describe('Intent Suppression: Lookup / Educational Queries', () => {
  it('should suppress PERSON for "who is" query', () => {
    const text = 'Who is Elon Musk and what companies does he run?';
    const entities = [makeEntity('PERSON', 'Elon Musk', 7)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(1);
  });

  it('should suppress ORGANIZATION for "what is" query', () => {
    const text = 'What is Goldman Sachs? Tell me about their investment banking division';
    const entities = [makeEntity('ORGANIZATION', 'Goldman Sachs', 8)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(1);
  });

  it('should suppress for "tell me about" pattern', () => {
    const text = 'Tell me about Sullivan & Cromwell law firm';
    const entities = [makeEntity('ORGANIZATION', 'Sullivan & Cromwell', 14)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(1);
  });
});

// ─── Safety: Things that should NOT be suppressed ───────────────────────────

describe('Intent Suppression: Safety Guards', () => {
  it('should NOT suppress when no benign intent pattern matches', () => {
    const text = 'Patient DOB: 03/15/1990, Name: John Smith';
    const entities = [
      makeEntity('DATE', '03/15/1990', 13),
      makeEntity('PERSON', 'John Smith', 31),
    ];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(0);
    expect(result.scoreMultiplier).toBe(1.0);
  });

  it('should NOT suppress SSN even with benign intent', () => {
    const text = 'My SSN is 123-45-6789, can you help me with my tax return?';
    const entities = [makeEntity('SSN', '123-45-6789', 10)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(0);
  });

  it('should NOT suppress CREDIT_CARD even with benign intent', () => {
    const text = 'Look up my card 4111-1111-1111-1111';
    const entities = [makeEntity('CREDIT_CARD', '4111-1111-1111-1111', 16)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(0);
  });

  it('should NOT suppress API_KEY even with benign intent', () => {
    const text = 'What is sk-1234567890abcdef? Is it valid?';
    const entities = [makeEntity('API_KEY', 'sk-1234567890abcdef', 8)];
    const result = applyIntentSuppression(text, entities);
    expect(result.suppressions).toHaveLength(0);
  });

  it('should NOT suppress when entity appears in data-record context', () => {
    const text = 'Look up this person: Name: John Smith, DOB: 03/15/1990';
    const entities = [
      makeEntity('PERSON', 'John Smith', 27),
      makeEntity('DATE', '03/15/1990', 44),
    ];
    const result = applyIntentSuppression(text, entities);
    // "Name:" prefix makes it a data record — should not suppress
    expect(result.suppressions.filter(s => s.entity.type === 'PERSON')).toHaveLength(0);
  });

  it('should return empty suppressions when entities array is empty', () => {
    const text = 'Create a horoscope for me';
    const result = applyIntentSuppression(text, []);
    expect(result.suppressions).toHaveLength(0);
    expect(result.scoreMultiplier).toBe(1.0);
  });
});

// ─── Integration: Full Scorer Pipeline ──────────────────────────────────────

describe('Intent Suppression: Scorer Integration', () => {
  it('horoscope prompt should score lower than data record with same DOB', () => {
    const horoscopeText = 'Create a horoscope for March 15, 1990';
    const horoscopeEntities = [makeEntity('DATE', 'March 15, 1990', 24)];

    const recordText = 'Patient DOB: March 15, 1990';
    const recordEntities = [makeEntity('DATE', 'March 15, 1990', 13)];

    const horoscopeScore = computeScore(horoscopeText, horoscopeEntities);
    const recordScore = computeScore(recordText, recordEntities);

    expect(horoscopeScore.score).toBeLessThan(recordScore.score);
  });

  it('competitive research should score lower than M&A leak with same org', () => {
    const researchText = 'Do competitive research on Acme Corp';
    const researchEntities = [makeEntity('ORGANIZATION', 'Acme Corp', 27)];

    const leakText = 'Acme Corp is acquiring TargetCo for $2B, announcement next week';
    const leakEntities = [
      makeEntity('ORGANIZATION', 'Acme Corp', 0),
      makeEntity('ORGANIZATION', 'TargetCo', 24),
      makeEntity('MONETARY_AMOUNT', '$2B', 37),
    ];

    const researchScore = computeScore(researchText, researchEntities);
    const leakScore = computeScore(leakText, leakEntities);

    expect(researchScore.score).toBeLessThan(leakScore.score);
  });

  it('"who is Elon Musk" should score low', () => {
    const text = 'Who is Elon Musk?';
    const entities = [makeEntity('PERSON', 'Elon Musk', 7)];
    const score = computeScore(text, entities);
    expect(score.score).toBeLessThanOrEqual(25); // Should be low
    expect(score.level).toBe('low');
  });

  it('"weather in San Francisco" should score low', () => {
    const text = "What's the weather in San Francisco?";
    const entities = [makeEntity('LOCATION', 'San Francisco', 22)];
    const score = computeScore(text, entities);
    expect(score.score).toBeLessThanOrEqual(25);
  });

  it('self-intro for resume should score low', () => {
    const text = 'My name is Sarah Johnson. Help me write my resume.';
    const entities = [makeEntity('PERSON', 'Sarah Johnson', 11)];
    const score = computeScore(text, entities);
    expect(score.score).toBeLessThanOrEqual(25);
  });

  it('SSN should still score high even with benign-sounding prompt', () => {
    const text = 'Can you help me check my SSN 123-45-6789?';
    const entities = [makeEntity('SSN', '123-45-6789', 28)];
    const score = computeScore(text, entities);
    expect(score.score).toBeGreaterThanOrEqual(61); // High or critical
  });
});
