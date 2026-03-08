// ============================================================================
// Iron Gate — Server-Side HMAC Signing Key (Singleton)
// ============================================================================
// Derives an HMAC-SHA256 key from IRON_GATE_SIGNING_SECRET on first use,
// then caches for the process lifetime. Uses a dedicated signing secret
// (falls back to IRON_GATE_MASTER_SECRET for backward compatibility).
// ============================================================================

import { deriveHmacSigningKey } from '@iron-gate/crypto';

// Resolve signing secret lazily — NEVER throw at import time.
// Throwing at import time kills the entire process before /health can respond,
// causing Render healthcheck failures and preventing any debugging.
function resolveSigningSecret(): string {
  const secret = process.env.IRON_GATE_SIGNING_SECRET || process.env.IRON_GATE_MASTER_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[CRITICAL] IRON_GATE_SIGNING_SECRET is not set. Audit-chain signing will use a ' +
      'per-process fallback. Set this in your Render environment variables.',
    );
    return `emergency-fallback-${process.pid}-${Date.now()}`;
  }

  console.warn('[WARN] Using dev-only signing secret. Set IRON_GATE_SIGNING_SECRET for production.');
  return `dev-only-sign-${process.pid}-${Date.now()}`;
}

const _effectiveSecret = resolveSigningSecret();

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
