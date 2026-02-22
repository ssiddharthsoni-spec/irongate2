/**
 * Local pseudonymizer for the extension.
 * Replaces detected entities with deterministic pseudonyms like [PERSON-1], [SSN-1], etc.
 * Used by the service worker to show "what the LLM would receive" in the sidepanel.
 */

import type { DetectedEntity } from './types';

export interface PseudonymMapping {
  original: string;
  pseudonym: string;
  type: string;
}

export interface PseudonymResult {
  maskedText: string;
  mappings: PseudonymMapping[];
}

/**
 * Replace all detected entities with type-indexed pseudonyms.
 * Entities are processed from end-to-start to preserve string positions.
 */
export function pseudonymizeLocal(text: string, entities: DetectedEntity[]): PseudonymResult {
  if (entities.length === 0) {
    return { maskedText: text, mappings: [] };
  }

  const counters: Record<string, number> = {};
  const mappings: PseudonymMapping[] = [];
  const seen = new Map<string, string>(); // original text -> pseudonym (dedup same value)

  // Sort entities by start position descending so replacements don't shift earlier positions
  const sorted = [...entities].sort((a, b) => b.start - a.start);

  let maskedText = text;

  for (const entity of sorted) {
    const normalizedText = entity.text.trim();

    // Reuse pseudonym if we've seen the same text before
    let pseudonym = seen.get(normalizedText);
    if (!pseudonym) {
      counters[entity.type] = (counters[entity.type] || 0) + 1;
      pseudonym = `[${entity.type}-${counters[entity.type]}]`;
      seen.set(normalizedText, pseudonym);
      mappings.push({
        original: normalizedText,
        pseudonym,
        type: entity.type,
      });
    }

    maskedText = maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
  }

  // Reverse mappings so they're in document order
  mappings.reverse();

  return { maskedText, mappings };
}
