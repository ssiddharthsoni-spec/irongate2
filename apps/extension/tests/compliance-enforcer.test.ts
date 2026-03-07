import { describe, it, expect, beforeEach } from 'vitest';
import {
  enforceCompliance,
  setActiveFrameworks,
  getActiveFrameworks,
  COMPLIANCE_FRAMEWORKS,
} from '../src/shared/compliance-enforcer';
import type { DetectedEntity } from '../src/detection/types';

function entity(type: string, confidence = 0.9): DetectedEntity {
  return { type, text: 'test', start: 0, end: 4, confidence, source: 'regex' };
}

describe('Compliance Enforcer', () => {
  beforeEach(() => {
    setActiveFrameworks([]);
  });

  describe('enforceCompliance', () => {
    it('returns not blocked when no frameworks are active', () => {
      const result = enforceCompliance([entity('SSN')]);
      expect(result.blocked).toBe(false);
      expect(result.violations).toHaveLength(0);
    });

    it('blocks MEDICAL_RECORD when HIPAA is active', () => {
      setActiveFrameworks(['hipaa']);
      const result = enforceCompliance([entity('MEDICAL_RECORD')]);
      expect(result.blocked).toBe(true);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].frameworkId).toBe('hipaa');
      expect(result.violations[0].entityType).toBe('MEDICAL_RECORD');
    });

    it('blocks CREDIT_CARD when PCI-DSS is active', () => {
      setActiveFrameworks(['pci_dss']);
      const result = enforceCompliance([entity('CREDIT_CARD')]);
      expect(result.blocked).toBe(true);
      expect(result.violations[0].frameworkId).toBe('pci_dss');
    });

    it('blocks SSN when SOC 2 is active', () => {
      setActiveFrameworks(['soc2']);
      const result = enforceCompliance([entity('SSN')]);
      expect(result.blocked).toBe(true);
    });

    it('blocks API_KEY when SOC 2 is active', () => {
      setActiveFrameworks(['soc2']);
      const result = enforceCompliance([entity('API_KEY')]);
      expect(result.blocked).toBe(true);
    });

    it('blocks SSN when GDPR is active', () => {
      setActiveFrameworks(['gdpr']);
      const result = enforceCompliance([entity('SSN')]);
      expect(result.blocked).toBe(true);
    });

    it('blocks MNPI_KEYWORD when GLBA is active', () => {
      setActiveFrameworks(['glba']);
      const result = enforceCompliance([entity('MNPI_KEYWORD')]);
      expect(result.blocked).toBe(true);
    });

    it('does not block PERSON entities under any framework', () => {
      setActiveFrameworks(['hipaa', 'pci_dss', 'soc2', 'gdpr', 'ccpa', 'itar', 'glba']);
      const result = enforceCompliance([entity('PERSON')]);
      expect(result.blocked).toBe(false);
    });

    it('does not block low-confidence entities below framework threshold', () => {
      setActiveFrameworks(['hipaa']);
      // HIPAA minConfidence is 0.7
      const result = enforceCompliance([entity('MEDICAL_RECORD', 0.5)]);
      expect(result.blocked).toBe(false);
    });

    it('blocks entities at exactly the confidence threshold', () => {
      setActiveFrameworks(['hipaa']);
      const result = enforceCompliance([entity('MEDICAL_RECORD', 0.7)]);
      expect(result.blocked).toBe(true);
    });

    it('reports multiple violations across frameworks', () => {
      setActiveFrameworks(['hipaa', 'soc2']);
      const result = enforceCompliance([
        entity('MEDICAL_RECORD'),
        entity('SSN'),
      ]);
      expect(result.blocked).toBe(true);
      // SSN is blocked by both HIPAA and SOC2, MEDICAL_RECORD by HIPAA
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
    });

    it('accepts override framework IDs parameter', () => {
      setActiveFrameworks([]); // No cached frameworks
      const result = enforceCompliance([entity('CREDIT_CARD')], ['pci_dss']);
      expect(result.blocked).toBe(true);
    });

    it('generates a human-readable reason', () => {
      setActiveFrameworks(['hipaa']);
      const result = enforceCompliance([entity('MEDICAL_RECORD')]);
      expect(result.reason).toContain('HIPAA');
      expect(result.reason).toContain('medical record');
    });

    it('ignores unknown framework IDs', () => {
      setActiveFrameworks(['unknown_framework']);
      const result = enforceCompliance([entity('SSN')]);
      expect(result.blocked).toBe(false);
    });
  });

  describe('framework cache', () => {
    it('stores and retrieves active frameworks', () => {
      setActiveFrameworks(['hipaa', 'soc2']);
      expect(getActiveFrameworks()).toEqual(['hipaa', 'soc2']);
    });

    it('filters out invalid framework IDs', () => {
      setActiveFrameworks(['hipaa', 'nonexistent', 'soc2']);
      expect(getActiveFrameworks()).toEqual(['hipaa', 'soc2']);
    });
  });

  describe('all 7 frameworks registered', () => {
    it('has hipaa, pci_dss, soc2, gdpr, ccpa, itar, glba', () => {
      const ids = Object.keys(COMPLIANCE_FRAMEWORKS);
      expect(ids).toContain('hipaa');
      expect(ids).toContain('pci_dss');
      expect(ids).toContain('soc2');
      expect(ids).toContain('gdpr');
      expect(ids).toContain('ccpa');
      expect(ids).toContain('itar');
      expect(ids).toContain('glba');
      expect(ids).toHaveLength(7);
    });
  });
});
