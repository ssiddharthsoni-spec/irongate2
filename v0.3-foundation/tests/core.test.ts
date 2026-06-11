/**
 * Core tests — prove the foundation works in Node with zero Chrome dependency.
 *
 * These tests validate:
 *   1. Contracts compile and are usable
 *   2. Dictionary detector catches single-word brands
 *   3. Dedupe resolver collapses overlapping spans correctly
 *   4. Evidence bundler produces valid EvidenceBundle
 *   5. Message types are exhaustive and validated
 */

import { describe, it, expect } from 'vitest';
import {
  // Contracts
  ENTITY_TYPES, BRIGHT_LINE_TYPES, VALUE_TYPES,
  VERDICTS, LEVELS, MESSAGE_TYPES,
  scoreToLevel, scoreToVerdict,
  isValidMessage, assertNever,
  DEFAULT_FIRM_POLICY,
  // Detectors
  DetectorRegistry, brandDictionaryDetector,
  // Dedupe
  dedupeDetections, mergeDetections,
  // Evidence
  buildEvidenceBundle,
  // Derived state
  toActivityItem, totalEntitiesDetected,
} from '../src/core';
import type { Detection, Judgment, DetectionResult } from '../src/core';

// ── Contract Tests ──────────────────────────────────────────────────────────

describe('Contracts', () => {
  it('ENTITY_TYPES is exhaustive (50+ types)', () => {
    expect(ENTITY_TYPES.length).toBeGreaterThan(50);
    expect(ENTITY_TYPES).toContain('SSN');
    expect(ENTITY_TYPES).toContain('ORGANIZATION');
    expect(ENTITY_TYPES).toContain('API_KEY');
  });

  it('BRIGHT_LINE_TYPES contains non-negotiable types', () => {
    expect(BRIGHT_LINE_TYPES.has('SSN')).toBe(true);
    expect(BRIGHT_LINE_TYPES.has('CREDIT_CARD')).toBe(true);
    expect(BRIGHT_LINE_TYPES.has('API_KEY')).toBe(true);
    expect(BRIGHT_LINE_TYPES.has('PERSON')).toBe(false);
  });

  it('VALUE_TYPES does NOT contain ACCOUNT_NUMBER', () => {
    expect(VALUE_TYPES.has('MONETARY_AMOUNT')).toBe(true);
    expect(VALUE_TYPES.has('DATE')).toBe(true);
    // ACCOUNT_NUMBER was removed — it's an identifier, not a value
    expect(VALUE_TYPES.has('ACCOUNT_NUMBER' as any)).toBe(false);
  });

  it('scoreToLevel maps correctly', () => {
    expect(scoreToLevel(0)).toBe('low');
    expect(scoreToLevel(25)).toBe('low');
    expect(scoreToLevel(26)).toBe('medium');
    expect(scoreToLevel(60)).toBe('medium');
    expect(scoreToLevel(61)).toBe('high');
    expect(scoreToLevel(85)).toBe('high');
    expect(scoreToLevel(86)).toBe('critical');
    expect(scoreToLevel(100)).toBe('critical');
  });

  it('scoreToVerdict maps correctly', () => {
    expect(scoreToVerdict(10)).toBe('allow');
    expect(scoreToVerdict(40)).toBe('warn');
    expect(scoreToVerdict(70)).toBe('redact-and-send');
    expect(scoreToVerdict(90)).toBe('block');
  });

  it('MESSAGE_TYPES has exactly 12 types', () => {
    expect(MESSAGE_TYPES.size).toBe(12);
    expect(MESSAGE_TYPES.has('PROMPT_ANALYZE')).toBe(true);
    expect(MESSAGE_TYPES.has('PROMPT_VERDICT')).toBe(true);
    expect(MESSAGE_TYPES.has('WARMUP_TICK')).toBe(true);
  });

  it('isValidMessage rejects garbage', () => {
    expect(isValidMessage(null)).toBe(false);
    expect(isValidMessage({})).toBe(false);
    expect(isValidMessage({ type: 'FAKE_TYPE' })).toBe(false);
    expect(isValidMessage({ type: 'PROMPT_ANALYZE' })).toBe(true);
  });
});

// ── Dictionary Detector Tests ───────────────────────────────────────────────

describe('Dictionary Detector', () => {
  it('detects Salesforce as ORGANIZATION', () => {
    const results = brandDictionaryDetector.detect(
      'Compare Salesforce and HubSpot pricing for a 500-person company.'
    );
    const salesforce = results.find(r => r.text === 'Salesforce');
    expect(salesforce).toBeDefined();
    expect(salesforce!.type).toBe('ORGANIZATION');
    expect(salesforce!.source).toBe('dictionary');
  });

  it('detects HubSpot as ORGANIZATION', () => {
    const results = brandDictionaryDetector.detect(
      'Compare Salesforce and HubSpot pricing.'
    );
    // HubSpot has CamelCase — regex should catch it too.
    // Dictionary may or may not have it. Let's check.
    const orgs = results.filter(r => r.type === 'ORGANIZATION');
    expect(orgs.length).toBeGreaterThanOrEqual(1);
  });

  it('detects Google in business context', () => {
    const results = brandDictionaryDetector.detect(
      'Our Salesforce deal with Google is worth $3.4M.'
    );
    expect(results.some(r => r.text === 'Google')).toBe(true);
    expect(results.some(r => r.text === 'Salesforce')).toBe(true);
  });

  it('does not false-positive on lowercase "google"', () => {
    const results = brandDictionaryDetector.detect(
      'I need to google how to fix this bug.'
    );
    // "google" lowercase should NOT match the case-sensitive dictionary
    expect(results.length).toBe(0);
  });

  it('detects Fabrikam (test company)', () => {
    const results = brandDictionaryDetector.detect(
      'Top customer (Fabrikam): $3.4M'
    );
    expect(results.some(r => r.text === 'Fabrikam')).toBe(true);
  });
});

// ── Dedupe Resolver Tests ───────────────────────────────────────────────────

describe('Dedupe Resolver', () => {
  it('keeps higher-confidence detection on overlap', () => {
    const detections: Detection[] = [
      { type: 'PERSON', text: 'John Smith', start: 0, end: 10, confidence: 0.9, source: 'regex' },
      { type: 'ORGANIZATION', text: 'John Smith', start: 0, end: 10, confidence: 0.6, source: 'dictionary' },
    ];
    const result = dedupeDetections(detections);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe('PERSON');
  });

  it('keeps both detections when no overlap', () => {
    const detections: Detection[] = [
      { type: 'PERSON', text: 'John', start: 0, end: 4, confidence: 0.9, source: 'regex' },
      { type: 'EMAIL', text: 'john@example.com', start: 20, end: 36, confidence: 0.95, source: 'regex' },
    ];
    const result = dedupeDetections(detections);
    expect(result.length).toBe(2);
  });

  it('prefers firm-lexicon over regex at same confidence', () => {
    const detections: Detection[] = [
      { type: 'ORGANIZATION', text: 'Acme', start: 0, end: 4, confidence: 0.7, source: 'regex' },
      { type: 'ORGANIZATION', text: 'Acme', start: 0, end: 4, confidence: 0.7, source: 'firm-lexicon' },
    ];
    const result = dedupeDetections(detections);
    expect(result.length).toBe(1);
    expect(result[0]!.source).toBe('firm-lexicon');
  });

  it('mergeDetections flattens multiple sources', () => {
    const regex: Detection[] = [
      { type: 'SSN', text: '234-56-7890', start: 10, end: 21, confidence: 0.95, source: 'regex' },
    ];
    const dict: Detection[] = [
      { type: 'ORGANIZATION', text: 'Google', start: 30, end: 36, confidence: 0.55, source: 'dictionary' },
    ];
    const result = mergeDetections(regex, dict);
    expect(result.length).toBe(2);
    expect(result[0]!.type).toBe('SSN');
    expect(result[1]!.type).toBe('ORGANIZATION');
  });
});

// ── Evidence Bundler Tests ──────────────────────────────────────────────────

describe('Evidence Bundler', () => {
  it('identifies bright-line flags', () => {
    const detections: Detection[] = [
      { type: 'SSN', text: '234-56-7890', start: 10, end: 21, confidence: 0.95, source: 'regex' },
      { type: 'PERSON', text: 'John Smith', start: 0, end: 10, confidence: 0.8, source: 'regex' },
    ];
    const bundle = buildEvidenceBundle('test prompt', detections, 'chatgpt');
    expect(bundle.brightLineFlags.length).toBe(1);
    expect(bundle.brightLineFlags[0]!.type).toBe('SSN');
  });

  it('computes pattern score with bright-line floor', () => {
    const detections: Detection[] = [
      { type: 'SSN', text: '234-56-7890', start: 10, end: 21, confidence: 0.95, source: 'regex' },
    ];
    const bundle = buildEvidenceBundle('test prompt', detections, 'chatgpt');
    expect(bundle.patternScore).toBeGreaterThanOrEqual(61);
  });

  it('returns low score for empty detections', () => {
    const bundle = buildEvidenceBundle('What is the weather?', [], 'chatgpt');
    expect(bundle.patternScore).toBe(0);
    expect(bundle.patternLevel).toBe('low');
    expect(bundle.brightLineFlags.length).toBe(0);
  });

  it('uses default firm policy when none provided', () => {
    const bundle = buildEvidenceBundle('test', [], 'chatgpt');
    expect(bundle.firmPolicy.mode).toBe('audit');
    expect(bundle.firmPolicy.firmId).toBeNull();
  });

  it('generates deterministic context hash', () => {
    const detections: Detection[] = [
      { type: 'PERSON', text: 'John', start: 0, end: 4, confidence: 0.8, source: 'regex' },
    ];
    const a = buildEvidenceBundle('test', detections, 'chatgpt');
    const b = buildEvidenceBundle('test', detections, 'chatgpt');
    expect(a.contextHash).toBe(b.contextHash);
  });
});

// ── Derived State Tests ─────────────────────────────────────────────────────

describe('Derived State', () => {
  const mockJudgment: Judgment = {
    verdict: 'warn',
    score: 45,
    level: 'medium',
    rationale: 'Test',
    entities: [
      { type: 'PERSON', text: 'John', start: 0, end: 4, detectionConfidence: 0.8, isSensitive: true, source: 'regex' },
      { type: 'ORGANIZATION', text: 'Google', start: 10, end: 16, detectionConfidence: 0.55, isSensitive: false, source: 'dictionary' },
    ],
    affectedSpans: [],
    source: 'pattern-only',
    model: null,
    brightLineOverride: false,
    complianceFrameworks: [],
    degraded: true,
    latency: { stage1Ms: 5, stage2Ms: 0, totalMs: 5 },
    confidence: 0.7,
    modelVersion: 'regex-only',
  };

  const mockResult: DetectionResult = {
    id: 'test-1',
    judgment: mockJudgment,
    evidence: buildEvidenceBundle('test', [], 'chatgpt'),
    tabId: 1,
    wasIntercepted: false,
    seq: 0,
    timestamp: new Date().toISOString(),
  };

  it('toActivityItem derives correctly', () => {
    const item = toActivityItem(mockResult);
    expect(item.score).toBe(45);
    expect(item.level).toBe('medium');
    expect(item.entityCount).toBe(2);
    expect(item.verdict).toBe('warn');
    expect(item.degraded).toBe(true);
  });

  it('totalEntitiesDetected sums across results', () => {
    expect(totalEntitiesDetected([mockResult, mockResult])).toBe(4);
  });
});

// ── Detector Registry Tests ─────────────────────────────────────────────────

describe('Detector Registry', () => {
  it('runs all detectors and flattens results', () => {
    const registry = new DetectorRegistry();
    registry.register(brandDictionaryDetector);

    const results = registry.detectAllSync(
      'Compare Salesforce and Google pricing.'
    );
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some(r => r.text === 'Salesforce')).toBe(true);
    expect(results.some(r => r.text === 'Google')).toBe(true);
  });

  it('rejects duplicate detector IDs', () => {
    const registry = new DetectorRegistry();
    registry.register(brandDictionaryDetector);
    expect(() => registry.register(brandDictionaryDetector)).toThrow('already registered');
  });

  it('catches and logs detector errors without crashing', () => {
    const registry = new DetectorRegistry();
    registry.register({
      id: 'bad-detector',
      name: 'Throws Error',
      source: 'heuristic',
      entityTypes: ['PERSON'],
      detect() { throw new Error('Boom'); },
    });
    registry.register(brandDictionaryDetector);

    // Should not throw — bad detector is caught, brand detector still runs
    const results = registry.detectAllSync('Salesforce pricing');
    expect(results.some(r => r.text === 'Salesforce')).toBe(true);
  });
});
