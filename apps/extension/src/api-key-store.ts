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
const API_KEY_ERROR_FLAG = 'ironGateApiKey_decrypt_error';
const API_KEY_SCHEME_VERSION = 'ironGateApiKey_scheme';
const LEGACY_KEY = 'ironGateApiKey';

// Scheme versions for the encrypted API-key payload.
//
// Any saveApiKey() today writes at SCHEME_CURRENT; loadApiKey() uses the
// stamp to route decryption to the right derivation path and skip legacy
// probes that don't apply.
//
//   SCHEME_4  (current) — random secret + random salt + PBKDF2(2.1M, SHA-256)
//   SCHEME_3            — random secret + random salt + PBKDF2(600k, SHA-256)
//   unstamped           — pre-v0.2.7 legacy (deterministic secret variants)
//
// Bumping iteration count to 2.1M matches NIST SP 800-132 (2023) guidance
// for PBKDF2 over SHA-256. Our 32-byte random secret already puts brute
// force out of reach; the iteration bump is defense in depth for any
// future reduction in secret entropy (e.g., managed-policy-derived keys).
//
// Sr. Engineer Audit · Item 4.
const SCHEME_4 = 4;
const SCHEME_3 = 3;
const SCHEME_CURRENT = SCHEME_4;
const PBKDF2_ITERATIONS_CURRENT = 2_100_000;
const PBKDF2_ITERATIONS_V3 = 600_000;

let _cachedKey: CryptoKey | null = null;
let _cachedSecretVersion: 'random' | 'deterministic' | null = null;
let _lastApiKeyError: string | null = null;

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

async function getEncryptionKey(iterations: number = PBKDF2_ITERATIONS_CURRENT): Promise<CryptoKey> {
  // Cache keyed on iteration count — a v3 decrypt (600k) during migration
  // must not hit the 2.1M-derived cached key.
  if (iterations === PBKDF2_ITERATIONS_CURRENT && _cachedKey && _cachedSecretVersion === 'random') {
    return _cachedKey;
  }

  const secret = await getOrCreateSecret();
  const salt = await getOrCreateSalt();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  const derived = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  if (iterations === PBKDF2_ITERATIONS_CURRENT) {
    _cachedKey = derived;
    _cachedSecretVersion = 'random';
  }
  return derived;
}

/**
 * Derive a key using the old deterministic secret — for MIGRATION ONLY.
 *
 * Historically used 600k iterations. We keep that constant here so we can
 * decrypt old blobs; successful decryption immediately triggers re-encrypt
 * at the current scheme (2.1M iterations, random secret, stamped version).
 *
 * Do not call this function for NEW writes. It exists purely to unblock
 * users upgrading from pre-v0.2.7 installs.
 */
async function getLegacyDeterministicKey(salt: BufferSource): Promise<CryptoKey> {
  const extId = chrome.runtime.id || 'iron-gate-local';
  const secret = `iron-gate-api-key-${extId}`;
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS_V3, hash: 'SHA-256' },
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

  // Clear any prior decrypt-error flag — the user is re-setting their key.
  _lastApiKeyError = null;
  try { await chrome.storage.local.remove(API_KEY_ERROR_FLAG); } catch { /* non-fatal */ }

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

  // Write encrypted, stamp scheme version, remove plaintext legacy key
  await chrome.storage.local.set({
    [API_KEY_STORAGE_KEY]: b64,
    [API_KEY_SCHEME_VERSION]: SCHEME_CURRENT,
  });
  await chrome.storage.local.remove(LEGACY_KEY);
}

/**
 * Load and decrypt the API key.
 * Auto-migrates any legacy plaintext key to encrypted storage immediately.
 */
export async function loadApiKey(): Promise<string> {
  const result = await chrome.storage.local.get([
    API_KEY_STORAGE_KEY,
    LEGACY_KEY,
    API_KEY_SCHEME_VERSION,
  ]);

  const schemeStamp: number | undefined = typeof result[API_KEY_SCHEME_VERSION] === 'number'
    ? result[API_KEY_SCHEME_VERSION]
    : undefined;

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

    const failures: string[] = [];

    // 1. Try current random-secret key
    try {
      const key = await getEncryptionKey();
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    } catch (err) {
      failures.push(`current-random-secret: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Scheme stamp says we're on the current scheme but decryption failed.
    // That means the ciphertext/secret/salt became inconsistent (e.g., user
    // wiped chrome.storage but the encrypted blob survived in a synced
    // profile). Do NOT fall through to legacy probes — attempting the
    // hardcoded-salt path against a current-scheme payload is wasted work
    // AND leaves the old derivation code as an attack surface. Report and
    // bail.
    if (schemeStamp === SCHEME_CURRENT) {
      const summary = failures.join(' | ');
      console.error('[Iron Gate] API key decryption failed with current scheme (stamped):', summary);
      _lastApiKeyError = summary;
      try {
        await chrome.storage.local.set({ [API_KEY_ERROR_FLAG]: summary });
      } catch { /* non-fatal */ }
      return '';
    }

    // 1b. SCHEME_3 migration: stamped v3 blob — try the random-secret
    //     key at the OLD 600k iteration count, then re-encrypt at 2.1M.
    if (schemeStamp === SCHEME_3) {
      try {
        const v3Key = await getEncryptionKey(PBKDF2_ITERATIONS_V3);
        const pt = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv, tagLength: 128 }, v3Key, ciphertext,
        );
        const apiKeyStr = new TextDecoder().decode(pt);
        // Re-encrypt at current (2.1M) iterations + bump stamp to SCHEME_4
        _cachedKey = null;
        _cachedSecretVersion = null;
        await saveApiKey(apiKeyStr);
        return apiKeyStr;
      } catch (err) {
        failures.push(`scheme-3-migration: ${err instanceof Error ? err.message : String(err)}`);
        const summary = failures.join(' | ');
        console.error('[Iron Gate] API key decryption failed with scheme 3 (stamped):', summary);
        _lastApiKeyError = summary;
        try { await chrome.storage.local.set({ [API_KEY_ERROR_FLAG]: summary }); } catch { /* non-fatal */ }
        return '';
      }
    }

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
    } catch (err) {
      failures.push(`legacy-det+random-salt: ${err instanceof Error ? err.message : String(err)}`);
    }

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
    } catch (err) {
      failures.push(`legacy-det+static-salt: ${err instanceof Error ? err.message : String(err)}`);
    }

    // All three schemes failed. Sr. Engineer Audit · Item 8: DO NOT silently
    // return ''. Previously the extension would boot with no auth and the
    // user had no idea their API key was unreadable. Now:
    //   1. Log to console so it shows up in service-worker DevTools
    //   2. Record the detail into _lastApiKeyError so the sidepanel can
    //      show a visible "re-enter your API key" banner
    //   3. Persist a flag to chrome.storage.local so the banner survives
    //      worker restarts / sidepanel re-mounts
    // We still return '' (to preserve caller contract) — but the error
    // is no longer invisible.
    const summary = failures.join(' | ');
    console.error('[Iron Gate] API key decryption failed against all known schemes:', summary);
    _lastApiKeyError = summary;
    try {
      await chrome.storage.local.set({ [API_KEY_ERROR_FLAG]: summary });
    } catch { /* storage itself failed — error state is still in memory */ }
    return '';
  }

  return '';
}

/**
 * Read the last API-key decryption failure.
 * Returns null if loadApiKey() has never failed this session.
 *
 * Callers (sidepanel, settings UI) should render a banner when this
 * returns a non-null value — the user's ciphertext is unrecoverable and
 * they need to re-enter their API key. Otherwise the extension silently
 * operates without auth.
 */
export async function getLastApiKeyError(): Promise<string | null> {
  if (_lastApiKeyError) return _lastApiKeyError;
  try {
    const r = await chrome.storage.local.get(API_KEY_ERROR_FLAG);
    const persisted = r?.[API_KEY_ERROR_FLAG];
    if (typeof persisted === 'string' && persisted.length > 0) {
      _lastApiKeyError = persisted;
      return persisted;
    }
  } catch { /* non-fatal */ }
  return null;
}

/** Call after the user successfully re-enters their API key. */
export async function clearApiKeyError(): Promise<void> {
  _lastApiKeyError = null;
  try {
    await chrome.storage.local.remove(API_KEY_ERROR_FLAG);
  } catch { /* non-fatal */ }
}
