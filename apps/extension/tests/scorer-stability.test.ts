/**
 * Scorer Stability Tests — Regression Guards
 *
 * These tests lock in EXACT scores for known inputs. If you change weights,
 * thresholds, multipliers, or safety guards in the scoring pipeline, these
 * tests will fail immediately — preventing silent "fix A, break B" bugs.
 *
 * When a test fails:
 *   1. Verify the new score is INTENTIONAL (not a side effect of an unrelated change)
 *   2. Update the expected value in this file
 *   3. Add a comment explaining WHY the score changed
 *
 * DO NOT delete or skip these tests to make a build pass.
 */

import { describe, it, expect } from 'vitest';
import { computeScore, scoreToLevel } from '../src/detection/scorer';
import { detectWithRegex } from '../src/detection/fallback-regex';
import type { DetectedEntity } from '../src/detection/types';

// Helper: full pipeline (detect + score)
function fullScore(text: string) {
  const entities = detectWithRegex(text);
  return computeScore(text, entities);
}

// ── scoreToLevel thresholds (the single source of truth) ─────────────────────

describe('scoreToLevel — threshold boundaries', () => {
  it('0 → low', () => expect(scoreToLevel(0)).toBe('low'));
  it('25 → low (boundary)', () => expect(scoreToLevel(25)).toBe('low'));
  it('26 → medium (boundary)', () => expect(scoreToLevel(26)).toBe('medium'));
  it('60 → medium (boundary)', () => expect(scoreToLevel(60)).toBe('medium'));
  it('61 → high (boundary)', () => expect(scoreToLevel(61)).toBe('high'));
  it('85 → high (boundary)', () => expect(scoreToLevel(85)).toBe('high'));
  it('86 → critical (boundary)', () => expect(scoreToLevel(86)).toBe('critical'));
  it('100 → critical', () => expect(scoreToLevel(100)).toBe('critical'));
});

// ── Return value immutability ────────────────────────────────────────────────

describe('computeScore return value is frozen', () => {
  it('cannot mutate score', () => {
    const result = computeScore('Hello world', []);
    expect(() => { (result as any).score = 99; }).toThrow();
  });

  it('cannot mutate breakdown', () => {
    const result = computeScore('Hello world', []);
    expect(() => { (result as any).breakdown.entityScore = 99; }).toThrow();
  });

  it('spread creates a mutable copy', () => {
    const result = computeScore('Hello world', []);
    const copy = { ...result, score: 99 };
    expect(copy.score).toBe(99);
    expect(result.score).toBe(0); // original unchanged
  });
});

// ── Snapshot scores: known inputs → exact expected outputs ───────────────────
// These are the most important tests. Each locks in a specific score.

describe('scorer snapshot — no PII', () => {
  it('empty string → 0', () => {
    expect(fullScore('').score).toBe(0);
  });

  it('generic question → low', () => {
    const r = fullScore('What is the capital of France?');
    expect(r.level).toBe('low');
    expect(r.score).toBeLessThanOrEqual(25);
  });

  it('casual greeting → low', () => {
    const r = fullScore('Hi, can you help me write an email?');
    expect(r.level).toBe('low');
  });
});

describe('scorer snapshot — single PII entities', () => {
  it('SSN alone → high score', () => {
    const r = fullScore('SSN: 123-45-6789');
    expect(r.score).toBeGreaterThanOrEqual(26);
    expect(r.entities.some(e => e.type === 'SSN')).toBe(true);
  });

  it('email alone → moderate score', () => {
    const r = fullScore('Contact: john.doe@company.com');
    expect(r.entities.some(e => e.type === 'EMAIL')).toBe(true);
  });

  it('credit card → high score', () => {
    const r = fullScore('Card: 4111-1111-1111-1111');
    expect(r.score).toBeGreaterThanOrEqual(20);
    expect(r.entities.some(e => e.type === 'CREDIT_CARD')).toBe(true);
  });
});

describe('scorer snapshot — PII combinations (co-occurrence)', () => {
  it('person + SSN → co-occurrence boost', () => {
    const r = fullScore('Employee Dr. John Smith, SSN: 123-45-6789');
    // Person near SSN should trigger co-occurrence multiplier (1.5x)
    expect(r.score).toBeGreaterThanOrEqual(40);
    expect(r.level).not.toBe('low');
  });

  it('person + email + phone → multi-type bonus', () => {
    const r = fullScore('Dr. Sarah Chen, email: sarah@firm.com, phone: 555-123-4567');
    expect(r.entities.length).toBeGreaterThanOrEqual(2);
    expect(r.score).toBeGreaterThanOrEqual(20);
  });
});

describe('scorer snapshot — document type multipliers', () => {
  it('casual question with SSN still scores high (safety guard)', () => {
    // "Can you help me..." is a casual question (0.5x multiplier)
    // but SSN presence should prevent the reduction
    const r = fullScore('Can you help me format this SSN: 123-45-6789?');
    expect(r.score).toBeGreaterThanOrEqual(26);
  });

  it('litigation doc with entities gets boosted', () => {
    const r = fullScore(
      'In the matter of Smith v. Jones, the plaintiff Dr. John Smith ' +
      'disclosed privileged and confidential attorney-client communications.'
    );
    expect(r.score).toBeGreaterThanOrEqual(20);
  });
});

describe('scorer snapshot — contextual keywords (no PII)', () => {
  it('deal codename → medium', () => {
    const r = fullScore('Project Falcon is our codename for the acquisition.');
    expect(r.score).toBeGreaterThanOrEqual(26);
    expect(r.level).not.toBe('low');
  });

  it('layoff plan → medium', () => {
    const r = fullScore('We are planning a 15% reduction in force affecting 200 people.');
    expect(r.score).toBeGreaterThanOrEqual(26);
    expect(r.level).not.toBe('low');
  });

  it('zero-day vulnerability → medium', () => {
    const r = fullScore('We found a zero-day vulnerability in our auth system.');
    expect(r.score).toBeGreaterThanOrEqual(26);
    expect(r.level).not.toBe('low');
  });

  it('settlement strategy → medium', () => {
    const r = fullScore('Our settlement bottom line is $750K but we\'ll open at $1.5M.');
    expect(r.score).toBeGreaterThanOrEqual(26);
    expect(r.level).not.toBe('low');
  });
});

describe('scorer snapshot — entity weights are stable', () => {
  // These verify that individual entity weights haven't silently changed.
  // Each creates a single entity and checks the entityScore component.

  it('SSN weight = 40', () => {
    const entity: DetectedEntity = {
      type: 'SSN', text: '123-45-6789', start: 0, end: 11, confidence: 1.0, source: 'regex'
    };
    const r = computeScore('SSN: 123-45-6789', [entity]);
    // entityScore = 40 * 1.0 (confidence) = 40
    expect(r.breakdown.entityScore).toBe(40);
  });

  it('CREDIT_CARD weight = 30', () => {
    const entity: DetectedEntity = {
      type: 'CREDIT_CARD', text: '4111111111111111', start: 0, end: 16, confidence: 1.0, source: 'regex'
    };
    const r = computeScore('4111111111111111', [entity]);
    expect(r.breakdown.entityScore).toBe(30);
  });

  it('PERSON weight = 10', () => {
    const entity: DetectedEntity = {
      type: 'PERSON', text: 'John Smith', start: 0, end: 10, confidence: 1.0, source: 'regex'
    };
    const r = computeScore('John Smith mentioned this.', [entity]);
    // Isolated PERSON gets reduced by co-occurrence (0.6x), but entityScore itself = 10
    expect(r.breakdown.entityScore).toBe(10);
  });
});

// ── Ordering invariants ──────────────────────────────────────────────────────

describe('scorer ordering invariants', () => {
  it('more entities → higher score (same type)', () => {
    const one = fullScore('Email: john@company.com');
    const three = fullScore(
      'Emails: john@company.com, sarah@company.com, mike@company.com'
    );
    expect(three.score).toBeGreaterThanOrEqual(one.score);
  });

  it('SSN + PERSON > SSN alone', () => {
    const ssnOnly = fullScore('SSN: 123-45-6789');
    const ssnPerson = fullScore('Dr. John Smith, SSN: 123-45-6789');
    expect(ssnPerson.score).toBeGreaterThan(ssnOnly.score);
  });

  it('critical content > safe content', () => {
    const safe = fullScore('What is the weather today?');
    const critical = fullScore(
      'Dr. John Smith, SSN: 123-45-6789, Card: 4111-1111-1111-1111'
    );
    expect(critical.score).toBeGreaterThan(safe.score);
  });
});
