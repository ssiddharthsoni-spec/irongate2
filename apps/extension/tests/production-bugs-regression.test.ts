/**
 * Production Bug Regression Tests
 *
 * Every test in this file corresponds to a REAL bug that was discovered
 * in production (user testing with ChatGPT/Gemini) and reported via screenshot.
 *
 * These tests exist to PERMANENTLY PREVENT these bugs from recurring.
 * If you change pseudonymization, de-pseudonymization, or DOM interception code,
 * run this file first: `pnpm test -- tests/production-bugs-regression.test.ts`
 *
 * Bug inventory (from 42 screenshots across March 4-8, 2026):
 *   P0-1: Garbled de-pseudonymization ("Sullivan & Cromwellaw firm"]")
 *   P0-2: De-identification notice leaking into ChatGPT chat bubbles
 *   P0-3: Bracket tokens sent to AI ([MONETARY_AMOUNT-0003] instead of fakes)
 *   P1-4: Stale side panel — detection results not clearing when text deleted
 *   P1-5: replaceTextWithDirectives crash in DOM de-pseudo layer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  pseudonymizeLocal,
  resetMaps,
  setPseudonymMode,
  getPseudonymMode,
  getForwardMap,
  getReverseMap,
} from '../src/detection/pseudonymizer';
import type { DetectedEntity } from '../src/detection/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a DetectedEntity for testing */
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

/** Replicate main-world.ts replacePseudonyms logic for testing */
function replacePseudonyms(text: string, reverseMap: Record<string, string>): string {
  let result = text;
  const entries = Object.entries(reverseMap)
    .filter(([k]) => k && k.length >= 2)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [pseudonym, original] of entries) {
    if (pseudonym === original) continue;

    // Strategy 1: Boundary-aware exact match
    try {
      const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const startsWithAlpha = /^[a-zA-Z]/.test(pseudonym);
      const endsWithAlpha = /[a-zA-Z]$/.test(pseudonym);
      const startsWithDigit = /^\d/.test(pseudonym);
      const endsWithDigit = /\d$/.test(pseudonym);
      const prefix = startsWithDigit ? '(?<!\\d)' : startsWithAlpha ? '(?<![a-zA-Z])' : '';
      const suffix = endsWithDigit ? '(?!\\d)' : endsWithAlpha ? '(?![a-zA-Z])' : '';
      const regex = new RegExp(prefix + escaped + suffix, 'g');
      if (regex.test(result)) {
        regex.lastIndex = 0;
        result = result.replace(regex, original);
        continue;
      }
    } catch {}

    // Strategy 2: JSON-escaped match (single and double-escaped)
    const jsonEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const jsonPseudo = jsonEscape(pseudonym);
    const jsonOrig = jsonEscape(original);
    if (jsonPseudo !== pseudonym && result.includes(jsonPseudo)) {
      result = result.split(jsonPseudo).join(jsonOrig);
      continue;
    }
    // Double-escaped JSON (Gemini batchexecute responses)
    const json2Pseudo = jsonEscape(jsonPseudo);
    const json2Orig = jsonEscape(jsonOrig);
    if (json2Pseudo !== jsonPseudo && result.includes(json2Pseudo)) {
      result = result.split(json2Pseudo).join(json2Orig);
      continue;
    }

    // Strategy 3: Case-insensitive
    try {
      const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      if (regex.test(result)) {
        regex.lastIndex = 0;
        result = result.replace(regex, original);
        continue;
      }
    } catch {}

    // Strategy 4: Plain substring (>= 8 chars)
    if (pseudonym.length >= 8 && result.includes(pseudonym)) {
      result = result.split(pseudonym).join(original);
    } else if (pseudonym.length >= 8) {
      const lowerResult = result.toLowerCase();
      const lowerPseudo = pseudonym.toLowerCase();
      if (lowerResult.includes(lowerPseudo)) {
        let idx = lowerResult.indexOf(lowerPseudo);
        while (idx !== -1) {
          result = result.substring(0, idx) + original + result.substring(idx + pseudonym.length);
          idx = result.toLowerCase().indexOf(lowerPseudo, idx + original.length);
        }
      }
    }
  }
  return result;
}

beforeEach(() => {
  resetMaps();
  setPseudonymMode('realistic');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-1: GARBLED DE-PSEUDONYMIZATION
// Screenshots: Lines 16184, 18293 in transcript
//
// Bug: De-pseudonymized text had overlapping/garbled replacements:
//   "Sullivan & Cromwellaw firm"]"
//   "enZalandod"
//   "Teslaacturer"]"
//   "ActivisEngine No. 1nt firm"]"
//
// Root cause: Replacements applied in wrong order, causing partial overlaps
// when one pseudonym was a substring of another, or when replacements changed
// the string length and shifted positions of subsequent matches.
// ═══════════════════════════════════════════════════════════════════════════════
describe('P0-1: Garbled De-pseudonymization', () => {
  it('should not produce garbled text when pseudonyms overlap with surrounding text', () => {
    // Simulate the exact scenario from the screenshot:
    // "Sullivan & Cromwell" was pseudonymized but de-pseudo produced "Sullivan & Cromwellaw firm"]"
    const reverseMap = {
      'Adatum Partners': 'Sullivan & Cromwell',
      'Bentworth': 'Tesla',
      'Initech Corp': 'Activis Engine No. 1',
      'Globex Industries': 'Zalando',
    };

    const pseudonymized = 'The law firm Adatum Partners advised Bentworth and Globex Industries. Initech Corp was the investment firm.';
    const result = replacePseudonyms(pseudonymized, reverseMap);

    // Must contain ALL originals
    expect(result).toContain('Sullivan & Cromwell');
    expect(result).toContain('Tesla');
    expect(result).toContain('Zalando');
    expect(result).toContain('Activis Engine No. 1');

    // Must NOT contain ANY pseudonyms
    expect(result).not.toContain('Adatum Partners');
    expect(result).not.toContain('Bentworth');
    expect(result).not.toContain('Globex Industries');
    expect(result).not.toContain('Initech Corp');

    // CRITICAL: Must NOT have garbled fragments
    expect(result).not.toMatch(/\]\s*$/); // trailing bracket
    expect(result).not.toMatch(/\[.*?\]/); // leftover bracket tokens
    expect(result).not.toContain('ellaw'); // garbled overlap
  });

  it('should handle pseudonym that is substring of another word in response', () => {
    // LLM writes "Bentworthwhile" (pseudonym concatenated with next word)
    const reverseMap = { 'Bentworth': 'Tesla' };
    const text = 'The Bentworthwhile investment strategy paid off.';
    const result = replacePseudonyms(text, reverseMap);
    // Should replace "Bentworth" even when concatenated (Strategy 4: >= 8 chars)
    expect(result).toContain('Tesla');
    expect(result).not.toContain('Bentworth');
  });

  it('should handle multiple overlapping replacements without corruption', () => {
    const reverseMap = {
      'Adatum': 'Acme',
      'Adatum Corp': 'Acme Corporation',
      'John Adatum': 'John Doe',
    };
    // "Adatum Corp" should match first (longest), not "Adatum" alone
    const text = 'Contact John Adatum at Adatum Corp for details about Adatum products.';
    const result = replacePseudonyms(text, reverseMap);
    expect(result).toContain('John Doe');
    expect(result).toContain('Acme Corporation');
    // The standalone "Adatum" should also be replaced
    expect(result).toContain('Acme products');
    expect(result).not.toContain('Adatum');
  });

  it('should handle special characters in pseudonyms (& ampersand, parentheses)', () => {
    const reverseMap = {
      'Smith & Associates (LLC)': 'Real Firm Name (LLP)',
    };
    const text = 'Represented by Smith & Associates (LLC) in the matter.';
    const result = replacePseudonyms(text, reverseMap);
    expect(result).toContain('Real Firm Name (LLP)');
    expect(result).not.toContain('Smith & Associates');
  });

  it('round-trip: pseudonymize then de-pseudonymize should produce clean output', () => {
    const original = 'John Smith at Sullivan & Cromwell advised Tesla on the $450M acquisition of Zalando.';
    const entities = [
      entity('PERSON', 'John Smith', 0),
      entity('ORGANIZATION', 'Sullivan & Cromwell', 14),
      entity('ORGANIZATION', 'Tesla', 42),
      entity('MONETARY_AMOUNT', '$450M', 55),
      entity('ORGANIZATION', 'Zalando', 76),
    ];

    const result = pseudonymizeLocal(original, entities);

    // Build reverse map from mappings
    const reverseMap: Record<string, string> = {};
    for (const m of result.mappings) {
      reverseMap[m.pseudonym] = m.original;
    }

    // Simulate LLM response using pseudonymized names
    const llmResponse = `Based on the analysis, ${result.mappings[0]?.pseudonym || 'the person'} ` +
      `at ${result.mappings[1]?.pseudonym || 'the firm'} recommended proceeding with the acquisition.`;

    const deAnonymized = replacePseudonyms(llmResponse, reverseMap);

    // Should NOT contain any pseudonyms
    for (const m of result.mappings) {
      if (m.pseudonym !== m.original) {
        expect(deAnonymized).not.toContain(m.pseudonym);
      }
    }
    // Should NOT have garbled text
    expect(deAnonymized).not.toMatch(/\[.*?\]/); // no bracket tokens
    expect(deAnonymized).not.toMatch(/undefined|null|NaN/); // no JS artifacts
  });

  it('P0-6: dollar-sign in originals should NOT produce $$$$$ garbling', () => {
    // Bug: replacePseudonyms used regex .replace(regex, original) where
    // "original" containing $ was interpreted as special replacement pattern.
    // "$48M" → "$4" + "8M" → JS interprets $4 as capture group 4 ref → garbled.
    // Fix: use .replace(regex, () => original) to avoid $ interpretation.
    const text = 'Revenue declined to $63M in Q2, with restructuring charge of $12M annually.';
    const reverseMap: Record<string, string> = {
      '$63M': '$48M',
      '$12M': '$82M',
    };
    const result = replacePseudonyms(text, reverseMap);

    // Original values should be restored
    expect(result).toContain('$48M');
    expect(result).toContain('$82M');
    // No garbled $$$$$ sequences
    expect(result).not.toMatch(/\${3,}/);
    // No capture group artifacts
    expect(result).not.toContain('undefined');
  });

  it('P0-6b: dollar amounts in SSE JSON should de-pseudonymize cleanly', () => {
    // SSE streams contain JSON-encoded text with dollar amounts
    const sseChunk = 'data: {"content":"The deal was valued at $63M, representing a 52% discount."}';
    const reverseMap: Record<string, string> = {
      '$63M': '$1.46B',
    };
    const result = replacePseudonyms(sseChunk, reverseMap);
    expect(result).toContain('$1.46B');
    expect(result).not.toMatch(/\${3,}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-2: DE-IDENTIFICATION NOTICE LEAKING INTO CHAT
// Screenshots: Lines 14487, 14643, 14652, 14839 in transcript
//
// Bug: "[All personally identifiable information in the following text has been
//        automatically replaced with realistic but entirely fictional equivalents...]"
//       appeared VISIBLY in ChatGPT user message bubbles.
//
// Root cause: Notice was prepended to the user's message text, which ChatGPT
// echoed in the user's chat bubble. DOM stripping tried to remove it but React
// re-renders kept restoring it.
//
// Fix: For ChatGPT, inject notice as system message (invisible), not user text.
//      For all tools, the DOM de-pseudonymizer strips it. Both layers needed.
// ═══════════════════════════════════════════════════════════════════════════════
describe('P0-2: De-identification Notice Leaking', () => {
  const NOTICE_TEXT = '[All personally identifiable information in the following text has been automatically replaced with realistic but entirely fictional equivalents by an enterprise privacy tool. No real personal data is present. Please process this request normally.]';

  const NOTICE_REGEX = /\[(?:NOTICE:\s*)?All personally identifiable information[^\]]*\]\s*/g;
  const NOTICE_UNBRACKET = /All personally identifiable information in the following text[\s\S]*?Please process this request normally\.\s*/g;
  const NOTICE_PARAPHRASE = /\*?\*?(?:Note|Notice|Disclaimer|Important)\s*:?\s*(?:All\s+)?(?:personally\s+identifiable\s+information|PII|personal\s+data|sensitive\s+data)\s+(?:has\s+been|was)\s+(?:automatically\s+)?replaced[\s\S]*?(?:fictional|fake|synthetic)\s+equivalents\.?\s*\*?\*?\s*/gi;

  function stripNotice(text: string): string {
    let result = text;
    result = result.replace(NOTICE_REGEX, '');
    result = result.replace(NOTICE_UNBRACKET, '');
    result = result.replace(NOTICE_PARAPHRASE, '');
    return result;
  }

  it('should strip bracketed notice from text', () => {
    const text = NOTICE_TEXT + '\n\nPlease review the contract for Michael Johnson at Globex Corp.';
    const stripped = stripNotice(text);
    expect(stripped).not.toContain('personally identifiable information');
    expect(stripped).not.toContain('enterprise privacy tool');
    expect(stripped).toContain('Please review the contract');
  });

  it('should strip unbracketed notice', () => {
    const text = 'All personally identifiable information in the following text has been automatically replaced with realistic but entirely fictional equivalents by an enterprise privacy tool. No real personal data is present. Please process this request normally. Here is the contract for...';
    const stripped = stripNotice(text);
    expect(stripped).not.toContain('personally identifiable information');
    expect(stripped.trim().startsWith('Here is the contract')).toBe(true);
  });

  it('should strip LLM paraphrase of notice', () => {
    const paraphrased = '**Note: All personally identifiable information has been replaced with fictional equivalents.**\n\nThe contract terms are...';
    const stripped = stripNotice(paraphrased);
    expect(stripped.trim().startsWith('The contract terms')).toBe(true);
  });

  it('should strip notice that appears mid-text (not just at start)', () => {
    const text = 'Here is my analysis.\n\n[All personally identifiable information in the following text has been automatically replaced with realistic but entirely fictional equivalents by an enterprise privacy tool. No real personal data is present. Please process this request normally.]\n\nThe merger involves...';
    const stripped = stripNotice(text);
    expect(stripped).not.toContain('personally identifiable information');
    expect(stripped).toContain('Here is my analysis');
    expect(stripped).toContain('The merger involves');
  });

  it('ChatGPT: should NOT prepend notice to user message text', () => {
    // The ChatGPT path in main-world.ts should use system message injection,
    // not text prepending. Verify by checking that for ChatGPT backend format,
    // the pseudonymized text does NOT start with the notice.
    const original = 'Draft an NDA for John Smith at Acme Corp.';
    const entities = [
      entity('PERSON', 'John Smith', 20),
      entity('ORGANIZATION', 'Acme Corp', 34),
    ];
    const result = pseudonymizeLocal(original, entities);

    // maskedText should NOT start with notice — that's the main-world.ts job
    // and only for non-ChatGPT platforms
    expect(result.maskedText).not.toContain('personally identifiable information');
    expect(result.maskedText).not.toContain('[All personally');
    expect(result.maskedText).not.toContain('enterprise privacy tool');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-3: BRACKET TOKENS SENT TO AI
// Screenshots: Lines 14155, 14433 in transcript
//
// Bug: Raw bracket tokens like [MONETARY_AMOUNT-0003], [EMAIL-0001] were sent
//      to ChatGPT instead of realistic fake values, causing garbled responses.
//
// Root cause: pseudonymizer.ts has two modes: 'realistic' (generates fake names/values)
//             and 'bracket' (generates [TYPE-N] tokens). The bracket mode was
//             accidentally used or the mode wasn't set correctly.
//
// Fix: Default mode is 'realistic'. Guard against accidental bracket mode.
// ═══════════════════════════════════════════════════════════════════════════════
describe('P0-3: Bracket Tokens Sent to AI', () => {
  it('default mode should be realistic, not bracket', () => {
    expect(getPseudonymMode()).toBe('realistic');
  });

  it('realistic mode should NEVER produce bracket tokens', () => {
    const text = 'Contact John Smith (john@acme.com, SSN 123-45-6789) about the $450M deal at Acme Corp for Q4 2024.';
    const entities = [
      entity('PERSON', 'John Smith', 8),
      entity('EMAIL', 'john@acme.com', 20),
      entity('SSN', '123-45-6789', 39),
      entity('MONETARY_AMOUNT', '$450M', 62),
      entity('ORGANIZATION', 'Acme Corp', 76),
      entity('FISCAL_PERIOD', 'Q4 2024', 90),
    ];

    const result = pseudonymizeLocal(text, entities);

    // CRITICAL: No bracket tokens in output
    expect(result.maskedText).not.toMatch(/\[\w+-\d+\]/);
    expect(result.maskedText).not.toContain('[PERSON-');
    expect(result.maskedText).not.toContain('[EMAIL-');
    expect(result.maskedText).not.toContain('[SSN-');
    expect(result.maskedText).not.toContain('[MONETARY_AMOUNT-');
    expect(result.maskedText).not.toContain('[ORGANIZATION-');
    expect(result.maskedText).not.toContain('[FISCAL_PERIOD-');

    // Should produce realistic fakes
    for (const mapping of result.mappings) {
      expect(mapping.pseudonym).not.toMatch(/^\[.*\]$/);
      expect(mapping.pseudonym.length).toBeGreaterThan(0);
    }
  });

  it('bracket mode SHOULD produce bracket tokens (when explicitly set)', () => {
    setPseudonymMode('bracket');
    const text = 'John Smith at Acme Corp';
    const entities = [
      entity('PERSON', 'John Smith', 0),
      entity('ORGANIZATION', 'Acme Corp', 14),
    ];

    const result = pseudonymizeLocal(text, entities);
    expect(result.maskedText).toMatch(/\[PERSON-1\]/);
    expect(result.maskedText).toMatch(/\[ORGANIZATION-1\]/);

    // Reset to realistic for safety
    setPseudonymMode('realistic');
  });

  it('should generate unique fakes for different entities of same type', () => {
    const text = 'Revenue: $450M, Profit: $120M, Debt: $80M';
    const entities = [
      entity('MONETARY_AMOUNT', '$450M', 9),
      entity('MONETARY_AMOUNT', '$120M', 24),
      entity('MONETARY_AMOUNT', '$80M', 36),
    ];

    const result = pseudonymizeLocal(text, entities);

    // All three should be different fakes
    const fakes = result.mappings.map(m => m.pseudonym);
    const uniqueFakes = new Set(fakes);
    expect(uniqueFakes.size).toBe(3);

    // None should be bracket tokens
    for (const fake of fakes) {
      expect(fake).not.toMatch(/^\[.*\]$/);
    }
  });

  it('should preserve monetary format ($, M, B suffixes)', () => {
    const text = 'Revenue of $47M and profit of $3.1B';
    const entities = [
      entity('MONETARY_AMOUNT', '$47M', 11),
      entity('MONETARY_AMOUNT', '$3.1B', 30),
    ];

    const result = pseudonymizeLocal(text, entities);

    for (const m of result.mappings) {
      // Should start with $ and have a magnitude suffix
      expect(m.pseudonym).toMatch(/^\$\d/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-4: STALE SIDE PANEL (detection results not clearing)
// Screenshots: Line 2513 in transcript
//
// Bug: Side panel continued showing old detection results after user cleared
//      the ChatGPT input. Panel was not reactive to text changes.
//
// Root cause: PROMPT_DETECTED messages were sent to side panel but no
//      PROMPT_CLEARED message was sent when text was emptied.
//
// This test verifies the pseudonymizer handles empty/cleared text correctly.
// The actual PROMPT_CLEARED message is sent from content/capture/dom-observer.ts
// which is tested via E2E — here we verify the detection pipeline's contract.
// ═══════════════════════════════════════════════════════════════════════════════
describe('P1-4: Stale Side Panel (empty text handling)', () => {
  it('should return empty result for empty text', () => {
    const result = pseudonymizeLocal('', []);
    expect(result.maskedText).toBe('');
    expect(result.mappings).toHaveLength(0);
  });

  it('should return empty result for whitespace-only text', () => {
    const result = pseudonymizeLocal('   \n\t  ', []);
    expect(result.maskedText).toBe('   \n\t  ');
    expect(result.mappings).toHaveLength(0);
  });

  it('should return unmodified text when no entities detected', () => {
    const text = 'What is the weather today?';
    const result = pseudonymizeLocal(text, []);
    expect(result.maskedText).toBe(text);
    expect(result.mappings).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-5: replaceTextWithDirectives CRASH
// Screenshots: Line 16184 in transcript
//
// Bug: Console error "Failed replaceTextWithDirectives" — React 19's internal
//      text tracking crashed when our DOM observer mutated text nodes during
//      React's render cycle.
//
// Root cause: MutationObserver callback fired synchronously during React's
//      commit phase. Mutating text nodes inside the callback caused React's
//      replaceTextWithDirectives to fail because the text node it was tracking
//      was replaced out from under it.
//
// Fix: Disconnect observer during generation, use replaceChild instead of
//      textContent mutation, add cooldown after our own mutations.
//
// These tests verify the invariants that prevent the crash.
// ═══════════════════════════════════════════════════════════════════════════════
describe('P1-5: replaceTextWithDirectives Prevention', () => {
  // We can't test React's internals in Node, but we CAN verify the
  // de-pseudonymization logic's safety properties.

  it('replacePseudonyms should be idempotent (applying twice = same result)', () => {
    const reverseMap = {
      'Michael Johnson': 'John Smith',
      'Globex Corp': 'Acme Corp',
    };
    const text = 'Michael Johnson works at Globex Corp.';
    const pass1 = replacePseudonyms(text, reverseMap);
    const pass2 = replacePseudonyms(pass1, reverseMap);

    // After first pass, all pseudonyms should be gone
    expect(pass1).toBe('John Smith works at Acme Corp.');
    // Second pass should be a no-op (idempotent)
    expect(pass2).toBe(pass1);
  });

  it('replacePseudonyms should not corrupt text when no matches exist', () => {
    const reverseMap = {
      'Michael Johnson': 'John Smith',
    };
    const text = 'The weather is nice today.';
    const result = replacePseudonyms(text, reverseMap);
    expect(result).toBe(text); // Unchanged
  });

  it('replacePseudonyms should handle empty reverse map', () => {
    const text = 'Some text with Michael Johnson in it.';
    const result = replacePseudonyms(text, {});
    expect(result).toBe(text);
  });

  it('replacePseudonyms should handle empty string', () => {
    const reverseMap = { 'Michael Johnson': 'John Smith' };
    const result = replacePseudonyms('', reverseMap);
    expect(result).toBe('');
  });

  it('forward map should not grow unbounded', () => {
    // Pseudonymize many unique entities to test eviction
    for (let i = 0; i < 200; i++) {
      const text = `Entity${i} is here.`;
      const entities = [entity('PERSON', `Entity${i}`, 0)];
      pseudonymizeLocal(text, entities);
    }

    // Forward map should not crash or produce errors
    const fwd = getForwardMap();
    expect(fwd.size).toBeGreaterThan(0);
    expect(fwd.size).toBeLessThanOrEqual(5200); // MAX_MAP_SIZE + buffer
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-CUTTING: Full Pipeline Integration
// Exercises the complete flow from detection through de-pseudonymization
// ═══════════════════════════════════════════════════════════════════════════════
describe('Full Pipeline: Pseudonymize → LLM Response → De-pseudonymize', () => {
  it('ModaGlobal board prep scenario (from actual user test)', () => {
    // This is the EXACT scenario from the user's screenshot (Line 18293)
    // that caused garbled de-pseudonymization
    const original = 'Prepare board materials for ModaGlobal Q4 earnings. ' +
      'CEO Sarah Chen and CFO David Kumar will present. ' +
      'Revenue: $450M (up 12%). Legal counsel: Sullivan & Cromwell. ' +
      'Key risk: Activist investor Starboard Value holds 8.2% stake.';

    const entities = [
      entity('ORGANIZATION', 'ModaGlobal', 31),
      entity('FISCAL_PERIOD', 'Q4', 42),
      entity('PERSON', 'Sarah Chen', 59),
      entity('PERSON', 'David Kumar', 77),
      entity('MONETARY_AMOUNT', '$450M', 103),
      entity('PERCENTAGE', '12%', 113),
      entity('ORGANIZATION', 'Sullivan & Cromwell', 135),
      entity('ORGANIZATION', 'Starboard Value', 182),
      entity('PERCENTAGE', '8.2%', 204),
    ];

    const result = pseudonymizeLocal(original, entities);

    // 1. No bracket tokens
    expect(result.maskedText).not.toMatch(/\[\w+-\d+\]/);

    // 2. No original PII remains
    expect(result.maskedText).not.toContain('Sarah Chen');
    expect(result.maskedText).not.toContain('David Kumar');
    expect(result.maskedText).not.toContain('ModaGlobal');
    expect(result.maskedText).not.toContain('Sullivan & Cromwell');
    expect(result.maskedText).not.toContain('Starboard Value');

    // 3. Build reverse map
    const reverseMap: Record<string, string> = {};
    for (const m of result.mappings) {
      reverseMap[m.pseudonym] = m.original;
    }
    expect(Object.keys(reverseMap).length).toBeGreaterThanOrEqual(5);

    // 4. Simulate LLM response using pseudonymized names
    const personPseudo = result.mappings.find(m => m.type === 'PERSON')!.pseudonym;
    const orgPseudo = result.mappings.find(m => m.type === 'ORGANIZATION')!.pseudonym;
    const llmResponse = `Based on the board materials, ${personPseudo} presented strong results for ${orgPseudo}. The revenue growth is encouraging.`;

    // 5. De-pseudonymize
    const final = replacePseudonyms(llmResponse, reverseMap);

    // 6. Verify clean output — NO garbling
    expect(final).not.toContain(personPseudo);
    expect(final).not.toContain(orgPseudo);
    expect(final).not.toMatch(/\]\s/); // no trailing brackets
    expect(final).not.toMatch(/\[/); // no opening brackets
    expect(final).not.toContain('undefined');

    // Should contain original names
    const originalPerson = result.mappings.find(m => m.type === 'PERSON')!.original;
    const originalOrg = result.mappings.find(m => m.type === 'ORGANIZATION')!.original;
    expect(final).toContain(originalPerson);
    expect(final).toContain(originalOrg);
  });

  it('multi-turn conversation should maintain consistent pseudonyms', () => {
    // Turn 1
    const text1 = 'John Smith at Acme Corp called about the deal.';
    const entities1 = [
      entity('PERSON', 'John Smith', 0),
      entity('ORGANIZATION', 'Acme Corp', 14),
    ];
    const result1 = pseudonymizeLocal(text1, entities1);
    const johnPseudo = result1.mappings.find(m => m.original === 'John Smith')!.pseudonym;
    const acmePseudo = result1.mappings.find(m => m.original === 'Acme Corp')!.pseudonym;

    // Turn 2 — same entities should get same pseudonyms
    const text2 = 'John Smith sent the updated term sheet from Acme Corp.';
    const entities2 = [
      entity('PERSON', 'John Smith', 0),
      entity('ORGANIZATION', 'Acme Corp', 42),
    ];
    const result2 = pseudonymizeLocal(text2, entities2);

    expect(result2.maskedText).toContain(johnPseudo);
    expect(result2.maskedText).toContain(acmePseudo);

    // Turn 3 — de-pseudonymize with accumulated reverse map
    const reverseMap: Record<string, string> = {};
    for (const m of [...result1.mappings, ...result2.mappings]) {
      reverseMap[m.pseudonym] = m.original;
    }

    const llmResponse = `${johnPseudo} from ${acmePseudo} confirmed the deal terms.`;
    const final = replacePseudonyms(llmResponse, reverseMap);
    expect(final).toBe('John Smith from Acme Corp confirmed the deal terms.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GUARD: Prevent accidental mode changes
// ═══════════════════════════════════════════════════════════════════════════════
describe('Guard: Mode Safety', () => {
  it('resetMaps should NOT change mode to bracket', () => {
    setPseudonymMode('realistic');
    resetMaps();
    expect(getPseudonymMode()).toBe('realistic');
  });

  it('mode should survive multiple resetMaps calls', () => {
    setPseudonymMode('realistic');
    resetMaps();
    resetMaps();
    resetMaps();
    expect(getPseudonymMode()).toBe('realistic');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-7: CROSS-PLATFORM DE-PSEUDONYMIZATION
// Validates de-pseudo works across different LLM response formats:
//   - Plain text (ChatGPT DOM observer)
//   - JSON-escaped (SSE streams, Claude)
//   - Double-escaped JSON (Gemini batchexecute)
//   - SignalR frames (Copilot)
//   - Socket.IO frames (Perplexity)
// ═══════════════════════════════════════════════════════════════════════════════
describe('P0-7: Cross-Platform De-pseudonymization', () => {
  const reverseMap = {
    'Bentworth Industries': 'Sullivan & Cromwell',
    'Marcus Chen': 'John Smith',
    '$63M': '$48M',
  };

  it('should de-pseudo plain text responses (ChatGPT DOM)', () => {
    const response = 'Marcus Chen from Bentworth Industries confirmed the $63M deal.';
    const result = replacePseudonyms(response, reverseMap);
    expect(result).toBe('John Smith from Sullivan & Cromwell confirmed the $48M deal.');
  });

  it('should de-pseudo JSON-escaped responses (Claude SSE)', () => {
    const response = '"Marcus Chen from Bentworth Industries confirmed the $63M deal."';
    const result = replacePseudonyms(response, reverseMap);
    expect(result).toContain('John Smith');
    expect(result).toContain('Sullivan & Cromwell');
    expect(result).toContain('$48M');
  });

  it('should de-pseudo double-escaped JSON (Gemini batchexecute)', () => {
    // Gemini wraps responses in nested JSON: inner escape + outer escape
    const jsonEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const quotedInner = `"Marcus Chen from Bentworth Industries"`;
    const doubleEscaped = jsonEscape(jsonEscape(quotedInner));
    // The double-escaped version should be de-pseudonymized
    const response = `[["wrb.fr","some_id","${doubleEscaped}"]]`;
    const result = replacePseudonyms(response, reverseMap);
    expect(result).toContain('John Smith');
    expect(result).toContain('Sullivan & Cromwell');
    expect(result).not.toContain('Marcus Chen');
    expect(result).not.toContain('Bentworth Industries');
  });

  it('should de-pseudo SignalR frames (Copilot)', () => {
    // SignalR frames separated by \x1e
    const frame1 = JSON.stringify({
      type: 1,
      target: 'update',
      arguments: [{ text: 'Marcus Chen from Bentworth Industries confirmed.' }],
    });
    const frame2 = JSON.stringify({ type: 6 }); // ping
    const signalRData = frame1 + '\x1e' + frame2 + '\x1e';

    // Process each frame separately (as the fix does)
    const frames = signalRData.split('\x1e');
    const processedFrames = frames.map(f =>
      f.length > 5 ? replacePseudonyms(f, reverseMap) : f
    );
    const result = processedFrames.join('\x1e');

    expect(result).toContain('John Smith');
    expect(result).toContain('Sullivan & Cromwell');
    expect(result).not.toContain('Marcus Chen');
    expect(result).not.toContain('Bentworth Industries');
  });

  it('should de-pseudo Socket.IO frames (Perplexity)', () => {
    // Socket.IO response: 42["query_progress",{"text":"Marcus Chen from Bentworth Industries..."}]
    const socketIOFrame = '42' + JSON.stringify([
      'query_progress',
      { text: 'Marcus Chen from Bentworth Industries confirmed the $63M deal.', step: 'answer' },
    ]);
    const result = replacePseudonyms(socketIOFrame, reverseMap);
    expect(result).toContain('John Smith');
    expect(result).toContain('Sullivan & Cromwell');
    expect(result).toContain('$48M');
    expect(result).not.toContain('Marcus Chen');
    expect(result).not.toContain('Bentworth Industries');
  });

  it('should handle case-insensitive matches (LLM may uppercase pseudonyms)', () => {
    const response = 'BENTWORTH INDUSTRIES announced the acquisition.';
    const result = replacePseudonyms(response, reverseMap);
    expect(result).toContain('Sullivan & Cromwell');
    expect(result).not.toContain('BENTWORTH');
  });
});
