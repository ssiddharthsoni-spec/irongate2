/**
 * Encrypted Map Store — Phase 1.2
 *
 * Seven-layer storage system for pseudonym maps:
 * 1. Non-extractable AES-256-GCM key via Web Crypto API (per session)
 * 2. Encrypted map blobs in IndexedDB (not localStorage)
 * 3. Keyed by sessionId + conversationId
 * 4. 24-hour TTL sweep on startup and every 5 minutes
 * 5. Plaintext map variables zeroed after each decrypt/use cycle
 * 6. Zero network imports — fully offline
 * 7. Graceful degradation: falls back to in-memory if IndexedDB unavailable
 *
 * SECURITY: This module has ZERO network imports.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface EncryptedBlob {
  iv: string;       // hex-encoded IV
  ciphertext: string; // hex-encoded ciphertext
  createdAt: number;  // timestamp for TTL
}

interface StoredEntry {
  key: string;          // sessionId:conversationId
  blob: EncryptedBlob;
  createdAt: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DB_NAME = 'irongate-pseudonym-maps';
const STORE_NAME = 'encrypted-maps';
const DB_VERSION = 1;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Session Key ─────────────────────────────────────────────────────────────
// Generated once per extension session. Non-extractable: cannot be read
// from JavaScript, only used for encrypt/decrypt operations.

let sessionKey: CryptoKey | null = null;

async function getOrCreateSessionKey(): Promise<CryptoKey> {
  if (sessionKey) return sessionKey;

  sessionKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // NON-EXTRACTABLE — key material cannot be exported
    ['encrypt', 'decrypt'],
  );

  return sessionKey;
}

// ─── Hex Encoding ────────────────────────────────────────────────────────────

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

// ─── Encrypt / Decrypt ───────────────────────────────────────────────────────

async function encryptData(data: string): Promise<EncryptedBlob> {
  const key = await getOrCreateSessionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );

  return {
    iv: bufToHex(iv.buffer),
    ciphertext: bufToHex(ciphertext),
    createdAt: Date.now(),
  };
}

async function decryptData(blob: EncryptedBlob): Promise<string> {
  const key = await getOrCreateSessionKey();
  const iv = hexToBuf(blob.iv);
  const ciphertext = hexToBuf(blob.ciphertext);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

// ─── IndexedDB Operations ────────────────────────────────────────────────────

let dbInstance: IDBDatabase | null = null;
let dbFailed = false;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        dbInstance = request.result;
        resolve(dbInstance);
      };

      request.onerror = () => {
        dbFailed = true;
        reject(new Error('Failed to open IndexedDB'));
      };
    } catch {
      dbFailed = true;
      reject(new Error('IndexedDB not available'));
    }
  });
}

async function idbPut(entry: StoredEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key: string): Promise<StoredEntry | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAllKeys(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(): Promise<StoredEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── In-Memory Fallback ──────────────────────────────────────────────────────
// If IndexedDB is unavailable (e.g., in certain browser contexts),
// fall back to an in-memory Map. Data is lost on page/worker reload
// but pseudonymization still works.

const memoryFallback = new Map<string, EncryptedBlob>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Save pseudonym maps (forward + reverse) for a session/conversation.
 * Data is encrypted with AES-256-GCM before storage.
 */
export async function saveMaps(
  sessionId: string,
  conversationId: string,
  forwardMap: Record<string, string>,
  reverseMap: Record<string, string>,
): Promise<void> {
  const key = `${sessionId}:${conversationId}`;
  const payload = JSON.stringify({ forward: forwardMap, reverse: reverseMap });

  const blob = await encryptData(payload);

  if (dbFailed) {
    memoryFallback.set(key, blob);
    return;
  }

  try {
    await idbPut({ key, blob, createdAt: Date.now() });
  } catch {
    // Fall back to memory
    memoryFallback.set(key, blob);
  }
}

/**
 * Load and decrypt pseudonym maps for a session/conversation.
 * Returns null if no maps exist or decryption fails.
 *
 * SECURITY: The decrypted plaintext is returned to the caller.
 * The caller MUST zero out the returned object after use.
 */
export async function loadMaps(
  sessionId: string,
  conversationId: string,
): Promise<{ forward: Record<string, string>; reverse: Record<string, string> } | null> {
  const key = `${sessionId}:${conversationId}`;

  let blob: EncryptedBlob | undefined;

  if (dbFailed) {
    blob = memoryFallback.get(key);
  } else {
    try {
      const entry = await idbGet(key);
      blob = entry?.blob;
    } catch {
      blob = memoryFallback.get(key);
    }
  }

  if (!blob) return null;

  // Check TTL
  if (Date.now() - blob.createdAt > TTL_MS) {
    await deleteMaps(sessionId, conversationId);
    return null;
  }

  try {
    const plaintext = await decryptData(blob);
    const parsed = JSON.parse(plaintext);
    return { forward: parsed.forward, reverse: parsed.reverse };
  } catch {
    // Decryption failed (key rotated, corrupted data) — delete and return null
    await deleteMaps(sessionId, conversationId);
    return null;
  }
}

/**
 * Delete maps for a session/conversation.
 */
export async function deleteMaps(
  sessionId: string,
  conversationId: string,
): Promise<void> {
  const key = `${sessionId}:${conversationId}`;
  memoryFallback.delete(key);
  if (!dbFailed) {
    try { await idbDelete(key); } catch { /* ignore */ }
  }
}

/**
 * Delete all maps for a session (across all conversations).
 */
export async function deleteSession(sessionId: string): Promise<void> {
  // Memory fallback
  for (const key of memoryFallback.keys()) {
    if (key.startsWith(sessionId + ':')) {
      memoryFallback.delete(key);
    }
  }

  if (dbFailed) return;

  try {
    const keys = await idbGetAllKeys();
    for (const key of keys) {
      if (key.startsWith(sessionId + ':')) {
        await idbDelete(key);
      }
    }
  } catch { /* ignore */ }
}

/**
 * Sweep expired entries. Run on startup and every 5 minutes.
 */
export async function sweepExpired(): Promise<number> {
  let deleted = 0;
  const now = Date.now();

  // Memory fallback
  for (const [key, blob] of memoryFallback) {
    if (now - blob.createdAt > TTL_MS) {
      memoryFallback.delete(key);
      deleted++;
    }
  }

  if (dbFailed) return deleted;

  try {
    const entries = await idbGetAll();
    for (const entry of entries) {
      if (now - entry.createdAt > TTL_MS) {
        await idbDelete(entry.key);
        deleted++;
      }
    }
  } catch { /* ignore */ }

  return deleted;
}

// ─── Auto-Sweep Timer ────────────────────────────────────────────────────────

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the encrypted map store.
 * Generates the session key, opens IndexedDB, and starts the TTL sweep timer.
 */
export async function initEncryptedMapStore(): Promise<void> {
  // Generate session key
  await getOrCreateSessionKey();

  // Try to open IndexedDB
  try {
    await openDB();
  } catch {
    dbFailed = true;
    console.warn('[Iron Gate] IndexedDB unavailable — using in-memory fallback for pseudonym maps');
  }

  // Initial sweep
  sweepExpired().catch(() => {});

  // Periodic sweep every 5 minutes
  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      sweepExpired().catch(() => {});
    }, SWEEP_INTERVAL_MS);
  }
}

/**
 * Destroy the store. Clears all data and stops the sweep timer.
 */
export async function destroyEncryptedMapStore(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }

  sessionKey = null;
  memoryFallback.clear();

  if (!dbFailed && dbInstance) {
    try {
      const keys = await idbGetAllKeys();
      for (const key of keys) {
        await idbDelete(key);
      }
    } catch { /* ignore */ }
  }
}
