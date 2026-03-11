/**
 * Fake Value Generator
 *
 * Generates realistic, format-preserving fake values for all entity types.
 * Deterministic within a session: same original text always maps to the
 * same fake value via the session-wide forward map.
 *
 * Extracted from main-world.ts and hardened for use across the entire
 * extension pipeline (content scripts, worker, sidepanel).
 */

import {
  FAKE_NAMES_F, FAKE_NAMES_M, FEMALE_FIRST_NAMES,
  FAKE_ORGS, FAKE_TICKERS, FAKE_PROJECTS,
  FAKE_EMAIL_DOMAINS, FAKE_ADDRESSES, MONTHS,
} from './fake-data-pools';

// ─── Pool Tracker ────────────────────────────────────────────────────────────
// Tracks usage indices per entity type to cycle through pools without repeats.

const usageCounters: Record<string, number> = {};

function pickFromPool(pool: readonly string[], typeKey: string): string {
  if (!usageCounters[typeKey]) usageCounters[typeKey] = 0;
  const idx = usageCounters[typeKey] % pool.length;
  usageCounters[typeKey]++;
  return pool[idx];
}

/** Reset all pool counters. Called on session/conversation reset. */
export function resetFakeCounters(): void {
  for (const key of Object.keys(usageCounters)) {
    delete usageCounters[key];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isFemaleFirst(name: string): boolean {
  const first = name.split(/\s+/)[0].toLowerCase();
  return FEMALE_FIRST_NAMES.has(first);
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / (0xFFFFFFFF + 1);
}

function randBetween(min: number, max: number): number {
  return min + secureRandom() * (max - min);
}

// ─── Generator ───────────────────────────────────────────────────────────────

/**
 * Generate a realistic fake value for a given entity type.
 * Format-preserving: the fake matches the structural pattern of the original.
 */
export function generateFake(type: string, original: string): string {
  switch (type) {
    case 'PERSON': {
      const pool = isFemaleFirst(original) ? FAKE_NAMES_F : FAKE_NAMES_M;
      const genderKey = type + (isFemaleFirst(original) ? '_F' : '_M');
      const origFirst = original.split(/\s+/)[0].toLowerCase();
      let candidate = pickFromPool(pool, genderKey);
      let attempts = 0;
      while (candidate.split(/\s+/)[0].toLowerCase() === origFirst && attempts < pool.length) {
        candidate = pickFromPool(pool, genderKey);
        attempts++;
      }
      return candidate;
    }

    case 'ORGANIZATION':
      return pickFromPool(FAKE_ORGS, type);

    case 'TICKER': {
      const m = original.match(/^([A-Z]+\s*:\s*)/);
      if (m) return m[1] + pickFromPool(FAKE_TICKERS, type);
      return pickFromPool(FAKE_TICKERS, type);
    }

    case 'PROJECT_NAME':
      return pickFromPool(FAKE_PROJECTS, type);

    case 'EMAIL': {
      const fakeName = pickFromPool(
        [...FAKE_NAMES_F, ...FAKE_NAMES_M],
        'EMAIL_NAME',
      );
      const parts = fakeName.toLowerCase().split(' ');
      const domain = FAKE_EMAIL_DOMAINS[Math.floor(secureRandom() * FAKE_EMAIL_DOMAINS.length)];
      return parts[0] + '.' + parts[1] + '@' + domain;
    }

    case 'SSN': {
      const a = Math.floor(randBetween(100, 899));
      const b = Math.floor(randBetween(10, 99));
      const c = Math.floor(randBetween(1000, 9999));
      if (original.includes('-')) return a + '-' + b + '-' + c;
      if (original.includes(' ')) return a + ' ' + b + ' ' + c;
      return '' + a + b + c;
    }

    case 'CREDIT_CARD': {
      const groups = [
        Math.floor(randBetween(4000, 4999)),
        Math.floor(randBetween(1000, 9999)),
        Math.floor(randBetween(1000, 9999)),
        Math.floor(randBetween(1000, 9999)),
      ];
      if (original.includes('-')) return groups.join('-');
      if (original.includes(' ')) return groups.join(' ');
      return groups.join('');
    }

    case 'PHONE_NUMBER': {
      const a = Math.floor(randBetween(200, 899));
      const b = Math.floor(randBetween(200, 899));
      const c = Math.floor(randBetween(1000, 9999));
      if (original.includes('(')) return '(' + a + ') ' + b + '-' + c;
      if (original.includes('-')) return a + '-' + b + '-' + c;
      return a + ' ' + b + ' ' + c;
    }

    case 'MONETARY_AMOUNT': {
      const cleaned = original.replace(/[,$\s]/g, '');
      const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(million|billion|M|B|k|K|dollars?|USD|EUR|GBP)?/i);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const suffix = numMatch[2] || '';
        const shifted = num * randBetween(0.7, 1.35);
        const hasDecimal = numMatch[1].includes('.');
        const decPlaces = hasDecimal ? (numMatch[1].split('.')[1]?.length || 1) : 0;
        const formatted = hasDecimal ? shifted.toFixed(decPlaces) : Math.round(shifted).toString();
        const prefix = original.startsWith('$') ? '$' : '';
        return prefix + formatted + suffix;
      }
      return original;
    }

    case 'PERCENTAGE': {
      const numMatch = original.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        const offset = randBetween(3, 8) * (secureRandom() > 0.5 ? 1 : -1);
        const shifted = Math.max(0.1, Math.min(99.9, num + offset));
        const hasDecimal = numMatch[1].includes('.');
        return (hasDecimal ? shifted.toFixed(1) : Math.round(shifted).toString()) + '%';
      }
      return original;
    }

    case 'DATE': {
      const dateMatch = original.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(.*)$/i);
      if (dateMatch) {
        const monthIdx = MONTHS.findIndex(m => m.toLowerCase() === dateMatch[1].toLowerCase());
        if (monthIdx >= 0) {
          const newMonthIdx = (monthIdx + Math.floor(randBetween(1, 4))) % 12;
          const newDay = Math.max(1, Math.min(28, parseInt(dateMatch[2]) + Math.floor(randBetween(-10, 10))));
          const suffix = newDay === 1 || newDay === 21 || newDay === 31 ? 'st'
            : newDay === 2 || newDay === 22 ? 'nd'
            : newDay === 3 || newDay === 23 ? 'rd' : 'th';
          return MONTHS[newMonthIdx] + ' ' + newDay + suffix + (dateMatch[3] || '');
        }
      }
      const numDate = original.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{2,4})$/);
      if (numDate) {
        const mShift = Math.floor(randBetween(1, 4));
        const dShift = Math.floor(randBetween(1, 10));
        const m = Math.max(1, Math.min(12, ((parseInt(numDate[1]) - 1 + mShift) % 12) + 1));
        const d = Math.max(1, Math.min(28, ((parseInt(numDate[3]) - 1 + dShift) % 28) + 1));
        const mStr = numDate[1].length === 2 ? m.toString().padStart(2, '0') : m.toString();
        const dStr = numDate[3].length === 2 ? d.toString().padStart(2, '0') : d.toString();
        return mStr + numDate[2] + dStr + numDate[2] + numDate[4];
      }
      return original;
    }

    case 'FISCAL_PERIOD': {
      const qMatch = original.match(/^([QH])(\d)/);
      if (qMatch) {
        const shifted = ((parseInt(qMatch[2]) + Math.floor(randBetween(1, 3)) - 1) % 4) + 1;
        return qMatch[1] + shifted + original.substring(2);
      }
      return original;
    }

    case 'IP_ADDRESS': {
      const octets = Array.from({ length: 4 }, () => Math.floor(randBetween(1, 254)));
      return octets.join('.');
    }

    case 'HEADCOUNT': {
      const hcMatch = original.match(/^(\d+)\s*(.*)/);
      if (hcMatch) {
        const num = parseInt(hcMatch[1]);
        const shifted = Math.round(num * randBetween(0.7, 1.35));
        return shifted + (hcMatch[2] ? ' ' + hcMatch[2] : '');
      }
      return original;
    }

    case 'LEGAL_REFERENCE': {
      const lrMatch = original.match(/^(\w+)\s+(\d+)(.*)/);
      if (lrMatch) {
        const shifted = parseInt(lrMatch[2]) + Math.floor(randBetween(2, 8));
        return lrMatch[1] + ' ' + shifted + (lrMatch[3] || '');
      }
      return original;
    }

    case 'EMPLOYEE_ID':
    case 'RECORD_ID': {
      const idMatch = original.match(/^([A-Z#-]+)(\d+)$/);
      if (idMatch) {
        const len = idMatch[2].length;
        const newNum = Math.floor(randBetween(10 ** (len - 1), 10 ** len - 1));
        return idMatch[1] + newNum;
      }
      return original;
    }

    case 'MEDICAL_RECORD':
    case 'INSURANCE_ID':
    case 'AUTHORIZATION':
      return original.replace(/\d/g, () => Math.floor(secureRandom() * 10).toString());

    case 'PASSPORT_NUMBER': {
      // Format: letter + 8 digits
      const letter = String.fromCharCode(65 + Math.floor(secureRandom() * 26));
      const digits = Array.from({ length: 8 }, () => Math.floor(secureRandom() * 10)).join('');
      return letter + digits;
    }

    case 'DRIVERS_LICENSE': {
      // Format: letter + 7-8 digits
      const letter = String.fromCharCode(65 + Math.floor(secureRandom() * 26));
      const numDigits = original.replace(/[^0-9]/g, '').length || 7;
      const digits = Array.from({ length: numDigits }, () => Math.floor(secureRandom() * 10)).join('');
      return letter + digits;
    }

    case 'ACCOUNT_NUMBER': {
      // Preserve prefix, randomize digits
      const acctMatch = original.match(/^([A-Za-z.\s#]+)(\d+)$/);
      if (acctMatch) {
        const len = acctMatch[2].length;
        const newNum = Math.floor(randBetween(10 ** (len - 1), 10 ** len - 1));
        return acctMatch[1] + newNum;
      }
      return original.replace(/\d/g, () => Math.floor(secureRandom() * 10).toString());
    }

    case 'MATTER_NUMBER': {
      // Preserve prefix and format: "matter #24-123456" → "matter #XX-XXXXXX"
      return original.replace(/\d/g, () => Math.floor(secureRandom() * 10).toString());
    }

    case 'LOCATION':
    case 'ADDRESS':
      return pickFromPool(FAKE_ADDRESSES, 'ADDRESS');

    // Secrets — use obvious placeholders so they never leak
    case 'API_KEY':
    case 'AWS_CREDENTIAL':
    case 'GCP_CREDENTIAL':
    case 'AUTH_TOKEN': {
      // Fully replace with a safe placeholder — preserve prefix style only
      const prefixMatch = original.match(/^([a-zA-Z_\-]{2,10}[-_])/);
      const prefix = prefixMatch ? prefixMatch[1] : 'key-';
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const fakeLen = Math.max(16, original.length - prefix.length);
      let fake = prefix;
      for (let i = 0; i < fakeLen; i++) fake += chars[Math.floor(secureRandom() * chars.length)];
      return fake;
    }
    case 'DATABASE_URI': {
      const scheme = original.match(/^([a-z+]+:\/\/)/)?.[1] || 'db://';
      return scheme + 'testuser:fakepwd@db-' + Math.floor(secureRandom() * 9000 + 1000) + '.example.com:5432/testdb';
    }
    case 'PRIVATE_KEY': {
      const headerMatch = original.match(/^(-----BEGIN [A-Z ]+-----)/);
      const footerMatch = original.match(/(-----END [A-Z ]+-----)$/);
      if (headerMatch || footerMatch) {
        const header = headerMatch?.[1] || '-----BEGIN PRIVATE KEY-----';
        const footer = footerMatch?.[1] || '-----END PRIVATE KEY-----';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let fakeBody = '';
        for (let i = 0; i < 64; i++) fakeBody += chars[Math.floor(secureRandom() * chars.length)];
        return header + '\n' + fakeBody + '\n' + footer;
      }
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let fake = '';
      for (let i = 0; i < original.length; i++) fake += chars[Math.floor(secureRandom() * chars.length)];
      return fake;
    }

    default: {
      // Fallback: randomize digits AND letters to prevent any PII leak
      let result = original;
      if (/\d/.test(result)) {
        result = result.replace(/\d/g, () => Math.floor(secureRandom() * 10).toString());
      }
      if (result === original && /[a-zA-Z]/.test(result)) {
        result = result.replace(/[a-zA-Z]/g, c => {
          const base = c >= 'a' ? 97 : 65;
          return String.fromCharCode(base + Math.floor(secureRandom() * 26));
        });
      }
      return result;
    }
  }
}

/**
 * Generate a same-byte-length fake for WebSocket/binary protocol interception.
 * Pads or truncates the fake to exactly match the original's byte length.
 */
export function generateFakeSameLength(type: string, original: string): string {
  const fake = generateFake(type, original);
  const originalBytes = new TextEncoder().encode(original).length;
  const fakeBytes = new TextEncoder().encode(fake).length;

  if (fakeBytes === originalBytes) return fake;

  if (fakeBytes < originalBytes) {
    // Pad with spaces
    return fake + ' '.repeat(originalBytes - fakeBytes);
  }

  // Truncate to fit — decode back to string to handle multi-byte chars safely
  const encoded = new TextEncoder().encode(fake);
  return new TextDecoder().decode(encoded.slice(0, originalBytes));
}
