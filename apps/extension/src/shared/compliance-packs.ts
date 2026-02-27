/**
 * Industry Compliance Packs — Priority 9
 *
 * Custom entity type definitions for Legal, Healthcare, and Financial verticals.
 * Each pack defines regex patterns, confidence scores, and risk weights.
 * These are loaded alongside the built-in 21 entity types via the policy engine.
 */

import type { DetectedEntity } from '../detection/types';

// ─── 9.1 Custom Entity Type System ─────────────────────────────────────────

export interface CustomEntityDefinition {
  name: string;
  pattern: RegExp;
  confidence: number;
  weight: number;
  category: string;
  description?: string;
}

export interface CompliancePack {
  id: string;
  name: string;
  description: string;
  entities: CustomEntityDefinition[];
  /** Co-occurrence boost rules specific to this pack */
  boostRules?: BoostRule[];
}

export interface BoostRule {
  /** If this entity type is found... */
  triggerType: string;
  /** ...boost all entities in the same prompt by this multiplier */
  multiplier: number;
  description: string;
}

/**
 * Detect entities using custom entity definitions from a compliance pack.
 */
export function detectCustomEntities(
  text: string,
  definitions: CustomEntityDefinition[]
): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  for (const def of definitions) {
    const pattern = new RegExp(def.pattern.source, def.pattern.flags);
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      entities.push({
        type: def.name,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: def.confidence,
        source: 'regex',
      });
    }
  }

  return entities.sort((a, b) => a.start - b.start);
}

/**
 * Apply boost rules from a compliance pack.
 * Returns a score multiplier if any trigger types are found.
 */
export function applyBoostRules(
  entities: DetectedEntity[],
  rules: BoostRule[]
): { multiplier: number; explanations: string[] } {
  const types = new Set(entities.map((e) => e.type));
  let multiplier = 1.0;
  const explanations: string[] = [];

  for (const rule of rules) {
    if (types.has(rule.triggerType)) {
      multiplier = Math.max(multiplier, rule.multiplier);
      explanations.push(rule.description);
    }
  }

  return { multiplier, explanations };
}

// ─── 9.2 Legal Pack ─────────────────────────────────────────────────────────

export const LEGAL_PACK: CompliancePack = {
  id: 'legal',
  name: 'Legal Pack',
  description: 'Entity types for law firms and legal departments',
  entities: [
    {
      name: 'MATTER_NUMBER',
      pattern: /\b(?:\d{4}[-./]\d{3,6}|(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d{2,4}[-./]\d{3,6})\b/gi,
      confidence: 0.85,
      weight: 20,
      category: 'legal',
      description: 'Firm-specific matter numbers (e.g., 2024-001234)',
    },
    {
      name: 'CASE_CITATION',
      pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+v\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*\d{1,4}\s+[A-Z][a-z.]+\s*(?:\d+[a-z]*\s*)+\d+)?\b/g,
      confidence: 0.9,
      weight: 15,
      category: 'legal',
      description: 'Case citations (e.g., Smith v. Jones, 123 F.3d 456)',
    },
    {
      name: 'PRIVILEGE_MARKER',
      pattern: /\b(?:attorney[- ]client\s+privilege|work\s+product(?:\s+doctrine)?|privileged\s+and\s+confidential|without\s+prejudice|protected\s+communication|legal\s+professional\s+privilege)\b/gi,
      confidence: 0.95,
      weight: 30,
      category: 'legal',
      description: 'Privilege markers indicating protected communication',
    },
    {
      name: 'COURT_FILING',
      pattern: /\b(?:case\s+no\.?\s*)?(?:\d{1,2}:)?\d{2,4}[-](?:cv|cr|mc|mj)[-]\d{3,6}(?:[-]\w+)?\b/gi,
      confidence: 0.85,
      weight: 20,
      category: 'legal',
      description: 'Court filing numbers (e.g., 1:24-cv-01234)',
    },
    {
      name: 'OPPOSING_COUNSEL',
      pattern: /\b(?:counsel\s+for\s+(?:the\s+)?(?:defendant|plaintiff|respondent|petitioner|appellee|appellant))\s*:?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/gi,
      confidence: 0.8,
      weight: 15,
      category: 'legal',
      description: 'Opposing counsel names',
    },
    {
      name: 'BAR_NUMBER',
      pattern: /\b(?:bar\s+(?:no\.?|number|#)\s*)\d{4,8}\b/gi,
      confidence: 0.85,
      weight: 15,
      category: 'legal',
      description: 'Attorney bar numbers',
    },
  ],
  boostRules: [
    {
      triggerType: 'PRIVILEGE_MARKER',
      multiplier: 1.5,
      description: 'Privilege marker detected — all entities escalated 1.5x',
    },
  ],
};

// ─── 9.3 Healthcare Pack ────────────────────────────────────────────────────

export const HEALTHCARE_PACK: CompliancePack = {
  id: 'healthcare',
  name: 'Healthcare Pack',
  description: 'HIPAA-focused entity types for healthcare organizations',
  entities: [
    {
      name: 'MRN',
      pattern: /\b(?:MRN|medical\s+record(?:\s+(?:number|#|no\.?))?)[\s:#]*\d{4,10}\b/gi,
      confidence: 0.9,
      weight: 35,
      category: 'healthcare',
      description: 'Medical Record Numbers',
    },
    {
      name: 'ICD10_CODE',
      pattern: /\b[A-TV-Z]\d{2}(?:\.\d{1,4})?[A-Z]?\b/g,
      confidence: 0.7,
      weight: 15,
      category: 'healthcare',
      description: 'ICD-10 diagnosis codes (e.g., E11.65, M54.5)',
    },
    {
      name: 'DRUG_PRESCRIPTION',
      pattern: /\b(?:metformin|lisinopril|atorvastatin|amoxicillin|levothyroxine|metoprolol|omeprazole|amlodipine|simvastatin|losartan|gabapentin|hydrochlorothiazide|sertraline|fluoxetine|montelukast|escitalopram|rosuvastatin|bupropion|furosemide|pantoprazole|alprazolam|prednisone|tramadol|tamsulosin|duloxetine|venlafaxine|carvedilol|warfarin|clopidogrel|insulin)\s*(?:\d+\s*(?:mg|mcg|ml|units?|iu)(?:\s*(?:daily|bid|tid|qid|qhs|prn|po|iv|im|sc))?)/gi,
      confidence: 0.85,
      weight: 25,
      category: 'healthcare',
      description: 'Drug prescriptions with dosage',
    },
    {
      name: 'NPI_NUMBER',
      pattern: /\b(?:NPI|national\s+provider(?:\s+identifier)?)\s*[:#]?\s*\d{10}\b/gi,
      confidence: 0.85,
      weight: 20,
      category: 'healthcare',
      description: 'National Provider Identifier (10-digit)',
    },
    {
      name: 'PHI_COMBINATION',
      pattern: /\b(?:patient|pt\.?)\s*:?\s*[A-Z][a-z]+\s+[A-Z][a-z]+(?:.*?(?:DOB|date\s+of\s+birth|dx|diagnosis|MRN))/gis,
      confidence: 0.9,
      weight: 40,
      category: 'healthcare',
      description: 'PHI combination — patient name + health info (HIPAA violation)',
    },
  ],
  boostRules: [
    {
      triggerType: 'PHI_COMBINATION',
      multiplier: 1.5,
      description: 'PHI combination detected — HIPAA co-occurrence rule triggered',
    },
    {
      triggerType: 'MRN',
      multiplier: 1.2,
      description: 'Medical record number found — healthcare context escalation',
    },
  ],
};

// ─── 9.4 Financial Pack ─────────────────────────────────────────────────────

export const FINANCIAL_PACK: CompliancePack = {
  id: 'financial',
  name: 'Financial Pack',
  description: 'Entity types for financial services and investment firms',
  entities: [
    {
      name: 'SWIFT_CODE',
      pattern: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,
      confidence: 0.75,
      weight: 20,
      category: 'financial',
      description: 'SWIFT/BIC codes (8 or 11 alphanumeric)',
    },
    {
      name: 'CUSIP',
      pattern: /\b[0-9A-Z]{9}\b/g,
      confidence: 0.5, // Low confidence — needs context
      weight: 15,
      category: 'financial',
      description: 'CUSIP identifiers (9 alphanumeric)',
    },
    {
      name: 'ISIN',
      pattern: /\b[A-Z]{2}[A-Z0-9]{10}\b/g,
      confidence: 0.7,
      weight: 15,
      category: 'financial',
      description: 'ISIN codes (2 letter + 10 alphanumeric)',
    },
    {
      name: 'TRADING_ACCOUNT',
      pattern: /\b(?:account|acct|portfolio)\s*[:#]?\s*[A-Z0-9]{6,12}\b/gi,
      confidence: 0.75,
      weight: 25,
      category: 'financial',
      description: 'Trading/brokerage account numbers',
    },
    {
      name: 'MNPI_KEYWORD',
      pattern: /\b(?:material\s+non[- ]public|insider\s+(?:information|trading)|earnings\s+before\s+announcement|merger\s+not\s+yet\s+announced|pre[- ]release\s+earnings|confidential\s+(?:deal|transaction|acquisition)|non[- ]public\s+financial)/gi,
      confidence: 0.95,
      weight: 40,
      category: 'financial',
      description: 'MNPI keywords (material non-public information)',
    },
    {
      name: 'ROUTING_NUMBER',
      pattern: /\b(?:routing|aba|transit)\s*(?:#|no\.?|number)?\s*:?\s*\d{9}\b/gi,
      confidence: 0.85,
      weight: 25,
      category: 'financial',
      description: 'Bank routing/ABA numbers',
    },
  ],
  boostRules: [
    {
      triggerType: 'MNPI_KEYWORD',
      multiplier: 2.0,
      description: 'MNPI keyword detected — all entities marked as critical',
    },
  ],
};

// ─── Pack Registry ──────────────────────────────────────────────────────────

export const COMPLIANCE_PACKS: Record<string, CompliancePack> = {
  legal: LEGAL_PACK,
  healthcare: HEALTHCARE_PACK,
  financial: FINANCIAL_PACK,
};

/**
 * Get a compliance pack by ID.
 */
export function getCompliancePack(id: string): CompliancePack | undefined {
  return COMPLIANCE_PACKS[id];
}

/**
 * Get all available compliance packs.
 */
export function getAllCompliancePacks(): CompliancePack[] {
  return Object.values(COMPLIANCE_PACKS);
}

/**
 * Detect entities using one or more compliance packs.
 */
export function detectWithPacks(
  text: string,
  packIds: string[]
): { entities: DetectedEntity[]; multiplier: number; explanations: string[] } {
  let allEntities: DetectedEntity[] = [];
  let maxMultiplier = 1.0;
  const allExplanations: string[] = [];

  for (const packId of packIds) {
    const pack = COMPLIANCE_PACKS[packId];
    if (!pack) continue;

    const entities = detectCustomEntities(text, pack.entities);
    allEntities = allEntities.concat(entities);

    if (pack.boostRules) {
      const { multiplier, explanations } = applyBoostRules(entities, pack.boostRules);
      maxMultiplier = Math.max(maxMultiplier, multiplier);
      allExplanations.push(...explanations);
    }
  }

  return { entities: allEntities, multiplier: maxMultiplier, explanations: allExplanations };
}
