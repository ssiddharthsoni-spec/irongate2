/**
 * De-pseudonymization Engine — Pure Functions
 *
 * Extracted from main-world.ts to reduce the 5700-line monolith.
 * These are stateless, pure functions with ZERO side effects:
 *   - jsonStringEscape: JSON-encode a string for SSE matching
 *   - looksLikePersonName: heuristic name classifier
 *   - buildRegexCache: precompile boundary-aware regexes for all pseudonyms
 *   - replacePseudonymsCore: 3-strategy replacement + leak scanner
 *
 * The stateful cache wrapper (replacePseudonyms) remains in main-world.ts
 * because it depends on mutable module-level state (_regexCacheVersion, etc.).
 *
 * IMPORTANT: This module runs in MAIN world (page context). No chrome.* APIs.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CachedPseudoEntry {
  pseudonym: string;
  original: string;
  regexCS: RegExp | null;      // case-sensitive boundary-aware
  regexCI: RegExp | null;      // case-insensitive boundary-aware
  jsonPseudo: string;
  jsonOrig: string;
  json2Pseudo: string;
  json2Orig: string;
}

// ─── JSON String Escape ─────────────────────────────────────────────────────

export function jsonStringEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// ─── Person Name Heuristic ──────────────────────────────────────────────────

const _ORG_SUFFIXES = new Set([
  'inc', 'corp', 'corporation', 'llc', 'ltd', 'llp',
  'associates', 'partners', 'group', 'foundation',
  'hospital', 'center', 'centre', 'university', 'college',
  'bank', 'insurance', 'industries', 'enterprises', 'holdings',
  'capital', 'trust', 'fund', 'technologies', 'tech',
  'solutions', 'services', 'consulting', 'management',
  'investments', 'advisors', 'advisory', 'labs', 'laboratories',
  'media', 'energy', 'resources', 'dynamics', 'systems',
  'international', 'global', 'worldwide', 'agency',
  'securities', 'networks', 'financial', 'ventures',
  'software', 'analytics', 'robotics', 'automation',
  'engineering', 'properties', 'realty', 'brands',
]);

/**
 * Detect if a string looks like a person name: 2+ words, each capitalized,
 * and the last word is NOT a common org suffix (Corp, Securities, etc.)
 */
export function looksLikePersonName(s: string): boolean {
  const words = s.split(/\s+/);
  if (words.length < 2) return false;
  // L-7 FIX: Handle apostrophes (O'Brien), hyphens (Soo-Jin), and all-caps (JOHN)
  if (!words.every(w => /^[A-Z][a-z'-]/.test(w) || /^[A-Z]{2,}$/.test(w) || /^[A-Z]'[A-Z][a-z]/.test(w))) return false;
  // Reject if last word is a common org suffix
  if (_ORG_SUFFIXES.has(words[words.length - 1].toLowerCase())) return false;
  return true;
}

// ─── Regex Cache Builder ────────────────────────────────────────────────────

export function buildRegexCache(reverseMap: Record<string, string>): CachedPseudoEntry[] {
  const entries = Object.entries(reverseMap)
    .filter(([k]) => k && k.length >= 2);

  // Sort entries by pseudonym length DESCENDING before building cache.
  // Longer pseudonyms must be replaced first to prevent substring collisions.
  // E.g., "Contoso Holdings" must be replaced before "Contoso".
  // Expand person-name entries to include first-name-only variants.
  // AI responses often use "James" instead of "James Mitchell". Without
  // this, the first name leaks through de-pseudonymization.
  const expanded: Array<[string, string]> = [];
  for (const [pseudonym, original] of entries) {
    expanded.push([pseudonym, original]);
    if (looksLikePersonName(pseudonym) && looksLikePersonName(original)) {
      const pseudoFirst = pseudonym.split(/\s+/)[0];
      const origFirst = original.split(/\s+/)[0];
      // Only add first-name mapping if it's not already in the map
      // and the first name is long enough to be safe (≥3 chars)
      if (pseudoFirst && origFirst && pseudoFirst.length >= 3
          && pseudoFirst !== origFirst
          && !entries.some(([k]) => k === pseudoFirst)) {
        expanded.push([pseudoFirst, origFirst]);
      }
    }
  }

  return expanded
    .filter(([pseudonym, original]) => pseudonym !== original)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([pseudonym, original]) => {
      let regexCS: RegExp | null = null;
      let regexCI: RegExp | null = null;
      try {
        const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startsWithAlpha = /^[a-zA-Z]/.test(pseudonym);
        const endsWithAlpha = /[a-zA-Z]$/.test(pseudonym);
        const startsWithDigit = /^\d/.test(pseudonym);
        const endsWithDigit = /\d$/.test(pseudonym);
        const startsWithDollar = pseudonym.startsWith('$');
        // DEF-021/025: Include hyphen and dot in word boundaries to prevent
        // "Meridian" matching inside "meridian-legal.com" or "meridian.corp.io".
        // Hyphens and dots connect words in URLs/domains/emails — treating them
        // as boundaries causes fragment collisions.
        const prefix = startsWithDollar ? '\\$*'
          : startsWithDigit ? '(?<![\\d.])'
          : startsWithAlpha ? '(?<![a-zA-Z.\\-])'
          : '';
        const suffix = endsWithDigit ? '(?![\\d.])' : endsWithAlpha ? '(?![a-zA-Z.\\-])' : '';
        regexCS = new RegExp(prefix + escaped + suffix, 'g');
        regexCI = new RegExp(prefix + escaped + suffix, 'gi');
      } catch { /* regex failed */ }
      const jsonPseudo = jsonStringEscape(pseudonym);
      const jsonOrig = jsonStringEscape(original);

      return {
        pseudonym, original,
        regexCS, regexCI,
        jsonPseudo, jsonOrig,
        json2Pseudo: jsonStringEscape(jsonPseudo),
        json2Orig: jsonStringEscape(jsonOrig),
      };
    });
}

// ─── Core Replacement Engine ────────────────────────────────────────────────

/**
 * Stateless core of replacePseudonyms. Takes a pre-built regex cache
 * and performs 3-strategy replacement + leak scanner with:
 *   - Replaced-region tracking (prevents overlap corruption)
 *   - Word-boundary checks (prevents false positives in longer words)
 *   - Fragment exclusion (prevents email corruption)
 */
export function replacePseudonymsCore(text: string, cache: CachedPseudoEntry[]): string {
  let result = text;

  for (const entry of cache) {
    const { pseudonym, original, regexCS, regexCI, jsonPseudo, jsonOrig, json2Pseudo, json2Orig } = entry;

    // Strategy 1: Boundary-aware exact match (case-sensitive)
    // IMPORTANT: Use arrow function as replacer to avoid $ being interpreted
    // as special replacement patterns ($1, $$, $&, etc.).
    // NOTE: All strategies run (no `continue`) because the same pseudonym can appear
    // in both plain-text and JSON-encoded forms within a single SSE chunk.
    if (regexCS) {
      regexCS.lastIndex = 0;
      result = result.replace(regexCS, () => original);
    }

    // Strategy 2: JSON-escaped match (SSE streams contain JSON-encoded strings)
    if (jsonPseudo !== pseudonym && result.includes(jsonPseudo)) {
      result = result.split(jsonPseudo).join(jsonOrig);
    }
    // Double-escaped: Gemini batchexecute responses use nested escaping
    if (json2Pseudo !== jsonPseudo && result.includes(json2Pseudo)) {
      result = result.split(json2Pseudo).join(json2Orig);
    }

    // Strategy 3: Case-insensitive boundary-aware match (catches case variants missed by S1)
    if (regexCI) {
      regexCI.lastIndex = 0;
      result = result.replace(regexCI, () => original);
    }
  }

  // ── LEAK SCANNER: Defense-in-depth verification ──────────────────────────
  // After all boundary-aware replacements, scan for ANY remaining pseudonym words.
  // Guards: skip <7 chars, skip fragments of longer keys, word-boundary check,
  // replaced-region tracking to prevent overlap corruption.
  const _leakLongerKeys = cache.map(e => e.pseudonym.toLowerCase());
  const _leakExcluded = new Set<string>();
  for (const entry of cache) {
    const pl = entry.pseudonym.toLowerCase();
    if (pl.length < 7) continue;
    for (const longer of _leakLongerKeys) {
      if (longer.length > pl.length && longer.includes(pl)) {
        _leakExcluded.add(pl);
        break;
      }
    }
  }

  const _replacedRanges: Array<[number, number]> = [];

  function _overlapsReplaced(start: number, end: number): boolean {
    for (const [rs, re] of _replacedRanges) {
      if (start < re && end > rs) return true;
    }
    return false;
  }

  function _recordReplacement(start: number, oldLen: number, newLen: number): void {
    const delta = newLen - oldLen;
    for (let i = 0; i < _replacedRanges.length; i++) {
      if (_replacedRanges[i][0] >= start + oldLen) {
        _replacedRanges[i][0] += delta;
        _replacedRanges[i][1] += delta;
      }
    }
    _replacedRanges.push([start, start + newLen]);
  }

  let resultLowerLeak = result.toLowerCase();
  for (const entry of cache) {
    const pseudoLower = entry.pseudonym.toLowerCase();
    if (pseudoLower.length < 7) continue;
    if (_leakExcluded.has(pseudoLower)) continue;
    if (!resultLowerLeak.includes(pseudoLower)) continue;
    let idx = resultLowerLeak.indexOf(pseudoLower);
    while (idx !== -1) {
      if (_overlapsReplaced(idx, idx + entry.pseudonym.length)) {
        idx = resultLowerLeak.indexOf(pseudoLower, idx + entry.pseudonym.length);
        continue;
      }
      const charBefore = idx > 0 ? resultLowerLeak.charCodeAt(idx - 1) : 32;
      const charAfter = idx + pseudoLower.length < resultLowerLeak.length
        ? resultLowerLeak.charCodeAt(idx + pseudoLower.length) : 32;
      // DEF-021/025 ROOT CAUSE FIX: Include dot (46) and hyphen (45) as "connected"
      // characters. Without this, the leak scanner treats "meridian-legal.com" as
      // having a word boundary after "meridian" and replaces it — corrupting the domain.
      const isWordConnected = (c: number) =>
        (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) // alphanumeric
        || c === 45 || c === 46; // hyphen, dot — connect words in URLs/domains/emails
      if (isWordConnected(charBefore) || isWordConnected(charAfter)) {
        idx = resultLowerLeak.indexOf(pseudoLower, idx + pseudoLower.length);
        continue;
      }
      result = result.substring(0, idx) + entry.original + result.substring(idx + entry.pseudonym.length);
      _recordReplacement(idx, entry.pseudonym.length, entry.original.length);
      resultLowerLeak = result.toLowerCase();
      idx = resultLowerLeak.indexOf(pseudoLower, idx + entry.original.length);
    }
  }

  return result;
}
