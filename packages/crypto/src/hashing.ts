// ============================================================================
// Iron Gate — SHA-256 Hashing Utilities
// ============================================================================
// Uses the Web Crypto API (SubtleCrypto) which is available in:
//   - Chrome extension service workers (globalThis.crypto)
//   - Bun runtime (globalThis.crypto)
//   - Node.js 20+ (globalThis.crypto)
// ============================================================================

/**
 * Compute SHA-256 hash of a string, returning hex-encoded result.
 *
 * @param input - The string to hash
 * @returns 64-character hex string (256 bits)
 */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute a chain hash for the cryptographic audit trail.
 * Each event's hash includes the previous event's hash,
 * creating a tamper-evident chain similar to a blockchain.
 *
 * @param eventData - The event data object to hash
 * @param previousHash - Hash of the preceding event (null for genesis)
 * @returns 64-character hex string
 */
export async function chainHash(
  eventData: Record<string, unknown>,
  previousHash: string | null,
): Promise<string> {
  const canonical = JSON.stringify(eventData, Object.keys(eventData).sort());
  return sha256(canonical + (previousHash || 'GENESIS'));
}
