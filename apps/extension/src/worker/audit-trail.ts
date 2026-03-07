/**
 * Cryptographic Audit Trail
 *
 * Records HMAC-signed, AES-256-GCM encrypted attestation records for every
 * interception event.
 *
 * Security layers:
 * 1. Persistent HMAC-SHA256 signing (tamper-evidence across sessions)
 * 2. AES-256-GCM encryption at rest (unreadable in chrome.storage.local)
 *
 * Encryption key is derived from a per-installation random secret via PBKDF2.
 * HMAC key is persisted in chrome.storage.local so signatures remain verifiable
 * across service worker restarts.
 */

import { deriveKey, encrypt, decrypt } from '@iron-gate/crypto';

const AUDIT_STORAGE_KEY = '__ig_audit_log';          // legacy plaintext
const AUDIT_STORAGE_KEY_ENC = '__ig_audit_log_enc';  // encrypted blob
const AUDIT_VERSION_KEY = '__ig_audit_log_version';
const AUDIT_SALT_KEY = '__ig_audit_log_salt';
const AUDIT_SECRET_KEY = '__ig_audit_secret';
const AUDIT_HMAC_KEY = '__ig_audit_hmac_key';
const CURRENT_AUDIT_VERSION = 2;
const MAX_RECORDS = 2000;

interface AuditRecord {
  /** ISO timestamp */
  ts: string;
  /** Action taken: proxy, audit, pass, block, warn */
  action: string;
  /** Number of entities detected */
  entityCount: number;
  /** SHA-256 hash of the prompt (pre-computed by caller) */
  promptHash: string;
  /** Sensitivity level */
  level: string;
  /** Sensitivity score */
  score: number;
  /** AI tool identifier */
  aiToolId: string;
  /** HMAC-SHA256 signature of the record fields */
  hmac: string;
}

// ── HMAC signing (persisted across service worker restarts) ───────────

let _hmacKey: CryptoKey | null = null;

async function getHmacKey(): Promise<CryptoKey> {
  if (_hmacKey) return _hmacKey;

  // Try to load persisted HMAC key
  const result = await chrome.storage.local.get(AUDIT_HMAC_KEY);
  if (result[AUDIT_HMAC_KEY]) {
    try {
      const rawKey = Uint8Array.from(atob(result[AUDIT_HMAC_KEY]), c => c.charCodeAt(0));
      _hmacKey = await crypto.subtle.importKey(
        'raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify'],
      );
      return _hmacKey;
    } catch { /* corrupted — regenerate */ }
  }

  // Generate new HMAC key and persist it
  _hmacKey = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify'],
  );
  const exported = await crypto.subtle.exportKey('raw', _hmacKey);
  await chrome.storage.local.set({
    [AUDIT_HMAC_KEY]: btoa(String.fromCharCode(...new Uint8Array(exported))),
  });
  return _hmacKey;
}

async function hmacSign(data: string): Promise<string> {
  const key = await getHmacKey();
  const encoded = new TextEncoder().encode(data);
  const sig = await crypto.subtle.sign('HMAC', key, encoded);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── AES-256-GCM encryption at rest ────────────────────────────────────

let _auditEncKey: CryptoKey | null = null;

/**
 * Get or generate a per-installation random salt for audit log encryption.
 * Stored in chrome.storage.local — salt provides uniqueness, not secrecy.
 */
async function getOrCreateAuditSalt(): Promise<Uint8Array> {
  const result = await chrome.storage.local.get(AUDIT_SALT_KEY);
  if (result[AUDIT_SALT_KEY]) {
    return Uint8Array.from(atob(result[AUDIT_SALT_KEY]), c => c.charCodeAt(0));
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({
    [AUDIT_SALT_KEY]: btoa(String.fromCharCode(...salt)),
  });
  return salt;
}

/**
 * Get or generate a per-installation random secret for audit log encryption.
 * Replaces the old deterministic `iron-gate-audit-${extensionId}` scheme.
 */
async function getOrCreateAuditSecret(): Promise<string> {
  const result = await chrome.storage.local.get(AUDIT_SECRET_KEY);
  if (result[AUDIT_SECRET_KEY]) return result[AUDIT_SECRET_KEY];
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...secretBytes));
  await chrome.storage.local.set({ [AUDIT_SECRET_KEY]: secret });
  return secret;
}

async function getAuditEncryptionKey(): Promise<CryptoKey> {
  if (_auditEncKey) return _auditEncKey;
  const secret = await getOrCreateAuditSecret();
  const salt = await getOrCreateAuditSalt();
  _auditEncKey = await deriveKey(secret, salt);
  return _auditEncKey;
}

/** Derive a key using the old deterministic secret (for migration only). */
async function getLegacyAuditKey(salt: Uint8Array): Promise<CryptoKey> {
  const extId = chrome.runtime.id || 'iron-gate-local';
  return deriveKey(`iron-gate-audit-${extId}`, salt);
}

async function readDecryptedLog(): Promise<AuditRecord[]> {
  const encKey = await getAuditEncryptionKey();
  const result = await chrome.storage.local.get([AUDIT_STORAGE_KEY_ENC, AUDIT_VERSION_KEY, AUDIT_STORAGE_KEY]);

  // New encrypted format
  if (result[AUDIT_VERSION_KEY] === CURRENT_AUDIT_VERSION && result[AUDIT_STORAGE_KEY_ENC]) {
    try {
      const decrypted = await decrypt(result[AUDIT_STORAGE_KEY_ENC], encKey);
      return JSON.parse(decrypted) as AuditRecord[];
    } catch {
      // Try old deterministic key + current random salt
      try {
        const salt = await getOrCreateAuditSalt();
        const legacyKey = await getLegacyAuditKey(salt);
        const dec = await decrypt(result[AUDIT_STORAGE_KEY_ENC], legacyKey);
        const records = JSON.parse(dec) as AuditRecord[];
        _auditEncKey = null;
        await writeEncryptedLog(records);
        return records;
      } catch { /* try oldest scheme */ }

      // Try old deterministic key + hardcoded static salt (oldest scheme)
      try {
        const legacySalt = new TextEncoder().encode('ig-audit-log-salt-v1');
        const legacyKey = await getLegacyAuditKey(legacySalt);
        const dec = await decrypt(result[AUDIT_STORAGE_KEY_ENC], legacyKey);
        const records = JSON.parse(dec) as AuditRecord[];
        _auditEncKey = null;
        await writeEncryptedLog(records);
        return records;
      } catch {
        return [];
      }
    }
  }

  // Legacy plaintext format — auto-migrate
  if (result[AUDIT_STORAGE_KEY] && Array.isArray(result[AUDIT_STORAGE_KEY])) {
    const legacyLog: AuditRecord[] = result[AUDIT_STORAGE_KEY];
    await writeEncryptedLog(legacyLog);
    await chrome.storage.local.remove(AUDIT_STORAGE_KEY);
    return legacyLog;
  }

  return [];
}

async function writeEncryptedLog(log: AuditRecord[]): Promise<void> {
  const encKey = await getAuditEncryptionKey();
  const plaintext = JSON.stringify(log);
  const ciphertext = await encrypt(plaintext, encKey);
  await chrome.storage.local.set({
    [AUDIT_STORAGE_KEY_ENC]: ciphertext,
    [AUDIT_VERSION_KEY]: CURRENT_AUDIT_VERSION,
  });
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Record an attestation for an interception event.
 */
export async function recordAttestation(params: {
  action: string;
  entityCount: number;
  promptHash: string;
  level: string;
  score: number;
  aiToolId: string;
}): Promise<void> {
  try {
    const ts = new Date().toISOString();
    const { action, entityCount, promptHash, level, score, aiToolId } = params;

    const canonical = `${ts}|${action}|${entityCount}|${promptHash}|${level}|${score}|${aiToolId}`;
    const hmac = await hmacSign(canonical);

    const record: AuditRecord = { ts, action, entityCount, promptHash, level, score, aiToolId, hmac };

    let log = await readDecryptedLog();
    log.push(record);

    if (log.length > MAX_RECORDS) {
      log = log.slice(log.length - MAX_RECORDS);
    }

    await writeEncryptedLog(log);
  } catch {
    // Non-critical — don't let audit logging break the main flow
  }
}

/**
 * Retrieve the full audit log (decrypted).
 */
export async function getAuditLog(): Promise<AuditRecord[]> {
  try {
    return await readDecryptedLog();
  } catch {
    return [];
  }
}

/**
 * Clear the audit log.
 */
export async function clearAuditLog(): Promise<void> {
  await chrome.storage.local.remove([AUDIT_STORAGE_KEY, AUDIT_STORAGE_KEY_ENC, AUDIT_VERSION_KEY]);
}
