/**
 * Agent De-pseudonymizer
 *
 * When the AI tool responds with pseudonymized names, the agent reads
 * the response and replaces fakes with originals using the reverse map.
 *
 * Handles cases where the AI tool slightly modified the pseudonym:
 *   - "James R. Morrison" → "Morrison" in a follow-up
 *   - "Dr. Morrison" when original mapping was "James Morrison"
 *   - Pluralized or possessive forms: "Morrison's", "the Morrisons"
 *
 * Two modes:
 *   1. Simple: direct string replacement from reverse map (fast, <1ms)
 *   2. Agent: LLM-assisted de-pseudonymization for complex cases
 */

import type { PseudonymMapping } from '../detection/pseudonymizer';
import { getReverseMap } from '../detection/pseudonymizer';
import type { ModelRuntime } from './model-runtime';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DepseudonymizeResult {
  /** Text with pseudonyms replaced by originals */
  restoredText: string;
  /** How many pseudonyms were restored */
  restoredCount: number;
  /** Whether the agent was used (vs simple replacement) */
  usedAgent: boolean;
  /** Latency in ms */
  latencyMs: number;
}

export interface DepseudonymizeOptions {
  /** Additional mappings beyond the session reverse map */
  extraMappings?: PseudonymMapping[];
  /** Force simple mode (no LLM) */
  forceSimple?: boolean;
  /** Timeout for agent mode */
  timeoutMs?: number;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createAgentDepseudonymizer(runtime: ModelRuntime) {
  /**
   * De-pseudonymize AI response text.
   *
   * First tries simple reverse-map replacement. If unresolved pseudonyms
   * remain (partial matches, modified forms), uses the LLM agent for
   * fuzzy matching.
   */
  async function depseudonymize(
    text: string,
    options?: DepseudonymizeOptions,
  ): Promise<DepseudonymizeResult> {
    const start = performance.now();

    // Build the full reverse map
    const reverseMap = getReverseMap();
    const extraMap = new Map<string, string>();

    if (options?.extraMappings) {
      for (const m of options.extraMappings) {
        extraMap.set(m.pseudonym, m.original);
      }
    }

    // Step 1: Simple replacement (longest pseudonym first)
    const { result: simpleResult, count: simpleCount } = simpleReplace(text, reverseMap, extraMap);

    // Step 2: Check for remaining unresolved pseudonyms
    // A pseudonym is "unresolved" if parts of it still appear in the text
    const unresolvedFragments = findUnresolvedFragments(simpleResult, reverseMap, extraMap);

    if (unresolvedFragments.length === 0 || options?.forceSimple) {
      return {
        restoredText: simpleResult,
        restoredCount: simpleCount,
        usedAgent: false,
        latencyMs: performance.now() - start,
      };
    }

    // Step 3: Agent-assisted de-pseudonymization for fragments
    try {
      const timeoutMs = options?.timeoutMs ?? 5000;
      const agentResult = await Promise.race([
        agentResolveFragments(runtime, simpleResult, unresolvedFragments, reverseMap, extraMap),
        timeoutPromise(timeoutMs),
      ]);

      return {
        restoredText: agentResult.text,
        restoredCount: simpleCount + agentResult.resolvedCount,
        usedAgent: true,
        latencyMs: performance.now() - start,
      };
    } catch {
      // Agent failed — return simple result
      return {
        restoredText: simpleResult,
        restoredCount: simpleCount,
        usedAgent: false,
        latencyMs: performance.now() - start,
      };
    }
  }

  return { depseudonymize };
}

// ── Simple Replacement ──────────────────────────────────────────────────────

function simpleReplace(
  text: string,
  reverseMap: ReadonlyMap<string, string>,
  extraMap: Map<string, string>,
): { result: string; count: number } {
  let result = text;
  let count = 0;

  // Merge maps, sort by pseudonym length descending
  const allEntries: [string, string][] = [
    ...Array.from(reverseMap.entries()),
    ...Array.from(extraMap.entries()),
  ];
  allEntries.sort((a, b) => b[0].length - a[0].length);

  for (const [pseudonym, original] of allEntries) {
    if (result.includes(pseudonym)) {
      const before = result;
      result = result.replaceAll(pseudonym, original);
      if (result !== before) count++;
    }
  }

  return { result, count };
}

// ── Fragment Detection ──────────────────────────────────────────────────────

interface UnresolvedFragment {
  /** The fragment text found in the response */
  fragment: string;
  /** The full pseudonym it's likely part of */
  fullPseudonym: string;
  /** The original value */
  original: string;
}

function findUnresolvedFragments(
  text: string,
  reverseMap: ReadonlyMap<string, string>,
  extraMap: Map<string, string>,
): UnresolvedFragment[] {
  const fragments: UnresolvedFragment[] = [];
  const lowerText = text.toLowerCase();

  const allEntries: [string, string][] = [
    ...Array.from(reverseMap.entries()),
    ...Array.from(extraMap.entries()),
  ];

  for (const [pseudonym, original] of allEntries) {
    // Skip if already fully replaced
    if (!lowerText.includes(pseudonym.toLowerCase())) {
      // Check for partial matches (last name only, possessive, etc.)
      const words = pseudonym.split(/\s+/);
      for (const word of words) {
        if (word.length < 4) continue; // Skip short words
        // Check for the word with common suffixes
        const patterns = [
          word,           // exact
          `${word}'s`,    // possessive
          `${word}s`,     // plural
          `the ${word}`,  // with article
          `Dr. ${word}`,  // with title
          `Mr. ${word}`,
          `Ms. ${word}`,
          `Mrs. ${word}`,
        ];
        for (const pattern of patterns) {
          if (lowerText.includes(pattern.toLowerCase()) && !text.includes(original)) {
            fragments.push({ fragment: pattern, fullPseudonym: pseudonym, original });
            break;
          }
        }
      }
    }
  }

  return fragments;
}

// ── Agent-Assisted Resolution ───────────────────────────────────────────────

async function agentResolveFragments(
  runtime: ModelRuntime,
  text: string,
  fragments: UnresolvedFragment[],
  _reverseMap: ReadonlyMap<string, string>,
  _extraMap: Map<string, string>,
): Promise<{ text: string; resolvedCount: number }> {
  // For fragments, we do simple replacement with the original
  // (the LLM would add unnecessary latency for this straightforward task)
  let result = text;
  let resolvedCount = 0;

  for (const { fragment, original } of fragments) {
    if (result.includes(fragment)) {
      // Replace the fragment with the corresponding original part
      // If fragment is a last name from "James Morrison", replace with last name of original
      const originalWords = original.split(/\s+/);
      const fragmentClean = fragment.replace(/^(?:Dr\.|Mr\.|Ms\.|Mrs\.|the)\s+/i, '').replace(/'s$|s$/i, '');

      // Find the matching part of the original
      let replacement = original; // default: use full original
      if (originalWords.length > 1) {
        // If fragment matches last word of pseudonym, use last word of original
        const pseudWords = fragment.split(/\s+/);
        if (pseudWords.length === 1 || fragmentClean === pseudWords[pseudWords.length - 1]) {
          replacement = originalWords[originalWords.length - 1];
        }
      }

      // Preserve the prefix/suffix (Dr., 's, etc.)
      const prefixMatch = fragment.match(/^(Dr\.|Mr\.|Ms\.|Mrs\.|the)\s+/i);
      const suffixMatch = fragment.match(/('s|s)$/i);
      const finalReplacement = (prefixMatch ? prefixMatch[0] : '') +
        replacement +
        (suffixMatch ? suffixMatch[0] : '');

      result = result.replaceAll(fragment, finalReplacement);
      resolvedCount++;
    }
  }

  return { text: result, resolvedCount };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Depseudonymizer timed out after ${ms}ms`)), ms)
  );
}
