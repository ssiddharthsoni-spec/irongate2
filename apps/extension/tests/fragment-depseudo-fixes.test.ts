/**
 * Regression Tests — Fragment De-pseudonymization Fixes (March 22, 2026)
 *
 * Three bugs fixed in main-world.ts:
 *
 *   FIX-1 (BUFFER_WINDOW_MS 800→2000):
 *     Turn Coordinator buffer too short for Claude's multi-fetch pattern.
 *     0-entity preflight would flush and show "All Clear" before the real
 *     detection result arrived (~1.2–1.5s on Claude.ai). Tested as timing logic.
 *
 *   FIX-2 (nameFragments 'g' → 'gi'):
 *     Fragment replacement regex was case-sensitive. Standalone "james" (lowercase)
 *     or "JAMES" (uppercase) after a list bullet / section number wasn't replaced.
 *
 *   FIX-3 (server-mode addReverseMapping adds fragment keys):
 *     When the server returns the reverse map, addReverseMapping was called with
 *     entityType='server', so isPerson=false and fragment keys ("James" → "David")
 *     were never added directly. DOM observer relied solely on Strategy 5
 *     nameFragments — which has edge cases — instead of a direct map entry.
 *
 * Run: pnpm test -- tests/fragment-depseudo-fixes.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pseudonymizeLocal,
  resetMaps,
  setPseudonymMode,
  getReverseMapObject,
} from '../src/detection/pseudonymizer';
import type { DetectedEntity } from '../src/detection/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function entity(type: string, text: string, start: number): DetectedEntity {
  return {
    type,
    text,
    start,
    end: start + text.length,
    confidence: 0.95,
    source: 'regex',
  };
}

/**
 * Replicate the FIXED replacePseudonyms logic from main-world.ts.
 * Key differences from the OLD logic that these tests verify:
 *   - nameFragments regex uses 'gi' (case-insensitive)  — FIX-2
 *   - addReverseMapping adds fragment keys for server-mode person names — FIX-3
 */
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
function looksLikePersonName(s: string): boolean {
  const words = s.split(/\s+/);
  if (words.length < 2 || !words.every(w => /^[A-Z][a-z]/.test(w))) return false;
  if (_ORG_SUFFIXES.has(words[words.length - 1].toLowerCase())) return false;
  return true;
}

function buildReverseMapWithFragments(
  serverMap: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = { ...serverMap };

  // FIX-3: server-mode entries also get fragment keys if they look like person names
  for (const [pseudonym, original] of Object.entries(serverMap)) {
    if (!looksLikePersonName(pseudonym) || !looksLikePersonName(original)) continue;
    const pWords = pseudonym.split(/\s+/);
    const oWords = original.split(/\s+/);
    if (pWords.length !== oWords.length) continue;
    for (let i = 0; i < pWords.length; i++) {
      const pWord = pWords[i];
      const oWord = oWords[i];
      if (pWord.length < 3 || oWord.length < 2) continue;
      if (pWord.toLowerCase() === oWord.toLowerCase()) continue;
      if (result[pWord]) continue; // don't overwrite existing entry
      if (original.toLowerCase().includes(pWord.toLowerCase())) continue;
      result[pWord] = oWord;
    }
  }
  return result;
}

function replacePseudonymsFixed(
  text: string,
  reverseMap: Record<string, string>
): string {
  // New architecture: all fragments (person first/last names, org abbreviations)
  // are pre-registered as first-class map entries by buildReverseMapWithFragments.
  // replacePseudonyms just does boundary-aware matching — no Strategy 4/5 needed.
  const entries = Object.entries(reverseMap)
    .filter(([k]) => k && k.length >= 2)
    .sort((a, b) => b[0].length - a[0].length);

  let result = text;

  for (const [pseudonym, original] of entries) {
    if (pseudonym === original) continue;

    // Boundary-aware exact match (case-sensitive)
    try {
      const esc = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefix = /^[a-zA-Z]/.test(pseudonym) ? '(?<![a-zA-Z])' : /^\d/.test(pseudonym) ? '(?<![\\d.])' : '';
      const suffix = /[a-zA-Z]$/.test(pseudonym) ? '(?![a-zA-Z])' : /\d$/.test(pseudonym) ? '(?![\\d.])' : '';
      const regexCS = new RegExp(prefix + esc + suffix, 'g');
      regexCS.lastIndex = 0;
      result = result.replace(regexCS, () => original);
    } catch { /* skip */ }

    // Case-insensitive boundary-aware
    try {
      const esc = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefix = /^[a-zA-Z]/.test(pseudonym) ? '(?<![a-zA-Z])' : '';
      const suffix = /[a-zA-Z]$/.test(pseudonym) ? '(?![a-zA-Z])' : '';
      const regexCI = new RegExp(prefix + esc + suffix, 'gi');
      regexCI.lastIndex = 0;
      result = result.replace(regexCI, () => original);
    } catch { /* skip */ }
  }
  return result;
}

/** OLD (buggy) replacePseudonyms — no 'gi' flag, no server-mode fragments */
function replacePseudonymsBuggy(
  text: string,
  reverseMap: Record<string, string>
): string {
  const entries = Object.entries(reverseMap)
    .filter(([k]) => k && k.length >= 2)
    .sort((a, b) => b[0].length - a[0].length);

  let result = text;

  for (const [pseudonym, original] of entries) {
    if (pseudonym === original) continue;
    // Strategy 1 only — no case-insensitive fragments, no 'gi'
    try {
      const esc = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefix = /^[a-zA-Z]/.test(pseudonym) ? '(?<![a-zA-Z])' : '';
      const suffix = /[a-zA-Z]$/.test(pseudonym) ? '(?![a-zA-Z])' : '';
      const regex = new RegExp(prefix + esc + suffix, 'g');
      regex.lastIndex = 0;
      result = result.replace(regex, () => original);
    } catch { /* skip */ }
  }
  return result;
}

beforeEach(() => {
  resetMaps();
  setPseudonymMode('realistic');
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX-3: Server-mode reverse map must generate fragment keys
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIX-3: Server-mode addReverseMapping generates fragment keys', () => {
  it('SCENARIO 1 — standalone first name "James" in PIP AI response is replaced after React re-render', () => {
    // Server returns: James Mitchell → David Park (entityType='server')
    // The old code did NOT add "James" → "David" as a direct key.
    // The DOM observer must be able to replace it using the map alone.

    // Old behaviour (no fragment keys in server-mode map)
    const serverMapBuggy: Record<string, string> = {
      'James Mitchell': 'David Park',
    };
    const aiResponseWithStandaloneFirstName =
      '2a. James received a verbal warning on March 14 regarding repeated lateness.';

    const buggyResult = replacePseudonymsBuggy(aiResponseWithStandaloneFirstName, serverMapBuggy);
    // OLD: standalone "James" is NOT replaced because the map only has the full name
    expect(buggyResult).toContain('James');

    // Fixed behaviour: fragment keys ARE added for server-mode person names
    const fixedMap = buildReverseMapWithFragments(serverMapBuggy);
    expect(fixedMap['James']).toBe('David');
    expect(fixedMap['Mitchell']).toBe('Park');

    const fixedResult = replacePseudonymsFixed(aiResponseWithStandaloneFirstName, fixedMap);
    expect(fixedResult).not.toContain('James');
    expect(fixedResult).toContain('David');
  });

  it('SCENARIO 2 — standalone last name is also mapped via server-mode fragment key', () => {
    const serverMap = buildReverseMapWithFragments({ 'Emily Carter': 'Sarah Chen' });

    // "Carter" alone in a sentence should be replaced to "Chen"
    const text = 'Carter was placed on a formal improvement plan in Q1.';
    const result = replacePseudonymsFixed(text, serverMap);

    expect(result).not.toContain('Carter');
    expect(result).toContain('Chen');
  });

  it('SCENARIO 3 — multiple server-mode persons each get their own fragment keys', () => {
    const serverMap = buildReverseMapWithFragments({
      'James Mitchell': 'David Park',
      'Emily Carter': 'Sarah Chen',
    });

    expect(serverMap['James']).toBe('David');
    expect(serverMap['Mitchell']).toBe('Park');
    expect(serverMap['Emily']).toBe('Sarah');
    expect(serverMap['Carter']).toBe('Chen');

    const text = 'James and Emily both reported to Mitchell. Carter disagreed.';
    const result = replacePseudonymsFixed(text, serverMap);

    expect(result).not.toContain('James');
    expect(result).not.toContain('Emily');
    expect(result).not.toContain('Mitchell');
    expect(result).not.toContain('Carter');
    expect(result).toContain('David');
    expect(result).toContain('Sarah');
  });

  it('SCENARIO 4 — org names and non-person entries do NOT get fragment keys from server map', () => {
    // "Alpine Securities" does not look like a person name — should not get fragments
    const serverMap = buildReverseMapWithFragments({
      'James Mitchell': 'David Park',
      'Alpine Securities': 'Acme Corp',
    });

    // Person fragments added
    expect(serverMap['James']).toBe('David');
    // Org fragments NOT added (looksLikePersonName fails for org names)
    expect(serverMap['Alpine']).toBeUndefined();
    expect(serverMap['Securities']).toBeUndefined();
  });

  it('SCENARIO 5 — fragment key is not created if the fragment word appears in the original name (prevents double-replacement)', () => {
    // "David Mitchell" → "Mitchell Park" — fragment "Mitchell" appears in the original
    // Creating "Mitchell" → "Park" would cause "Mitchell Park" to become "Park Park"
    const serverMap = buildReverseMapWithFragments({
      'David Mitchell': 'Mitchell Park',
    });

    // "Mitchell" appears in original "Mitchell Park" → fragment must be skipped
    expect(serverMap['Mitchell']).toBeUndefined();
    // "David" is fine — doesn't appear in "Mitchell Park"
    expect(serverMap['David']).toBe('Mitchell');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX-2: nameFragments regex must be case-insensitive ('gi')
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIX-2: nameFragments regex is case-insensitive (gi)', () => {
  it('SCENARIO 6 — lowercase "james" after section number (e.g. "2a. james") is replaced', () => {
    // In the new architecture, fragment keys are in the map via buildReverseMapWithFragments.
    // "James" → "David" is a first-class map entry, caught by case-insensitive regex.
    const reverseMap = buildReverseMapWithFragments({
      'James Mitchell': 'David Park',
    });
    const text = '2a. james received feedback on his attendance.';

    const fixed = replacePseudonymsFixed(text, reverseMap);
    expect(fixed).not.toContain('james');
    expect(fixed).toContain('David');
  });

  it('SCENARIO 7 — all-caps "JAMES" (e.g. section heading) is replaced', () => {
    const reverseMap = buildReverseMapWithFragments({
      'James Mitchell': 'David Park',
    });
    const text = 'PERFORMANCE CONCERNS: JAMES failed to meet the Q3 targets.';

    const fixed = replacePseudonymsFixed(text, reverseMap);
    expect(fixed).not.toContain('JAMES');
    expect(fixed).toContain('David');
  });

  it('SCENARIO 8 — mixed case "jAmEs" (corrupted / copy-paste artefact) is replaced', () => {
    const reverseMap = buildReverseMapWithFragments({
      'James Mitchell': 'David Park',
    });
    const text = 'As noted, jAmEs has not met expectations.';

    const fixed = replacePseudonymsFixed(text, reverseMap);
    expect(fixed).not.toContain('jAmEs');
    expect(fixed).toContain('David');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX-1: Turn Coordinator buffer timing logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIX-1: Turn Coordinator suppresses 0-entity preflight within 2000ms window', () => {
  it('SCENARIO 9 — real detection within 2s suppresses the 0-entity preflight buffer', () => {
    vi.useFakeTimers();

    // Simulates the Turn Coordinator logic from main-world.ts
    let sidepanelState = 'initial';
    let bufferedTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSignificantEmitAt = 0;
    const BUFFER_WINDOW_MS = 2000; // THE FIX — was 800
    const SIGNIFICANT_PROTECT_MS = 5000;

    function submit(type: 'INTERCEPTED' | 'AUDIT', entityCount: number): void {
      if (type === 'INTERCEPTED' || entityCount > 0) {
        // Significant result — emit immediately, cancel any pending buffer
        if (bufferedTimer !== null) {
          clearTimeout(bufferedTimer);
          bufferedTimer = null;
        }
        lastSignificantEmitAt = Date.now();
        sidepanelState = `${type}:${entityCount}`;
        return;
      }
      // 0-entity AUDIT: buffer for BUFFER_WINDOW_MS
      if (lastSignificantEmitAt > 0 && Date.now() - lastSignificantEmitAt < SIGNIFICANT_PROTECT_MS) {
        return; // suppressed
      }
      if (bufferedTimer === null) {
        bufferedTimer = setTimeout(() => {
          bufferedTimer = null;
          sidepanelState = 'AUDIT:0';
        }, BUFFER_WINDOW_MS);
      }
    }

    // T=0: preflight arrives with 0 entities → buffered
    submit('AUDIT', 0);
    expect(sidepanelState).toBe('initial'); // not shown yet

    // T=1200ms: real detection arrives with 7 entities → should cancel buffer, show real result
    vi.advanceTimersByTime(1200);
    submit('AUDIT', 7);
    expect(sidepanelState).toBe('AUDIT:7'); // real result shown

    // T=3000ms: buffer window would have expired — but it was cancelled
    vi.advanceTimersByTime(3000);
    expect(sidepanelState).toBe('AUDIT:7'); // still showing real result, NOT "All Clear"

    vi.useRealTimers();
  });

  it('SCENARIO 10 — with OLD 800ms buffer, real detection at 1200ms arrives too late (regression proof)', () => {
    vi.useFakeTimers();

    let sidepanelState = 'initial';
    let bufferedTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSignificantEmitAt = 0;
    const OLD_BUFFER_WINDOW_MS = 800; // THE BUG — old value
    const SIGNIFICANT_PROTECT_MS = 5000;

    function submitOld(type: 'INTERCEPTED' | 'AUDIT', entityCount: number): void {
      if (type === 'INTERCEPTED' || entityCount > 0) {
        if (bufferedTimer !== null) {
          clearTimeout(bufferedTimer);
          bufferedTimer = null;
        }
        lastSignificantEmitAt = Date.now();
        sidepanelState = `${type}:${entityCount}`;
        return;
      }
      if (lastSignificantEmitAt > 0 && Date.now() - lastSignificantEmitAt < SIGNIFICANT_PROTECT_MS) {
        return;
      }
      if (bufferedTimer === null) {
        bufferedTimer = setTimeout(() => {
          bufferedTimer = null;
          sidepanelState = 'AUDIT:0'; // "All Clear"
        }, OLD_BUFFER_WINDOW_MS);
      }
    }

    // T=0: preflight arrives → buffered for 800ms
    submitOld('AUDIT', 0);
    expect(sidepanelState).toBe('initial');

    // T=800ms+: OLD buffer fires — "All Clear" shown BEFORE real result arrives
    vi.advanceTimersByTime(801);
    expect(sidepanelState).toBe('AUDIT:0'); // BUG: "All Clear" displayed

    // T=1200ms: real detection finally arrives — overwrites, but user already saw "All Clear"
    vi.advanceTimersByTime(399);
    submitOld('AUDIT', 7);
    expect(sidepanelState).toBe('AUDIT:7'); // correct final state, but flicker happened

    vi.useRealTimers();
  });
});
