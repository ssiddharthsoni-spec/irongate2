/**
 * Shared Attestation Tests
 *
 * Tests for hashing, HMAC signing, attestation creation,
 * verification, and tamper detection.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  hashPrompt,
  hmacSign,
  generateSigningKey,
  createAttestation,
  verifyAttestation,
} from '../src/shared/attestation';
import type { AttestationRecord } from '../src/shared/attestation';
import type { DetectedEntity } from '../src/detection/types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function entity(type: string, text: string): DetectedEntity {
  return { type, text, start: 0, end: text.length, confidence: 0.9, source: 'regex' };
}

let signingKey: CryptoKey;

beforeAll(async () => {
  signingKey = await generateSigningKey();
});

// ─── Hashing ────────────────────────────────────────────────────────────────

describe('hashPrompt', () => {
  it('returns a 64-character hex string (SHA-256)', async () => {
    const hash = await hashPrompt('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces consistent hashes for same input', async () => {
    const h1 = await hashPrompt('test input');
    const h2 = await hashPrompt('test input');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different inputs', async () => {
    const h1 = await hashPrompt('input A');
    const h2 = await hashPrompt('input B');
    expect(h1).not.toBe(h2);
  });

  it('handles empty string', async () => {
    const hash = await hashPrompt('');
    expect(hash).toHaveLength(64);
  });

  it('handles very long text', async () => {
    const hash = await hashPrompt('x'.repeat(100000));
    expect(hash).toHaveLength(64);
  });

  it('handles unicode characters', async () => {
    const hash = await hashPrompt('こんにちは世界 🌍');
    expect(hash).toHaveLength(64);
  });
});

// ─── HMAC Signing ───────────────────────────────────────────────────────────

describe('hmacSign', () => {
  it('returns a 64-character hex string (HMAC-SHA256)', async () => {
    const sig = await hmacSign('data to sign', signingKey);
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces consistent signatures for same key and data', async () => {
    const s1 = await hmacSign('test data', signingKey);
    const s2 = await hmacSign('test data', signingKey);
    expect(s1).toBe(s2);
  });

  it('produces different signatures for different data', async () => {
    const s1 = await hmacSign('data A', signingKey);
    const s2 = await hmacSign('data B', signingKey);
    expect(s1).not.toBe(s2);
  });

  it('produces different signatures with different keys', async () => {
    const key2 = await generateSigningKey();
    const s1 = await hmacSign('same data', signingKey);
    const s2 = await hmacSign('same data', key2);
    expect(s1).not.toBe(s2);
  });
});

// ─── Key Generation ─────────────────────────────────────────────────────────

describe('generateSigningKey', () => {
  it('returns a CryptoKey', async () => {
    const key = await generateSigningKey();
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });

  it('generates unique keys each time', async () => {
    const k1 = await generateSigningKey();
    const k2 = await generateSigningKey();
    // Sign same data with both keys to verify they're different
    const s1 = await hmacSign('test', k1);
    const s2 = await hmacSign('test', k2);
    expect(s1).not.toBe(s2);
  });
});

// ─── Attestation Creation ───────────────────────────────────────────────────

describe('createAttestation', () => {
  it('creates a valid attestation record', async () => {
    const entities = [entity('SSN', '123-45-6789'), entity('EMAIL', 'j@t.com')];
    const record = await createAttestation(
      'Original prompt with SSN 123-45-6789',
      'Original prompt with [SSN-1]',
      entities,
      'chatgpt',
      'proxy',
      75,
      'high',
      signingKey
    );

    expect(record.timestamp).toBeTruthy();
    expect(record.promptHash).toHaveLength(64);
    expect(record.maskedHash).toHaveLength(64);
    expect(record.entityTypes).toEqual(expect.arrayContaining(['SSN', 'EMAIL']));
    expect(record.entityCount).toBe(2);
    expect(record.aiToolId).toBe('chatgpt');
    expect(record.action).toBe('proxy');
    expect(record.score).toBe(75);
    expect(record.level).toBe('high');
    expect(record.hmac).toHaveLength(64);
  });

  it('prompt hash differs from masked hash', async () => {
    const record = await createAttestation(
      'SSN: 123-45-6789',
      'SSN: [SSN-1]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      40,
      'medium',
      signingKey
    );
    expect(record.promptHash).not.toBe(record.maskedHash);
  });

  it('deduplicates entity types', async () => {
    const entities = [
      entity('SSN', '111-22-3333'),
      entity('SSN', '444-55-6666'),
    ];
    const record = await createAttestation(
      'SSN1 and SSN2',
      '[SSN-1] and [SSN-2]',
      entities,
      'chatgpt',
      'audit',
      50,
      'medium',
      signingKey
    );
    expect(record.entityTypes).toEqual(['SSN']);
    expect(record.entityCount).toBe(2);
  });

  it('handles zero entities', async () => {
    const record = await createAttestation(
      'Hello world',
      'Hello world',
      [],
      'chatgpt',
      'pass',
      0,
      'low',
      signingKey
    );
    expect(record.entityTypes).toHaveLength(0);
    expect(record.entityCount).toBe(0);
    expect(record.hmac).toHaveLength(64);
  });
});

// ─── Attestation Verification ───────────────────────────────────────────────

describe('verifyAttestation', () => {
  it('verifies an untampered record returns true', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const valid = await verifyAttestation(record, signingKey);
    expect(valid).toBe(true);
  });

  it('detects tampered timestamp', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const tampered = { ...record, timestamp: '2020-01-01T00:00:00.000Z' };
    const valid = await verifyAttestation(tampered, signingKey);
    expect(valid).toBe(false);
  });

  it('detects tampered score', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const tampered = { ...record, score: 10 };
    const valid = await verifyAttestation(tampered, signingKey);
    expect(valid).toBe(false);
  });

  it('detects tampered action', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const tampered = { ...record, action: 'pass' };
    const valid = await verifyAttestation(tampered, signingKey);
    expect(valid).toBe(false);
  });

  it('detects tampered entity count', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const tampered = { ...record, entityCount: 0 };
    const valid = await verifyAttestation(tampered, signingKey);
    expect(valid).toBe(false);
  });

  it('detects tampered HMAC', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const tampered = { ...record, hmac: 'a'.repeat(64) };
    const valid = await verifyAttestation(tampered, signingKey);
    expect(valid).toBe(false);
  });

  it('fails verification with different key', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const differentKey = await generateSigningKey();
    const valid = await verifyAttestation(record, differentKey);
    expect(valid).toBe(false);
  });

  it('detects tampered level', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const tampered = { ...record, level: 'low' };
    const valid = await verifyAttestation(tampered, signingKey);
    expect(valid).toBe(false);
  });

  it('detects tampered entity types', async () => {
    const record = await createAttestation(
      'Test prompt',
      'Test [MASKED]',
      [entity('SSN', '123-45-6789')],
      'chatgpt',
      'proxy',
      50,
      'medium',
      signingKey
    );
    const tampered = { ...record, entityTypes: ['EMAIL'] };
    const valid = await verifyAttestation(tampered, signingKey);
    expect(valid).toBe(false);
  });
});
