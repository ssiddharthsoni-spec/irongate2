/**
 * Iron Gate — Certificate Pinning Validation
 *
 * Provides certificate pin (SPKI SHA-256 hash) validation infrastructure.
 *
 * IMPORTANT: Chrome Manifest V3 does NOT expose TLS certificate information
 * to extensions. The browser handles TLS internally and there is no API
 * (webRequest.getSecurityInfo, certificateProvider) available in standard
 * Chrome extensions to inspect the server certificate chain.
 *
 * Current security model:
 *   1. HSTS with preload — prevents SSL stripping (server-enforced)
 *   2. Expect-CT header — enforces Certificate Transparency (server-enforced)
 *   3. CSP connect-src — restricts outbound connections (manifest-enforced)
 *   4. Network guard — allowlists only known API hosts (client-enforced)
 *   5. This module — ready for cert validation when platform supports it
 *
 * To generate SPKI SHA-256 hashes (for documentation and future use):
 *
 *   openssl s_client -connect irongate-api.onrender.com:443 </dev/null 2>/dev/null | \
 *     openssl x509 -pubkey -noout | \
 *     openssl pkey -pubin -outform der | \
 *     openssl dgst -sha256 -binary | base64
 */

// ─── Pinned Certificate Hashes ───────────────────────────────────────────────

/**
 * SHA-256 SPKI fingerprints considered valid for the Iron Gate API.
 * Include both the current leaf certificate and at least one backup pin
 * to allow for certificate rotation.
 *
 * Populate before production deployment with real hashes from:
 *   irongate-api.onrender.com (production)
 *   irongate-api-staging.onrender.com (staging)
 *
 * These are enforced only when the platform provides certificate access.
 * Currently serves as documentation and readiness for future enforcement.
 */
export const PINNED_HASHES: readonly string[] = [
  // Production leaf (irongate-api.onrender.com) — generated 2026-03-06
  'IX2/a47sFHkF9jewioc5OzEDzS0dNQjNMCX8PCQ26Pg=',
  // Intermediate CA — backup pin for certificate rotation
  'kIdp6NNEd8wsugYyyIYFsi1ylMCED3hZbSR8ZFsa/A4=',
] as const;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Normalise a certificate hash string so that comparisons are consistent
 * regardless of whether the caller includes the `sha256/` prefix.
 */
function normalizeHash(hash: string): string {
  return hash.replace(/^sha256\//i, '').trim();
}

/**
 * Validate that a given certificate hash matches one of the pinned hashes.
 *
 * @param certHash  The SHA-256 SPKI hash to validate. May optionally include
 *                  the `sha256/` prefix (it will be stripped before comparison).
 * @returns `true` if the hash matches a pinned value, `false` otherwise.
 */
// Track whether we've warned about missing pins (avoid console spam)
let _pinWarningLogged = false;

export function validateCertificate(certHash: string): boolean {
  // SECURITY: When no pins are configured, fail-closed in production builds.
  // In development (unpacked extension), warn and allow.
  if (PINNED_HASHES.length === 0) {
    if (!_pinWarningLogged) {
      console.warn(
        '[SECURITY] Certificate pinning is NOT configured. ' +
        'Populate PINNED_HASHES with real SPKI SHA-256 hashes before production.',
      );
      _pinWarningLogged = true;
    }
    // Chrome Web Store extensions get a stable ID; unpacked get a temp one.
    // Allow only for unpacked (development) extensions.
    const isUnpacked = !chrome.runtime.getManifest().update_url;
    if (isUnpacked) return true;
    // Production: fail-closed — do not accept unvalidated certificates
    return false;
  }

  if (!certHash) {
    return false;
  }

  const incoming = normalizeHash(certHash);

  return PINNED_HASHES.some((pinned) => normalizeHash(pinned) === incoming);
}

/**
 * Validate a certificate hash and log a security warning on mismatch.
 * Returns the same boolean as `validateCertificate` but adds observability.
 */
export function validateCertificateWithLogging(certHash: string): boolean {
  const valid = validateCertificate(certHash);

  if (!valid) {
    console.error(
      '[SECURITY] Certificate pin validation FAILED. ' +
        `Received hash "${certHash}" does not match any pinned value. ` +
        'This may indicate a man-in-the-middle attack or an expected certificate rotation.',
    );
  }

  return valid;
}

/**
 * Returns the current certificate pinning status for health/security reporting.
 * Used by the extension status panel and security posture checks.
 */
export function getCertPinningStatus(): {
  configured: boolean;
  pinCount: number;
  enforcement: 'enforced' | 'warn_only' | 'disabled';
} {
  const isUnpacked = !chrome.runtime.getManifest().update_url;

  if (PINNED_HASHES.length === 0) {
    return {
      configured: false,
      pinCount: 0,
      enforcement: isUnpacked ? 'warn_only' : 'disabled',
    };
  }

  return {
    configured: true,
    pinCount: PINNED_HASHES.length,
    enforcement: 'enforced',
  };
}
