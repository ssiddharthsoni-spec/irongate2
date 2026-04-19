/**
 * Session Entity Tracker — Extracted from main-world.ts (Strangler Fig Phase 1)
 *
 * Tracks entities pseudonymized in prior turns so follow-up prompts that
 * reference them (even without re-detecting as PII) get boosted scores.
 * This fixes DEF-016: "follow-up with prior PII scores too low".
 *
 * IMPORTANT: This module runs in MAIN world (page context). No chrome.* APIs.
 */

export interface SessionEntityTracker {
  /** Add an entity to the session registry */
  add(entity: string): void;
  /** Count how many session entities are referenced in the given text */
  countReferences(text: string): number;
  /** Clear all tracked entities (conversation change) */
  clear(): void;
  /** Current size of the registry */
  readonly size: number;
}

export function createSessionEntityTracker(maxSize: number = 500): SessionEntityTracker {
  const entities = new Set<string>();

  return {
    add(entity: string): void {
      if (entity.length < 4) return;
      entities.add(entity);
      // Evict oldest entries if over cap (Set iterates in insertion order)
      if (entities.size > maxSize) {
        const iter = entities.values();
        entities.delete(iter.next().value!);
      }
    },

    countReferences(text: string): number {
      if (entities.size === 0) return 0;
      const textLower = text.toLowerCase();
      let count = 0;
      const counted = new Set<string>();

      for (const entity of entities) {
        const entityLower = entity.toLowerCase();
        // Full entity match
        if (entityLower.length >= 4 && textLower.includes(entityLower)) {
          if (!counted.has(entityLower)) { counted.add(entityLower); count++; }
          continue;
        }
        // Word-level matching: "Sarah Chen" matches if both "sarah" and "chen" appear.
        const words = entityLower.split(/\s+/).filter(w => w.length >= 3);
        if (words.length >= 2) {
          const allWordsPresent = words.every(w => textLower.includes(w));
          if (allWordsPresent && !counted.has(entityLower)) {
            counted.add(entityLower);
            count++;
          }
        }
      }
      return count;
    },

    clear(): void {
      entities.clear();
    },

    get size(): number {
      return entities.size;
    },
  };
}
