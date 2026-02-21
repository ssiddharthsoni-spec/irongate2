/**
 * Iron Gate — Local Storage Policy
 *
 * Enforces strict rules about what the extension is allowed to persist in
 * `chrome.storage.local`.  Sensitive data — prompt text, detection results,
 * raw API responses, etc. — must NEVER be written to disk.  This module
 * provides:
 *
 *  1. An allowlist of safe storage keys (`AllowedStorageKeys`).
 *  2. A blocklist of keys that must never be stored (`BLOCKED_KEYS`).
 *  3. A write-time guard (`sanitizeStorageWrite`) that throws if a caller
 *     attempts to persist a blocked key.
 *  4. A cleanup function (`clearSensitiveData`) that removes any blocked
 *     keys that may have leaked into storage.
 */

// ─── Allowed Keys ────────────────────────────────────────────────────────────

/**
 * Interface describing the keys that the extension is permitted to persist.
 * Every value is non-sensitive configuration / state.
 */
export interface AllowedStorageKeys {
  /** URL of the Iron Gate API the extension is connected to. */
  apiEndpoint: string;
  /** User-selected colour theme (light / dark / system). */
  extensionTheme: string;
  /** Feature-flag blob pulled from the API at startup. */
  featureFlags: Record<string, boolean>;
  /** Server-side config version for cache invalidation. */
  configVersion: number;
  /** Whether the kill switch is currently active. */
  killSwitchActive: boolean;
  /** The firm ID the extension is registered under. */
  firmId: string;
  /** Current connection status metadata. */
  connectionStatus: 'connected' | 'disconnected' | 'error';
}

/** Set of keys present in AllowedStorageKeys — used for runtime checks. */
const ALLOWED_KEY_SET: ReadonlySet<string> = new Set<string>([
  'apiEndpoint',
  'extensionTheme',
  'featureFlags',
  'configVersion',
  'killSwitchActive',
  'firmId',
  'connectionStatus',
  // Additional operational keys used by existing code
  'apiBaseUrl',
  'connectionState',
  'firmMode',
]);

// ─── Blocked Keys ────────────────────────────────────────────────────────────

/**
 * Keys that must NEVER appear in `chrome.storage.local`.  These represent
 * data whose persistence would create a security or compliance risk.
 */
export const BLOCKED_KEYS: readonly string[] = [
  'promptText',
  'detectionResults',
  'entityValues',
  'sessionData',
  'rawResponse',
] as const;

const BLOCKED_KEY_SET: ReadonlySet<string> = new Set(BLOCKED_KEYS);

// ─── Types ───────────────────────────────────────────────────────────────────

export class StoragePolicyViolationError extends Error {
  public readonly violatingKey: string;

  constructor(key: string) {
    super(
      `[SECURITY] Storage policy violation: writing key "${key}" is prohibited. ` +
        'This key contains sensitive data that must not be persisted.',
    );
    this.name = 'StoragePolicyViolationError';
    this.violatingKey = key;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate a single storage write.  Throws `StoragePolicyViolationError` if
 * the key is on the blocked list.
 *
 * @param key    The storage key being written.
 * @param value  The value (used for logging context only — not inspected).
 * @throws {StoragePolicyViolationError} if the key is blocked.
 */
export function sanitizeStorageWrite(key: string, value: unknown): void {
  if (BLOCKED_KEY_SET.has(key)) {
    console.error(
      `[SECURITY] Blocked attempt to write sensitive key "${key}" to chrome.storage.local.`,
      'Value type:', typeof value,
    );
    throw new StoragePolicyViolationError(key);
  }
}

/**
 * Validate a batch of storage writes (an object whose keys will be persisted).
 * Throws on the first violation found.
 *
 * @param items  The object being passed to `chrome.storage.local.set()`.
 * @throws {StoragePolicyViolationError} if any key is blocked.
 */
export function sanitizeStorageWriteBatch(
  items: Record<string, unknown>,
): void {
  for (const key of Object.keys(items)) {
    sanitizeStorageWrite(key, items[key]);
  }
}

/**
 * Scan `chrome.storage.local` for any blocked keys and remove them.
 * This is a defensive measure that should run on extension startup to clean
 * up data that may have been written by a previous buggy version.
 *
 * @returns A promise that resolves to the list of keys that were removed.
 */
export async function clearSensitiveData(): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    chrome.storage.local.get(null, (allItems) => {
      const keysToRemove = Object.keys(allItems).filter((key) =>
        BLOCKED_KEY_SET.has(key),
      );

      if (keysToRemove.length === 0) {
        resolve([]);
        return;
      }

      console.error(
        `[SECURITY] Found ${keysToRemove.length} sensitive key(s) in chrome.storage.local — removing:`,
        keysToRemove,
      );

      chrome.storage.local.remove(keysToRemove, () => {
        resolve(keysToRemove);
      });
    });
  });
}

/**
 * Check whether a key is on the allowed list.  This is an informational
 * check — it does NOT throw.  Use it for logging or soft warnings when you
 * encounter an unrecognised key that isn't explicitly blocked.
 */
export function isAllowedKey(key: string): boolean {
  return ALLOWED_KEY_SET.has(key);
}
