/**
 * Authentication manager for the extension.
 * Manages JWT tokens via Clerk for API authentication.
 * All credentials are AES-256-GCM encrypted before storing in chrome.storage.local.
 */

import { encrypt, decrypt, deriveKey } from '@iron-gate/crypto';

// Debug logging — gated behind ironGateDebug storage flag
let _authDebug = false;
try { chrome.storage.local.get('ironGateDebug', (r) => { _authDebug = !!r.ironGateDebug; }); } catch {}
function authLog(...args: any[]) { if (_authDebug) console.log('[Iron Gate Auth]', ...args); }

const TOKEN_STORAGE_KEY = 'iron_gate_auth_token';
const TOKEN_EXPIRY_KEY = 'iron_gate_token_expiry';
const ENCRYPTION_KEY_SESSION = 'iron_gate_crypto_key';
const MASTER_SECRET_STORAGE_KEY = 'iron_gate_master_secret';

interface AuthState {
  token: string | null;
  expiresAt: number;
  firmId: string | null;
  userId: string | null;
}

let authState: AuthState = {
  token: null,
  expiresAt: 0,
  firmId: null,
  userId: null,
};

// The derived CryptoKey — held in memory while service worker is alive
let encryptionKey: CryptoKey | null = null;
// M-10 fix: TTL for memoized key — re-fetch from session storage periodically
// to pick up key rotations (e.g., after re-login or session refresh).
let _encryptionKeyTimestamp = 0;
const ENCRYPTION_KEY_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Guard against concurrent getEncryptionKey() calls (TOCTOU race)
let _encryptionKeyPromise: Promise<CryptoKey | null> | null = null;

// ---------------------------------------------------------------------------
// Encryption Key Management
// ---------------------------------------------------------------------------

/**
 * Initialize the encryption key from session storage or derive a new one.
 * The key is stored in chrome.storage.session (survives SW restart,
 * cleared when browser quits).
 * Uses a promise guard to prevent concurrent double-derivation.
 */
async function getEncryptionKey(): Promise<CryptoKey | null> {
  // M-10: Return cached key only if within TTL — stale keys are re-derived
  // from session storage to pick up any key rotation (e.g., re-login).
  if (encryptionKey && (Date.now() - _encryptionKeyTimestamp) < ENCRYPTION_KEY_TTL_MS) {
    return encryptionKey;
  }

  // If another call is already deriving, wait for it instead of double-deriving
  if (_encryptionKeyPromise) return _encryptionKeyPromise;

  _encryptionKeyPromise = (async () => {
    try {
      // Try to restore key derivation material from session storage
      const session = await chrome.storage.session.get(ENCRYPTION_KEY_SESSION);
      if (session[ENCRYPTION_KEY_SESSION]) {
        const { masterSecret, salt } = session[ENCRYPTION_KEY_SESSION];
        const saltBytes = new Uint8Array(salt);
        encryptionKey = await deriveKey(masterSecret, saltBytes);
        _encryptionKeyTimestamp = Date.now();
        return encryptionKey;
      }
    } catch {
      // Session storage not available or empty — key will be derived on login
    }
    return null;
  })();

  try {
    return await _encryptionKeyPromise;
  } finally {
    _encryptionKeyPromise = null;
  }
}

/**
 * Get or generate a per-installation cryptographic master secret.
 * On first call, generates 32 bytes of randomness via crypto.getRandomValues()
 * and persists it in chrome.storage.session (cleared when browser quits).
 * Subsequent calls return the cached value.
 *
 * This replaces the old deterministic `iron-gate-${firmId}` scheme, which was
 * predictable since firmId is not secret material.
 */
async function getOrCreateMasterSecret(firmId: string): Promise<string> {
  // 1. Try session storage (survives service worker restart within same browser session)
  try {
    const stored = await chrome.storage.session.get(MASTER_SECRET_STORAGE_KEY);
    const entry = stored[MASTER_SECRET_STORAGE_KEY];
    if (entry && entry.firmId === firmId && typeof entry.secret === 'string') {
      return entry.secret;
    }
  } catch {
    // Session storage unavailable — will generate fresh
  }

  // 2. Generate a new cryptographically random secret
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...secretBytes));

  // 3. Persist in session storage (survives SW restart, cleared on browser quit)
  try {
    await chrome.storage.session.set({
      [MASTER_SECRET_STORAGE_KEY]: { firmId, secret },
    });
  } catch {
    // If session storage is unavailable, the secret lives in memory only.
    // It will be regenerated on SW restart, which means stored credentials
    // will fail to decrypt and the user will need to re-authenticate —
    // safe behavior (fail-closed).
  }

  return secret;
}

/**
 * Set up encryption key when the user logs in.
 * Called from setCredentials() with the firm's encryption salt.
 */
async function initEncryptionKey(firmId: string, encryptionSalt?: string): Promise<void> {
  // Derive key from a cryptographically random secret + salt
  const masterSecret = await getOrCreateMasterSecret(firmId);
  const salt = encryptionSalt
    ? hexToUint8(encryptionSalt)
    : crypto.getRandomValues(new Uint8Array(16));

  encryptionKey = await deriveKey(masterSecret, salt);
  _encryptionKeyTimestamp = Date.now();

  // Persist key material in session storage (survives SW restart)
  try {
    await chrome.storage.session.set({
      [ENCRYPTION_KEY_SESSION]: {
        masterSecret,
        salt: Array.from(salt),
      },
    });
  } catch {
    // Session storage may not be available in all contexts
  }
}

function hexToUint8(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Invalid hex string for encryption salt');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Encrypted Storage Helpers
// ---------------------------------------------------------------------------

async function encryptedSet(data: Record<string, unknown>): Promise<void> {
  const key = await getEncryptionKey();
  if (!key) {
    // No encryption key yet (pre-login) — store in session storage only
    // (clears on browser close). Never write to local storage unencrypted.
    try {
      await chrome.storage.session.set(data);
    } catch {
      // Session storage unavailable — hold in memory only (authState).
      // Data will be lost on SW restart, but that's safer than plaintext persistence.
      authLog('No encryption key and no session storage — credentials held in memory only');
    }
    return;
  }

  const encrypted: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    encrypted[k] = await encrypt(JSON.stringify(v), key);
  }
  await chrome.storage.local.set(encrypted);
}

async function encryptedGet(keys: string[]): Promise<Record<string, unknown>> {
  const key = await getEncryptionKey();
  const stored = await chrome.storage.local.get(keys);
  const result: Record<string, unknown> = {};

  for (const k of keys) {
    if (stored[k] === undefined || stored[k] === null) {
      result[k] = null;
      continue;
    }

    if (!key) {
      // No encryption key — try reading from session storage (pre-login fallback)
      try {
        const sessionData = await chrome.storage.session.get(k);
        result[k] = sessionData[k] ?? null;
      } catch {
        result[k] = null;
      }
      continue;
    }

    try {
      const decrypted = await decrypt(stored[k] as string, key);
      result[k] = JSON.parse(decrypted);
    } catch {
      // Decryption failed — might be legacy plaintext data
      result[k] = stored[k];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize auth from stored credentials.
 */
export async function initAuth(): Promise<void> {
  try {
    // Try to restore encryption key first
    await getEncryptionKey();

    const stored = await encryptedGet([
      TOKEN_STORAGE_KEY,
      TOKEN_EXPIRY_KEY,
      'iron_gate_firm_id',
      'iron_gate_user_id',
    ]);

    authState = {
      token: (stored[TOKEN_STORAGE_KEY] as string) || null,
      expiresAt: (stored[TOKEN_EXPIRY_KEY] as number) || 0,
      firmId: (stored.iron_gate_firm_id as string) || null,
      userId: (stored.iron_gate_user_id as string) || null,
    };

    authLog('Initialized', {
      hasToken: !!authState.token,
      firmId: authState.firmId,
      encrypted: !!encryptionKey,
    });
  } catch (error) {
    authLog('Failed to initialize:', error);
  }
}

/**
 * Get a valid authentication token.
 * Returns the stored token if still valid, or an empty string if unauthenticated.
 * The API will return 401 for unauthenticated requests, which the side panel
 * surfaces as a "please log in" prompt.
 */
export async function getToken(): Promise<string> {
  // Valid token — return it
  if (authState.token && Date.now() < authState.expiresAt - 60_000) {
    return authState.token;
  }

  // Token exists but is expired — discard it and return empty string
  // so API returns 401, triggering re-authentication
  if (authState.token) {
    authLog('Token expired — clearing, user needs to re-authenticate');
    authState.token = '';
    authState.expiresAt = 0;
    return '';
  }

  // No token at all — return empty string so API returns 401
  authLog('No token available — user needs to authenticate');
  return '';
}

/**
 * Set authentication credentials (called from side panel login flow).
 * Initializes per-firm encryption key and encrypts all stored data.
 */
export async function setCredentials(credentials: {
  token: string;
  expiresAt: number;
  firmId: string;
  userId: string;
  encryptionSalt?: string;
}): Promise<void> {
  // Initialize encryption key BEFORE persisting
  await initEncryptionKey(credentials.firmId, credentials.encryptionSalt);

  authState = {
    token: credentials.token,
    expiresAt: credentials.expiresAt,
    firmId: credentials.firmId,
    userId: credentials.userId,
  };

  await persistAuth();
  authLog('Credentials updated (AES-256-GCM encrypted)');
}

/**
 * Clear authentication state (logout).
 */
export async function clearCredentials(): Promise<void> {
  authState = {
    token: null,
    expiresAt: 0,
    firmId: null,
    userId: null,
  };

  encryptionKey = null;
  _encryptionKeyTimestamp = 0;

  try {
    await chrome.storage.local.remove([
      TOKEN_STORAGE_KEY,
      TOKEN_EXPIRY_KEY,
      'iron_gate_firm_id',
      'iron_gate_user_id',
    ]);
  } catch {
    // Storage may not be available during extension shutdown
  }

  try {
    await chrome.storage.session.remove([ENCRYPTION_KEY_SESSION, MASTER_SECRET_STORAGE_KEY]);
  } catch {
    // Session storage may not be available
  }

  authLog('Credentials cleared');
}

export function getFirmId(): string | null {
  return authState.firmId;
}

export function getUserId(): string | null {
  return authState.userId;
}

export function isAuthenticated(): boolean {
  return !!authState.token && Date.now() < authState.expiresAt;
}

async function persistAuth(): Promise<void> {
  try {
    await encryptedSet({
      [TOKEN_STORAGE_KEY]: authState.token,
      [TOKEN_EXPIRY_KEY]: authState.expiresAt,
      iron_gate_firm_id: authState.firmId,
      iron_gate_user_id: authState.userId,
    });
  } catch (err) {
    authLog('Failed to persist auth state:', err);
  }
}
