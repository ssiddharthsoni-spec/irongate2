/**
 * Compliance Enforcement Engine — IG-002
 *
 * Enforces compliance framework rules at the extension level.
 * When a firm has an active compliance profile (HIPAA, SOC2, PCI-DSS, etc.),
 * specific entity types trigger BLOCK regardless of sensitivity score.
 *
 * This is the extension-side enforcement layer. The API-side compliance routes
 * handle audit logging and reporting.
 */

import type { DetectedEntity } from '../detection/types';

// ─── Framework → Blocked Entity Types ────────────────────────────────────────
// If ANY of these entity types are detected while the framework is active,
// the prompt is blocked unconditionally — no score-based override.

export interface ComplianceFramework {
  id: string;
  name: string;
  /** Entity types that trigger mandatory block */
  blockedEntityTypes: ReadonlySet<string>;
  /** Minimum confidence to trigger block (prevents low-confidence false positives from blocking) */
  minConfidence: number;
}

const HIPAA: ComplianceFramework = {
  id: 'hipaa',
  name: 'HIPAA',
  blockedEntityTypes: new Set([
    'MEDICAL_RECORD', 'MRN', 'PHI_COMBINATION', 'NPI_NUMBER',
    'DRUG_PRESCRIPTION', 'ICD10_CODE',
    // PHI includes PII when combined with health data
    'SSN', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  ]),
  minConfidence: 0.7,
};

const PCI_DSS: ComplianceFramework = {
  id: 'pci_dss',
  name: 'PCI-DSS',
  blockedEntityTypes: new Set([
    'CREDIT_CARD', 'ACCOUNT_NUMBER', 'ROUTING_NUMBER',
    'TRADING_ACCOUNT', 'SWIFT_CODE',
  ]),
  minConfidence: 0.75,
};

const SOC2: ComplianceFramework = {
  id: 'soc2',
  name: 'SOC 2',
  blockedEntityTypes: new Set([
    'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER',
    'DRIVERS_LICENSE', 'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL',
    'DATABASE_URI', 'PRIVATE_KEY', 'AUTH_TOKEN',
  ]),
  minConfidence: 0.7,
};

const GDPR: ComplianceFramework = {
  id: 'gdpr',
  name: 'GDPR',
  blockedEntityTypes: new Set([
    'SSN', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
    'MEDICAL_RECORD', 'CREDIT_CARD',
    // GDPR special categories
    'PHI_COMBINATION', 'MRN',
  ]),
  minConfidence: 0.7,
};

const CCPA: ComplianceFramework = {
  id: 'ccpa',
  name: 'CCPA',
  blockedEntityTypes: new Set([
    'SSN', 'DRIVERS_LICENSE', 'PASSPORT_NUMBER',
    'CREDIT_CARD', 'ACCOUNT_NUMBER',
  ]),
  minConfidence: 0.7,
};

const ITAR: ComplianceFramework = {
  id: 'itar',
  name: 'ITAR',
  blockedEntityTypes: new Set([
    'PASSPORT_NUMBER', 'PRIVATE_KEY', 'AWS_CREDENTIAL',
    'GCP_CREDENTIAL', 'DATABASE_URI',
  ]),
  minConfidence: 0.6,
};

const GLBA: ComplianceFramework = {
  id: 'glba',
  name: 'GLBA',
  blockedEntityTypes: new Set([
    'SSN', 'CREDIT_CARD', 'ACCOUNT_NUMBER', 'ROUTING_NUMBER',
    'TRADING_ACCOUNT', 'SWIFT_CODE', 'MNPI_KEYWORD',
  ]),
  minConfidence: 0.7,
};

const FERPA: ComplianceFramework = {
  id: 'ferpa',
  name: 'FERPA',
  blockedEntityTypes: new Set([
    'STUDENT_ID', 'EDUCATION_RECORD',
    // Student records + PII = FERPA violation
    'SSN', 'DATE_OF_BIRTH', 'DRIVERS_LICENSE',
  ]),
  minConfidence: 0.65,
};

export const COMPLIANCE_FRAMEWORKS: Record<string, ComplianceFramework> = {
  hipaa: HIPAA,
  pci_dss: PCI_DSS,
  soc2: SOC2,
  gdpr: GDPR,
  ccpa: CCPA,
  itar: ITAR,
  glba: GLBA,
  ferpa: FERPA,
};

// ─── Enforcement Result ──────────────────────────────────────────────────────

export interface ComplianceViolation {
  frameworkId: string;
  frameworkName: string;
  entityType: string;
  entityConfidence: number;
}

export interface ComplianceEnforcementResult {
  /** Whether ANY compliance framework mandates blocking */
  blocked: boolean;
  /** List of violations that triggered the block */
  violations: ComplianceViolation[];
  /** Human-readable explanation for the user */
  reason: string;
  /** Active framework IDs checked */
  activeFrameworks: string[];
}

// ─── Cached Compliance Profile ───────────────────────────────────────────────

let _cachedFrameworks: string[] = [];
let _profileLastFetch = 0;
const PROFILE_CACHE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Set the active compliance frameworks directly (called from managed config or API).
 */
export function setActiveFrameworks(frameworkIds: string[]): void {
  _cachedFrameworks = frameworkIds.filter(id => id in COMPLIANCE_FRAMEWORKS);
  _profileLastFetch = Date.now();
}

/**
 * Get the currently cached active frameworks.
 */
export function getActiveFrameworks(): string[] {
  return [..._cachedFrameworks];
}

/**
 * Check whether the compliance profile cache needs refresh.
 */
export function needsProfileRefresh(): boolean {
  return Date.now() - _profileLastFetch > PROFILE_CACHE_MS;
}

/**
 * Enforce compliance rules against detected entities.
 * Returns a result indicating whether the prompt should be blocked.
 */
export function enforceCompliance(
  entities: DetectedEntity[],
  activeFrameworkIds?: string[],
): ComplianceEnforcementResult {
  const frameworkIds = activeFrameworkIds || _cachedFrameworks;

  if (frameworkIds.length === 0) {
    return { blocked: false, violations: [], reason: '', activeFrameworks: [] };
  }

  const violations: ComplianceViolation[] = [];

  for (const fwId of frameworkIds) {
    const framework = COMPLIANCE_FRAMEWORKS[fwId];
    if (!framework) continue;

    for (const entity of entities) {
      if (
        framework.blockedEntityTypes.has(entity.type) &&
        entity.confidence >= framework.minConfidence
      ) {
        violations.push({
          frameworkId: framework.id,
          frameworkName: framework.name,
          entityType: entity.type,
          entityConfidence: entity.confidence,
        });
      }
    }
  }

  if (violations.length === 0) {
    return { blocked: false, violations: [], reason: '', activeFrameworks: frameworkIds };
  }

  // Deduplicate frameworks in the reason
  const triggeredFrameworks = [...new Set(violations.map(v => v.frameworkName))];
  const triggeredTypes = [...new Set(violations.map(v => v.entityType.replace(/_/g, ' ').toLowerCase()))];

  const reason = `Blocked by ${triggeredFrameworks.join(', ')} compliance: ` +
    `${triggeredTypes.join(', ')} detected. ` +
    `Your organization's compliance policy prohibits sending this data to AI tools.`;

  return {
    blocked: true,
    violations,
    reason,
    activeFrameworks: frameworkIds,
  };
}
