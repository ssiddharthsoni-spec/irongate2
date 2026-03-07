// ============================================================================
// Iron Gate — Server-Side HMAC Signing Key (Singleton)
// ============================================================================
// Derives an HMAC-SHA256 key from IRON_GATE_SIGNING_SECRET on first use,
// then caches for the process lifetime. Uses a dedicated signing secret
// (falls back to IRON_GATE_MASTER_SECRET for backward compatibility).
// ============================================================================

import { deriveHmacSigningKey } from '@iron-gate/crypto';

// Prefer dedicated signing secret; fall back to master secret for backward compat
const SIGNING_SECRET = process.env.IRON_GATE_SIGNING_SECRET || process.env.IRON_GATE_MASTER_SECRET;

if (!SIGNING_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error(
    '[FATAL] IRON_GATE_SIGNING_SECRET (or IRON_GATE_MASTER_SECRET) is required in production. ' +
    'The server cannot start without this critical secret.',
  );
}

// In development, use a dev-only secret that is clearly marked as non-production
const _effectiveSecret = SIGNING_SECRET || (() => {
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new Error('[FATAL] IRON_GATE_SIGNING_SECRET is required outside of development/test.');
  }
  console.warn('[WARN] Using development-only signing secret. Set IRON_GATE_SIGNING_SECRET for production.');
  return `dev-only-sign-${process.pid}-${Date.now()}`;
})();

let _cachedKey: CryptoKey | null = null;

/**
 * Get the server-side HMAC signing key (singleton).
 * Derives from IRON_GATE_SIGNING_SECRET on first call, then caches.
 */
export async function getSigningKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;
  const key = await deriveHmacSigningKey(_effectiveSecret);
  _cachedKey = key;
  return key;
}
