// ============================================================================
// Iron Gate — AES-256-GCM Encryption
// ============================================================================
// Uses the Web Crypto API (SubtleCrypto) which is available in:
//   - Chrome extension service workers (globalThis.crypto)
//   - Bun runtime (globalThis.crypto)
//   - Node.js 20+ (globalThis.crypto)
//
// AES-256-GCM provides:
//   - 256-bit key (strongest AES variant)
//   - Authenticated encryption (confidentiality + integrity)
//   - 128-bit authentication tag (tamper detection)
//   - Random 96-bit IV per encryption (prevents nonce reuse)
//
// Output format: base64( IV[12 bytes] || ciphertext || authTag[16 bytes] )
// ============================================================================

const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12;       // 96 bits — recommended for AES-GCM
const AUTH_TAG_LENGTH = 128; // 128-bit auth tag (in bits, as WebCrypto expects)
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;     // 128-bit salt for PBKDF2

// ---------------------------------------------------------------------------
// Key Derivation
// ---------------------------------------------------------------------------

/**
 * Derive an AES-256-GCM CryptoKey from a master secret and salt.
 * Uses PBKDF2 with 100,000 iterations and SHA-256.
 *
 * @param masterSecret - The master secret string (e.g., firm-level secret)
 * @param salt - A unique salt per firm (16 bytes)
 * @returns CryptoKey usable for encrypt/decrypt
 */
export async function deriveKey(
  masterSecret: string,
  salt: Uint8Array,
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
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false, // non-extractable — key never leaves SubtleCrypto
    ['encrypt', 'decrypt'],
  );
}

/**
 * Generate a cryptographically random salt for PBKDF2.
 * @returns 16 random bytes
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Convert a salt to hex string for database storage.
 */
export function saltToHex(salt: Uint8Array): string {
  return Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a hex string back to a Uint8Array salt.
 */
export function hexToSalt(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param key - AES-256-GCM CryptoKey (from deriveKey())
 * @returns Base64-encoded string: IV(12) || ciphertext || authTag(16)
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = encoder.encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH },
    key,
    data,
  );

  // Combine IV + ciphertext+authTag into a single buffer
  const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), IV_LENGTH);

  return uint8ToBase64(combined);
}

/**
 * Decrypt an AES-256-GCM ciphertext back to plaintext.
 *
 * @param ciphertext - Base64-encoded string from encrypt()
 * @param key - Same CryptoKey used for encryption
 * @returns The original plaintext string
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export async function decrypt(
  ciphertext: string,
  key: CryptoKey,
): Promise<string> {
  const combined = base64ToUint8(ciphertext);

  if (combined.length < IV_LENGTH + 1) {
    throw new Error('Invalid ciphertext: too short');
  }

  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH },
    key,
    data,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// ---------------------------------------------------------------------------
// Base64 helpers (cross-platform: works in browser, Bun, Node.js)
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
  // Use btoa which is available in browsers, Bun, and Node.js 16+
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
