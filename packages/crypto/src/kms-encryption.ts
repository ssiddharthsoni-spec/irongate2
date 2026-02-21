// ============================================================================
// Iron Gate — KMS Envelope Encryption
// ============================================================================
// Envelope encryption pattern:
//   1. Generate a random Data Encryption Key (DEK)
//   2. Encrypt the plaintext with the DEK using AES-256-GCM
//   3. Encrypt (wrap) the DEK with the firm's master key (KEK)
//   4. Return the encrypted data, wrapped DEK, and IV
//
// In production this would delegate key wrapping to AWS KMS.
// In dev/local mode, the KEK is derived from the firmKeyId via PBKDF2
// so no external service is needed.
//
// Uses only the Web Crypto API (crypto.subtle / crypto.getRandomValues).
// ============================================================================

const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const AUTH_TAG_LENGTH = 128; // 128-bit auth tag (in bits)
const DEK_LENGTH = 32; // 256-bit DEK
const PBKDF2_ITERATIONS = 100_000;

// Static salt used to derive local master keys from firm IDs.
// In production, the master key lives in AWS KMS and this is unused.
const LOCAL_MASTER_SALT = new Uint8Array([
  0x49, 0x52, 0x4f, 0x4e, 0x47, 0x41, 0x54, 0x45,
  0x4b, 0x4d, 0x53, 0x4c, 0x4f, 0x43, 0x41, 0x4c, // "IRONGATEKMSLOCAL"
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvelopeEncryptedPayload {
  /** Base64-encoded AES-256-GCM ciphertext (IV prepended) */
  encryptedData: string;
  /** Base64-encoded wrapped DEK (encrypted with the master key) */
  encryptedDek: string;
  /** Base64-encoded 12-byte IV used to wrap the DEK */
  iv: string;
}

export interface DataKeyResult {
  /** Raw DEK as a CryptoKey for immediate use */
  plaintextKey: CryptoKey;
  /** Base64-encoded wrapped (encrypted) DEK for storage */
  encryptedDek: string;
  /** Base64-encoded IV used to wrap the DEK */
  iv: string;
}

// ---------------------------------------------------------------------------
// Base64 helpers (cross-platform: browser, Bun, Node.js 16+)
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Local Master Key Derivation
// ---------------------------------------------------------------------------

/**
 * Derive a local master key (KEK) from a firmKeyId.
 * In production this would be replaced by an AWS KMS call.
 */
async function deriveLocalMasterKey(firmKeyId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(firmKeyId),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: LOCAL_MASTER_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

// ---------------------------------------------------------------------------
// Data Key Generation
// ---------------------------------------------------------------------------

/**
 * Generate a random Data Encryption Key (DEK) and wrap it with the firm's
 * master key. Returns both the plaintext CryptoKey (for immediate use) and
 * the encrypted (wrapped) DEK for storage alongside the ciphertext.
 *
 * @param firmKeyId - Identifier for the firm's master key
 * @returns The plaintext CryptoKey, the wrapped DEK, and the wrapping IV
 */
export async function generateDataKey(firmKeyId: string): Promise<DataKeyResult> {
  const masterKey = await deriveLocalMasterKey(firmKeyId);

  // Generate a random AES-256-GCM DEK
  const dek = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable — we need to wrap it
    ['encrypt', 'decrypt'],
  );

  // Wrap (encrypt) the DEK with the master key
  const wrapIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const wrappedDek = await crypto.subtle.wrapKey(
    'raw',
    dek,
    masterKey,
    { name: 'AES-GCM', iv: wrapIv, tagLength: AUTH_TAG_LENGTH },
  );

  return {
    plaintextKey: dek,
    encryptedDek: uint8ToBase64(new Uint8Array(wrappedDek)),
    iv: uint8ToBase64(wrapIv),
  };
}

// ---------------------------------------------------------------------------
// Envelope Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext using envelope encryption.
 *
 * 1. Generates a fresh DEK
 * 2. Encrypts the plaintext with the DEK (AES-256-GCM)
 * 3. Wraps the DEK with the firm's master key
 *
 * @param firmKeyId - Identifier for the firm's master key
 * @param plaintext - The string to encrypt
 * @returns The encrypted data, wrapped DEK, and wrapping IV
 */
export async function encryptForFirm(
  firmKeyId: string,
  plaintext: string,
): Promise<EnvelopeEncryptedPayload> {
  const { plaintextKey, encryptedDek, iv } = await generateDataKey(firmKeyId);

  const encoder = new TextEncoder();
  const dataIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = encoder.encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: dataIv, tagLength: AUTH_TAG_LENGTH },
    plaintextKey,
    data,
  );

  // Combine data IV + ciphertext (which includes the auth tag)
  const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  combined.set(dataIv, 0);
  combined.set(new Uint8Array(encrypted), IV_LENGTH);

  return {
    encryptedData: uint8ToBase64(combined),
    encryptedDek,
    iv,
  };
}

/**
 * Decrypt envelope-encrypted data.
 *
 * 1. Unwraps the DEK using the firm's master key
 * 2. Decrypts the ciphertext with the recovered DEK
 *
 * @param firmKeyId - Identifier for the firm's master key
 * @param encryptedDek - Base64-encoded wrapped DEK
 * @param encryptedData - Base64-encoded ciphertext (IV prepended)
 * @param iv - Base64-encoded IV used to wrap the DEK
 * @returns The original plaintext string
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export async function decryptForFirm(
  firmKeyId: string,
  encryptedDek: string,
  encryptedData: string,
  iv: string,
): Promise<string> {
  const masterKey = await deriveLocalMasterKey(firmKeyId);

  // Unwrap the DEK
  const wrapIv = base64ToUint8(iv);
  const wrappedDekBytes = base64ToUint8(encryptedDek);

  const dek = await crypto.subtle.unwrapKey(
    'raw',
    wrappedDekBytes as BufferSource,
    masterKey,
    { name: 'AES-GCM', iv: wrapIv as BufferSource, tagLength: AUTH_TAG_LENGTH },
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable once unwrapped
    ['decrypt'],
  );

  // Decrypt the data
  const combined = base64ToUint8(encryptedData);

  if (combined.length < IV_LENGTH + 1) {
    throw new Error('Invalid ciphertext: too short');
  }

  const dataIv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: dataIv, tagLength: AUTH_TAG_LENGTH },
    dek,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
