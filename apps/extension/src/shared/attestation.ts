/**
 * Shared Attestation Module
 *
 * Provides cryptographic hashing and HMAC-based attestation
 * for tamper-evident audit records.
 */

import type { DetectedEntity } from '../detection/types';

export interface AttestationRecord {
  /** ISO timestamp */
  timestamp: string;
  /** SHA-256 hash of the original prompt text */
  promptHash: string;
  /** SHA-256 hash of the masked text */
  maskedHash: string;
  /** Entity types detected */
  entityTypes: string[];
  /** Number of entities */
  entityCount: number;
  /** AI tool identifier */
  aiToolId: string;
  /** Action taken */
  action: string;
  /** Sensitivity score */
  score: number;
  /** Sensitivity level */
  level: string;
  /** HMAC-SHA256 signature of the record */
  hmac: string;
}

/**
 * Compute SHA-256 hash of text, returned as hex string.
 */
export async function hashPrompt(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute HMAC-SHA256 of data using the provided CryptoKey.
 */
export async function hmacSign(data: string, key: CryptoKey): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const sig = await crypto.subtle.sign('HMAC', key, encoded);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a new HMAC-SHA256 signing key.
 */
export async function generateSigningKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    true, // extractable for export/verification
    ['sign', 'verify']
  );
}

/**
 * Create a tamper-evident attestation record for an interception event.
 */
export async function createAttestation(
  originalText: string,
  maskedText: string,
  entities: DetectedEntity[],
  aiToolId: string,
  action: string,
  score: number,
  level: string,
  signingKey: CryptoKey
): Promise<AttestationRecord> {
  const timestamp = new Date().toISOString();
  const promptHash = await hashPrompt(originalText);
  const maskedHash = await hashPrompt(maskedText);
  const entityTypes = [...new Set(entities.map((e) => e.type))];
  const entityCount = entities.length;

  // Canonical string for HMAC: deterministic field order
  const canonical = [
    timestamp,
    promptHash,
    maskedHash,
    entityTypes.sort().join(','),
    entityCount,
    aiToolId,
    action,
    score,
    level,
  ].join('|');

  const hmac = await hmacSign(canonical, signingKey);

  return {
    timestamp,
    promptHash,
    maskedHash,
    entityTypes,
    entityCount,
    aiToolId,
    action,
    score,
    level,
    hmac,
  };
}

/**
 * Verify an attestation record's HMAC signature.
 * Returns true if the record is untampered.
 */
export async function verifyAttestation(
  record: AttestationRecord,
  signingKey: CryptoKey
): Promise<boolean> {
  const canonical = [
    record.timestamp,
    record.promptHash,
    record.maskedHash,
    record.entityTypes.sort().join(','),
    record.entityCount,
    record.aiToolId,
    record.action,
    record.score,
    record.level,
  ].join('|');

  const expectedHmac = await hmacSign(canonical, signingKey);
  return record.hmac === expectedHmac;
}
