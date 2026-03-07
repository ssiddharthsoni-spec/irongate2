// ==========================================
// Iron Gate Phase 2 — Pseudonym Map Persistence
// Now with AES-256-GCM encryption at rest
// ==========================================

import { eq, and, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { pseudonymMaps, firms } from '../db/schema';
import type { PseudonymMap, PseudonymEntry } from './pseudonymizer';
import type { EntityType } from '@iron-gate/types';
import { encrypt, decrypt, deriveKey, generateSalt, saltToHex, hexToSalt } from '@iron-gate/crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Prefer dedicated encryption secret; fall back to master secret for backward compat
function getEncryptionSecret(): string {
  const secret = process.env.IRON_GATE_ENCRYPTION_SECRET || process.env.IRON_GATE_MASTER_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
      throw new Error(
        'FATAL: IRON_GATE_ENCRYPTION_SECRET or IRON_GATE_MASTER_SECRET must be set in production/staging.'
      );
    }
    throw new Error(
      'IRON_GATE_ENCRYPTION_SECRET or IRON_GATE_MASTER_SECRET must be set. ' +
      'No hardcoded fallback is provided for security.'
    );
  }
  return secret;
}

// Lazy getter — evaluated at request time, not import time
let _encryptionSecret: string | null = null;
function ENCRYPTION_SECRET(): string {
  if (!_encryptionSecret) _encryptionSecret = getEncryptionSecret();
  return _encryptionSecret;
}

// Cache derived keys per firm to avoid re-deriving on every request
const keyCache = new Map<string, CryptoKey>();

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

/**
 * Get or derive the AES-256-GCM key for a firm.
 * Uses PBKDF2 with the firm's unique salt and the master secret.
 */
async function getFirmKey(firmId: string): Promise<CryptoKey> {
  // Check cache first
  const cached = keyCache.get(firmId);
  if (cached) return cached;

  // Look up the firm's encryption salt
  const firmRows = await db
    .select({ encryptionSalt: firms.encryptionSalt })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  let salt: Uint8Array;

  if (firmRows.length > 0 && firmRows[0].encryptionSalt) {
    salt = hexToSalt(firmRows[0].encryptionSalt);
  } else {
    // First time — generate salt and store atomically using COALESCE to prevent race conditions.
    // If two requests arrive concurrently, only the first write takes effect.
    const newSalt = generateSalt();
    const [result] = await db
      .update(firms)
      .set({ encryptionSalt: sql`COALESCE(${firms.encryptionSalt}, ${saltToHex(newSalt)})` })
      .where(eq(firms.id, firmId))
      .returning({ encryptionSalt: firms.encryptionSalt });
    salt = result?.encryptionSalt ? hexToSalt(result.encryptionSalt) : newSalt;
  }

  const key = await deriveKey(ENCRYPTION_SECRET(), salt);
  keyCache.set(firmId, key);
  return key;
}

// ---------------------------------------------------------------------------
// PseudonymStore — reads/writes PseudonymMap <-> pseudonym_maps table
// All sensitive columns encrypted with AES-256-GCM per-firm keys
// ---------------------------------------------------------------------------

export class PseudonymStore {
  /**
   * Persist every mapping in the PseudonymMap to the database.
   * Each row's sensitive data (originalHash, pseudonym, entityType) is
   * encrypted as a single JSON blob using the firm's AES-256-GCM key.
   */
  async save(map: PseudonymMap): Promise<void> {
    const key = await getFirmKey(map.firmId);

    const rows = await Promise.all(
      Array.from(map.mappings.values()).map(async (entry) => {
        // Bundle sensitive fields into a single JSON string
        const sensitiveData = JSON.stringify({
          originalHash: entry.originalHash,
          pseudonym: entry.pseudonym,
          entityType: entry.entityType,
        });

        // Encrypt with AES-256-GCM
        const encryptedData = await encrypt(sensitiveData, key);

        return {
          firmId: map.firmId,
          sessionId: map.sessionId,
          encryptedData,
          expiresAt: map.expiresAt,
          // Plaintext columns set to null — data lives in encryptedData only
          originalHash: null,
          pseudonym: null,
          entityType: null,
        };
      }),
    );

    if (rows.length === 0) {
      return;
    }

    // Delete any existing rows for this session first, then insert
    await db.delete(pseudonymMaps).where(
      and(
        eq(pseudonymMaps.sessionId, map.sessionId),
        eq(pseudonymMaps.firmId, map.firmId),
      ),
    );

    await db.insert(pseudonymMaps).values(rows);
  }

  /**
   * Reconstitute a PseudonymMap from the database for a given session.
   * Decrypts each row's encryptedData using the firm's AES-256-GCM key.
   */
  async load(sessionId: string, firmId: string): Promise<PseudonymMap | null> {
    const rows = await db
      .select()
      .from(pseudonymMaps)
      .where(
        and(
          eq(pseudonymMaps.sessionId, sessionId),
          eq(pseudonymMaps.firmId, firmId),
        ),
      );

    if (rows.length === 0) {
      return null;
    }

    const key = await getFirmKey(firmId);
    const mappings = new Map<string, PseudonymEntry>();

    let earliestCreatedAt: Date = rows[0].createdAt;
    let expiresAt: Date = rows[0].expiresAt;

    for (const row of rows) {
      let originalHash: string;
      let pseudonym: string;
      let entityType: EntityType;

      if (row.encryptedData) {
        // Decrypt the AES-256-GCM encrypted data
        const decrypted = await decrypt(row.encryptedData, key);
        const parsed = JSON.parse(decrypted);
        originalHash = parsed.originalHash;
        pseudonym = parsed.pseudonym;
        entityType = parsed.entityType as EntityType;
      } else {
        // Legacy fallback: read from plaintext columns (migration period)
        originalHash = row.originalHash || '';
        pseudonym = row.pseudonym || '';
        entityType = (row.entityType || 'PERSON') as EntityType;
      }

      // Use hash-based key that matches what Pseudonymizer.loadMap() expects.
      // We use the hash as the lookup key since original text is not persisted.
      const mapKey = `hash::${originalHash}`;

      mappings.set(mapKey, {
        original: '', // Original text is never persisted (privacy by design)
        originalHash,
        pseudonym,
        entityType,
      });

      if (row.createdAt < earliestCreatedAt) {
        earliestCreatedAt = row.createdAt;
      }
      if (row.expiresAt > expiresAt) {
        expiresAt = row.expiresAt;
      }
    }

    return {
      sessionId,
      firmId,
      mappings,
      createdAt: earliestCreatedAt,
      expiresAt,
    };
  }

  /**
   * Remove all pseudonym map rows whose expiresAt is in the past.
   */
  async cleanupExpired(): Promise<number> {
    const now = new Date();

    const result = await db
      .delete(pseudonymMaps)
      .where(lt(pseudonymMaps.expiresAt, now))
      .returning({ id: pseudonymMaps.id });

    return result.length;
  }
}
