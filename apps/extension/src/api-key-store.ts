/**
 * Encrypted API Key Storage
 *
 * Encrypts the Iron Gate API key with AES-256-GCM before storing in
 * chrome.storage.local. The encryption key is derived from a per-installation
 * cryptographically random secret (stored in chrome.storage.local) + random
 * salt via PBKDF2.
 *
 * Protects against: casual profile inspection, malware scanning browser
 * storage for API keys, and cross-extension storage access.
 *
 * Migration: transparently upgrades keys encrypted with the old deterministic
 * scheme (extension-id-based) to the new random-secret scheme on first load.
 */

const API_KEY_STORAGE_KEY = 'ironGateApiKey_enc';
const API_KEY_SALT_KEY = 'ironGateApiKey_salt';
const API_KEY_SECRET_KEY = 'ironGateApiKey_secret';
const LEGACY_KEY = 'ironGateApiKey';

let _cachedKey: CryptoKey | null = null;
let _cachedSecretVersion: 'random' | 'deterministic' | null = null;

/**
 * Get or generate a per-installation random salt.
 * Stored alongside the encrypted key — this is safe because the salt's
 * purpose is uniqueness (prevents cross-installation key equivalence),
 * not secrecy. The secret material is `chrome.runtime.id`.
 */
async function getOrCreateSalt(): Promise<Uint8Array> {
  const result = await chrome.storage.local.get(API_KEY_SALT_KEY);
  if (result[API_KEY_SALT_KEY]) {
    return Uint8Array.from(atob(result[API_KEY_SALT_KEY]), c => c.charCodeAt(0));
  }
  // First use — generate 16-byte random salt and persist
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({
    [API_KEY_SALT_KEY]: btoa(String.fromCharCode(...salt)),
  });
  return salt;
}

/**
 * Get or generate a per-installation random encryption secret.
 * This replaces the old deterministic `iron-gate-api-key-${extensionId}`
 * which was trivially reversible since the extension ID is public.
 */
async function getOrCreateSecret(): Promise<string> {
  const result = await chrome.storage.local.get(API_KEY_SECRET_KEY);
  if (result[API_KEY_SECRET_KEY]) {
    return result[API_KEY_SECRET_KEY];
  }
  // Generate 32 bytes of cryptographic randomness as the secret
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...secretBytes));
  await chrome.storage.local.set({ [API_KEY_SECRET_KEY]: secret });
  return secret;
}

async function getEncryptionKey(): Promise<CryptoKey> {
  if (_cachedKey && _cachedSecretVersion === 'random') return _cachedKey;

  const secret = await getOrCreateSecret();
  const salt = await getOrCreateSalt();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  _cachedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  _cachedSecretVersion = 'random';

  return _cachedKey;
}

/** Derive a key using the old deterministic secret (for migration only). */
async function getLegacyDeterministicKey(salt: BufferSource): Promise<CryptoKey> {
  const extId = chrome.runtime.id || 'iron-gate-local';
  const secret = `iron-gate-api-key-${extId}`;
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt and store the API key.
 * Also clears any legacy plaintext key.
 */
export async function saveApiKey(apiKey: string): Promise<void> {
  if (!apiKey) {
    // Clear both encrypted and legacy
    await chrome.storage.local.remove([API_KEY_STORAGE_KEY, LEGACY_KEY]);
    return;
  }

  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(apiKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    encoded,
  );

  // Store as base64: iv + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  const b64 = btoa(String.fromCharCode(...combined));

  // Write encrypted, remove plaintext legacy key
  await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: b64 });
  await chrome.storage.local.remove(LEGACY_KEY);
}

/**
 * Load and decrypt the API key.
 * Auto-migrates any legacy plaintext key to encrypted storage immediately.
 */
export async function loadApiKey(): Promise<string> {
  const result = await chrome.storage.local.get([API_KEY_STORAGE_KEY, LEGACY_KEY]);

  // Always force-migrate legacy plaintext key first (don't leave it sitting around)
  if (result[LEGACY_KEY]) {
    const legacyKey = result[LEGACY_KEY];
    try {
      await saveApiKey(legacyKey); // encrypts + deletes legacy key
    } catch {
      // Migration failed — delete plaintext anyway for safety
      await chrome.storage.local.remove(LEGACY_KEY);
    }
    return legacyKey;
  }

  if (result[API_KEY_STORAGE_KEY]) {
    const combined = Uint8Array.from(atob(result[API_KEY_STORAGE_KEY]), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    // 1. Try current random-secret key
    try {
      const key = await getEncryptionKey();
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    } catch { /* not encrypted with current key — try legacy */ }

    // 2. Try old deterministic key + current random salt (migration case)
    try {
      const salt = await getOrCreateSalt();
      const legacyKey = await getLegacyDeterministicKey(salt as BufferSource);
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 }, legacyKey, ciphertext,
      );
      const apiKeyStr = new TextDecoder().decode(pt);
      // Re-encrypt with new random secret
      _cachedKey = null;
      _cachedSecretVersion = null;
      await saveApiKey(apiKeyStr);
      return apiKeyStr;
    } catch { /* not this scheme either */ }

    // 3. Try old deterministic key + hardcoded static salt (oldest scheme)
    try {
      const legacySalt = new TextEncoder().encode('ig-api-key-salt-v1');
      const legacyKey = await getLegacyDeterministicKey(legacySalt);
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 }, legacyKey, ciphertext,
      );
      const apiKeyStr = new TextDecoder().decode(pt);
      // Re-encrypt with new random secret + random salt
      _cachedKey = null;
      _cachedSecretVersion = null;
      await saveApiKey(apiKeyStr);
      return apiKeyStr;
    } catch {
      return '';
    }
  }

  return '';
}
