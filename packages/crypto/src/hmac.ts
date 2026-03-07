// ============================================================================
// Iron Gate — HMAC-SHA256 Signing Utilities
// ============================================================================
// Server-side event signing for tamper-proof audit trail.
// Uses Web Crypto API (SubtleCrypto) — available in Bun, Node.js 20+,
// and Chrome extension service workers.
// ============================================================================

const PBKDF2_ITERATIONS = 600_000;

// Domain-separated salt for HMAC key derivation.
// Distinct from AES salt in aes-gcm.ts and KMS salt in kms-encryption.ts.
const HMAC_SIGNING_SALT = new TextEncoder().encode('IGHMAC_SIGNING_KEY_V2');

/**
 * Derive a non-extractable HMAC-SHA256 CryptoKey from a master secret.
 * Uses PBKDF2 with a fixed domain-separated salt so the same master secret
 * produces a cryptographically independent key from the AES encryption path.
 *
 * Cache the returned key at the application layer (singleton per process).
 */
export async function deriveHmacSigningKey(
  masterSecret: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterSecret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: HMAC_SIGNING_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false, // non-extractable
    ['sign', 'verify'],
  );
}

/**
 * Compute HMAC-SHA256 of a message, returning a 64-char hex string.
 */
export async function hmacSign(
  message: string,
  key: CryptoKey,
): Promise<string> {
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify an HMAC-SHA256 signature against a message.
 * Uses crypto.subtle.verify for constant-time comparison.
 */
export async function hmacVerify(
  message: string,
  signature: string,
  key: CryptoKey,
): Promise<boolean> {
  const encoder = new TextEncoder();
  // Convert hex signature back to ArrayBuffer
  const sigBytes = new Uint8Array(
    signature.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
  );
  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(message));
}
