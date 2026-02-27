/**
 * Client Matter Isolation — Priority 10.2
 *
 * Detects when a prompt references entities from two different client matters.
 * Shows a warning to prevent cross-matter contamination.
 */

export interface MatterDefinition {
  id: string;
  name: string;
  clientName: string;
  aliases: string[];
  parties: string[];
  matterNumber?: string;
}

export interface CrossMatterWarning {
  matterA: MatterDefinition;
  matterB: MatterDefinition;
  matchesA: string[];
  matchesB: string[];
  message: string;
}

/**
 * Check if a prompt references entities from multiple client matters.
 */
export function detectCrossMatterReference(
  text: string,
  matters: MatterDefinition[]
): CrossMatterWarning | null {
  if (matters.length < 2) return null;

  const lowerText = text.toLowerCase();
  const matchedMatters: Array<{ matter: MatterDefinition; matches: string[] }> = [];

  for (const matter of matters) {
    const matches: string[] = [];

    // Check client name
    if (lowerText.includes(matter.clientName.toLowerCase())) {
      matches.push(matter.clientName);
    }

    // Check aliases
    for (const alias of matter.aliases) {
      if (alias.length >= 3 && lowerText.includes(alias.toLowerCase())) {
        matches.push(alias);
      }
    }

    // Check parties
    for (const party of matter.parties) {
      if (party.length >= 3 && lowerText.includes(party.toLowerCase())) {
        matches.push(party);
      }
    }

    // Check matter number
    if (matter.matterNumber && text.includes(matter.matterNumber)) {
      matches.push(matter.matterNumber);
    }

    if (matches.length > 0) {
      matchedMatters.push({ matter, matches });
    }
  }

  // If 2+ different matters are referenced, warn
  if (matchedMatters.length >= 2) {
    const [a, b] = matchedMatters;
    return {
      matterA: a.matter,
      matterB: b.matter,
      matchesA: a.matches,
      matchesB: b.matches,
      message: `This prompt references both "${a.matter.name}" and "${b.matter.name}". These are separate client matters. Continuing may create a conflict.`,
    };
  }

  return null;
}
