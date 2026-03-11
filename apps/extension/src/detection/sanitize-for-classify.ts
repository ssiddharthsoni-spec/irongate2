/**
 * Sanitize for Classification — Convert pseudonymized text to token format
 *
 * The /v1/classify endpoint expects text with [TYPE_N] tokens:
 *   "[PERSON_1] discussed acquiring [ORG_2] for [AMOUNT_1]"
 *
 * The extension's pseudonymizer creates realistic fakes:
 *   "James Anderson discussed acquiring Northwind Corp for $45M"
 *
 * This module converts pseudonymized text → token format for the classify API.
 */

export interface PseudonymMapping {
  type: string;
  original: string;
  pseudonym: string;
}

export interface SanitizedResult {
  /** Text with [TYPE_N] tokens replacing pseudonyms */
  sanitizedText: string;
  /** Count of each entity type found */
  entityTypeCounts: Record<string, number>;
  /** Total entities replaced */
  totalEntities: number;
}

/**
 * Convert pseudonymized text into token-format text for the classify endpoint.
 *
 * @param pseudonymizedText - Text with fake names/orgs/etc.
 * @param mappings - The pseudonymizer's forward mappings (original → fake)
 * @returns Sanitized text with [TYPE_N] tokens
 */
export function sanitizeForClassification(
  pseudonymizedText: string,
  mappings: PseudonymMapping[],
): SanitizedResult {
  if (!mappings || mappings.length === 0) {
    return {
      sanitizedText: pseudonymizedText,
      entityTypeCounts: {},
      totalEntities: 0,
    };
  }

  const entityTypeCounts: Record<string, number> = {};
  let result = pseudonymizedText;

  // Sort mappings by pseudonym length (longest first) to avoid partial replacements
  const sorted = [...mappings].sort(
    (a, b) => (b.pseudonym?.length ?? 0) - (a.pseudonym?.length ?? 0),
  );

  for (const mapping of sorted) {
    if (!mapping.pseudonym || !mapping.type) continue;

    // Increment counter for this type
    const count = (entityTypeCounts[mapping.type] || 0) + 1;
    entityTypeCounts[mapping.type] = count;

    // Create token: [PERSON_1], [ORG_2], etc.
    const token = `[${mapping.type}_${count}]`;

    // Replace all occurrences of the pseudonym with the token
    // Use a loop instead of replaceAll for broader compatibility
    let idx = result.indexOf(mapping.pseudonym);
    while (idx !== -1) {
      result = result.substring(0, idx) + token + result.substring(idx + mapping.pseudonym.length);
      idx = result.indexOf(mapping.pseudonym, idx + token.length);
    }
  }

  return {
    sanitizedText: result,
    entityTypeCounts,
    totalEntities: sorted.filter(m => m.pseudonym && m.type).length,
  };
}
