// ============================================================================
// Iron Gate — Server-Side HMAC Signing Key (Singleton)
// ============================================================================
// Derives an HMAC-SHA256 key from IRON_GATE_MASTER_SECRET on first use,
// then caches for the process lifetime. The key is domain-separated from
// AES encryption keys via a distinct PBKDF2 salt.
// ============================================================================

import { deriveHmacSigningKey } from '@iron-gate/crypto';

const MASTER_SECRET =
  process.env.IRON_GATE_MASTER_SECRET || 'iron-gate-dev-secret-change-in-production';

let _cachedKey: CryptoKey | null = null;

/**
 * Get the server-side HMAC signing key (singleton).
 * Derives from IRON_GATE_MASTER_SECRET on first call, then caches.
 */
export async function getSigningKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;
  const key = await deriveHmacSigningKey(MASTER_SECRET);
  _cachedKey = key;
  return key;
}
