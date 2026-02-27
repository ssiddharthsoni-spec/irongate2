/**
 * Encrypted API Key Storage
 *
 * Encrypts the Iron Gate API key with AES-256-GCM before storing in
 * chrome.storage.local. The encryption key is derived from the extension's
 * runtime ID + static salt via PBKDF2, so it's unique per installation
 * and survives browser restarts.
 *
 * Protects against: casual profile inspection, malware scanning browser
 * storage for API keys, and cross-extension storage access.
 */

const API_KEY_STORAGE_KEY = 'ironGateApiKey_enc';
const LEGACY_KEY = 'ironGateApiKey';

let _cachedKey: CryptoKey | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;

  const extId = chrome.runtime.id || 'iron-gate-local';
  const secret = `iron-gate-api-key-${extId}`;
  const salt = new TextEncoder().encode('ig-api-key-salt-v1');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  _cachedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  return _cachedKey;
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
    { name: 'AES-GCM', iv },
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
 * Falls back to reading legacy plaintext key (auto-migrates on next save).
 */
export async function loadApiKey(): Promise<string> {
  // Try encrypted key first
  const result = await chrome.storage.local.get([API_KEY_STORAGE_KEY, LEGACY_KEY]);

  if (result[API_KEY_STORAGE_KEY]) {
    try {
      const key = await getEncryptionKey();
      const combined = Uint8Array.from(atob(result[API_KEY_STORAGE_KEY]), c => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);

      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext,
      );

      return new TextDecoder().decode(plaintext);
    } catch {
      // Decryption failed (key changed?) — fall through to legacy
    }
  }

  // Legacy plaintext key — migrate on next save
  if (result[LEGACY_KEY]) {
    const legacyKey = result[LEGACY_KEY];
    // Auto-migrate: re-save encrypted
    await saveApiKey(legacyKey);
    return legacyKey;
  }

  return '';
}
