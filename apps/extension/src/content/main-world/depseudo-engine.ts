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

// ─── Inline citation-marker stripper ────────────────────────────────────────
//
// ChatGPT's response content embeds inline citation markers (the visible
// `["]<box-char>` tail observed in corrupted output). They use Private Use
// Area (PUA) Unicode codepoints (U+E000–U+F8FF) — characters that should
// never appear in normal text — plus zero-width joiner / non-joiner pairs.
//
// We strip them BEFORE pseudonym replacement so the per-entry regexes
// don't have to navigate around them, and so the rendered output is clean.
//
// Patterns stripped:
//   • PUA codepoints                    (U+E000–U+F8FF)
//   • Zero-width chars                  (U+200B–U+200F, U+FEFF)
//   • The full inline-cite pattern      (`["]` followed by a PUA char)
//   • `cite_turn0...` style placeholders (rare, but seen in some payloads)
//
// All of these are content-neutral — they exist only to drive ChatGPT's
// front-end citation rendering, and the front-end gracefully handles their
// absence (text just renders without the citation hover).
const INLINE_MARKER_PATTERNS: RegExp[] = [
  // ChatGPT inline citation: closing-bracket + PUA character (the literal
  // `"]≡` pattern observed). The leading character is sometimes a typographic
  // quote, sometimes a regular bracket — strip the bracket+PUA pair regardless.
  /[\]\)][-]+/g,
  // Bare PUA characters wherever they appear
  /[-]+/g,
  // Zero-width chars + BOM
  /[​-‏﻿]+/g,
  // ChatGPT inline entity references that leak into rendered text when the
  // pseudonym-replacement byte-length change throws off the renderer's
  // offset table. Observed corruption: `entity["company","Apple Inc."]`
  // and `entity["person","Leopold Aschenbrenner"]` appearing verbatim.
  // Strip the entire wrapper — the display name is already in surrounding
  // text most of the time and this is metadata, not content.
  /entity\["[^"\]]*"(?:,"[^"\]]*")*\]/g,
  // Bare-fragment leftover when the closing `"]` was already consumed.
  /entity\["[a-z_]+","/g,
  // ChatGPT search-citation tokens: `turn0search3`, `cite_turn0search3`,
  // `mainstrecite…turn0search…`. Placeholder markers their front-end
  // converts to chips; when offsets break, the raw token leaks to the user.
  // Match anywhere (not just on word boundary) because corrupted output
  // shows these glued to surrounding content: `Digitalsearch1turn0search0`.
  /(?:mainstre)?cite[_a-z]*turn\d+search\d+/gi,
  /turn\d+search\d+/gi,
  // Bare `search<digit>` placeholder (the head of a chained citation run
  // that lost its leading `turn0`). Conservative: only strip when followed
  // by another `turn<digit>` token to avoid clobbering English text.
  /search\d+(?=turn\d+|search\d+)/gi,
];

export function stripInlineMarkers(content: string): string {
  if (!content) return content;
  let out = content;
  for (const re of INLINE_MARKER_PATTERNS) {
    out = out.replace(re, '');
  }
  return out;
}

// ─── Core Replacement Engine ────────────────────────────────────────────────

/**
 * Stateless core of replacePseudonyms. Takes a pre-built regex cache
 * and performs 3-strategy replacement + leak scanner with:
 *   - Inline citation marker strip (cleans up `"]≡` style markers)
 *   - Fast-reject for chunks with no candidate substring (perf)
 *   - Replaced-region tracking (prevents overlap corruption)
 *   - Word-boundary checks (prevents false positives in longer words)
 *   - Fragment exclusion (prevents email corruption)
 */
export function replacePseudonymsCore(text: string, cache: CachedPseudoEntry[]): string {
  if (cache.length === 0) return text;

  // Strip inline citation markers FIRST. These are PUA / zero-width chars
  // ChatGPT injects between text fragments to drive citation rendering on
  // its front-end. They corrupted past de-pseudonymization runs because
  // the markers landed inside or adjacent to a pseudonym, splitting the
  // word at the wrong place after replacement.
  let result = stripInlineMarkers(text);

  // ── FAST-REJECT (perf) ────────────────────────────────────────────────
  // SSE streams contain hundreds of small chunks; most are punctuation,
  // whitespace, or filler tokens with no pseudonym to replace. Running 22+
  // regex passes plus the leak scanner on each was the visible UI lag.
  // Test ONCE per chunk: if no pseudonym (or its JSON-escaped form)
  // appears, skip the whole replacement loop.
  const resultLowerForReject = result.toLowerCase();
  let anyCandidate = false;
  for (const entry of cache) {
    const pl = entry.pseudonym.toLowerCase();
    if (pl.length >= 2 && resultLowerForReject.includes(pl)) {
      anyCandidate = true;
      break;
    }
    if (entry.jsonPseudo !== entry.pseudonym && result.includes(entry.jsonPseudo)) {
      anyCandidate = true;
      break;
    }
  }
  if (!anyCandidate) return result;

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
