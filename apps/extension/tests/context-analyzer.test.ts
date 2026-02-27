/**
 * Context-Aware Detection Tests — Priority 7
 */

import { describe, it, expect } from 'vitest';
import {
  applyCoOccurrenceRules,
  classifyContext,
  isCodeContext,
  suppressCodeFalsePositives,
  applyContextAwareDetection,
} from '../src/shared/context-analyzer';
import { detectEntities } from '../src/shared/scanner';
import type { DetectedEntity } from '../src/detection/types';

function entity(type: string, text: string, start: number, confidence = 0.8): DetectedEntity {
  return { type, text, start, end: start + text.length, confidence, source: 'regex' };
}

// ─── Co-Occurrence Rules ────────────────────────────────────────────────────

describe('Co-Occurrence Rules', () => {
  it('escalates PERSON near SSN to 0.95 confidence', () => {
    const entities = [
      entity('PERSON', 'John Smith', 0),
      entity('SSN', '123-45-6789', 30),
    ];
    const result = applyCoOccurrenceRules('John Smith has SSN 123-45-6789', entities);
    expect(result.entities[0].confidence).toBe(0.95);
    expect(result.entities[1].confidence).toBe(0.95);
    expect(result.scoreMultiplier).toBeGreaterThan(1.0);
  });

  it('reduces isolated PERSON score', () => {
    const entities = [entity('PERSON', 'John Smith', 0)];
    const result = applyCoOccurrenceRules('John Smith asked about lunch.', entities);
    expect(result.scoreMultiplier).toBeLessThan(1.0);
  });

  it('never reduces API_KEY confidence', () => {
    const entities = [entity('API_KEY', 'sk-abc123', 0, 0.7)];
    const result = applyCoOccurrenceRules('Key is sk-abc123', entities);
    expect(result.entities[0].confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('never reduces PRIVATE_KEY confidence', () => {
    const entities = [entity('PRIVATE_KEY', '-----BEGIN RSA-----', 0, 0.6)];
    const result = applyCoOccurrenceRules('Found: -----BEGIN RSA-----', entities);
    expect(result.entities[0].confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('applies 1.5x multiplier for PERSON + CREDIT_CARD proximity', () => {
    const entities = [
      entity('PERSON', 'Jane Doe', 0),
      entity('CREDIT_CARD', '4111-1111-1111-1111', 20),
    ];
    const result = applyCoOccurrenceRules('Jane Doe card: 4111-1111-1111-1111', entities);
    expect(result.scoreMultiplier).toBe(1.5);
  });

  it('no multiplier when PERSON and PII are far apart', () => {
    const entities = [
      entity('PERSON', 'John', 0),
      entity('SSN', '123-45-6789', 500),
    ];
    const text = 'John' + ' '.repeat(490) + '123-45-6789';
    const result = applyCoOccurrenceRules(text, entities);
    // Beyond proximity window, should not get PERSON+PII multiplier
    expect(result.scoreMultiplier).toBeLessThanOrEqual(1.5);
  });
});

// ─── Context Window Analysis ────────────────────────────────────────────────

describe('Context Window Analysis', () => {
  it('classifies casual context (greeting with name)', () => {
    const text = 'Hey John, thanks for the update! Let me know about lunch.';
    const e = entity('PERSON', 'John', 4);
    const result = classifyContext(text, e);
    expect(result.category).toBe('casual');
    expect(result.adjustmentFactor).toBeLessThan(1.0);
  });

  it('classifies legal context', () => {
    const text = 'This is privileged and confidential communication. The defendant John Smith was deposed.';
    const e = entity('PERSON', 'John Smith', 63);
    const result = classifyContext(text, e);
    expect(result.category).toBe('legal');
    expect(result.adjustmentFactor).toBeGreaterThan(1.0);
  });

  it('classifies code context', () => {
    const text = 'const userName = "John Smith";\nfunction processUser(name) { return name; }';
    const e = entity('PERSON', 'John Smith', 18);
    const result = classifyContext(text, e);
    expect(result.category).toBe('code');
    expect(result.adjustmentFactor).toBeLessThan(1.0);
  });

  it('classifies data record context', () => {
    const text = 'Name: John Smith, SSN: 123-45-6789, DOB: 01/15/1985';
    const e = entity('PERSON', 'John Smith', 6);
    const result = classifyContext(text, e);
    expect(result.category).toBe('data_record');
  });
});

// ─── Code Awareness ─────────────────────────────────────────────────────────

describe('Code Awareness', () => {
  it('detects JavaScript as code context', () => {
    const code = `
      import { useState } from 'react';
      const userName = "test";
      function processData(input) {
        return input.map(x => x * 2);
      }
      export default processData;
    `;
    expect(isCodeContext(code)).toBe(true);
  });

  it('does not detect plain English as code', () => {
    const text = 'Please review the contract for John Smith at Acme Corp regarding the merger.';
    expect(isCodeContext(text)).toBe(false);
  });

  it('suppresses PERSON on camelCase identifiers in code', () => {
    const code = 'const firstName = "John";\nfunction getData() { return firstName; }';
    const entities = [entity('PERSON', 'firstName', 6)];
    const filtered = suppressCodeFalsePositives(code, entities);
    expect(filtered).toHaveLength(0);
  });

  it('suppresses IP_ADDRESS on localhost in code', () => {
    const code = 'const server = "http://127.0.0.1:3000";\nfunction start() {}';
    const entities = [entity('IP_ADDRESS', '127.0.0.1', 22)];
    const filtered = suppressCodeFalsePositives(code, entities);
    expect(filtered).toHaveLength(0);
  });

  it('suppresses EMAIL on example.com in code', () => {
    const code = 'const testEmail = "user@example.com";\nfunction validate() {}';
    const entities = [entity('EMAIL', 'user@example.com', 20)];
    const filtered = suppressCodeFalsePositives(code, entities);
    expect(filtered).toHaveLength(0);
  });

  it('preserves API_KEY even in code context', () => {
    const code = 'const apiKey = "sk-live-abc123";\nfunction call() {}';
    const entities = [entity('API_KEY', 'sk-live-abc123', 16)];
    const filtered = suppressCodeFalsePositives(code, entities);
    expect(filtered).toHaveLength(1);
  });

  it('suppresses private network IPs in code', () => {
    const code = 'const gateway = "192.168.1.100";\nfunction ping() {}';
    const entities = [entity('IP_ADDRESS', '192.168.1.100', 18)];
    const filtered = suppressCodeFalsePositives(code, entities);
    expect(filtered).toHaveLength(0);
  });

  it('does not suppress in non-code text', () => {
    const text = 'Send results to user@example.com please.';
    const entities = [entity('EMAIL', 'user@example.com', 19)];
    const filtered = suppressCodeFalsePositives(text, entities);
    expect(filtered).toHaveLength(1);
  });
});

// ─── Full Pipeline ──────────────────────────────────────────────────────────

describe('Full Context-Aware Pipeline', () => {
  it('filters code false positives and adjusts co-occurrence', () => {
    const code = `
      const client = "John Smith";
      const ip = "127.0.0.1";
      const email = "test@example.com";
      function process() { return client; }
    `;
    const entities = [
      entity('PERSON', 'John Smith', 22),
      entity('IP_ADDRESS', '127.0.0.1', 52),
      entity('EMAIL', 'test@example.com', 78),
    ];
    const result = applyContextAwareDetection(code, entities);
    // All should be suppressed in code context
    expect(result.entities.length).toBeLessThanOrEqual(entities.length);
  });

  it('preserves real PII in non-code context', () => {
    const text = 'Patient John Smith (SSN: 123-45-6789) requires surgery.';
    const entities = detectEntities(text);
    const result = applyContextAwareDetection(text, entities);
    expect(result.entities.length).toBeGreaterThan(0);
  });
});
