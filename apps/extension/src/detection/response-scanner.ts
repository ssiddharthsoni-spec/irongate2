/**
 * Response Scanner — Contextual Intelligence Engine Layer 7
 *
 * Scans AI model responses for entities that should have been
 * pseudonymized but leaked through. This catches cases where:
 *
 * 1. The pseudonymizer missed an entity variant (e.g., first name only
 *    when full name was pseudonymized)
 * 2. The AI model inferred real entities from context and included
 *    them in the response despite receiving pseudonymized input
 * 3. Entity re-identification from cross-referencing pseudonymized data
 *
 * This is a post-hoc safety net — runs on the response AFTER
 * de-pseudonymization, comparing against the original entities
 * that were detected in the prompt.
 *
 * Light-weight: only checks response text against known entity strings
 * from the current session's reverse map. No regex detection needed.
 */

export interface ResponseScanResult {
  /** Whether any leaks were detected */
  hasLeaks: boolean;
  /** Entity strings that appeared in the response but shouldn't have */
  leakedEntities: LeakedEntity[];
  /** Total number of leaks found */
  leakCount: number;
}

export interface LeakedEntity {
  /** The entity text that leaked */
  text: string;
  /** The entity type (if known from the reverse map) */
  type: string;
  /** Position in the response where the leak was found */
  position: number;
}

/**
 * Scan an AI response for leaked entities.
 *
 * @param responseText - The AI model's response text (post de-pseudonymization)
 * @param knownEntities - Map of original entity text → entity type from the prompt
 * @param pseudonyms - Set of pseudonym strings (to exclude from leak detection —
 *                     pseudonyms appearing in response are EXPECTED)
 */
export function scanResponse(
  responseText: string,
  knownEntities: Map<string, string>,
  pseudonyms?: Set<string>,
): ResponseScanResult {
  if (!responseText || knownEntities.size === 0) {
    return { hasLeaks: false, leakedEntities: [], leakCount: 0 };
  }

  const leakedEntities: LeakedEntity[] = [];
  const lowerResponse = responseText.toLowerCase();

  for (const [entityText, entityType] of knownEntities) {
    // Skip very short entities (< 4 chars) — too many false positives
    if (entityText.length < 4) continue;

    // Skip if this is actually a pseudonym (expected in response)
    if (pseudonyms?.has(entityText)) continue;

    // Case-insensitive search
    const lowerEntity = entityText.toLowerCase();
    let searchStart = 0;

    // Find all occurrences (cap at 5 per entity to avoid DoS on repeated text)
    let found = 0;
    while (found < 5) {
      const idx = lowerResponse.indexOf(lowerEntity, searchStart);
      if (idx === -1) break;

      leakedEntities.push({
        text: entityText,
        type: entityType,
        position: idx,
      });
      found++;
      searchStart = idx + lowerEntity.length;
    }
  }

  return {
    hasLeaks: leakedEntities.length > 0,
    leakedEntities,
    leakCount: leakedEntities.length,
  };
}
