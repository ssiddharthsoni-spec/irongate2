/**
 * Industry Compliance Packs Tests — Priority 9
 */

import { describe, it, expect } from 'vitest';
import {
  detectCustomEntities,
  applyBoostRules,
  detectWithPacks,
  LEGAL_PACK,
  HEALTHCARE_PACK,
  FINANCIAL_PACK,
  getAllCompliancePacks,
  getCompliancePack,
} from '../src/shared/compliance-packs';

// ─── Pack Registry ──────────────────────────────────────────────────────────

describe('Compliance Pack Registry', () => {
  it('has 3 packs available', () => {
    expect(getAllCompliancePacks()).toHaveLength(3);
  });

  it('returns legal pack by ID', () => {
    expect(getCompliancePack('legal')).toBe(LEGAL_PACK);
  });

  it('returns healthcare pack by ID', () => {
    expect(getCompliancePack('healthcare')).toBe(HEALTHCARE_PACK);
  });

  it('returns financial pack by ID', () => {
    expect(getCompliancePack('financial')).toBe(FINANCIAL_PACK);
  });

  it('returns undefined for unknown pack', () => {
    expect(getCompliancePack('unknown')).toBeUndefined();
  });
});

// ─── Legal Pack ─────────────────────────────────────────────────────────────

describe('Legal Pack', () => {
  it('detects case citations (Smith v. Jones)', () => {
    const text = 'As established in Smith v. Jones, the precedent is clear.';
    const entities = detectCustomEntities(text, LEGAL_PACK.entities);
    expect(entities.some((e) => e.type === 'CASE_CITATION')).toBe(true);
  });

  it('detects privilege markers', () => {
    const text = 'This document is privileged and confidential.';
    const entities = detectCustomEntities(text, LEGAL_PACK.entities);
    expect(entities.some((e) => e.type === 'PRIVILEGE_MARKER')).toBe(true);
  });

  it('detects attorney-client privilege', () => {
    const text = 'Protected by attorney-client privilege.';
    const entities = detectCustomEntities(text, LEGAL_PACK.entities);
    const markers = entities.filter((e) => e.type === 'PRIVILEGE_MARKER');
    expect(markers.length).toBeGreaterThanOrEqual(1);
  });

  it('detects work product doctrine', () => {
    const text = 'This is work product doctrine protected.';
    const entities = detectCustomEntities(text, LEGAL_PACK.entities);
    expect(entities.some((e) => e.type === 'PRIVILEGE_MARKER')).toBe(true);
  });

  it('detects court filing numbers', () => {
    const text = 'Filed as case no. 1:24-cv-01234 in federal court.';
    const entities = detectCustomEntities(text, LEGAL_PACK.entities);
    expect(entities.some((e) => e.type === 'COURT_FILING')).toBe(true);
  });

  it('detects bar numbers', () => {
    const text = 'Attorney Jane Smith, Bar No. 123456, representing the plaintiff.';
    const entities = detectCustomEntities(text, LEGAL_PACK.entities);
    expect(entities.some((e) => e.type === 'BAR_NUMBER')).toBe(true);
  });

  it('applies privilege boost rule (1.5x)', () => {
    const text = 'This is privileged and confidential communication.';
    const entities = detectCustomEntities(text, LEGAL_PACK.entities);
    const { multiplier } = applyBoostRules(entities, LEGAL_PACK.boostRules!);
    expect(multiplier).toBe(1.5);
  });

  it('no boost when no privilege markers', () => {
    const text = 'The meeting is scheduled for Monday.';
    const entities = detectCustomEntities(text, LEGAL_PACK.entities);
    const { multiplier } = applyBoostRules(entities, LEGAL_PACK.boostRules!);
    expect(multiplier).toBe(1.0);
  });
});

// ─── Healthcare Pack ────────────────────────────────────────────────────────

describe('Healthcare Pack', () => {
  it('detects MRN numbers', () => {
    const text = 'Patient MRN: 12345678 requires follow-up.';
    const entities = detectCustomEntities(text, HEALTHCARE_PACK.entities);
    expect(entities.some((e) => e.type === 'MRN')).toBe(true);
  });

  it('detects medical record number with full label', () => {
    const text = 'Medical record number 87654321';
    const entities = detectCustomEntities(text, HEALTHCARE_PACK.entities);
    expect(entities.some((e) => e.type === 'MRN')).toBe(true);
  });

  it('detects ICD-10 codes', () => {
    const text = 'Diagnosis: E11.65 (Type 2 diabetes with hyperglycemia)';
    const entities = detectCustomEntities(text, HEALTHCARE_PACK.entities);
    expect(entities.some((e) => e.type === 'ICD10_CODE')).toBe(true);
  });

  it('detects drug prescriptions with dosage', () => {
    const text = 'Prescribed metformin 500mg daily.';
    const entities = detectCustomEntities(text, HEALTHCARE_PACK.entities);
    expect(entities.some((e) => e.type === 'DRUG_PRESCRIPTION')).toBe(true);
  });

  it('detects NPI numbers', () => {
    const text = 'Provider NPI: 1234567890 for Dr. Smith.';
    const entities = detectCustomEntities(text, HEALTHCARE_PACK.entities);
    expect(entities.some((e) => e.type === 'NPI_NUMBER')).toBe(true);
  });

  it('applies PHI combination boost (1.5x)', () => {
    const text = 'Patient: John Smith, DOB 01/15/1980, diagnosis hypertension.';
    const entities = detectCustomEntities(text, HEALTHCARE_PACK.entities);
    if (entities.some((e) => e.type === 'PHI_COMBINATION')) {
      const { multiplier } = applyBoostRules(entities, HEALTHCARE_PACK.boostRules!);
      expect(multiplier).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('applies MRN boost (1.2x)', () => {
    const text = 'MRN: 12345678';
    const entities = detectCustomEntities(text, HEALTHCARE_PACK.entities);
    const { multiplier } = applyBoostRules(entities, HEALTHCARE_PACK.boostRules!);
    expect(multiplier).toBe(1.2);
  });
});

// ─── Financial Pack ─────────────────────────────────────────────────────────

describe('Financial Pack', () => {
  it('detects MNPI keywords', () => {
    const text = 'This contains material non-public information about the acquisition.';
    const entities = detectCustomEntities(text, FINANCIAL_PACK.entities);
    expect(entities.some((e) => e.type === 'MNPI_KEYWORD')).toBe(true);
  });

  it('detects insider trading keywords', () => {
    const text = 'Be aware of insider information regulations.';
    const entities = detectCustomEntities(text, FINANCIAL_PACK.entities);
    expect(entities.some((e) => e.type === 'MNPI_KEYWORD')).toBe(true);
  });

  it('detects routing numbers', () => {
    const text = 'Wire to routing number 021000021.';
    const entities = detectCustomEntities(text, FINANCIAL_PACK.entities);
    expect(entities.some((e) => e.type === 'ROUTING_NUMBER')).toBe(true);
  });

  it('applies MNPI boost (2.0x)', () => {
    const text = 'Confidential: material non-public information about merger.';
    const entities = detectCustomEntities(text, FINANCIAL_PACK.entities);
    const { multiplier } = applyBoostRules(entities, FINANCIAL_PACK.boostRules!);
    expect(multiplier).toBe(2.0);
  });

  it('no boost without MNPI keywords', () => {
    const text = 'Normal financial report for Q3.';
    const entities = detectCustomEntities(text, FINANCIAL_PACK.entities);
    const { multiplier } = applyBoostRules(entities, FINANCIAL_PACK.boostRules!);
    expect(multiplier).toBe(1.0);
  });
});

// ─── Multi-Pack Detection ───────────────────────────────────────────────────

describe('detectWithPacks', () => {
  it('detects from multiple packs simultaneously', () => {
    const text = 'Attorney-client privilege: Patient MRN 12345678, material non-public information.';
    const result = detectWithPacks(text, ['legal', 'healthcare', 'financial']);
    expect(result.entities.length).toBeGreaterThan(0);
    const types = new Set(result.entities.map((e) => e.type));
    expect(types.has('PRIVILEGE_MARKER')).toBe(true);
    expect(types.has('MRN')).toBe(true);
    expect(types.has('MNPI_KEYWORD')).toBe(true);
  });

  it('applies highest multiplier from all packs', () => {
    const text = 'Material non-public information about merger.';
    const result = detectWithPacks(text, ['legal', 'financial']);
    // MNPI boost is 2.0x (highest)
    expect(result.multiplier).toBe(2.0);
  });

  it('handles unknown pack IDs gracefully', () => {
    const result = detectWithPacks('test', ['unknown', 'also-unknown']);
    expect(result.entities).toHaveLength(0);
    expect(result.multiplier).toBe(1.0);
  });

  it('returns empty for text with no matches', () => {
    const result = detectWithPacks('What is the weather today?', ['legal']);
    expect(result.entities).toHaveLength(0);
  });
});
