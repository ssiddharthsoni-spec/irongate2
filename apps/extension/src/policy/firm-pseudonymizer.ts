/**
 * Firm Pseudonymizer — deterministic per-firm fake name generation
 *
 * v1.0 SOVEREIGN MODE CONTRACT:
 *
 * When a customer is in local-only mode, each detected entity should be
 * replaced by a deterministic pseudonym derived from a per-firm key. Two
 * properties matter:
 *
 *   1. CONSISTENT WITHIN A FIRM: If user A and user B at the same firm both
 *      mention "Sarah Chen", they both get the SAME pseudonym (e.g., "Emma Park").
 *      This lets compliance officers correlate audit logs across users without
 *      seeing the original names.
 *
 *   2. DISTINCT BETWEEN FIRMS: A different firm gets different pseudonyms for
 *      the same input. An attacker who somehow obtains audit logs from one
 *      firm cannot use them to deanonymize logs from another firm.
 *
 * Implementation:
 *
 *   pseudonym = HKDF-SHA256(firmPseudonymKey, salt=entityType, info=originalText)
 *   → use the resulting bytes to deterministically pick from a fake name pool
 *
 * The firmPseudonymKey is a 32-byte secret set in managed config by IT during
 * deployment. It must be:
 *   - Generated cryptographically random (openssl rand -hex 32)
 *   - Stored in IT's secrets manager
 *   - Rotated periodically (rotation regenerates all pseudonyms — by design)
 *
 * If the key is not configured, the pseudonymizer falls back to the legacy
 * random pool selection (non-deterministic, per-session).
 */

import { FAKE_FIRST_NAMES, FAKE_LAST_NAMES, FAKE_ORG_NAMES, FAKE_DOMAINS } from './fake-pools';

interface FirmPseudonymizerOptions {
  /** 64-character hex string from managed config */
  firmKey: string;
  /** Cache size limit (default 1000) */
  cacheSize?: number;
}

export class FirmPseudonymizer {
  private firmKeyBytes: Uint8Array;
  private cache = new Map<string, string>();
  private cacheSize: number;

  constructor(options: FirmPseudonymizerOptions) {
    this.firmKeyBytes = hexDecode(options.firmKey);
    if (this.firmKeyBytes.length !== 32) {
      throw new Error(`firmKey must be 32 bytes (64 hex chars), got ${this.firmKeyBytes.length}`);
    }
    this.cacheSize = options.cacheSize || 1000;
  }

  /**
   * Generate a deterministic pseudonym for an entity. Same firm + same entity
   * always produces the same output. Different firms produce different output.
   */
  async pseudonymize(entityType: string, originalText: string): Promise<string> {
    const cacheKey = `${entityType}:${originalText}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const result = await this.derive(entityType, originalText);

    if (this.cache.size >= this.cacheSize) {
      // Simple LRU: clear oldest 10%
      const toEvict = Math.floor(this.cacheSize / 10);
      const keys = Array.from(this.cache.keys());
      for (let i = 0; i < toEvict; i++) this.cache.delete(keys[i]);
    }
    this.cache.set(cacheKey, result);
    return result;
  }

  private async derive(entityType: string, originalText: string): Promise<string> {
    // HKDF-SHA256: extract → expand
    const salt = new TextEncoder().encode(entityType);
    const info = new TextEncoder().encode(originalText.toLowerCase().trim());

    const baseKey = await crypto.subtle.importKey(
      'raw',
      toBufferSource(this.firmKeyBytes),
      'HKDF',
      false,
      ['deriveBits'],
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: toBufferSource(salt), info: toBufferSource(info) },
      baseKey,
      256, // 32 bytes of derived material
    );

    const bytes = new Uint8Array(derivedBits);

    // Use the derived bytes to select from the appropriate fake pool
    switch (entityType) {
      case 'PERSON':
      case 'NAME':
        return this.derivePersonName(bytes);
      case 'ORGANIZATION':
      case 'COMPANY':
      case 'ORG':
        return this.deriveOrgName(bytes);
      case 'EMAIL':
        return this.deriveEmail(bytes);
      case 'PHONE':
      case 'PHONE_NUMBER':
        return this.derivePhone(bytes);
      case 'SSN':
        return this.deriveSsn(bytes);
      case 'CREDIT_CARD':
      case 'CREDIT_CARD_NUMBER':
        return this.deriveCreditCard(bytes);
      case 'DATE_OF_BIRTH':
      case 'DATE':
        return this.deriveDate(bytes);
      case 'ADDRESS':
        return this.deriveAddress(bytes);
      default:
        // Fallback: return a generic pseudonym tagged with type
        return `[REDACTED_${entityType}_${bytesToBase36(bytes.subarray(0, 4))}]`;
    }
  }

  // ── Deterministic pickers ────────────────────────────────────────────────

  private derivePersonName(bytes: Uint8Array): string {
    const first = FAKE_FIRST_NAMES[bytesToInt(bytes.subarray(0, 4)) % FAKE_FIRST_NAMES.length];
    const last = FAKE_LAST_NAMES[bytesToInt(bytes.subarray(4, 8)) % FAKE_LAST_NAMES.length];
    return `${first} ${last}`;
  }

  private deriveOrgName(bytes: Uint8Array): string {
    return FAKE_ORG_NAMES[bytesToInt(bytes.subarray(0, 4)) % FAKE_ORG_NAMES.length];
  }

  private deriveEmail(bytes: Uint8Array): string {
    const first = FAKE_FIRST_NAMES[bytesToInt(bytes.subarray(0, 4)) % FAKE_FIRST_NAMES.length].toLowerCase();
    const last = FAKE_LAST_NAMES[bytesToInt(bytes.subarray(4, 8)) % FAKE_LAST_NAMES.length].toLowerCase();
    const domain = FAKE_DOMAINS[bytesToInt(bytes.subarray(8, 12)) % FAKE_DOMAINS.length];
    return `${first}.${last}@${domain}`;
  }

  private derivePhone(bytes: Uint8Array): string {
    // Use deterministic bytes to fill in (XXX) XXX-XXXX format
    const area = (bytesToInt(bytes.subarray(0, 4)) % 800) + 200; // 200-999, valid area code range
    const prefix = (bytesToInt(bytes.subarray(4, 8)) % 800) + 200;
    const line = bytesToInt(bytes.subarray(8, 12)) % 10000;
    return `(${area}) ${prefix}-${String(line).padStart(4, '0')}`;
  }

  private deriveSsn(bytes: Uint8Array): string {
    // SSN format: XXX-XX-XXXX
    // Use 900-999 area to avoid colliding with real assigned SSNs (those are 001-899)
    const area = 900 + (bytesToInt(bytes.subarray(0, 4)) % 100);
    const group = (bytesToInt(bytes.subarray(4, 8)) % 99) + 1;
    const serial = (bytesToInt(bytes.subarray(8, 12)) % 9999) + 1;
    return `${area}-${String(group).padStart(2, '0')}-${String(serial).padStart(4, '0')}`;
  }

  private deriveCreditCard(bytes: Uint8Array): string {
    // Generate a fake card with a deterministic 15-digit prefix and a Luhn check digit
    const digits: number[] = [];
    for (let i = 0; i < 15; i++) {
      digits.push(bytes[i] % 10);
    }
    // First 6 = BIN; force the test BIN range 4242XX (Stripe test card prefix)
    digits[0] = 4; digits[1] = 2; digits[2] = 4; digits[3] = 2;
    // Compute Luhn check digit
    digits.push(luhnCheckDigit(digits));
    return digits.join('').replace(/(\d{4})/g, '$1-').replace(/-$/, '');
  }

  private deriveDate(bytes: Uint8Array): string {
    // Generate a date in 1950-2010 range (plausible DOB)
    const year = 1950 + (bytesToInt(bytes.subarray(0, 4)) % 60);
    const month = (bytesToInt(bytes.subarray(4, 8)) % 12) + 1;
    const day = (bytesToInt(bytes.subarray(8, 12)) % 28) + 1;
    return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
  }

  private deriveAddress(bytes: Uint8Array): string {
    const num = (bytesToInt(bytes.subarray(0, 4)) % 9000) + 100;
    const streets = ['Oak', 'Elm', 'Maple', 'Pine', 'Cedar', 'Birch', 'Walnut', 'Chestnut', 'Spruce', 'Willow'];
    const types = ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Way'];
    const cities = ['Springfield', 'Riverside', 'Greenwood', 'Lakewood', 'Fairview', 'Oakdale'];
    const street = streets[bytesToInt(bytes.subarray(4, 8)) % streets.length];
    const type = types[bytesToInt(bytes.subarray(8, 12)) % types.length];
    const city = cities[bytesToInt(bytes.subarray(12, 16)) % cities.length];
    return `${num} ${street} ${type}, ${city}`;
  }

  /** Returns the size of the cache (for tests/diagnostics) */
  getCacheSize(): number {
    return this.cache.size;
  }
}

// ── Byte utilities ───────────────────────────────────────────────────────

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hexDecode(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToInt(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length && i < 4; i++) {
    n = (n << 8) | bytes[i];
  }
  return n >>> 0; // unsigned
}

function bytesToBase36(bytes: Uint8Array): string {
  return bytesToInt(bytes).toString(36);
}

function luhnCheckDigit(digits: number[]): number {
  let sum = 0;
  let alternate = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits[i];
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return (10 - (sum % 10)) % 10;
}
