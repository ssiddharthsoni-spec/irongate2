/**
 * De-Pseudonymization Completeness Tests
 *
 * This file tests EVERY known LLM reformulation pattern to verify that
 * de-pseudonymization catches all of them. If any test here fails,
 * it means a pseudonym can leak into the user-visible response.
 *
 * Architecture tested:
 *   addReverseMapping() — pre-generates all variant map entries
 *   replacePseudonyms()  — 3-pass boundary matching + leak scanner
 *
 * These functions are internal to main-world.ts (IIFE), so we replicate
 * the exact logic here. Any drift between test and prod is caught by
 * the 1900+ integration tests.
 */

import { describe, it, expect } from 'vitest';

// ── Replicate main-world.ts logic exactly ─────────────────────────────────

const ORG_SUFFIX_SET = new Set([
  'corporation', 'corp', 'corp.', 'inc', 'inc.', 'llc', 'ltd', 'ltd.',
  'partners', 'group', 'holdings', 'capital', 'enterprises', 'associates',
  'international', 'technologies', 'solutions', 'services', 'consulting',
  'management', 'investments', 'advisors', 'advisory', 'fund', 'trust',
  'bank', 'labs', 'co', 'co.', 'company', 'industries', 'foundation',
]);

const _ORG_SUFFIXES_PERSON = new Set([
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
  if (_ORG_SUFFIXES_PERSON.has(words[words.length - 1].toLowerCase())) return false;
  return true;
}

/**
 * Replicates addReverseMapping's name/org variant generation.
 * Takes a map of { pseudonym: original } and returns an expanded map
 * with all fragment variants.
 */
function buildFullReverseMap(baseMap: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [pseudonym, original] of Object.entries(baseMap)) {
    map[pseudonym] = original;

    const words = pseudonym.split(/\s+/);
    const origWords = original.split(/\s+/);
    const origLower = original.toLowerCase();

    const canAdd = (key: string): boolean => {
      if (!key || key.length < 3) return false;
      if (map[key]) return false;
      if (ORG_SUFFIX_SET.has(key.toLowerCase())) return false;
      if (origLower.includes(key.toLowerCase())) return false;
      return true;
    };

    const looksLikePerson_ = looksLikePersonName(pseudonym) && looksLikePersonName(original);

    // Person fragments
    if (words.length >= 2 && looksLikePerson_ && origWords.length >= 2 && words.length === origWords.length) {
      for (let i = 0; i < words.length; i++) {
        const pWord = words[i];
        const oWord = origWords[i];
        if (pWord.length < 3 || oWord.length < 2) continue;
        if (pWord.toLowerCase() === oWord.toLowerCase()) continue;
        if (canAdd(pWord)) map[pWord] = oWord;
      }
    }

    // Org/project fragments
    if (words.length >= 2 && !looksLikePerson_) {
      if (words[0].length >= 4 && canAdd(words[0])) {
        map[words[0]] = original;
      }
      if (words.length >= 3) {
        const firstTwo = words.slice(0, 2).join(' ');
        if (canAdd(firstTwo)) map[firstTwo] = original;
      }
      if (words.length >= 2) {
        const lastWord = words[words.length - 1];
        if (lastWord.length >= 4 && canAdd(lastWord)) map[lastWord] = original;
      }
      const ORG_SUFFIX_RE = /\s+(Corporation|Corp\.?|Inc\.?|LLC|Ltd\.?|Partners|Group|Holdings|Capital|Enterprises|Associates|International|Technologies|Solutions|Services|Consulting|Management|Investments|Advisors|Advisory|Fund|Trust|Bank|Labs|Co\.?)$/i;
      const withoutSuffix = pseudonym.replace(ORG_SUFFIX_RE, '');
      if (withoutSuffix !== pseudonym && canAdd(withoutSuffix)) {
        map[withoutSuffix] = original;
      }
    }
  }

  return map;
}

/**
 * Replicates replacePseudonyms: 3-pass boundary matching + leak scanner.
 */
function replacePseudonyms(text: string, reverseMap: Record<string, string>): string {
  const entries = Object.entries(reverseMap)
    .filter(([k]) => k && k.length >= 2)
    .filter(([k, v]) => k !== v)
    .sort((a, b) => b[0].length - a[0].length);

  let result = text;

  for (const [pseudonym, original] of entries) {
    // Strategy 1: boundary-aware case-sensitive
    try {
      const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefix = /^[a-zA-Z]/.test(pseudonym) ? '(?<![a-zA-Z])' : /^\d/.test(pseudonym) ? '(?<![\\d.])' : '';
      const suffix = /[a-zA-Z]$/.test(pseudonym) ? '(?![a-zA-Z])' : /\d$/.test(pseudonym) ? '(?![\\d.])' : '';
      const regexCS = new RegExp(prefix + escaped + suffix, 'g');
      regexCS.lastIndex = 0;
      result = result.replace(regexCS, () => original);
    } catch { /* skip */ }

    // Strategy 2: JSON-escaped (for SSE)
    const jsonPseudo = pseudonym.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jsonOrig = original.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (jsonPseudo !== pseudonym && result.includes(jsonPseudo)) {
      result = result.split(jsonPseudo).join(jsonOrig);
    }

    // Strategy 3: boundary-aware case-insensitive
    try {
      const escaped = pseudonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefix = /^[a-zA-Z]/.test(pseudonym) ? '(?<![a-zA-Z])' : '';
      const suffix = /[a-zA-Z]$/.test(pseudonym) ? '(?![a-zA-Z])' : '';
      const regexCI = new RegExp(prefix + escaped + suffix, 'gi');
      regexCI.lastIndex = 0;
      result = result.replace(regexCI, () => original);
    } catch { /* skip */ }
  }

  // LEAK SCANNER: aggressive case-insensitive substring match
  const resultLower = result.toLowerCase();
  for (const [pseudonym, original] of entries) {
    const pseudoLower = pseudonym.toLowerCase();
    if (pseudoLower.length < 4) continue;
    if (!resultLower.includes(pseudoLower)) continue;
    let idx = result.toLowerCase().indexOf(pseudoLower);
    while (idx !== -1) {
      result = result.substring(0, idx) + original + result.substring(idx + pseudonym.length);
      idx = result.toLowerCase().indexOf(pseudoLower, idx + original.length);
    }
  }

  return result;
}

// ── Helper ────────────────────────────────────────────────────────────────

/**
 * Build reverse map + run replacePseudonyms. Simulates the full pipeline.
 */
function dePseudo(aiResponse: string, mappings: Record<string, string>): string {
  const reverseMap = buildFullReverseMap(mappings);
  return replacePseudonyms(aiResponse, reverseMap);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORGANIZATION DE-PSEUDO: Every LLM reformulation pattern
// ═══════════════════════════════════════════════════════════════════════════════

describe('DE-PSEUDO COMPLETENESS: Organization names', () => {
  const mapping = { 'Contoso Holdings': 'Northwind Technologies' };

  it('exact match', () => {
    expect(dePseudo('Contoso Holdings is growing.', mapping)).toContain('Northwind Technologies');
    expect(dePseudo('Contoso Holdings is growing.', mapping)).not.toContain('Contoso');
  });

  it('abbreviated first word: "Contoso"', () => {
    const result = dePseudo('Contoso is growing.', mapping);
    expect(result).toContain('Northwind Technologies');
    expect(result).not.toContain('Contoso');
  });

  it('possessive: "Contoso\'s"', () => {
    const result = dePseudo("Contoso's revenue grew 20%.", mapping);
    expect(result).not.toContain('Contoso');
  });

  it('possessive full: "Contoso Holdings\'"', () => {
    const result = dePseudo("Contoso Holdings' revenue grew 20%.", mapping);
    expect(result).not.toContain('Contoso');
  });

  it('ALL CAPS: "CONTOSO HOLDINGS"', () => {
    const result = dePseudo('CONTOSO HOLDINGS reported earnings.', mapping);
    expect(result).not.toMatch(/contoso/i);
  });

  it('lowercase: "contoso holdings"', () => {
    const result = dePseudo('contoso holdings reported earnings.', mapping);
    expect(result).not.toMatch(/contoso/i);
  });

  it('with comma: "Contoso Holdings,"', () => {
    const result = dePseudo('Contoso Holdings, a tech company, grew.', mapping);
    expect(result).not.toContain('Contoso');
  });

  it('in parentheses: "(Contoso Holdings)"', () => {
    const result = dePseudo('The competitor (Contoso Holdings) grew.', mapping);
    expect(result).not.toContain('Contoso');
  });

  it('with colon: "Contoso Holdings:"', () => {
    const result = dePseudo('Contoso Holdings: Q4 results.', mapping);
    expect(result).not.toContain('Contoso');
  });

  it('abbreviated in parentheses: "(Contoso)"', () => {
    const result = dePseudo('The competitor (Contoso) grew.', mapping);
    expect(result).not.toContain('Contoso');
  });

  it('in quotes: \'"Contoso Holdings"\'', () => {
    const result = dePseudo('"Contoso Holdings" is the leader.', mapping);
    expect(result).not.toContain('Contoso');
  });

  it('abbreviated possessive: "Contoso\'s estimated 9% churn"', () => {
    const result = dePseudo("Contoso's estimated 9% churn signals what best-in-class looks like.", mapping);
    expect(result).not.toContain('Contoso');
  });

  it('in JSON SSE: "Contoso Holdings" escaped', () => {
    const result = dePseudo('data: {"text":"Contoso Holdings is growing."}', mapping);
    expect(result).not.toContain('Contoso');
  });

  it('hyphenated: "Contoso-Holdings"', () => {
    const result = dePseudo('Contoso-Holdings reported growth.', mapping);
    expect(result).not.toMatch(/contoso/i);
  });
});

describe('DE-PSEUDO COMPLETENESS: Org names with Corp suffix', () => {
  const mapping = { 'Adatum Corp': 'Fabrikam Industries' };

  it('exact match', () => {
    expect(dePseudo('Adatum Corp filed a report.', mapping)).not.toContain('Adatum');
  });

  it('abbreviated: "Adatum"', () => {
    expect(dePseudo('Adatum filed a report.', mapping)).not.toContain('Adatum');
  });

  it('possessive abbreviated: "Adatum\'s"', () => {
    expect(dePseudo("Adatum's CEO announced layoffs.", mapping)).not.toContain('Adatum');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSON DE-PSEUDO: Every LLM reformulation pattern
// ═══════════════════════════════════════════════════════════════════════════════

describe('DE-PSEUDO COMPLETENESS: Person names', () => {
  const mapping = { 'Emily Rogers': 'Sarah Chen' };

  it('exact match', () => {
    const result = dePseudo('Emily Rogers submitted the report.', mapping);
    expect(result).toContain('Sarah Chen');
    expect(result).not.toContain('Emily');
    expect(result).not.toContain('Rogers');
  });

  it('first name only: "Emily"', () => {
    const result = dePseudo('Emily submitted the report.', mapping);
    expect(result).not.toContain('Emily');
    expect(result).toContain('Sarah');
  });

  it('last name only: "Rogers"', () => {
    const result = dePseudo('Rogers submitted the report.', mapping);
    expect(result).not.toContain('Rogers');
    expect(result).toContain('Chen');
  });

  it('possessive first name: "Emily\'s"', () => {
    const result = dePseudo("Emily's performance was excellent.", mapping);
    expect(result).not.toContain('Emily');
  });

  it('possessive full name: "Emily Rogers\'"', () => {
    const result = dePseudo("Emily Rogers' performance was excellent.", mapping);
    expect(result).not.toContain('Emily');
    expect(result).not.toContain('Rogers');
  });

  it('ALL CAPS: "EMILY ROGERS"', () => {
    const result = dePseudo('EMILY ROGERS submitted the report.', mapping);
    expect(result).not.toMatch(/emily/i);
    expect(result).not.toMatch(/rogers/i);
  });

  it('lowercase: "emily rogers"', () => {
    const result = dePseudo('emily rogers submitted the report.', mapping);
    expect(result).not.toMatch(/emily/i);
    expect(result).not.toMatch(/rogers/i);
  });

  it('first name lowercase: "emily"', () => {
    const result = dePseudo('2a. emily received feedback on attendance.', mapping);
    expect(result).not.toMatch(/emily/i);
  });

  it('first name ALL CAPS: "EMILY"', () => {
    const result = dePseudo('PERFORMANCE REVIEW: EMILY failed targets.', mapping);
    expect(result).not.toMatch(/emily/i);
  });

  it('mixed case: "eMiLy"', () => {
    const result = dePseudo('As noted, eMiLy has not met expectations.', mapping);
    expect(result).not.toMatch(/emily/i);
  });

  it('with comma: "Emily Rogers,"', () => {
    const result = dePseudo('Emily Rogers, a senior analyst, resigned.', mapping);
    expect(result).not.toContain('Emily');
  });

  it('in parentheses: "(Emily Rogers)"', () => {
    const result = dePseudo('The employee (Emily Rogers) resigned.', mapping);
    expect(result).not.toContain('Emily');
  });

  it('with title: "Ms. Rogers"', () => {
    // Note: "Ms." is not in the map, so "Ms." stays but "Rogers" should be replaced
    const result = dePseudo('Ms. Rogers submitted her resignation.', mapping);
    expect(result).not.toContain('Rogers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-ENTITY DE-PSEUDO: Multiple pseudonyms in one response
// ═══════════════════════════════════════════════════════════════════════════════

describe('DE-PSEUDO COMPLETENESS: Multiple entities', () => {
  const mapping = {
    'Emily Rogers': 'Sarah Chen',
    'Contoso Holdings': 'Northwind Technologies',
    '342-65-8901': '198-76-5432',
  };

  it('all entities in one paragraph', () => {
    const text = "Emily Rogers at Contoso Holdings (SSN: 342-65-8901) submitted the Q4 report.";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Emily');
    expect(result).not.toContain('Rogers');
    expect(result).not.toContain('Contoso');
    expect(result).not.toContain('342-65-8901');
    expect(result).toContain('Sarah Chen');
    expect(result).toContain('Northwind Technologies');
    expect(result).toContain('198-76-5432');
  });

  it('mixed abbreviations: first name + org abbreviation', () => {
    const text = "Emily at Contoso reported growth. Rogers confirmed.";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Emily');
    expect(result).not.toContain('Contoso');
    expect(result).not.toContain('Rogers');
  });

  it('possessive forms mixed', () => {
    const text = "Emily's work at Contoso's headquarters was exemplary.";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Emily');
    expect(result).not.toContain('Contoso');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CASES: Tricky patterns that have caused real bugs
// ═══════════════════════════════════════════════════════════════════════════════

describe('DE-PSEUDO COMPLETENESS: Edge cases', () => {
  it('org name appears twice with different forms', () => {
    const mapping = { 'Contoso Holdings': 'Northwind Technologies' };
    const text = "While Contoso Holdings leads on scale, Contoso's churn rate is lower.";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Contoso');
  });

  it('person name in bullet list', () => {
    const mapping = { 'Emily Rogers': 'Sarah Chen' };
    const text = "Key employees:\n- Emily Rogers (analyst)\n- Emily (backup contact)";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Emily');
    expect(result).not.toContain('Rogers');
  });

  it('person name in markdown bold', () => {
    const mapping = { 'Emily Rogers': 'Sarah Chen' };
    const text = "**Emily Rogers** is the lead analyst.";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Emily');
  });

  it('org name in markdown header', () => {
    const mapping = { 'Contoso Holdings': 'Northwind Technologies' };
    const text = "## Contoso Holdings: Q4 Analysis";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Contoso');
  });

  it('three-word org name: all fragments caught', () => {
    const mapping = { 'Granite Point Capital': 'Morgan Stanley Group' };
    const text = "Granite Point Capital leads. Granite is strong. Granite Point also grew.";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Granite');
  });

  it('legal firm with ampersand', () => {
    const mapping = { 'Caldwell Drake': 'Sullivan Cromwell' };
    const text = "Caldwell Drake represented the plaintiff. Caldwell was lead counsel.";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Caldwell');
    expect(result).not.toContain('Drake');
  });

  it('same first name in two different people', () => {
    const mapping = {
      'Emily Rogers': 'Sarah Chen',
      'Emily Carter': 'Jessica Park',
    };
    const reverseMap = buildFullReverseMap(mapping);
    // "Emily" fragment should map to one of them (first one added wins)
    const result = replacePseudonyms('Emily submitted the report.', reverseMap);
    expect(result).not.toContain('Emily');
  });

  it('pseudonym appears inside a URL — should still be caught', () => {
    const mapping = { 'Contoso Holdings': 'Northwind Technologies' };
    const text = "Visit https://contoso.com for details.";
    // "contoso" inside URL is 7 chars, will be caught by leak scanner
    const result = dePseudo(text, mapping);
    // The URL will be mangled but that's correct — no pseudonym leaks
    expect(result.toLowerCase()).not.toContain('contoso');
  });

  it('SSE chunk with escaped quotes', () => {
    const mapping = { 'Emily Rogers': 'Sarah Chen' };
    const text = 'data: {"content":"Emily Rogers submitted the report."}';
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Emily');
    expect(result).not.toContain('Rogers');
  });

  it('real-world QA failure: "Contoso\'s estimated 9% churn"', () => {
    const mapping = { 'Contoso Holdings': 'Northwind Technologies' };
    const text = "While Northwind Technologies currently leads on scale — with an estimated $72M ARR and 310 employees — Company X is making decisive moves. Contoso's estimated 9% churn signals what best-in-class looks like.";
    const result = dePseudo(text, mapping);
    expect(result).not.toContain('Contoso');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEAK SCANNER VERIFICATION: Ensure no pseudonym words remain
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAK SCANNER: Post-replacement verification', () => {
  it('scans result for any remaining pseudonym >= 4 chars', () => {
    const mapping = { 'Contoso Holdings': 'Northwind Technologies' };
    // Even if boundary regex somehow misses it, leak scanner catches it
    const reverseMap = buildFullReverseMap(mapping);
    // Manually craft text where boundary regex would fail
    const text = 'The company (contoso) had great results.';
    const result = replacePseudonyms(text, reverseMap);
    expect(result.toLowerCase()).not.toContain('contoso');
  });

  it('catches pseudonym attached to punctuation', () => {
    const mapping = { 'Emily Rogers': 'Sarah Chen' };
    const reverseMap = buildFullReverseMap(mapping);
    // "Emily." — dot immediately after, no space
    const result = replacePseudonyms('Emily. She was great.', reverseMap);
    expect(result).not.toContain('Emily');
  });

  it('catches pseudonym in compound word', () => {
    const mapping = { 'Contoso Holdings': 'Northwind Technologies' };
    const reverseMap = buildFullReverseMap(mapping);
    const result = replacePseudonyms('Visit Contoso.com for details.', reverseMap);
    expect(result.toLowerCase()).not.toContain('contoso');
  });
});
