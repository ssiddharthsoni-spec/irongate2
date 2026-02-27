/**
 * Shared Pseudonymizer Module
 *
 * Unified entry point for pseudonymization and de-pseudonymization.
 * Wraps the detection/pseudonymizer with clean APIs.
 */

export type { PseudonymMapping, PseudonymResult } from '../detection/pseudonymizer';
export { pseudonymizeLocal } from '../detection/pseudonymizer';

import type { DetectedEntity } from '../detection/types';
import type { PseudonymMapping, PseudonymResult } from '../detection/pseudonymizer';
import { pseudonymizeLocal } from '../detection/pseudonymizer';

/**
 * Pseudonymize detected entities in text.
 * Replaces sensitive values with type-indexed tokens like [PERSON-1], [SSN-1].
 * Returns masked text and a mapping array for reversal.
 */
export function pseudonymize(text: string, entities: DetectedEntity[]): PseudonymResult {
  return pseudonymizeLocal(text, entities);
}

/**
 * De-pseudonymize text by replacing pseudonym tokens with original values.
 * Uses the reverse mapping from a prior pseudonymize() call.
 */
export function depseudonymize(
  text: string,
  reverseMap: PseudonymMapping[] | Record<string, string>
): string {
  // Accept either an array of PseudonymMapping or a plain {pseudonym: original} map
  if (Array.isArray(reverseMap)) {
    let result = text;
    for (const mapping of reverseMap) {
      result = result.replaceAll(mapping.pseudonym, mapping.original);
    }
    return result;
  }

  // Plain object map: key = pseudonym, value = original
  let result = text;
  for (const [pseudonym, original] of Object.entries(reverseMap)) {
    result = result.replaceAll(pseudonym, original);
  }
  return result;
}

/**
 * Pseudonymize with same-byte-length replacements for WebSocket interception.
 * Ensures the masked text is the exact same byte length as the original
 * to avoid breaking binary protocol framing.
 */
export function pseudonymizeSameLength(
  text: string,
  entities: DetectedEntity[]
): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [] };
  }

  const counters: Record<string, number> = {};
  const mappings: PseudonymMapping[] = [];
  const seen = new Map<string, string>();

  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let maskedText = text;

  for (const entity of sorted) {
    const normalizedText = entity.text.trim();
    let pseudonym = seen.get(normalizedText);

    if (!pseudonym) {
      counters[entity.type] = (counters[entity.type] || 0) + 1;
      const tag = `[${entity.type}-${counters[entity.type]}]`;

      // Pad or truncate to match original byte length
      const originalLen = new TextEncoder().encode(entity.text).length;
      const tagBytes = new TextEncoder().encode(tag);

      if (tagBytes.length <= originalLen) {
        // Pad with spaces
        pseudonym = tag + ' '.repeat(originalLen - tagBytes.length);
      } else {
        // Truncate tag and close bracket
        const truncated = new TextDecoder().decode(tagBytes.slice(0, originalLen - 1));
        pseudonym = truncated + ']';
      }

      seen.set(normalizedText, pseudonym);
      mappings.push({ original: normalizedText, pseudonym: pseudonym.trim(), type: entity.type });
    }

    maskedText = maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
  }

  mappings.reverse();
  return { maskedText, mappings };
}
