// ============================================================================
// Token encryption — AES-256-GCM for OAuth tokens at rest
// ============================================================================
//
// Used by mdm_connections table to store Google / Microsoft / Jamf OAuth
// tokens encrypted. Per-firm key derivation so a single compromised token
// doesn't reveal tokens for other firms.
//
// Key derivation:
//   key = HKDF-SHA256(IRON_GATE_ENCRYPTION_SECRET, salt=firmId, info="mdm-tokens")
//
// Format on disk:
//   encryptedTokens: base64 ciphertext
//   encryptionIv: hex(12 bytes) — required for GCM
//   encryptionAuthTag: hex(16 bytes) — required for GCM integrity
// ============================================================================

import crypto from 'crypto';

const ALGO = 'aes-256-gcm' as const;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits recommended for GCM

function getMasterSecret(): string {
  const secret =
    process.env.IRON_GATE_ENCRYPTION_SECRET ||
    process.env.IRON_GATE_MASTER_SECRET ||
    process.env.JWT_SIGNING_KEY;
  if (!secret) {
    throw new Error(
      '[token-encryption] IRON_GATE_ENCRYPTION_SECRET (or fallback) is required. ' +
      'Set it in the API environment — a random 32+ character string.',
    );
  }
  return secret;
}

/** Derive a per-firm encryption key via HKDF-SHA256. */
function deriveFirmKey(firmId: string): Buffer {
  const master = getMasterSecret();
  // Node's crypto HKDF is sync-safe; derive deterministically from master + firmId
  const salt = crypto.createHash('sha256').update(firmId).digest();
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(master, 'utf8'), salt, Buffer.from('mdm-tokens'), KEY_LENGTH),
  );
}

export interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string; // hex
  authTag: string; // hex
}

/**
 * Encrypt a string (typically a JSON-stringified OAuth token object) for
 * storage in the mdm_connections table.
 */
export function encryptForFirm(plaintext: string, firmId: string): EncryptedBlob {
  const key = deriveFirmKey(firmId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt a token blob previously encrypted with encryptForFirm().
 * Throws if the auth tag doesn't verify (tamper detection).
 */
export function decryptForFirm(blob: EncryptedBlob, firmId: string): string {
  const key = deriveFirmKey(firmId);
  const iv = Buffer.from(blob.iv, 'hex');
  const authTag = Buffer.from(blob.authTag, 'hex');
  const ciphertext = Buffer.from(blob.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
