/**
 * Length-preserving tokenization — Option C core (WP5, June 2026).
 *
 * THE long-term de-pseudonymization architecture: when every fake matches
 * its original's BYTE length, wire-level replacement stops corrupting
 * offset-annotated platforms (ChatGPT byte-offset markers never shift,
 * Gemini length-prefixed chunks never break) — one wire mechanism works on
 * every platform and the entire DOM-observer subsystem can be deleted.
 * This is how enterprise DLP tokenization (format-preserving) works.
 *
 * Key design point — PER-PART length matching for names: the AI may refer
 * to just the fake first name ("Daniel", "Daniel's"), so each name part
 * must independently match its original part's length. "Robert Chen"
 * (6+4) → "Daniel Park" (6+4): any fragment replacement is length-safe.
 *
 * NOT WIRED INTO PRODUCTION YET. Cutover gates (per platform):
 *   1. The ChatGPT offset-encoding spike: do their renderer offsets count
 *      BYTES or UTF-16 units? (Determines multi-byte handling. Until
 *      verified, originals containing non-ASCII fall back to the legacy
 *      generator — see isLengthSafe.)
 *   2. WP2 telemetry shows wire-* at 100% of replacements on the platform
 *      for a soak period — then and only then its DOM observer dies.
 *
 * Session-deterministic: the same original maps to the same fake for the
 * whole session (multi-turn conversations must reuse mappings), and two
 * different originals never share a fake.
 */

// ── Name pools indexed by length ─────────────────────────────────────────────
// Common, natural-looking name parts. Synthesis covers missing lengths.

const FIRST_BY_LEN: Record<number, string[]> = {
  2: ['Al', 'Bo', 'Cy', 'Ed', 'Jo', 'Lu', 'Mo', 'Ty'],
  3: ['Amy', 'Ben', 'Dan', 'Eva', 'Ian', 'Jay', 'Kim', 'Leo', 'Max', 'Sam', 'Tom', 'Zoe'],
  4: ['Adam', 'Beth', 'Carl', 'Dana', 'Erik', 'Gail', 'Hugo', 'Ivan', 'Jane', 'Kurt', 'Lisa', 'Noah', 'Omar', 'Rosa', 'Seth'],
  5: ['Aaron', 'Brent', 'Clara', 'David', 'Elena', 'Frank', 'Grace', 'Henry', 'Irene', 'James', 'Karen', 'Laura', 'Maria', 'Nadia', 'Oscar', 'Peter', 'Quinn', 'Ralph', 'Sarah', 'Tessa'],
  6: ['Amanda', 'Brenda', 'Carlos', 'Daniel', 'Edward', 'Felipe', 'George', 'Hannah', 'Ingrid', 'Joanna', 'Kelvin', 'Lauren', 'Marcus', 'Nathan', 'Olivia', 'Philip', 'Rachel', 'Sandra', 'Thomas', 'Victor'],
  7: ['Abigail', 'Bernard', 'Cameron', 'Deborah', 'Eduardo', 'Frances', 'Gabriel', 'Heather', 'Isabela', 'Jasmine', 'Kenneth', 'Lindsay', 'Matthew', 'Natalie', 'Octavio', 'Patrick', 'Rebecca', 'Stephen', 'Tristan', 'Vanessa'],
  8: ['Angelica', 'Benjamin', 'Carolina', 'Dominick', 'Emmanuel', 'Fernanda', 'Geoffrey', 'Hamilton', 'Isabella', 'Jonathan', 'Kimberly', 'Lawrence', 'Madeline', 'Nicholas', 'Patricia', 'Reginald', 'Salvador', 'Theodore', 'Virginia', 'Winifred'],
  9: ['Alexander', 'Bernadette', 'Cassandra', 'Demetrius', 'Esperanza', 'Francesca', 'Guillermo', 'Henrietta', 'Jacqueline', 'Katherine', 'Maximilian', 'Nathaniel', 'Sebastian', 'Stephanie', 'Valentina'].filter(n => n.length === 9),
};

const LAST_BY_LEN: Record<number, string[]> = {
  2: ['Le', 'Ng', 'Wu', 'Xu', 'Yu'],
  3: ['Cox', 'Day', 'Fox', 'Kim', 'Lee', 'Liu', 'Loy', 'May', 'Ray', 'Roy'],
  4: ['Bell', 'Cole', 'Dean', 'Ford', 'Gray', 'Hall', 'Hunt', 'King', 'Lane', 'Long', 'Mora', 'Park', 'Reed', 'Ross', 'West'],
  5: ['Adams', 'Banks', 'Blake', 'Burke', 'Casey', 'Drake', 'Evans', 'Hayes', 'Jones', 'Kelly', 'Lopez', 'Mason', 'Nolan', 'Perez', 'Quinn', 'Reyes', 'Smith', 'Stone', 'Walsh', 'Young'],
  6: ['Barnes', 'Bishop', 'Carter', 'Dawson', 'Fisher', 'Garcia', 'Harmon', 'Hudson', 'Jensen', 'Keller', 'Lawson', 'Mercer', 'Norris', 'Osborn', 'Porter', 'Ramsey', 'Sawyer', 'Turner', 'Vargas', 'Walker'],
  7: ['Baldwin', 'Bennett', 'Caldwen', 'Dickson', 'Edwards', 'Fleming', 'Griffin', 'Hawkins', 'Jackson', 'Kendall', 'Lindsey', 'Maxwell', 'Navarro', 'Pearson', 'Ramirez', 'Sanders', 'Thomson', 'Vasquez', 'Wallace', 'Whitman'].filter(n => n.length === 7),
  8: ['Anderson', 'Brockman', 'Caldwell', 'Donnelly', 'Espinoza', 'Franklin', 'Gallagar', 'Harrison', 'Jacobson', 'Kavanagh', 'Lockhart', 'Marshall', 'Mitchell', 'Pemberly', 'Robinson', 'Sheridan', 'Thornton', 'Vandermer', 'Westwood', 'Whitford'].filter(n => n.length === 8),
};

// ── Session-deterministic mapping ────────────────────────────────────────────

const _sessionMap = new Map<string, string>();
const _issued = new Set<string>();

/** Test hook — resets session state. */
export function _resetLengthPreservingSession(): void {
  _sessionMap.clear();
  _issued.clear();
}

function _rand(n: number): number {
  return Math.floor(Math.random() * n);
}

const CONSONANTS = 'bcdfghjklmnprstvwz';
const VOWELS = 'aeiou';

/** Pronounceable synthetic name part of exact length, capitalized. */
function synthesizeNamePart(len: number): string {
  if (len <= 0) return '';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += i % 2 === 0 ? CONSONANTS[_rand(CONSONANTS.length)] : VOWELS[_rand(VOWELS.length)];
  }
  return out[0].toUpperCase() + out.slice(1);
}

function pickNamePart(len: number, pool: Record<number, string[]>, avoid: Set<string>): string {
  const candidates = (pool[len] || []).filter(c => !avoid.has(c));
  if (candidates.length > 0) return candidates[_rand(candidates.length)];
  for (let i = 0; i < 20; i++) {
    const s = synthesizeNamePart(len);
    if (!avoid.has(s)) return s;
  }
  return synthesizeNamePart(len);
}

// ── Character-class-preserving substitution (universal fallback) ─────────────
// Preserves length AND format for any value: digits→digits, upper→upper,
// lower→lower, everything else (separators, punctuation, unicode) unchanged.

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '0123456789';

function classPreserving(original: string, preservePrefix = 0): string {
  let out = original.slice(0, preservePrefix);
  for (let i = preservePrefix; i < original.length; i++) {
    const c = original[i];
    if (c >= '0' && c <= '9') out += DIGITS[_rand(10)];
    else if (c >= 'A' && c <= 'Z') out += UPPER[_rand(UPPER.length)];
    else if (c >= 'a' && c <= 'z') out += LOWER[_rand(LOWER.length)];
    else out += c; // separators, punctuation, non-ASCII: unchanged
  }
  return out;
}

/** Known credential prefixes whose shape identifies the key type — kept so
 *  the fake still "reads" as the same kind of secret. */
const KEY_PREFIXES = ['sk-ant-', 'sk_live_', 'sk_test_', 'pk_live_', 'sk-', 'pk-', 'ghp_', 'gho_', 'AKIA', 'ASIA', 'AIza', 'xoxb-', 'xoxp-'];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Multi-byte safety gate: until the ChatGPT offset-encoding spike confirms
 * byte vs UTF-16 semantics, only ASCII originals are length-safe (for
 * ASCII, byte length === UTF-16 length === codepoint length — all
 * interpretations agree). Callers fall back to the legacy generator when
 * this returns false.
 */
export function isLengthSafe(original: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(original);
}

/**
 * Generate a fake with the SAME byte length as the original (per name part
 * for person/org types). Session-deterministic: repeated calls with the
 * same original return the same fake; distinct originals never collide.
 * Returns null when the original is not length-safe (see isLengthSafe) —
 * caller falls back to the legacy generator.
 */
export function lengthPreservingFake(type: string, original: string): string | null {
  if (!original || !isLengthSafe(original)) return null;

  const cached = _sessionMap.get(original);
  if (cached) return cached;

  let fake: string | null = null;
  for (let attempt = 0; attempt < 8 && (fake === null || fake === original || _issued.has(fake)); attempt++) {
    fake = generateOnce(type, original);
  }
  if (fake === null) return null;

  _sessionMap.set(original, fake);
  _issued.add(fake);
  if (_sessionMap.size > 5000) { _sessionMap.clear(); _issued.clear(); }
  return fake;
}

function generateOnce(type: string, original: string): string {
  switch (type) {
    case 'PERSON':
    case 'ORGANIZATION': {
      // Per-part: each whitespace-separated part maps to a same-length part.
      // Non-alpha parts (initials with periods, "&", suffixes) go through
      // class-preserving substitution so punctuation survives.
      const avoid = new Set<string>();
      const parts = original.split(/(\s+)/); // keep separators
      const out = parts.map((part, idx) => {
        if (/^\s+$/.test(part) || part.length === 0) return part;
        if (!/^[A-Za-z][A-Za-z.'-]*$/.test(part)) return classPreserving(part);
        const isFirstWord = idx === 0;
        const fakePart = pickNamePart(part.length, isFirstWord ? FIRST_BY_LEN : LAST_BY_LEN, avoid);
        avoid.add(fakePart);
        // Preserve the original part's capitalization shape (ALL-CAPS stays caps).
        if (part === part.toUpperCase() && part.length > 1) return fakePart.toUpperCase();
        return fakePart;
      });
      return out.join('');
    }

    case 'API_KEY':
    case 'AUTH_TOKEN':
    case 'AWS_CREDENTIAL':
    case 'GCP_CREDENTIAL':
    case 'AZURE_CREDENTIAL':
    case 'PRIVATE_KEY': {
      const prefix = KEY_PREFIXES.find(p => original.startsWith(p));
      return classPreserving(original, prefix ? prefix.length : 0);
    }

    case 'EMAIL': {
      // Randomize local part and domain name, preserve @, dots, and TLD.
      const at = original.indexOf('@');
      if (at <= 0) return classPreserving(original);
      const local = original.slice(0, at);
      const domain = original.slice(at + 1);
      const lastDot = domain.lastIndexOf('.');
      const domainName = lastDot > 0 ? domain.slice(0, lastDot) : domain;
      const tld = lastDot > 0 ? domain.slice(lastDot) : '';
      return classPreserving(local) + '@' + classPreserving(domainName) + tld;
    }

    // SSN, CREDIT_CARD, PHONE_NUMBER, ACCOUNT_NUMBER, IP_ADDRESS, dates,
    // monetary amounts, DATABASE_URI, and anything else: class-preserving
    // substitution is length- and format-correct by construction.
    default:
      return classPreserving(original);
  }
}
