/**
 * Iron Gate — Certificate Pinning Validation
 *
 * Provides a client-side check for certificate pin (SPKI SHA-256 hash)
 * validation.  In a Manifest V3 service worker we cannot intercept the
 * TLS handshake directly, but we CAN verify known-good certificate
 * fingerprints returned by the server or injected at build time.
 *
 * The PINNED_HASHES array below contains **placeholder** values that MUST
 * be replaced with real SPKI SHA-256 hashes before shipping to production.
 * Typically these are generated with:
 *
 *   openssl s_client -connect api.irongate.ai:443 | \
 *     openssl x509 -pubkey -noout | \
 *     openssl pkey -pubin -outform der | \
 *     openssl dgst -sha256 -binary | base64
 */

// ─── Pinned Certificate Hashes ───────────────────────────────────────────────

/**
 * SHA-256 SPKI fingerprints that are considered valid for api.irongate.ai.
 * Include both the current leaf certificate and at least one backup pin
 * to allow for certificate rotation.
 *
 * **PLACEHOLDER VALUES** — replace before production deployment.
 */
export const PINNED_HASHES: readonly string[] = [
  // Primary certificate pin (placeholder — replace with real hash)
  'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  // Backup certificate pin (placeholder — replace with real hash)
  'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
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
export function validateCertificate(certHash: string): boolean {
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
