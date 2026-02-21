// ============================================================================
// Iron Gate — Client-Side Envelope Encryption (RSA-OAEP)
// ============================================================================
// Provides RSA-OAEP 2048-bit key pair operations for firm-level encryption.
//
// Each firm generates an RSA key pair:
//   - The public key is stored server-side to encrypt sensitive data
//   - The private key is held by the firm (or in a secure vault)
//
// Key format: Base64-encoded SPKI (public) and PKCS8 (private) DER bytes.
// This is a compact, portable format suitable for database storage and
// API transport without PEM header/footer lines.
//
// Uses only the Web Crypto API (crypto.subtle).
// ============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RSA_KEY_SIZE = 2048;
const RSA_HASH = 'SHA-256';
const RSA_ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: RSA_KEY_SIZE,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
  hash: RSA_HASH,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FirmKeyPair {
  /** Base64-encoded SPKI public key */
  publicKey: string;
  /** Base64-encoded PKCS8 private key */
  privateKey: string;
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
// Key Pair Generation
// ---------------------------------------------------------------------------

/**
 * Generate an RSA-OAEP 2048-bit key pair for a firm.
 *
 * @returns An object containing the Base64-encoded public and private keys
 */
export async function generateFirmKeyPair(): Promise<FirmKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    RSA_ALGORITHM,
    true, // extractable — we need to export the keys
    ['encrypt', 'decrypt'],
  );

  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  return {
    publicKey: uint8ToBase64(new Uint8Array(publicKeyBuffer)),
    privateKey: uint8ToBase64(new Uint8Array(privateKeyBuffer)),
  };
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt data using a firm's RSA-OAEP public key.
 *
 * RSA-OAEP with a 2048-bit key and SHA-256 can encrypt up to 190 bytes
 * of plaintext directly. For larger payloads, use envelope encryption
 * (encrypt a symmetric key with RSA, then encrypt data with that key).
 *
 * @param data - The plaintext string to encrypt
 * @param publicKeyBase64 - Base64-encoded SPKI public key
 * @returns Base64-encoded ciphertext
 */
export async function encryptWithPublicKey(
  data: string,
  publicKeyBase64: string,
): Promise<string> {
  const publicKeyBytes = base64ToUint8(publicKeyBase64);

  const publicKey = await crypto.subtle.importKey(
    'spki',
    publicKeyBytes as BufferSource,
    { name: 'RSA-OAEP', hash: RSA_HASH },
    false,
    ['encrypt'],
  );

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(data);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    plaintext,
  );

  return uint8ToBase64(new Uint8Array(ciphertext));
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypt data using a firm's RSA-OAEP private key.
 *
 * @param encrypted - Base64-encoded ciphertext from encryptWithPublicKey()
 * @param privateKeyBase64 - Base64-encoded PKCS8 private key
 * @returns The original plaintext string
 * @throws Error if decryption fails (wrong key, corrupted data, etc.)
 */
export async function decryptWithPrivateKey(
  encrypted: string,
  privateKeyBase64: string,
): Promise<string> {
  const privateKeyBytes = base64ToUint8(privateKeyBase64);

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes as BufferSource,
    { name: 'RSA-OAEP', hash: RSA_HASH },
    false,
    ['decrypt'],
  );

  const ciphertext = base64ToUint8(encrypted);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    ciphertext as BufferSource,
  );

  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}
